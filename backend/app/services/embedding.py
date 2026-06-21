from __future__ import annotations

import logging
from typing import Protocol

import cv2
import numpy as np

LOGGER = logging.getLogger("attendance_verification")


class ModelUnavailableError(RuntimeError):
    pass


class InvalidImageError(ValueError):
    pass


class NoFaceDetectedError(ValueError):
    pass


class EmbeddingExtractionError(RuntimeError):
    pass


class EmbeddingService(Protocol):
    def extract_embedding(self, image_bgr: np.ndarray) -> np.ndarray:
        ...


def decode_upload_image(file_bytes: bytes) -> np.ndarray:
    if not file_bytes:
        raise InvalidImageError("Uploaded file is empty.")

    np_buffer = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise InvalidImageError("Uploaded file is not a valid image.")
    return image


class InsightFaceEmbeddingService:
    def __init__(self) -> None:
        try:
            from insightface.app import FaceAnalysis
        except ImportError as exc:  # pragma: no cover
            raise ModelUnavailableError(
                "InsightFace is not installed. Run `pip install -r requirements.txt`."
            ) from exc

        try:
            self.face_analysis = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
            self.face_analysis.prepare(ctx_id=-1, det_size=(640, 640))
        except Exception as exc:  # pragma: no cover
            raise ModelUnavailableError(f"Failed to initialize FaceAnalysis: {exc}") from exc

    def extract_embedding(self, image_bgr: np.ndarray) -> np.ndarray:
        faces = self.face_analysis.get(image_bgr)
        if not faces:
            raise NoFaceDetectedError("No face detected in the provided image.")

        dominant_face = max(faces, key=self._face_area)
        embedding = getattr(dominant_face, "normed_embedding", None)
        if embedding is None:
            embedding = getattr(dominant_face, "embedding", None)
        if embedding is None:
            raise EmbeddingExtractionError("InsightFace did not return an embedding vector.")

        vector = np.asarray(embedding, dtype=np.float32).flatten()
        if vector.size == 0:
            raise EmbeddingExtractionError("Embedding vector is empty.")

        return vector

    @staticmethod
    def _face_area(face: object) -> float:
        bbox = np.asarray(getattr(face, "bbox", []), dtype=np.float32)
        if bbox.size != 4:
            return 0.0
        return max(float(bbox[2] - bbox[0]), 0.0) * max(float(bbox[3] - bbox[1]), 0.0)


class LazyInsightFaceEmbeddingService:
    def __init__(self) -> None:
        self._service: InsightFaceEmbeddingService | None = None

    def _ensure_service(self) -> InsightFaceEmbeddingService:
        if self._service is None:
            self._service = InsightFaceEmbeddingService()
        return self._service

    def warm_up(self) -> None:
        service = self._ensure_service()
        try:
            dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
            service.face_analysis.get(dummy_img)
            LOGGER.info("InsightFace dummy inference warm-up completed successfully.")
        except Exception as e:
            LOGGER.warning("InsightFace dummy inference warm-up failed: %s", e)

    def extract_embedding(self, image_bgr: np.ndarray) -> np.ndarray:
        return self._ensure_service().extract_embedding(image_bgr)
