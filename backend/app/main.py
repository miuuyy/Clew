from contextlib import asynccontextmanager

import hmac
import time
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from app.services.repository import RepositoryConflictError

from app.api.routes import router
from app.api.chatgpt_routes import callback_router
from app.api.deps import get_repository
from app.agent.runtime import AgentRuntime
from app.core.config import Settings, get_settings
from app.services.debug_log_service import get_debug_log_service
from app.agent.chatgpt_auth import ChatGPTError


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        runtime = AgentRuntime(settings, get_repository(settings))
        app.state.agent_runtime = runtime
        try:
            yield
        finally:
            await runtime.close()

    app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.dependency_overrides[get_settings] = lambda: settings
    debug_logs = get_debug_log_service(settings.debug_log_dir)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def local_access(request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path.startswith("/api/"):
            if settings.desktop_token and not hmac.compare_digest(
                request.headers.get("x-clew-session", "").encode("utf-8"), settings.desktop_token.encode("utf-8")
            ):
                return JSONResponse(status_code=403, content={"detail": "This request is not from the Clew desktop app."})
            if not request.url.path.startswith("/api/v1/chatgpt/"):
                try:
                    await request.app.state.agent_runtime.auth.access_token()
                except ChatGPTError as exc:
                    return JSONResponse(status_code=503 if exc.retryable else 401,
                                        content={"detail": str(exc), "code": exc.code})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if settings.desktop_token and not request.url.path.startswith("/auth/"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; "
                "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
            )
        if request.url.path.startswith(("/api/", "/auth/")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RepositoryConflictError)
    async def conflict_error(request: Request, exc: RepositoryConflictError):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.middleware("http")
    async def debug_error_logging(request: Request, call_next):
        started_at = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:
            if not request.url.path.startswith("/api/v1/debug/"):
                debug_logs.log_server_error(
                    title=f"{request.method} {request.url.path}",
                    message=str(exc) or exc.__class__.__name__,
                    method=request.method,
                    path=request.url.path,
                    duration_ms=round((time.perf_counter() - started_at) * 1000),
                    stack="".join(traceback.format_exception(exc)),
                )
            raise

        if response.status_code >= 500 and not request.url.path.startswith("/api/v1/debug/"):
            debug_logs.log_server_error(
                title=f"{request.method} {request.url.path}",
                message=f"Server responded with HTTP {response.status_code}",
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=round((time.perf_counter() - started_at) * 1000),
            )
        return response

    app.include_router(router)
    app.include_router(callback_router)
    app.mount("/contracts", StaticFiles(directory=settings.root_dir / "contracts"), name="contracts")
    return app


app = create_app()
