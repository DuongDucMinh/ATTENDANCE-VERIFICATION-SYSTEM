from __future__ import annotations

from datetime import datetime, timezone

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

    def upsert(self, student_id: str, embedding: list[float], image_path: str | None) -> FaceEmbedding:
        entity = self.session.get(FaceEmbedding, student_id)
        if entity is None:
            entity = FaceEmbedding(student_id=student_id, embedding=embedding, image_path=image_path)
            self.session.add(entity)
        else:
            entity.embedding = embedding
            entity.image_path = image_path
            entity.updated_at = datetime.now(timezone.utc)
        self.session.flush()
        return entity

    def get(self, student_id: str) -> FaceEmbedding | None:
        return self.session.get(FaceEmbedding, student_id)


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
    ) -> AttendanceLog:
        log = AttendanceLog(student_id=student_id, action=action, status=status, score=score, reason=reason)
        self.session.add(log)
        self.session.flush()
        return log
