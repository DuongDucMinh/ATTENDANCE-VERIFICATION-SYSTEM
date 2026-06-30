import sys
import os
import numpy as np

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

print("Step 1: Importing insightface...")
from insightface.app import FaceAnalysis
from insightface.app.common import Face
print("Import completed.")

print("Step 2: Initializing FaceAnalysis...")
# Set env threads before initializing
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

face_analysis = FaceAnalysis(name="buffalo_s", allowed_modules=["detection", "recognition"], providers=["CPUExecutionProvider"])
face_analysis.prepare(ctx_id=-1, det_size=(320, 320))
print("FaceAnalysis prepared.")

print("Step 3: Warming up detector with zeros...")
dummy_img = np.zeros((320, 320, 3), dtype=np.uint8)
faces = face_analysis.get(dummy_img)
print(f"Detector warm-up completed. Found {len(faces)} faces.")

print("Step 4: Warming up recognizer with mock Face...")
try:
    mock_face = Face()
    mock_face.kps = np.array([
        [120, 140],
        [200, 140],
        [160, 180],
        [130, 220],
        [190, 220]
    ], dtype=np.float32)
    
    # We also mock bbox since some versions check it
    mock_face.bbox = np.array([100, 100, 220, 220], dtype=np.float32)
    
    rec_model = face_analysis.models["recognition"]
    print("Calling rec_model.get...")
    rec_model.get(dummy_img, mock_face)
    print("Recognizer warm-up completed successfully.")
except Exception as e:
    print(f"Recognizer warm-up failed with error: {e}")
    import traceback
    traceback.print_exc()

print("All steps completed.")
