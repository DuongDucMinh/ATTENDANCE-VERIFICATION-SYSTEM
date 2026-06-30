import time
import numpy as np
import cv2
import os
import sys

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.services.embedding import InsightFaceEmbeddingService
from insightface.app import FaceAnalysis

def benchmark():
    print("=== InsightFace Benchmarking ===")
    
    # Create dummy image
    dummy_img = np.zeros((640, 640, 3), dtype=np.uint8)
    # Draw a circle to simulate something
    cv2.circle(dummy_img, (320, 320), 100, (255, 255, 255), -1)

    sizes = [(640, 640), (480, 480), (320, 320), (256, 256)]
    
    for size in sizes:
        print(f"\nTesting det_size={size}...")
        
        # Initialize
        start_init = time.perf_counter()
        face_analysis = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
        face_analysis.prepare(ctx_id=-1, det_size=size)
        init_time = time.perf_counter() - start_init
        print(f"  Initialization time: {init_time:.4f} seconds")
        
        # Run multiple times to measure first run vs subsequent runs
        for i in range(5):
            start_infer = time.perf_counter()
            try:
                # face_analysis.get will run the detector
                faces = face_analysis.get(dummy_img)
                detected = len(faces)
            except Exception as e:
                detected = f"Error: {e}"
            infer_time = time.perf_counter() - start_infer
            print(f"  Inference {i+1} time: {infer_time:.4f} seconds (Faces detected: {detected})")

if __name__ == "__main__":
    benchmark()
