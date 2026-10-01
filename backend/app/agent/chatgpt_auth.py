from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import time
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

    def _keyring(self):
        try:
            import keyring
            from keyring.backends.fail import Keyring as FailKeyring
        except ImportError as exc:
            raise ChatGPTError("credential_storage_unavailable", "Install the keyring package to store ChatGPT credentials.") from exc
        backend = keyring.get_keyring()
        if isinstance(backend, FailKeyring) or getattr(backend, "priority", 1) <= 0:
            raise ChatGPTError("credential_storage_unavailable", "No OS credential store is available, so Clew cannot keep a ChatGPT sign-in.")
        return keyring

    def read(self) -> dict | None:
        raw = self._keyring().get_password(self.service, self.account)
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
        self._keyring().set_password(self.service, self.account, json.dumps(value))

    def delete(self) -> None:
        keyring = self._keyring()
        try:
            keyring.delete_password(self.service, self.account)
        except keyring.errors.PasswordDeleteError:
            pass


@dataclass
class PendingLogin:
    login_id: str
    state: str
    nonce: str
    verifier: str
    redirect_uri: str
    created_at: float
    auth_url: str


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
        self.last_error: str | None = None
        self._discovery: dict | None = None
        self._jwks: dict | None = None
        self._refresh_lock = asyncio.Lock()

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
            response = await self.http.get(f"{ISSUER}/.well-known/openid-configuration")
            data = response.json() if response.content else None
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
                response = await self.http.get((await self.discovery())["jwks_uri"])
                body = response.json() if response.status_code == 200 else None
                if not isinstance(body, dict) or not isinstance(body.get("keys"), list):
                    raise ChatGPTError("identity_verification_unavailable", "ChatGPT identity verification is temporarily unavailable. Try again shortly.", retryable=True)
                self._jwks = body
            match = next((key for key in self._jwks["keys"] if key.get("kid") == kid), None)
            if match is not None:
                return jwt.PyJWK(match)
        raise ChatGPTError("identity_verification_unavailable", "ChatGPT identity verification is temporarily unavailable. Try again shortly.", retryable=True)

    async def verify_identity(self, id_token: str, client_id: str, nonce: str | None) -> dict:
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise ChatGPTError("invalid_id_token", "The ChatGPT identity could not be verified. Sign in again.") from exc
        key = await self._signing_key(header.get("kid"))
        try:
            claims = jwt.decode(id_token, key=key, algorithms=["RS256"], audience=client_id, issuer=ISSUER,
                                leeway=5, options={"require": ["iss", "aud", "exp", "iat", "sub"]})
        except jwt.PyJWTError as exc:
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
        response = await self.http.post((await self.discovery())["token_endpoint"], data=form,
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
        scopes = scope.split() if isinstance(scope, str) else previous_scopes
        if scopes is None:
            raise ChatGPTError("invalid_token_response", "ChatGPT did not confirm the granted permissions. Sign in again.")
        expires_in = data.get("expires_in")
        if (not isinstance(data.get("access_token"), str) or not data["access_token"]
                or str(data.get("token_type", "")).lower() != "bearer"
                or not isinstance(expires_in, (int, float)) or expires_in <= 0
                or not isinstance(data.get("refresh_token"), str) or not data["refresh_token"]):
            raise ChatGPTError("invalid_token_response", "ChatGPT returned incomplete credentials. Sign in again.")
        return {"access_token": data["access_token"], "refresh_token": data["refresh_token"],
                "expires_at": time.time() + float(expires_in), "scopes": scopes}

    # Sign-in flow

    async def start_login(self) -> PendingLogin:
        if self.pending and time.time() - self.pending.created_at < LOGIN_TTL_SECONDS:
            return self.pending
        provider = await self.discovery()
        registration = self.registration()
        state, nonce, verifier = _random(), _random(), _random()
        params = {
            "client_id": registration.get("client_id") or DYNAMIC_CLIENT,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": SCOPES,
            "resource": RESOURCE,
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
                                    redirect_uri=self.redirect_uri, created_at=time.time(), auth_url=auth_url)
        return self.pending

    def cancel_login(self) -> None:
        self.pending = None

    async def complete_login(self, query: dict[str, list[str]]) -> None:
        pending = self.pending
        states = query.get("state", [])
        if pending is None or len(states) != 1 or not hmac.compare_digest(states[0], pending.state):
            raise ChatGPTError("invalid_state", "This sign-in link is not the one Clew started. Start sign-in again from Clew.")
        self.pending = None
        try:
            if time.time() - pending.created_at > LOGIN_TTL_SECONDS:
                raise ChatGPTError("login_expired", "Sign-in took too long. Start it again from Clew.")
            if query.get("error"):
                raise api_error({"error": query["error"][0], "error_description": (query.get("error_description") or [None])[0]})
            codes, client_ids = query.get("code", []), query.get("client_id", [])
            saved = self.registration().get("client_id")
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
            credentials = self._credentials(data)
            self.store.write({"client_id": client_id, "subject": identity["subject"], **credentials})
            self._save_registration(subject=identity["subject"], email=identity["email"], name=identity["name"])
            self.last_error = None
        except ChatGPTError as exc:
            self.last_error = str(exc)
            raise

    # Session

    def connection(self) -> dict | None:
        connection = self.store.read()
        if connection is None:
            return None
        if connection.get("client_id") != self.registration().get("client_id"):
            raise ChatGPTError("credential_storage_corrupt", "The saved ChatGPT connection does not match this Clew install. Sign out and sign in again.")
        return connection

    def status(self) -> dict:
        registration = self.registration()
        try:
            connection = self.connection()
        except ChatGPTError as exc:
            return {"authenticated": False, "sharing": False, "account": None, "error": str(exc)}
        if connection is None:
            return {"authenticated": False, "sharing": False, "account": None, "error": self.last_error}
        sharing = SHARING_SCOPE in connection.get("scopes", [])
        return {"authenticated": True, "sharing": sharing,
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
            if connection["expires_at"] - REFRESH_MARGIN_SECONDS > time.time():
                return connection["access_token"]
            data = await self._token_request({"grant_type": "refresh_token", "client_id": connection["client_id"],
                                              "refresh_token": connection["refresh_token"], "resource": RESOURCE})
            credentials = self._credentials(data, connection.get("scopes"))
            if isinstance(data.get("id_token"), str):
                identity = await self.verify_identity(data["id_token"], connection["client_id"], None)
                if identity["subject"] != connection["subject"]:
                    raise ChatGPTError("account_mismatch", "The refreshed ChatGPT identity does not match this connection. Sign in again.")
            self.store.write({**connection, **credentials})
            return credentials["access_token"]

    async def logout(self) -> str | None:
        """Remove local tokens, then try remote revocation. Returns a warning when revocation is unconfirmed."""
        connection = self.connection() if self.store.read() is not None else None
        self.store.delete()
        self.pending = None
        self.last_error = None
        if connection is None:
            return None
        warning = "Local credentials were removed, but ChatGPT did not confirm the disconnect. Remove Clew in ChatGPT Settings → Connected apps."
        try:
            endpoint = (await self.discovery()).get("revocation_endpoint")
            if not endpoint:
                return warning
            response = await self.http.post(endpoint, data={"token": connection["refresh_token"], "token_type_hint": "refresh_token",
                                                            "client_id": connection["client_id"]})
            return None if response.status_code == 200 else warning
        except httpx.HTTPError:
            return warning

    async def close(self) -> None:
        await self.http.aclose()
