from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

import numpy as np
from sqlalchemy.orm import Session

from ..config import settings
from ..repositories import AttendanceLogRepository, FaceEmbeddingRepository, UserRepository
from .embedding import decode_upload_image

LOGGER = logging.getLogger("attendance_verification")


@dataclass
class ServiceResult:
    status: str
    action: str
    student_id: str
    created_at: datetime | None
    score: float | None = None
    reason: str | None = None


def cosine_similarity(vector_a: np.ndarray, vector_b: np.ndarray) -> float:
    norm_a = np.linalg.norm(vector_a)
    norm_b = np.linalg.norm(vector_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vector_a, vector_b) / (norm_a * norm_b))


class AttendanceService:
    def __init__(self, session: Session, embedding_service) -> None:
        self.session = session
        self.embedding_service = embedding_service
        self.users = UserRepository(session)
        self.embeddings = FaceEmbeddingRepository(session)
        self.logs = AttendanceLogRepository(session)

    def upsert_profile(self, student_id: str, full_name: str | None, class_name: str | None, department: str | None):
        user = self.users.upsert(student_id.strip(), full_name, class_name, department)
        self.session.commit()
        self.session.refresh(user)
        return user

    def register_face(self, student_id: str, file_bytes: bytes) -> ServiceResult:
        student_id = student_id.strip()
        if not student_id:
            raise ValueError("student_id must not be empty.")
        self.users.ensure_placeholder(student_id)

        image = decode_upload_image(file_bytes)
        embedding = self.embedding_service.extract_embedding(image)

        face_record = self.embeddings.upsert(student_id, embedding.astype(np.float32).tolist(), None)
        log = self.logs.create(student_id=student_id, action="register", status="Registered")
        self.session.commit()
        self.session.refresh(face_record)
        self.session.refresh(log)

        return ServiceResult(
            status="Registered",
            action="register",
            student_id=student_id,
            created_at=log.created_at,
        )

    def verify_attendance(self, student_id: str, file_bytes: bytes) -> ServiceResult:
        student_id = student_id.strip()
        if not student_id:
            raise ValueError("student_id must not be empty.")
        user = self.users.get(student_id)
        if user is None:
            self.users.ensure_placeholder(student_id)
            log = self.logs.create(
                student_id=student_id,
                action="verify",
                status="Failed",
                reason="Student profile does not exist.",
            )
            self.session.commit()
            self.session.refresh(log)
            return ServiceResult(
                status="Failed",
                action="verify",
                student_id=student_id,
                created_at=log.created_at,
                reason="Student profile does not exist.",
            )

        stored = self.embeddings.get(student_id)
        if stored is None:
            log = self.logs.create(
                student_id=student_id,
                action="verify",
                status="Failed",
                reason="No face has been registered for this student.",
            )
            self.session.commit()
            self.session.refresh(log)
            return ServiceResult(
                status="Failed",
                action="verify",
                student_id=student_id,
                created_at=log.created_at,
                reason="No face has been registered for this student.",
            )

        image = decode_upload_image(file_bytes)
        probe_embedding = self.embedding_service.extract_embedding(image)
        score = round(cosine_similarity(probe_embedding, np.asarray(stored.embedding, dtype=np.float32)), 3)

        if score >= settings.similarity_threshold:
            log = self.logs.create(student_id=student_id, action="verify", status="Success", score=score)
            self.session.commit()
            self.session.refresh(log)
            return ServiceResult(
                status="Success",
                action="verify",
                student_id=student_id,
                created_at=log.created_at,
                score=score,
            )

        LOGGER.info("Verification failed for %s with score %.3f", student_id, score)
        log = self.logs.create(
            student_id=student_id,
            action="verify",
            status="Failed",
            score=score,
            reason="Cosine similarity below the decision threshold.",
        )
        self.session.commit()
        self.session.refresh(log)
        return ServiceResult(
            status="Failed",
            action="verify",
            student_id=student_id,
            created_at=log.created_at,
            score=score,
            reason="Cosine similarity below the decision threshold.",
        )
