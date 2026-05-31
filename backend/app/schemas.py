from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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
    registered_pose_labels: list[str] = Field(default_factory=list)
    registered_sample_count: int = 0


class QualitySummary(BaseModel):
    blur_score: float | None = None
    brightness_mean: float | None = None
    quality_score: float | None = None


class AntiReplaySummary(BaseModel):
    motion_corr: float | None = None
    flicker_peak_ratio: float | None = None
    stripe_score: float | None = None
    moire_score: float | None = None
    verdict: str | None = None


class SelectedFrameSummary(BaseModel):
    frame_index: int | None = None
    sampled_frame_count: int | None = None
    face_box: dict[str, float] | None = None
    center_box: dict[str, float] | None = None


class CaptureMetaPayload(BaseModel):
    challenge_sequence: list[str] = Field(default_factory=list)
    challenge_result: str | None = None
    quality: QualitySummary | None = None
    anti_replay: AntiReplaySummary | None = None
    selected_frame: SelectedFrameSummary | None = None
    pose_label: str | None = None
    telemetry: dict[str, Any] = Field(default_factory=dict)


class ActionResponse(BaseModel):
    status: str
    student_id: str | None = None
    score: float | None = None
    reason: str | None = None
    action: str
    created_at: datetime | None = None
    meta: dict[str, Any] | None = None


class RuntimeConfigResponse(BaseModel):
    app_name: str
    similarity_threshold: float
    uploads_dir: str
