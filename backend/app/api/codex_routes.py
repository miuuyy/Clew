from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from app.api.deps import get_agent_runtime
from app.agent.transport import CodexError

router = APIRouter(prefix="/api/v1/codex")


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_code: bool = False


@router.get("/account")
async def account(runtime=Depends(get_agent_runtime)) -> dict:
    return await runtime.account()


@router.post("/login")
async def login(body: LoginRequest, runtime=Depends(get_agent_runtime)) -> dict:
    try:
        return await runtime.start_login(body.device_code)
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/login/cancel")
async def cancel_login(runtime=Depends(get_agent_runtime)) -> dict:
    try:
        await runtime.cancel_login()
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/logout")
async def logout(runtime=Depends(get_agent_runtime)) -> dict:
    try:
        await runtime.logout()
    except CodexError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True}
