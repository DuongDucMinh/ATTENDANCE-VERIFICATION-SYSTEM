from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Attendance Verification API"
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/attendance_verification",
        alias="DATABASE_URL",
    )
    similarity_threshold: float = Field(default=0.8, alias="SIMILARITY_THRESHOLD")
    cors_origins: list[str] = Field(
        default=["http://127.0.0.1:5173", "http://localhost:5173"],
        alias="CORS_ORIGINS",
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
