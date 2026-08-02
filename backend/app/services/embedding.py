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


def resize_and_pad(image: np.ndarray, target_size: int = 640) -> np.ndarray:
    """
    Resizes an image to a square of target_size x target_size, preserving the aspect ratio
    and padding the remaining areas with black pixels.
    """
    h, w = image.shape[:2]
    scale = target_size / max(h, w)
    new_h, new_w = int(h * scale), int(w * scale)
    
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    
    pad_h = target_size - new_h
    pad_w = target_size - new_w
    
    top = pad_h // 2
    bottom = pad_h - top
    left = pad_w // 2
    right = pad_w - left
    
    padded = cv2.copyMakeBorder(
        resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=[0, 0, 0]
    )
    return padded


class InsightFaceEmbeddingService:
    def __init__(self) -> None:
        try:
            from insightface.app import FaceAnalysis
        except ImportError as exc:  # pragma: no cover
            raise ModelUnavailableError(
                "InsightFace is not installed. Run `pip install -r requirements.txt`."
            ) from exc

        # Giới hạn số luồng ONNX Runtime trên CPU để tránh tranh chấp luồng khi chạy song song
        import os
        os.environ["OMP_NUM_THREADS"] = "2"
        os.environ["MKL_NUM_THREADS"] = "2"
        os.environ["OPENBLAS_NUM_THREADS"] = "2"
        os.environ["VECLIB_MAXIMUM_THREADS"] = "2"
        os.environ["NUMEXPR_NUM_THREADS"] = "2"

        try:
            insightface_root = os.environ.get(
                "INSIGHTFACE_ROOT",
                os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "models"))
            )
            self.face_analysis = FaceAnalysis(
                name="buffalo_s",
                root=insightface_root,
                allowed_modules=["detection", "recognition"],
                providers=["CPUExecutionProvider"]
            )
            self.face_analysis.prepare(ctx_id=-1, det_size=(320, 320))
        except Exception as exc:  # pragma: no cover
            raise ModelUnavailableError(f"Failed to initialize FaceAnalysis: {exc}") from exc

    def extract_embedding(self, image_bgr: np.ndarray) -> np.ndarray:
        # Chuẩn hóa kích thước ảnh đầu vào về 640x640 có padding để triệt tiêu hoàn toàn
        # độ trễ biên dịch đồ thị động trong ONNX Runtime đối với các kích thước ảnh khác nhau.
        standardized_image = resize_and_pad(image_bgr, target_size=640)
        faces = self.face_analysis.get(standardized_image)
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
        import sys
        service = self._ensure_service()
        try:
            # 1. Warm-up detector bằng kích thước chuẩn hóa 640x640 giống thực tế chạy để tối ưu đồ thị ONNX
            dummy_img = np.zeros((640, 640, 3), dtype=np.uint8)
            service.face_analysis.get(dummy_img)

            # 2. Warm-up recognizer (bằng cách giả lập đối tượng Face có keypoints và chạy model recognition)
            if hasattr(service.face_analysis, "models") and "recognition" in service.face_analysis.models:
                from insightface.app.common import Face
                mock_face = Face()
                # 5 keypoints giả lập trên ảnh 640x640 tương ứng với tọa độ tỉ lệ chuẩn
                mock_face.kps = np.array([
                    [240, 280],
                    [400, 280],
                    [320, 360],
                    [260, 440],
                    [380, 440]
                ], dtype=np.float32)
                # Bổ sung bbox giả lập để tránh thiếu thuộc tính trên một số phiên bản insightface
                mock_face.bbox = np.array([200, 200, 440, 440], dtype=np.float32)

                rec_model = service.face_analysis.models["recognition"]
                rec_model.get(dummy_img, mock_face)

            # Sử dụng print ra stdout để hiển thị chắc chắn trên uvicorn log console
            print("InsightFace (detector & recognizer) warm-up completed successfully.")
            LOGGER.info("InsightFace (detector & recognizer) warm-up completed successfully.")
        except Exception as e:
            print(f"InsightFace warm-up failed: {e}", file=sys.stderr)
            LOGGER.warning("InsightFace warm-up failed: %s", e)

    def extract_embedding(self, image_bgr: np.ndarray) -> np.ndarray:
        return self._ensure_service().extract_embedding(image_bgr)
