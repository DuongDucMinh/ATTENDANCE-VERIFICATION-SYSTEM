from __future__ import annotations

import logging
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
        LOGGER.info(
            "Starting API with similarity_threshold=%.3f uploads_dir=%s",
            settings.similarity_threshold,
            settings.uploads_dir,
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
    async def health() -> dict[str, str | float]:
        return {"status": "ok", "similarity_threshold": settings.similarity_threshold}

    return app


app = create_app()
