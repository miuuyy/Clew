from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import math
import secrets
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import urlencode

import httpx
import jwt

ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
SHARING_SCOPE = "chatgpt.tokens.use.direct"
CALLBACK_PATH = "/auth/callback"
DYNAMIC_CLIENT = "dynamic_agent_client"
LOGIN_TTL_SECONDS = 600
REFRESH_MARGIN_SECONDS = 60


class ChatGPTError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status = status


# Messages for documented Sign in with ChatGPT error codes. Unknown codes keep the server message.
API_ERRORS = {
    "subscription_sharing_user_not_eligible": "This ChatGPT account cannot share its plan with apps. Clew requires ChatGPT Plus or Pro.",
    "subscription_sharing_usage_limit_exceeded": "Your ChatGPT plan limit for apps has been reached. Check usage in ChatGPT Settings.",
    "subscription_sharing_usage_unavailable": "ChatGPT usage could not be checked. Try again shortly.",
    "subscription_sharing_unsupported_capability": "ChatGPT plan sharing does not support a capability this request uses.",
    "subscription_sharing_route_not_supported": "ChatGPT plan sharing does not support this API route.",
    "subscription_sharing_invalid_user": "ChatGPT could not validate this account's subscription. Sign in again.",
    "subscription_sharing_user_unavailable": "Your ChatGPT account is temporarily unavailable. Try again shortly.",
    "invalid_grant": "ChatGPT did not accept this sign-in. Sign in again.",
    "invalid_refresh_token": "Your ChatGPT connection can no longer be renewed. Sign in again.",
    "refresh_token_expired": "Your ChatGPT connection can no longer be renewed. Sign in again.",
    "refresh_token_invalidated": "Your ChatGPT connection can no longer be renewed. Sign in again.",
    "refresh_token_reused": "Your ChatGPT connection can no longer be renewed. Sign in again.",
    "token_expired": "Your ChatGPT connection can no longer be renewed. Sign in again.",
    "invalid_token": "ChatGPT did not accept this credential. Sign in again.",
    "access_denied": "Sign-in was not completed.",
    "model_not_found": "This model is not available for your ChatGPT plan. Choose another model.",
}
RETRYABLE = {"subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable"}
REJECTED_CREDENTIALS = {"invalid_grant", "invalid_refresh_token", "refresh_token_expired",
                        "refresh_token_invalidated", "refresh_token_reused", "token_expired",
                        "invalid_token", "subscription_sharing_invalid_user"}


def transport_error(exc: httpx.HTTPError) -> ChatGPTError:
    return ChatGPTError("transport_error", "Clew could not reach ChatGPT. Check your connection and try again.", retryable=True)


def api_error(body: object, status: int | None = None) -> ChatGPTError:
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, str):
        code, message = error, (body.get("error_description") if isinstance(body, dict) else None)
    elif isinstance(error, dict):
        code, message = error.get("code") or error.get("type"), error.get("message")
    else:
        # Some validation failures arrive as {"detail": "..."} without an error code.
        detail = body.get("detail") if isinstance(body, dict) else None
        code, message = None, detail if isinstance(detail, str) else None
    # Earlier responses used a v2 infix for the same sharing errors.
    code = str(code or "request_failed").replace("subscription_sharing_v2_", "subscription_sharing_", 1)
    text = API_ERRORS.get(code) or (str(message) if message else f"ChatGPT request failed ({status or 'no status'}).")
    retryable = code in RETRYABLE or (status is not None and status >= 500)
    return ChatGPTError(code, text, retryable=retryable, status=status)


class CredentialStore(Protocol):
    def read(self) -> dict | None: ...
    def write(self, value: dict) -> None: ...
    def delete(self) -> None: ...


