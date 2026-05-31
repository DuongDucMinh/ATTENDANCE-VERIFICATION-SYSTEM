from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AttendanceLog, FaceEmbedding, User


class UserRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def upsert(self, student_id: str, full_name: str | None, class_name: str | None, department: str | None) -> User:
        user = self.session.get(User, student_id)
        if user is None:
            user = User(
                student_id=student_id,
                full_name=full_name,
                class_name=class_name,
                department=department,
            )
            self.session.add(user)
        else:
            user.full_name = full_name
            user.class_name = class_name
            user.department = department
        self.session.flush()
        return user

    def ensure_placeholder(self, student_id: str) -> User:
        user = self.session.get(User, student_id)
        if user is None:
            user = User(student_id=student_id)
            self.session.add(user)
            self.session.flush()
        return user

    def get(self, student_id: str) -> User | None:
        return self.session.get(User, student_id)


class FaceEmbeddingRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def upsert(
        self,
        student_id: str,
        pose_label: str,
        embedding: list[float],
        *,
        blur_score: float | None,
        brightness_score: float | None,
        quality_score: float | None,
        capture_meta: dict[str, Any] | None,
        image_path: str | None,
    ) -> FaceEmbedding:
        entity = self.session.scalar(
            select(FaceEmbedding).where(
                FaceEmbedding.student_id == student_id,
                FaceEmbedding.pose_label == pose_label,
            )
        )
        if entity is None:
            entity = FaceEmbedding(
                student_id=student_id,
                pose_label=pose_label,
                embedding=embedding,
                blur_score=blur_score,
                brightness_score=brightness_score,
                quality_score=quality_score,
                capture_meta=capture_meta,
                image_path=image_path,
            )
            self.session.add(entity)
        else:
            entity.embedding = embedding
            entity.pose_label = pose_label
            entity.blur_score = blur_score
            entity.brightness_score = brightness_score
            entity.quality_score = quality_score
            entity.capture_meta = capture_meta
            entity.image_path = image_path
            entity.updated_at = datetime.now(timezone.utc)
        self.session.flush()
        return entity

    def list_for_student(self, student_id: str) -> list[FaceEmbedding]:
        statement = (
            select(FaceEmbedding)
            .where(FaceEmbedding.student_id == student_id)
            .order_by(FaceEmbedding.pose_label.asc(), FaceEmbedding.id.asc())
        )
        return list(self.session.scalars(statement))

    def get_pose(self, student_id: str, pose_label: str) -> FaceEmbedding | None:
        return self.session.scalar(
            select(FaceEmbedding).where(
                FaceEmbedding.student_id == student_id,
                FaceEmbedding.pose_label == pose_label,
            )
        )


class AttendanceLogRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        *,
        student_id: str,
        action: str,
        status: str,
        score: float | None = None,
        reason: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> AttendanceLog:
        log = AttendanceLog(
            student_id=student_id,
            action=action,
            status=status,
            score=score,
            reason=reason,
            meta=meta,
        )
        self.session.add(log)
        self.session.flush()
        return log
