from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import build_router
from .config import settings
from .db import Base, engine, ensure_pgvector_extension
from .services.embedding import LazyInsightFaceEmbeddingService

LOGGER = logging.getLogger("attendance_verification")


def create_app(embedding_service=None) -> FastAPI:
    service = embedding_service or LazyInsightFaceEmbeddingService()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        diagnostics = settings.diagnostics
        LOGGER.info(
            "Starting API with similarity_threshold=%.3f source=%s uploads_dir=%s env_file=%s cwd=%s pid=%s",
            settings.similarity_threshold,
            diagnostics["similarity_threshold_source"],
            settings.uploads_dir,
            diagnostics["env_file_path"],
            diagnostics["launch_cwd"],
            os.getpid(),
        )
        if (
            diagnostics["similarity_threshold_process_env"] is not None
            and diagnostics["similarity_threshold_env_file"] is not None
            and diagnostics["similarity_threshold_process_env"] != diagnostics["similarity_threshold_env_file"]
        ):
            LOGGER.warning(
                "SIMILARITY_THRESHOLD mismatch: process env=%s overrides .env=%s",
                diagnostics["similarity_threshold_process_env"],
                diagnostics["similarity_threshold_env_file"],
            )
        ensure_pgvector_extension()
        Base.metadata.create_all(bind=engine)
        warm_up = getattr(service, "warm_up", None)
        if callable(warm_up):
            try:
                warm_up()
                LOGGER.info("InsightFace embedding service warmed up during startup.")
            except Exception as exc:  # pragma: no cover
                LOGGER.warning("Embedding service warm-up failed, falling back to lazy init: %s", exc)
        yield

    app = FastAPI(title=settings.app_name, version="2.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(build_router(service))

    @app.get("/api/health")
    async def health() -> dict[str, str | float | bool | None]:
        diagnostics = settings.diagnostics
        return {"status": "ok", **diagnostics}

    return app


app = create_app()