class KeyringCredentialStore:
    """OS credential storage. There is no plaintext fallback for tokens."""

    service = "Clew · Sign in with ChatGPT"
    account = "connection"

    def __init__(self, account: str = "connection"):
        self.account = account

    def _keyring(self):
        try:
            import keyring
            from keyring.backends.fail import Keyring as FailKeyring
        except ImportError as exc:
            raise ChatGPTError("credential_storage_unavailable", "Install the keyring package to store ChatGPT credentials.") from exc
        try:
            backend = keyring.get_keyring()
        except keyring.errors.KeyringError as exc:
            raise ChatGPTError("credential_storage_unavailable", "The OS credential store could not be opened.") from exc
        if isinstance(backend, FailKeyring) or getattr(backend, "priority", 1) <= 0:
            raise ChatGPTError("credential_storage_unavailable", "No OS credential store is available, so Clew cannot keep a ChatGPT sign-in.")
        return keyring

    def read(self) -> dict | None:
        keyring = self._keyring()
        try:
            raw = keyring.get_password(self.service, self.account)
        except keyring.errors.KeyringError as exc:
            raise ChatGPTError("credential_storage_unavailable", "The OS credential store could not be read.") from exc
        if raw is None:
            return None
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ChatGPTError("credential_storage_corrupt", "The saved ChatGPT connection is unreadable. Sign out and sign in again.") from exc
        if not isinstance(value, dict):
            raise ChatGPTError("credential_storage_corrupt", "The saved ChatGPT connection is unreadable. Sign out and sign in again.")
        return value

    def write(self, value: dict) -> None:
        keyring = self._keyring()
        try:
            keyring.set_password(self.service, self.account, json.dumps(value))
        except keyring.errors.KeyringError as exc:
            raise ChatGPTError("credential_storage_unavailable", "The OS credential store could not save the ChatGPT connection.") from exc

    def delete(self) -> None:
        keyring = self._keyring()
        try:
            keyring.delete_password(self.service, self.account)
        except keyring.errors.PasswordDeleteError as exc:
            # Backends also use this error when no password exists. Confirm absence;
            # a failed deletion must never be reported as a successful sign-out.
            try:
                remaining = keyring.get_password(self.service, self.account)
            except keyring.errors.KeyringError as read_error:
                raise ChatGPTError("credential_storage_unavailable", "The OS credential store could not confirm removal of the ChatGPT connection.") from read_error
            if remaining is not None:
                raise ChatGPTError("credential_storage_unavailable", "The OS credential store could not remove the ChatGPT connection.") from exc
        except keyring.errors.KeyringError as exc:
            raise ChatGPTError("credential_storage_unavailable", "The OS credential store could not remove the ChatGPT connection.") from exc


@dataclass
class PendingLogin:
    login_id: str
    state: str
    nonce: str
    verifier: str
    redirect_uri: str
    created_at: float
    auth_url: str
    client_id: str
    subject: str | None


def _random() -> str:
    return secrets.token_urlsafe(32)


