from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Clew"
    api_host: str = "127.0.0.1"
    api_port: int = 8787
    root_dir: Path = Path(__file__).resolve().parents[3]
    debug_log_dir: Path = Path(__file__).resolve().parents[3] / "logs"
    db_path: Path = Path(__file__).resolve().parents[2] / "data" / "knowledge_graph.sqlite3"
    frontend_origin: str = "http://127.0.0.1:5178"
    local_user_name: str = "Local User"
    local_user_email: str = "local@example.com"
    desktop_token: str | None = None

    model_config = SettingsConfigDict(env_prefix="KG_", case_sensitive=False, env_file=Path(__file__).resolve().parents[3] / ".env", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
