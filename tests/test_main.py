import os
import pickle
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

TEMP_ROOT = tempfile.mkdtemp(prefix="attendance-backend-")
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{Path(TEMP_ROOT, 'test.db').as_posix()}"

from backend.app.db import Base, SessionLocal, engine  # noqa: E402
from backend.app.main import create_app  # noqa: E402
from backend.app.models import AttendanceLog, FaceEmbedding, User  # noqa: E402
from backend.app.services.embedding import NoFaceDetectedError  # noqa: E402
from backend.scripts.import_face_db import import_face_db  # noqa: E402


class StubEmbeddingService:
    def __init__(self) -> None:
        self.embedding_map = {
            10: np.array([1.0, 0.0, 0.0], dtype=np.float32),
            20: np.array([0.0, 1.0, 0.0], dtype=np.float32),
            30: np.array([0.92, 0.08, 0.0], dtype=np.float32),
            40: np.array([0.25, 0.96, 0.0], dtype=np.float32),
        }

    def extract_embedding(self, image_bgr: np.ndarray) -> np.ndarray:
        key = int(image_bgr[0, 0, 0])
        if key == 99:
            raise NoFaceDetectedError("No face detected in the provided image.")
        return self.embedding_map[key]


def make_image_bytes(pixel_value: int) -> bytes:
    image = np.full((32, 32, 3), pixel_value, dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("Failed to encode test image.")
    return encoded.tobytes()


class AttendanceApiTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        self.client = TestClient(create_app(embedding_service=StubEmbeddingService()))

    def test_profile_upsert_and_get(self) -> None:
        upsert = self.client.post(
            "/api/profile/upsert",
            json={
                "student_id": "2026_SV01",
                "full_name": "Nguyen Van A",
                "class_name": "CNTT K18",
                "department": "CS",
            },
        )
        self.assertEqual(upsert.status_code, 200)
        self.assertFalse(upsert.json()["has_face_registered"])

        detail = self.client.get("/api/profile/2026_SV01")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["full_name"], "Nguyen Van A")

    def test_register_face_upserts_embedding(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV01"})
        response = self.client.post(
            "/api/face/register",
            files={"file": ("register.png", make_image_bytes(10), "image/png")},
            data={"student_id": "2026_SV01"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Registered")

        session = SessionLocal()
        try:
          stored = session.get(FaceEmbedding, "2026_SV01")
          self.assertIsNotNone(stored)
          self.assertEqual(stored.embedding, [1.0, 0.0, 0.0])
        finally:
          session.close()

    def test_verify_success_and_failure_log(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV01"})
        self.client.post(
            "/api/face/register",
            files={"file": ("register.png", make_image_bytes(10), "image/png")},
            data={"student_id": "2026_SV01"},
        )

        success = self.client.post(
            "/api/attendance/verify",
            files={"file": ("verify.png", make_image_bytes(30), "image/png")},
            data={"student_id": "2026_SV01"},
        )
        self.assertEqual(success.status_code, 200)
        self.assertEqual(success.json()["status"], "Success")

        fail = self.client.post(
            "/api/attendance/verify",
            files={"file": ("verify.png", make_image_bytes(20), "image/png")},
            data={"student_id": "2026_SV01"},
        )
        self.assertEqual(fail.status_code, 200)
        self.assertEqual(fail.json()["status"], "Failed")

        session = SessionLocal()
        try:
            logs = session.query(AttendanceLog).filter(AttendanceLog.student_id == "2026_SV01").all()
            self.assertEqual(len(logs), 3)
        finally:
            session.close()

    def test_verify_without_registered_face_returns_failed(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV09"})
        response = self.client.post(
            "/api/attendance/verify",
            files={"file": ("verify.png", make_image_bytes(30), "image/png")},
            data={"student_id": "2026_SV09"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Failed")
        self.assertIn("No face", response.json()["reason"])

    def test_register_returns_no_face_error(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV03"})
        response = self.client.post(
            "/api/face/register",
            files={"file": ("noface.png", make_image_bytes(99), "image/png")},
            data={"student_id": "2026_SV03"},
        )
        self.assertEqual(response.status_code, 422)

    def test_import_face_db_script(self) -> None:
        source_path = Path(TEMP_ROOT) / "face_db.pkl"
        with source_path.open("wb") as handle:
            pickle.dump({"2026_SV10": [0.1, 0.2, 0.3]}, handle)

        import_face_db(source_path)

        session = SessionLocal()
        try:
            user = session.get(User, "2026_SV10")
            embedding = session.get(FaceEmbedding, "2026_SV10")
            self.assertIsNotNone(user)
            self.assertEqual(embedding.embedding, [0.1, 0.2, 0.3])
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
