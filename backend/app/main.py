from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import build_router
from .config import settings
from .db import Base, engine, ensure_pgvector_extension
from .services.embedding import LazyInsightFaceEmbeddingService


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_pgvector_extension()
    Base.metadata.create_all(bind=engine)
    yield


def create_app(embedding_service=None) -> FastAPI:
    service = embedding_service or LazyInsightFaceEmbeddingService()

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
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
