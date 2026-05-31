from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db_session
from ..repositories import FaceEmbeddingRepository, UserRepository
from ..config import settings
from ..schemas import ActionResponse, CaptureMetaPayload, ProfileResponse, ProfileUpsertRequest, RuntimeConfigResponse
from ..services.attendance import AttendanceService
from ..services.embedding import (
    EmbeddingExtractionError,
    InvalidImageError,
    ModelUnavailableError,
    NoFaceDetectedError,
)

LOGGER = logging.getLogger("attendance_verification")


def parse_capture_meta(raw_meta: str | None) -> CaptureMetaPayload | None:
    if raw_meta is None or not raw_meta.strip():
        return None
    try:
        payload = json.loads(raw_meta)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="capture_meta must be valid JSON.") from exc
    try:
        return CaptureMetaPayload.model_validate(payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"capture_meta is invalid: {exc}") from exc


def ensure_image_upload(file: UploadFile) -> None:
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")


def build_router(embedding_service) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.post("/profile/upsert", response_model=ProfileResponse)
    async def upsert_profile(payload: ProfileUpsertRequest, session: Session = Depends(get_db_session)) -> ProfileResponse:
        service = AttendanceService(session, embedding_service)
        user = service.upsert_profile(
            payload.student_id,
            payload.full_name,
            payload.class_name,
            payload.department,
        )
        samples = FaceEmbeddingRepository(session).list_for_student(user.student_id)
        return ProfileResponse(
            student_id=user.student_id,
            full_name=user.full_name,
            class_name=user.class_name,
            department=user.department,
            has_face_registered=len(samples) >= 3,
            last_face_registered_at=max((sample.registered_at for sample in samples), default=None),
            registered_pose_labels=[sample.pose_label for sample in samples],
            registered_sample_count=len(samples),
        )

    @router.get("/profile/{student_id}", response_model=ProfileResponse)
    async def get_profile(student_id: str, session: Session = Depends(get_db_session)) -> ProfileResponse:
        user = UserRepository(session).get(student_id.strip())
        if user is None:
            raise HTTPException(status_code=404, detail="Student profile was not found.")
        samples = FaceEmbeddingRepository(session).list_for_student(user.student_id)
        return ProfileResponse(
            student_id=user.student_id,
            full_name=user.full_name,
            class_name=user.class_name,
            department=user.department,
            has_face_registered=len(samples) >= 3,
            last_face_registered_at=max((sample.registered_at for sample in samples), default=None),
            registered_pose_labels=[sample.pose_label for sample in samples],
            registered_sample_count=len(samples),
        )

    @router.get("/runtime-config", response_model=RuntimeConfigResponse)
    async def get_runtime_config() -> RuntimeConfigResponse:
        return RuntimeConfigResponse(
            app_name=settings.app_name,
            similarity_threshold=settings.similarity_threshold,
            uploads_dir=settings.uploads_dir,
        )

    @router.post("/face/register", response_model=ActionResponse)
    async def register_face(
        student_id: str = Form(...),
        pose_label: str = Form(...),
        capture_meta: str | None = Form(None),
        file: UploadFile = File(...),
        session: Session = Depends(get_db_session),
    ) -> ActionResponse:
        ensure_image_upload(file)
        try:
            result = AttendanceService(session, embedding_service).register_pose_sample(
                student_id,
                pose_label,
                await file.read(),
                parse_capture_meta(capture_meta),
            )
        except InvalidImageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except NoFaceDetectedError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ModelUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except EmbeddingExtractionError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return ActionResponse(
            status=result.status,
            action=result.action,
            student_id=result.student_id,
            created_at=result.created_at,
            meta=result.meta,
        )

    @router.post("/attendance/verify", response_model=ActionResponse)
    async def verify_attendance(
        student_id: str = Form(...),
        capture_meta: str | None = Form(None),
        file: UploadFile = File(...),
        session: Session = Depends(get_db_session),
    ) -> ActionResponse:
        ensure_image_upload(file)
        try:
            result = AttendanceService(session, embedding_service).verify_probe(
                student_id,
                await file.read(),
                parse_capture_meta(capture_meta),
            )
        except InvalidImageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except NoFaceDetectedError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ModelUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except EmbeddingExtractionError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        return ActionResponse(
            status=result.status,
            action=result.action,
            student_id=result.student_id,
            score=result.score,
            reason=result.reason,
            created_at=result.created_at,
            meta=result.meta,
        )

    return router
