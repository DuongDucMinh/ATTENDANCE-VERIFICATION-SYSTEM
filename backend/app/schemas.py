from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProfileUpsertRequest(BaseModel):
    student_id: str
    full_name: str | None = None
    class_name: str | None = None
    department: str | None = None


class ProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    student_id: str
    full_name: str | None = None
    class_name: str | None = None
    department: str | None = None
    has_face_registered: bool
    last_face_registered_at: datetime | None = None


class ActionResponse(BaseModel):
    status: str
    student_id: str | None = None
    score: float | None = None
    reason: str | None = None
    action: str
    created_at: datetime | None = None
