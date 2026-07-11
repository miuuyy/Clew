import time
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.services.debug_log_service import get_debug_log_service


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    debug_logs = get_debug_log_service(settings.root_dir)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
    app.mount("/contracts", StaticFiles(directory=settings.root_dir / "contracts"), name="contracts")
    return app


app = create_app()
