from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
from typing import Any

import numpy as np
from sqlalchemy.orm import Session

from ..config import settings
from ..repositories import AttendanceLogRepository, FaceEmbeddingRepository, UserRepository
from ..schemas import CaptureMetaPayload
from .embedding import decode_upload_image

LOGGER = logging.getLogger("attendance_verification")

POSE_LABELS = {"front", "left", "right"}
MIN_REGISTERED_SAMPLES = 3
POSE_SCORE_WEIGHT = 0.7
CENTROID_SCORE_WEIGHT = 0.3
MAX_QUALITY_MARGIN = 0.06


@dataclass
class ServiceResult:
    status: str
    action: str
    student_id: str
    created_at: datetime | None
    score: float | None = None
    reason: str | None = None
    meta: dict[str, Any] | None = None


def cosine_similarity(vector_a: np.ndarray, vector_b: np.ndarray) -> float:
    norm_a = np.linalg.norm(vector_a)
    norm_b = np.linalg.norm(vector_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vector_a, vector_b) / (norm_a * norm_b))


def normalize_vector(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector
    return vector / norm


def safe_filename_part(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value).strip("_") or "unknown"


def mean_present(values: list[float | None]) -> float | None:
    present = [float(value) for value in values if value is not None]
    if not present:
        return None
    return float(np.mean(present))


def compute_quality_margin(
    probe_quality: dict[str, Any],
    registered_brightness: float | None,
    registered_blur: float | None,
) -> float:
    probe_brightness = probe_quality.get("brightness_mean")
    probe_blur = probe_quality.get("blur_score")
    margin = 0.0

    if probe_brightness is not None and registered_brightness is not None:
        brightness_gap = abs(float(probe_brightness) - registered_brightness)
        margin += min(0.04, (brightness_gap / 255.0) * 0.08)

    if probe_blur is not None and registered_blur is not None and float(probe_blur) < registered_blur:
        blur_gap_ratio = min(1.0, (registered_blur - float(probe_blur)) / max(registered_blur, 1.0))
        margin += 0.02 * blur_gap_ratio

    return round(min(MAX_QUALITY_MARGIN, margin), 3)


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

    def list_registered_samples(self, student_id: str):
        return self.embeddings.list_for_student(student_id.strip())

    def register_pose_sample(
        self,
        student_id: str,
        pose_label: str,
        file_bytes: bytes,
        capture_meta: CaptureMetaPayload | None,
    ) -> ServiceResult:
        student_id = student_id.strip()
        pose_label = pose_label.strip().lower()
        if not student_id:
            raise ValueError("student_id must not be empty.")
        if pose_label not in POSE_LABELS:
            raise ValueError(f"pose_label must be one of: {', '.join(sorted(POSE_LABELS))}.")

        self.users.ensure_placeholder(student_id)
        image = decode_upload_image(file_bytes)
        embedding = normalize_vector(self.embedding_service.extract_embedding(image).astype(np.float32))
        capture_meta_dict = capture_meta.model_dump(mode="json") if capture_meta else {}
        quality_summary = capture_meta_dict.get("quality") or {}
        anti_replay_summary = capture_meta_dict.get("anti_replay") or {}
        quality_score = quality_summary.get("quality_score")
        image_path = self._save_registered_face_image(student_id, pose_label, file_bytes)

        face_record = self.embeddings.upsert(
            student_id,
            pose_label,
            embedding.tolist(),
            blur_score=quality_summary.get("blur_score"),
            brightness_score=quality_summary.get("brightness_mean"),
            quality_score=quality_score,
            capture_meta=capture_meta_dict,
            image_path=image_path,
        )
        registered_samples = self.embeddings.list_for_student(student_id)
        log_meta = {
            "pose_label": pose_label,
            "quality": quality_summary,
            "anti_replay": anti_replay_summary,
            "registered_pose_labels": [sample.pose_label for sample in registered_samples],
            "registered_sample_count": len(registered_samples),
        }
        log = self.logs.create(
            student_id=student_id,
            action="register",
            status="Registered",
            meta=log_meta,
        )
        self.session.commit()
        self.session.refresh(face_record)
        self.session.refresh(log)

        return ServiceResult(
            status="Registered",
            action="register",
            student_id=student_id,
            created_at=log.created_at,
            meta=log_meta,
        )

    def verify_probe(self, student_id: str, file_bytes: bytes, capture_meta: CaptureMetaPayload | None) -> ServiceResult:
        student_id = student_id.strip()
        if not student_id:
            raise ValueError("student_id must not be empty.")
        user = self.users.get(student_id)
        if user is None:
            self.users.ensure_placeholder(student_id)
            reason = "Student profile does not exist."
            log = self.logs.create(
                student_id=student_id,
                action="verify",
                status="Failed",
                reason=reason,
                meta={"decision_breakdown": {"reason": reason}},
            )
            self.session.commit()
            self.session.refresh(log)
            return ServiceResult(
                status="Failed",
                action="verify",
                student_id=student_id,
                created_at=log.created_at,
                reason=reason,
                meta=log.meta,
            )

        samples = self.embeddings.list_for_student(student_id)
        if len(samples) < MIN_REGISTERED_SAMPLES:
            reason = f"At least {MIN_REGISTERED_SAMPLES} registered pose samples are required."
            log = self.logs.create(
                student_id=student_id,
                action="verify",
                status="Failed",
                reason=reason,
                meta={
                    "decision_breakdown": {"reason": reason},
                    "registered_pose_labels": [sample.pose_label for sample in samples],
                    "registered_sample_count": len(samples),
                },
            )
            self.session.commit()
            self.session.refresh(log)
            return ServiceResult(
                status="Failed",
                action="verify",
                student_id=student_id,
                created_at=log.created_at,
                reason=reason,
                meta=log.meta,
            )

        image = decode_upload_image(file_bytes)
        probe_embedding = normalize_vector(self.embedding_service.extract_embedding(image).astype(np.float32))
        sample_vectors = [normalize_vector(np.asarray(sample.embedding, dtype=np.float32)) for sample in samples]
        capture_meta_dict = capture_meta.model_dump(mode="json") if capture_meta else {}
        quality_summary = capture_meta_dict.get("quality") or {}

        centroid = normalize_vector(np.mean(sample_vectors, axis=0))
        centroid_score = cosine_similarity(probe_embedding, centroid)
        sample_scores = sorted((cosine_similarity(probe_embedding, vector) for vector in sample_vectors), reverse=True)
        best_sample_score = sample_scores[0]
        top_k_score = float(np.mean(sample_scores[:2]))
        pose_weighted_score = POSE_SCORE_WEIGHT * top_k_score + CENTROID_SCORE_WEIGHT * centroid_score
        raw_match_score = max(best_sample_score, pose_weighted_score)
        registered_brightness = mean_present([sample.brightness_score for sample in samples])
        registered_blur = mean_present([sample.blur_score for sample in samples])
        quality_margin = compute_quality_margin(quality_summary, registered_brightness, registered_blur)
        final_score = round(min(0.99, raw_match_score + quality_margin), 3)

        decision_breakdown = {
            "centroid_score": round(centroid_score, 3),
            "best_sample_score": round(best_sample_score, 3),
            "top_k_score": round(top_k_score, 3),
            "pose_weighted_score": round(pose_weighted_score, 3),
            "raw_match_score": round(raw_match_score, 3),
            "quality_margin": quality_margin,
            "registered_brightness_mean": round(registered_brightness, 3) if registered_brightness is not None else None,
            "registered_blur_mean": round(registered_blur, 3) if registered_blur is not None else None,
            "sample_scores": [round(score, 3) for score in sample_scores],
            "registered_pose_labels": [sample.pose_label for sample in samples],
            "registered_sample_count": len(samples),
            "threshold": settings.similarity_threshold,
            "final_score": final_score,
        }
        log_meta = {
            "challenge_sequence": capture_meta_dict.get("challenge_sequence", []),
            "challenge_result": capture_meta_dict.get("challenge_result"),
            "anti_replay": capture_meta_dict.get("anti_replay"),
            "quality": capture_meta_dict.get("quality"),
            "selected_frame": capture_meta_dict.get("selected_frame"),
            "decision_breakdown": decision_breakdown,
        }

        if final_score >= settings.similarity_threshold:
            log = self.logs.create(
                student_id=student_id,
                action="verify",
                status="Success",
                score=final_score,
                meta=log_meta,
            )
            self.session.commit()
            self.session.refresh(log)
            LOGGER.info(
                "Verification succeeded for %s final_score=%.3f centroid=%.3f top_k=%.3f",
                student_id,
                final_score,
                centroid_score,
                top_k_score,
            )
            return ServiceResult(
                status="Success",
                action="verify",
                student_id=student_id,
                created_at=log.created_at,
                score=final_score,
                meta=log_meta,
            )

        reason = (
            f"Hybrid similarity score below threshold "
            f"({final_score:.3f} < {settings.similarity_threshold:.3f})."
        )
        log_meta["decision_breakdown"]["reason"] = reason
        LOGGER.info(
            "Verification failed for %s final_score=%.3f centroid=%.3f top_k=%.3f",
            student_id,
            final_score,
            centroid_score,
            top_k_score,
        )
        log = self.logs.create(
            student_id=student_id,
            action="verify",
            status="Failed",
            score=final_score,
            reason=reason,
            meta=log_meta,
        )
        self.session.commit()
        self.session.refresh(log)
        return ServiceResult(
            status="Failed",
            action="verify",
            student_id=student_id,
            created_at=log.created_at,
            score=final_score,
            reason=reason,
            meta=log_meta,
        )

    def _save_registered_face_image(self, student_id: str, pose_label: str, file_bytes: bytes) -> str:
        root = Path(settings.uploads_dir)
        root.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
        filename = f"{safe_filename_part(student_id)}_{safe_filename_part(pose_label)}_{timestamp}.jpg"
        path = root / filename
        path.write_bytes(file_bytes)
        return str(path)
