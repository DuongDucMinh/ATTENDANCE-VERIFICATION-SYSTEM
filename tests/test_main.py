import json
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
os.environ["UPLOADS_DIR"] = str(Path(TEMP_ROOT, "registered_faces"))

from backend.app.db import Base, SessionLocal, engine  # noqa: E402
from backend.app.main import create_app  # noqa: E402
from backend.app.models import AttendanceLog, FaceEmbedding, User  # noqa: E402
from backend.app.services.embedding import NoFaceDetectedError  # noqa: E402
from backend.scripts.import_face_db import import_face_db  # noqa: E402


class StubEmbeddingService:
    def __init__(self) -> None:
        self.embedding_map = {
            10: np.array([1.0, 0.0, 0.0], dtype=np.float32),
            11: np.array([0.96, 0.28, 0.0], dtype=np.float32),
            12: np.array([0.96, -0.28, 0.0], dtype=np.float32),
            13: np.array([0.99, 0.06, 0.0], dtype=np.float32),
            20: np.array([0.0, 1.0, 0.0], dtype=np.float32),
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


def make_capture_meta(
    pose_label: str | None = None,
    *,
    quality: dict[str, float] | None = None,
) -> str:
    return json.dumps(
        {
            "challenge_sequence": ["front_blink" if pose_label == "front" else "turn_left_hold"],
            "challenge_result": "passed",
            "quality": quality or {"blur_score": 24.0, "brightness_mean": 128.0, "quality_score": 0.82},
            "anti_replay": {
                "motion_corr": 0.22,
                "flicker_peak_ratio": 1.1,
                "stripe_score": 45.0,
                "moire_score": 0.11,
                "verdict": "passed",
            },
            "selected_frame": {"frame_index": 6, "sampled_frame_count": 12},
            "pose_label": pose_label,
            "telemetry": {"note": "test"},
        }
    )


class AttendanceApiTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        self.client = TestClient(create_app(embedding_service=StubEmbeddingService()))

    def register_pose(self, student_id: str, pose_label: str, pixel_value: int) -> None:
        response = self.client.post(
            "/api/face/register",
            files={"file": ("register.png", make_image_bytes(pixel_value), "image/png")},
            data={
                "student_id": student_id,
                "pose_label": pose_label,
                "capture_meta": make_capture_meta(pose_label),
            },
        )
        self.assertEqual(response.status_code, 200)

    def register_pose_with_quality(
        self,
        student_id: str,
        pose_label: str,
        pixel_value: int,
        *,
        blur_score: float,
        brightness_mean: float,
        quality_score: float,
    ) -> None:
        response = self.client.post(
            "/api/face/register",
            files={"file": ("register.png", make_image_bytes(pixel_value), "image/png")},
            data={
                "student_id": student_id,
                "pose_label": pose_label,
                "capture_meta": make_capture_meta(
                    pose_label,
                    quality={
                        "blur_score": blur_score,
                        "brightness_mean": brightness_mean,
                        "quality_score": quality_score,
                    },
                ),
            },
        )
        self.assertEqual(response.status_code, 200)

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
        self.assertEqual(upsert.json()["registered_sample_count"], 0)

        detail = self.client.get("/api/profile/2026_SV01")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["full_name"], "Nguyen Van A")

    def test_health_reports_effective_threshold_and_source_diagnostics(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["similarity_threshold"], 0.7)
        self.assertIn(payload["similarity_threshold_source"], {"dotenv_file", "process_env", "default"})
        self.assertIn("env_file_path", payload)
        self.assertIn("env_file_exists", payload)
        self.assertIn("launch_cwd", payload)

    def test_register_three_pose_samples_and_profile(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV01"})
        self.register_pose("2026_SV01", "front", 10)
        self.register_pose("2026_SV01", "left", 11)
        self.register_pose("2026_SV01", "right", 12)

        detail = self.client.get("/api/profile/2026_SV01")
        self.assertEqual(detail.status_code, 200)
        self.assertTrue(detail.json()["has_face_registered"])
        self.assertEqual(detail.json()["registered_sample_count"], 3)
        self.assertEqual(sorted(detail.json()["registered_pose_labels"]), ["front", "left", "right"])

        session = SessionLocal()
        try:
            samples = session.query(FaceEmbedding).filter(FaceEmbedding.student_id == "2026_SV01").all()
            self.assertEqual(len(samples), 3)
            self.assertTrue(all(sample.image_path for sample in samples))
            self.assertTrue(all(Path(sample.image_path).exists() for sample in samples))
            self.assertTrue(all(Path(sample.image_path).name in {"2026_SV01_front.jpg", "2026_SV01_left.jpg", "2026_SV01_right.jpg"} for sample in samples))
        finally:
            session.close()

    def test_reregister_same_pose_reuses_single_image_path_and_cleans_legacy_files(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV02"})
        uploads_dir = Path(os.environ["UPLOADS_DIR"])
        uploads_dir.mkdir(parents=True, exist_ok=True)
        legacy_file = uploads_dir / "2026_SV02_front_20240101010101000000.jpg"
        legacy_file.write_bytes(b"legacy")

        self.register_pose("2026_SV02", "front", 10)
        self.assertFalse(legacy_file.exists())

        session = SessionLocal()
        try:
            sample = session.query(FaceEmbedding).filter(FaceEmbedding.student_id == "2026_SV02").one()
            first_path = Path(sample.image_path)
            self.assertEqual(first_path.name, "2026_SV02_front.jpg")
            self.assertTrue(first_path.exists())
        finally:
            session.close()

        self.register_pose("2026_SV02", "front", 13)

        session = SessionLocal()
        try:
            sample = session.query(FaceEmbedding).filter(FaceEmbedding.student_id == "2026_SV02").one()
            second_path = Path(sample.image_path)
            self.assertEqual(second_path, first_path)
            self.assertTrue(second_path.exists())
            self.assertEqual(len(list(uploads_dir.glob("2026_SV02_front*.jpg"))), 1)
        finally:
            session.close()

    def test_verify_success_and_failure_log(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV01"})
        self.register_pose("2026_SV01", "front", 10)
        self.register_pose("2026_SV01", "left", 11)
        self.register_pose("2026_SV01", "right", 12)

        success = self.client.post(
            "/api/attendance/verify",
            files={"file": ("verify.png", make_image_bytes(13), "image/png")},
            data={"student_id": "2026_SV01", "capture_meta": make_capture_meta()},
        )
        self.assertEqual(success.status_code, 200)
        self.assertEqual(success.json()["status"], "Success")
        self.assertGreaterEqual(success.json()["score"], 0.8)
        self.assertIn("best_sample_score", success.json()["meta"]["decision_breakdown"])

        fail = self.client.post(
            "/api/attendance/verify",
            files={"file": ("verify.png", make_image_bytes(20), "image/png")},
            data={"student_id": "2026_SV01", "capture_meta": make_capture_meta()},
        )
        self.assertEqual(fail.status_code, 200)
        self.assertEqual(fail.json()["status"], "Failed")

        session = SessionLocal()
        try:
            logs = session.query(AttendanceLog).filter(AttendanceLog.student_id == "2026_SV01").all()
            self.assertEqual(len(logs), 5)
            verify_logs = [log for log in logs if log.action == "verify"]
            self.assertEqual(len(verify_logs), 2)
            self.assertIn("decision_breakdown", verify_logs[0].meta)
        finally:
            session.close()

    def test_verify_final_score_matches_raw_match_score(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV11"})
        self.register_pose_with_quality("2026_SV11", "front", 10, blur_score=40.0, brightness_mean=128.0, quality_score=0.9)
        self.register_pose_with_quality("2026_SV11", "left", 11, blur_score=40.0, brightness_mean=128.0, quality_score=0.9)
        self.register_pose_with_quality("2026_SV11", "right", 12, blur_score=40.0, brightness_mean=128.0, quality_score=0.9)

        verify = self.client.post(
            "/api/attendance/verify",
            files={"file": ("verify.png", make_image_bytes(13), "image/png")},
            data={
                "student_id": "2026_SV11",
                "capture_meta": make_capture_meta(
                    quality={"blur_score": 44.0, "brightness_mean": 130.0, "quality_score": 0.92}
                ),
            },
        )
        self.assertEqual(verify.status_code, 200)
        breakdown = verify.json()["meta"]["decision_breakdown"]
        self.assertEqual(verify.json()["score"], breakdown["final_score"])
        self.assertEqual(breakdown["final_score"], min(0.99, breakdown["raw_match_score"]))
        self.assertNotIn("quality_margin", breakdown)

    def test_verify_without_enough_registered_samples_returns_failed(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV09"})
        self.register_pose("2026_SV09", "front", 10)
        response = self.client.post(
            "/api/attendance/verify",
            files={"file": ("verify.png", make_image_bytes(13), "image/png")},
            data={"student_id": "2026_SV09", "capture_meta": make_capture_meta()},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Failed")
        self.assertIn("At least 3 registered pose samples", response.json()["reason"])

    def test_register_returns_no_face_error(self) -> None:
        self.client.post("/api/profile/upsert", json={"student_id": "2026_SV03"})
        response = self.client.post(
            "/api/face/register",
            files={"file": ("noface.png", make_image_bytes(99), "image/png")},
            data={"student_id": "2026_SV03", "pose_label": "front", "capture_meta": make_capture_meta("front")},
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
            embedding = session.query(FaceEmbedding).filter(FaceEmbedding.student_id == "2026_SV10").one()
            self.assertIsNotNone(user)
            self.assertEqual(embedding.pose_label, "front")
            self.assertEqual(embedding.embedding, [0.1, 0.2, 0.3])
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
