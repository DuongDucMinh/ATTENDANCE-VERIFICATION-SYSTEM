from __future__ import annotations

import pickle
import sys
from pathlib import Path

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.db import Base, SessionLocal, engine  # noqa: E402
from backend.app.repositories import FaceEmbeddingRepository, UserRepository  # noqa: E402


def import_face_db(source_path: Path) -> None:
    if not source_path.exists():
        raise FileNotFoundError(f"Could not find source file: {source_path}")

    with source_path.open("rb") as source_file:
        data = pickle.load(source_file)

    if not isinstance(data, dict):
        raise ValueError("face_db.pkl must contain a dictionary.")

    Base.metadata.create_all(bind=engine)
    session: Session = SessionLocal()
    try:
        users = UserRepository(session)
        embeddings = FaceEmbeddingRepository(session)

        for student_id, vector in data.items():
            users.ensure_placeholder(str(student_id))
            embeddings.upsert(str(student_id), [float(item) for item in vector], None)

        session.commit()
    finally:
        session.close()


if __name__ == "__main__":
    source = ROOT / "face_db.pkl"
    import_face_db(source)
    print(f"Imported embeddings from {source}")