def _challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class ChatGPTAuth:
    """Sign in with ChatGPT: OAuth 2.0 + PKCE with an OIDC identity and plan-sharing scope.

    Tokens live in the OS credential store. The issued client registration and the
    account label are not secret and live next to the local database."""

    def __init__(self, *, redirect_uri: str, registration_path: Path, store: CredentialStore | None = None,
                 http: httpx.AsyncClient | None = None, app_name: str = "Clew"):
        self.redirect_uri = redirect_uri
        self.registration_path = registration_path
        self.store = store or KeyringCredentialStore()
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(30, read=180))
        self.app_name = app_name
        self.pending: PendingLogin | None = None
        self.completing: PendingLogin | None = None
        self.last_error: str | None = None
        self._discovery: dict | None = None
        self._jwks: dict | None = None
        self._refresh_lock = asyncio.Lock()
        # Canceling a browser login must not discard a concurrent token rotation.
        self._generation = 0
        self._login_generation = 0

    def _check_generation(self, generation: int, *, login: bool = False) -> None:
        if generation != (self._login_generation if login else self._generation):
            raise ChatGPTError("connection_changed", "The ChatGPT connection changed while this request was running. Try again from Clew.")

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            return await self.http.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise transport_error(exc) from exc

    # Registration and account label (not secret)

    def registration(self) -> dict:
        try:
            value = json.loads(self.registration_path.read_text())
            return value if isinstance(value, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save_registration(self, **values) -> None:
        self.registration_path.parent.mkdir(parents=True, exist_ok=True)
        merged = {**self.registration(), **values}
        temporary = self.registration_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(merged, indent=2))
        temporary.chmod(0o600)
        temporary.replace(self.registration_path)

    # Provider metadata

    async def discovery(self) -> dict:
        if self._discovery is None:
            response = await self._request("GET", f"{ISSUER}/.well-known/openid-configuration")
            try:
                data = response.json()
            except ValueError:
                data = None
            if response.status_code != 200 or not isinstance(data, dict) or data.get("issuer") != ISSUER:
                raise ChatGPTError("discovery_failed", "ChatGPT sign-in configuration could not be verified.", retryable=True)
            for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
                if not isinstance(data.get(key), str) or not data[key].startswith(ISSUER + "/"):
                    raise ChatGPTError("discovery_failed", "ChatGPT sign-in configuration could not be verified.", retryable=True)
            revocation = data.get("revocation_endpoint")
            if revocation is not None and (not isinstance(revocation, str) or not revocation.startswith(ISSUER + "/")):
                raise ChatGPTError("discovery_failed", "ChatGPT sign-in configuration could not be verified.", retryable=True)
            self._discovery = data
        return self._discovery

    async def _signing_key(self, kid: str | None) -> jwt.PyJWK:
        for attempt in range(2):
            if self._jwks is None or attempt:
                response = await self._request("GET", (await self.discovery())["jwks_uri"])
                try:
                    body = response.json() if response.status_code == 200 else None
                except ValueError:
                    body = None
                if (not isinstance(body, dict) or not isinstance(body.get("keys"), list)
                        or not all(isinstance(key, dict) for key in body["keys"])):
                    raise ChatGPTError("identity_verification_unavailable", "ChatGPT identity verification is temporarily unavailable. Try again shortly.", retryable=True)
                self._jwks = body
            match = next((key for key in self._jwks["keys"] if key.get("kid") == kid), None)
            if match is not None:
                try:
                    key = jwt.PyJWK(match, algorithm="RS256")
                    if match.get("kty") != "RSA" or match.get("alg", "RS256") != "RS256" or match.get("use", "sig") != "sig":
                        raise ValueError("Not an RS256 signing key")
                    return key
                except (jwt.PyJWTError, ValueError, TypeError, KeyError) as exc:
                    self._jwks = None
                    raise ChatGPTError("identity_verification_unavailable", "ChatGPT returned an invalid identity signing key. Try again shortly.", retryable=True) from exc
        raise ChatGPTError("identity_verification_unavailable", "ChatGPT identity verification is temporarily unavailable. Try again shortly.", retryable=True)

    async def verify_identity(self, id_token: str, client_id: str, nonce: str | None) -> dict:
        try:
            header = jwt.get_unverified_header(id_token)
        except (jwt.PyJWTError, TypeError, ValueError, OverflowError) as exc:
            raise ChatGPTError("invalid_id_token", "The ChatGPT identity could not be verified. Sign in again.") from exc
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str) or not header["kid"]:
            raise ChatGPTError("invalid_id_token", "The ChatGPT identity could not be verified. Sign in again.")
        key = await self._signing_key(header["kid"])
        try:
            claims = jwt.decode(id_token, key=key, algorithms=["RS256"], audience=client_id, issuer=ISSUER,
                                leeway=5, options={"require": ["iss", "aud", "exp", "iat", "sub"]})
        except (jwt.PyJWTError, TypeError, ValueError, OverflowError) as exc:
            raise ChatGPTError("invalid_id_token", "The ChatGPT identity could not be verified. Sign in again.") from exc
        audience = claims.get("aud")
        if (not isinstance(claims.get("sub"), str) or not claims["sub"]
                or (nonce is not None and claims.get("nonce") != nonce)
                or (claims.get("azp") is not None and claims["azp"] != client_id)
                or (isinstance(audience, list) and len(audience) > 1 and claims.get("azp") != client_id)):
            raise ChatGPTError("invalid_id_token", "The ChatGPT identity could not be verified. Sign in again.")
        return {"subject": claims["sub"], "email": claims.get("email") if isinstance(claims.get("email"), str) else None,
                "name": claims.get("name") if isinstance(claims.get("name"), str) else None}

    async def _token_request(self, form: dict) -> dict:
        response = await self._request("POST", (await self.discovery())["token_endpoint"], data=form,
                                        headers={"accept": "application/json"})
        try:
            data = response.json()
        except ValueError:
            data = None
        if response.status_code != 200:
            raise api_error(data, response.status_code)
        if not isinstance(data, dict):
            raise ChatGPTError("invalid_token_response", "ChatGPT returned an invalid token response. Sign in again.")
        return data

    @staticmethod
    def _credentials(data: dict, previous_scopes: list[str] | None = None) -> dict:
        scope = data.get("scope")
        scopes = scope.split() if isinstance(scope, str) else previous_scopes if scope is None else None
        if scopes is None:
            raise ChatGPTError("invalid_token_response", "ChatGPT did not confirm the granted permissions. Sign in again.")
        expires_in = data.get("expires_in")
        if (not isinstance(data.get("access_token"), str) or not data["access_token"]
                or str(data.get("token_type", "")).lower() != "bearer"
                or isinstance(expires_in, bool) or not isinstance(expires_in, (int, float))
                or not math.isfinite(expires_in) or expires_in <= 0
                or not isinstance(data.get("refresh_token"), str) or not data["refresh_token"]):
            raise ChatGPTError("invalid_token_response", "ChatGPT returned incomplete credentials. Sign in again.")
        return {"access_token": data["access_token"], "refresh_token": data["refresh_token"],
                "expires_at": time.time() + float(expires_in), "scopes": scopes}

    # Sign-in flow

    async def start_login(self) -> PendingLogin:
        if self.completing:
            return self.completing
        if self.pending and time.time() - self.pending.created_at < LOGIN_TTL_SECONDS:
            return self.pending
        self._login_generation += 1
        generation = self._login_generation
        provider = await self.discovery()
        self._check_generation(generation, login=True)
        registration = self.registration()
        host_id = registration.get("ext_agent_host_id")
        if not host_id:
            host_id = f"urn:uuid:{uuid.uuid4()}"
            self._save_registration(ext_agent_host_id=host_id)
        state, nonce, verifier = _random(), _random(), _random()
        params = {
            "client_id": registration.get("client_id") or DYNAMIC_CLIENT,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": SCOPES,
            "resource": RESOURCE,
            "ext_agent_host_id": host_id,
            "state": state,
            "nonce": nonce,
            "code_challenge_method": "S256",
            "code_challenge": _challenge(verifier),
        }
        if not registration.get("client_id"):
            params["agent_name_hint"] = self.app_name
        if registration.get("email"):
            params["login_hint"] = registration["email"]
        auth_url = f"{provider['authorization_endpoint']}?{urlencode(params)}"
        self.last_error = None
        self.pending = PendingLogin(login_id=_random()[:16], state=state, nonce=nonce, verifier=verifier,
                                    redirect_uri=self.redirect_uri, created_at=time.time(), auth_url=auth_url,
                                    client_id=params["client_id"], subject=registration.get("subject"))
        return self.pending

    def cancel_login(self) -> None:
        self._login_generation += 1
        self.pending = None
        self.completing = None

    async def complete_login(self, query: dict[str, list[str]]) -> None:
        pending = self.pending
        states = query.get("state", [])
        if (pending is None or len(states) != 1 or not states[0].isascii()
                or not hmac.compare_digest(states[0], pending.state)):
            raise ChatGPTError("invalid_state", "This sign-in link is not the one Clew started. Start sign-in again from Clew.")
        self.pending = None
        self.completing = pending
        generation = self._login_generation
        try:
            if time.time() - pending.created_at > LOGIN_TTL_SECONDS:
                raise ChatGPTError("login_expired", "Sign-in took too long. Start it again from Clew.")
            if query.get("error"):
                raise api_error({"error": query["error"][0], "error_description": (query.get("error_description") or [None])[0]})
            codes, client_ids = query.get("code", []), query.get("client_id", [])
            saved = pending.client_id if pending.client_id != DYNAMIC_CLIENT else None
            client_id = client_ids[0] if len(client_ids) == 1 else saved
            if (len(codes) != 1 or len(client_ids) > 1 or not client_id or client_id == DYNAMIC_CLIENT
                    or not all(c.isalnum() or c in "-_" for c in client_id) or len(client_id) > 200
                    or (saved and client_ids and client_ids[0] != saved)):
                raise ChatGPTError("registration_incomplete", "ChatGPT did not complete app registration. Try signing in again.")
            # Keep the issued registration before the one-time code exchange can fail.
            self._save_registration(client_id=client_id)
            data = await self._token_request({"grant_type": "authorization_code", "client_id": client_id,
                                              "code": codes[0], "code_verifier": pending.verifier,
                                              "redirect_uri": pending.redirect_uri, "resource": RESOURCE})
            if not isinstance(data.get("id_token"), str):
                raise ChatGPTError("invalid_id_token", "ChatGPT did not return a verifiable identity. Sign in again.")
            identity = await self.verify_identity(data["id_token"], client_id, pending.nonce)
            self._check_generation(generation, login=True)
            if pending.subject and identity["subject"] != pending.subject:
                raise ChatGPTError("account_mismatch", "This sign-in does not match the registered ChatGPT account.")
            credentials = self._credentials(data)
            self._generation += 1
            self._save_registration(subject=identity["subject"], email=identity["email"], name=identity["name"])
            self.store.write({"client_id": client_id, "subject": identity["subject"],
                              "id_token": data["id_token"], **credentials})
            self.last_error = None
        except ChatGPTError as exc:
            if generation == self._login_generation:
                self.last_error = str(exc)
            raise
        finally:
            if self.completing is pending:
                self.completing = None

    # Session

    def connection(self) -> dict | None:
        connection = self.store.read()
        if connection is None:
            return None
        expires = connection.get("expires_at") if isinstance(connection, dict) else None
        if (not isinstance(connection, dict)
                or any(not isinstance(connection.get(key), str) or not connection[key]
                       for key in ("client_id", "subject", "access_token", "refresh_token"))
                or isinstance(expires, bool) or not isinstance(expires, (int, float)) or not math.isfinite(expires)
                or not isinstance(connection.get("scopes"), list)
                or not all(isinstance(scope, str) for scope in connection["scopes"])):
            raise ChatGPTError("credential_storage_corrupt", "The saved ChatGPT connection is incomplete. Sign out and sign in again.")
        registration = self.registration()
        if (connection["client_id"] != registration.get("client_id")
                or connection["subject"] != registration.get("subject")):
            raise ChatGPTError("credential_storage_corrupt", "The saved ChatGPT connection does not match this Clew install. Sign out and sign in again.")
        return connection

    def status(self) -> dict:
        registration = self.registration()
        try:
            connection = self.connection()
        except ChatGPTError as exc:
            return {"authenticated": False, "sharing": False, "can_disconnect": exc.code == "credential_storage_corrupt",
                    "account": None, "error": str(exc)}
        if connection is None:
            return {"authenticated": False, "sharing": False, "can_disconnect": False, "account": None, "error": self.last_error}
        sharing = SHARING_SCOPE in connection.get("scopes", [])
        return {"authenticated": True, "sharing": sharing, "can_disconnect": True,
                "account": {"email": registration.get("email"), "name": registration.get("name")},
                "error": self.last_error or (None if sharing else "Plan sharing was not granted. Sign in again and allow Clew to use your ChatGPT plan.")}

    async def access_token(self) -> str:
        connection = self.connection()
        if connection is None:
            raise ChatGPTError("not_signed_in", "Sign in with ChatGPT to start a conversation.")
        if SHARING_SCOPE not in connection.get("scopes", []):
            raise ChatGPTError("sharing_not_granted", "Plan sharing was not granted. Sign in again and allow Clew to use your ChatGPT plan.")
        if connection["expires_at"] - REFRESH_MARGIN_SECONDS > time.time():
            return connection["access_token"]
        async with self._refresh_lock:
            connection = self.connection()
            if connection is None:
                raise ChatGPTError("not_signed_in", "Sign in with ChatGPT to start a conversation.")
            if SHARING_SCOPE not in connection["scopes"]:
                raise ChatGPTError("sharing_not_granted", "Plan sharing was not granted. Sign in again and allow Clew to use your ChatGPT plan.")
            if connection["expires_at"] - REFRESH_MARGIN_SECONDS > time.time():
                return connection["access_token"]
            generation = self._generation
            try:
                data = await self._token_request({"grant_type": "refresh_token", "client_id": connection["client_id"],
                                                  "refresh_token": connection["refresh_token"], "resource": RESOURCE})
                self._check_generation(generation)
                credentials = self._credentials(data, connection["scopes"])
                if "id_token" in data:
                    if not isinstance(data["id_token"], str):
                        raise ChatGPTError("invalid_id_token", "The refreshed ChatGPT identity could not be verified. Sign in again.")
                    identity = await self.verify_identity(data["id_token"], connection["client_id"], None)
                    self._check_generation(generation)
                    if identity["subject"] != connection["subject"]:
                        raise ChatGPTError("account_mismatch", "The refreshed ChatGPT identity does not match this connection. Sign in again.")
                    credentials["id_token"] = data["id_token"]
            except ChatGPTError as exc:
                self._check_generation(generation)
                if exc.status == 401 or exc.code in REJECTED_CREDENTIALS | {"invalid_id_token", "account_mismatch", "invalid_token_response"}:
                    self.store.delete()
                    self._generation += 1
                    self.last_error = str(exc)
                raise
            self.store.write({**connection, **credentials})
            if SHARING_SCOPE not in credentials["scopes"]:
                raise ChatGPTError("sharing_not_granted", "Plan sharing was not granted. Sign in again and allow Clew to use your ChatGPT plan.")
            return credentials["access_token"]

    def reject_token(self, token: str, error: ChatGPTError) -> None:
        if error.code not in REJECTED_CREDENTIALS and error.status != 401:
            return
        connection = self.store.read()
        # A delayed rejection of an old bearer must not sign out a newer connection.
        if connection is not None and connection.get("access_token") == token:
            self.store.delete()
            self._generation += 1
            self.cancel_login()
            self.last_error = str(error)

    async def logout(self) -> str | None:
        """Remove local tokens, then try remote revocation. Returns a warning when revocation is unconfirmed."""
        self._generation += 1
        self.cancel_login()
        self.last_error = None
        warning = "Local credentials were removed, but ChatGPT did not confirm the disconnect. Remove Clew in ChatGPT Settings → Connected apps."
        try:
            connection = self.store.read()
        except ChatGPTError:
            self.store.delete()
            return warning
        self.store.delete()
        if connection is None:
            return None
        if not all(isinstance(connection.get(key), str) and connection[key] for key in ("client_id", "refresh_token")):
            return warning
        try:
            endpoint = (await self.discovery()).get("revocation_endpoint")
            if not endpoint:
                return warning
            response = await self._request("POST", endpoint, data={"token": connection["refresh_token"], "token_type_hint": "refresh_token",
                                                            "client_id": connection["client_id"]})
            return None if response.status_code == 200 else warning
        except ChatGPTError:
            return warning

    async def close(self) -> None:
        await self.http.aclose()
