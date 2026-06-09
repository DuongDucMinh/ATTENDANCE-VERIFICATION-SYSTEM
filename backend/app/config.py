from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE_PATH = PROJECT_ROOT / ".env"


def _read_env_file_value(key: str) -> str | None:
    if not ENV_FILE_PATH.exists():
        return None

    for raw_line in ENV_FILE_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        env_key, env_value = line.split("=", 1)
        if env_key.strip() != key:
            continue
        value = env_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        return value
    return None


class Settings(BaseSettings):
    app_name: str = "Attendance Verification API"
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/attendance_verification",
        alias="DATABASE_URL",
    )
    similarity_threshold: float = Field(default=0.7, alias="SIMILARITY_THRESHOLD")
    uploads_dir: str = Field(default="backend/data/face_images", alias="UPLOADS_DIR")
    cors_origins: list[str] = Field(
        default=["http://127.0.0.1:5173", "http://localhost:5173"],
        alias="CORS_ORIGINS",
    )

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def similarity_threshold_process_env(self) -> str | None:
        return os.environ.get("SIMILARITY_THRESHOLD")

    @property
    def similarity_threshold_env_file(self) -> str | None:
        return _read_env_file_value("SIMILARITY_THRESHOLD")

    @property
    def similarity_threshold_source(self) -> str:
        if self.similarity_threshold_process_env is not None:
            return "process_env"
        if self.similarity_threshold_env_file is not None:
            return "dotenv_file"
        return "default"

    @property
    def diagnostics(self) -> dict[str, str | float | bool | None]:
        return {
            "similarity_threshold": self.similarity_threshold,
            "similarity_threshold_source": self.similarity_threshold_source,
            "similarity_threshold_process_env": self.similarity_threshold_process_env,
            "similarity_threshold_env_file": self.similarity_threshold_env_file,
            "env_file_path": str(ENV_FILE_PATH),
            "env_file_exists": ENV_FILE_PATH.exists(),
            "launch_cwd": str(Path.cwd()),
        }


settings = Settings()
