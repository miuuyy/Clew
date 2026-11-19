from html import escape
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.agent.chatgpt_auth import CALLBACK_PATH, ChatGPTError
from app.api.deps import get_agent_runtime
from app.api.route_helpers import request_locale
from app.core.config import Settings, get_settings
from app.core.locale import AppLocale

router = APIRouter(prefix="/api/v1/chatgpt")
callback_router = APIRouter()


@router.get("/account")
async def account(runtime=Depends(get_agent_runtime), locale: AppLocale = Depends(request_locale)) -> dict:
    return await runtime.account(locale)


@router.post("/login")
async def login(runtime=Depends(get_agent_runtime), locale: AppLocale = Depends(request_locale)) -> dict:
    try:
        return await runtime.start_login(locale)
    except ChatGPTError as exc:
        raise HTTPException(status_code=502, detail=exc.public_message(locale)) from exc


@router.post("/login/cancel")
async def cancel_login(runtime=Depends(get_agent_runtime)) -> dict:
    runtime.auth.cancel_login()
    return {"ok": True}


@router.post("/logout")
async def logout(runtime=Depends(get_agent_runtime), locale: AppLocale = Depends(request_locale)) -> dict:
    try:
        warning = await runtime.logout(locale)
    except ChatGPTError as exc:
        raise HTTPException(status_code=409, detail=exc.public_message(locale)) from exc
    return {"ok": True, "warning": warning}


CALLBACK_COPY = {
    "en": {
        "not_found": "Not found",
        "local_only": "This address only completes a local Clew sign-in.",
        "failed": "Sign-in did not finish",
        "return": "Return to Clew",
        "connected": "Clew is connected to your ChatGPT account. You can close this tab.",
    },
    "zh-CN": {
        "not_found": "找不到页面",
        "local_only": "此地址仅用于完成本地 Clew 登录。",
        "failed": "登录未完成",
        "return": "返回 Clew",
        "connected": "Clew 已连接到你的 ChatGPT 账号。你可以关闭此标签页。",
    },
}


def _page(locale: AppLocale, title: str, body: str, status: int) -> HTMLResponse:
    html = (f'<!doctype html><html lang="{locale}"><meta charset="utf-8"><title>{escape(title)}</title>'
            '<style>body{font:17px system-ui;max-width:32rem;margin:18vh auto;padding:24px;color:#202123}h1{font-size:26px}</style>'
            f"<h1>{escape(title)}</h1><p>{escape(body)}</p></html>")
    return HTMLResponse(html, status_code=status, headers={
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Language": locale,
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"})


@callback_router.get(CALLBACK_PATH, include_in_schema=False)
async def oauth_callback(request: Request, settings: Settings = Depends(get_settings), runtime=Depends(get_agent_runtime)) -> HTMLResponse:
    locale = request_locale(request)
    # The registered redirect is the loopback address; reject other hosts reaching this route.
    if request.headers.get("host") != f"127.0.0.1:{settings.api_port}":
        copy = CALLBACK_COPY[locale]
        return _page(locale, copy["not_found"], copy["local_only"], 404)
    try:
        locale = await runtime.auth.complete_login(parse_qs(request.url.query, keep_blank_values=True))
    except ChatGPTError as exc:
        locale = exc.locale or locale
        return _page(locale, CALLBACK_COPY[locale]["failed"], exc.public_message(locale), 400)
    copy = CALLBACK_COPY[locale]
    return _page(locale, copy["return"], copy["connected"], 200)
