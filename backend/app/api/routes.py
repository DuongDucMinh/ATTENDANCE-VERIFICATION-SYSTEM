from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db_session
from ..models import User
from ..repositories import FaceEmbeddingRepository, UserRepository
from ..schemas import ActionResponse, ProfileResponse, ProfileUpsertRequest
from ..services.attendance import AttendanceService
from ..services.embedding import (
    EmbeddingExtractionError,
    InvalidImageError,
    ModelUnavailableError,
    NoFaceDetectedError,
)

LOGGER = logging.getLogger("attendance_verification")


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
        face = FaceEmbeddingRepository(session).get(user.student_id)
        return ProfileResponse(
            student_id=user.student_id,
            full_name=user.full_name,
            class_name=user.class_name,
            department=user.department,
            has_face_registered=face is not None,
            last_face_registered_at=face.registered_at if face else None,
        )

    @router.get("/profile/{student_id}", response_model=ProfileResponse)
    async def get_profile(student_id: str, session: Session = Depends(get_db_session)) -> ProfileResponse:
        user = UserRepository(session).get(student_id.strip())
        if user is None:
            raise HTTPException(status_code=404, detail="Student profile was not found.")
        face = FaceEmbeddingRepository(session).get(user.student_id)
        return ProfileResponse(
            student_id=user.student_id,
            full_name=user.full_name,
            class_name=user.class_name,
            department=user.department,
            has_face_registered=face is not None,
            last_face_registered_at=face.registered_at if face else None,
        )

    @router.post("/face/register", response_model=ActionResponse)
    async def register_face(
        student_id: str = Form(...),
        file: UploadFile = File(...),
        session: Session = Depends(get_db_session),
    ) -> ActionResponse:
        try:
            result = AttendanceService(session, embedding_service).register_face(student_id, await file.read())
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
        )

    @router.post("/attendance/verify", response_model=ActionResponse)
    async def verify_attendance(
        student_id: str = Form(...),
        file: UploadFile = File(...),
        session: Session = Depends(get_db_session),
    ) -> ActionResponse:
        try:
            result = AttendanceService(session, embedding_service).verify_attendance(student_id, await file.read())
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
        )

    return router
