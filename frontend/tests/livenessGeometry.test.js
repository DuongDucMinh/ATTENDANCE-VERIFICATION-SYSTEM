import { describe, expect, it } from "vitest";
import { FACE_LANDMARKS } from "../src/liveness/constants";
import { computeEar, computeMouthOpenRatio, computePoseAngles } from "../src/liveness/geometry";

function createLandmarks() {
  return Array.from({ length: 400 }, () => ({ x: 0.5, y: 0.5 }));
}

describe("liveness geometry", () => {
  it("computes EAR for a synthetic open eye", () => {
    const landmarks = createLandmarks();
    landmarks[FACE_LANDMARKS.leftEye[0]] = { x: 0.3, y: 0.4 };
    landmarks[FACE_LANDMARKS.leftEye[1]] = { x: 0.34, y: 0.36 };
    landmarks[FACE_LANDMARKS.leftEye[2]] = { x: 0.38, y: 0.36 };
    landmarks[FACE_LANDMARKS.leftEye[3]] = { x: 0.42, y: 0.4 };
    landmarks[FACE_LANDMARKS.leftEye[4]] = { x: 0.38, y: 0.44 };
    landmarks[FACE_LANDMARKS.leftEye[5]] = { x: 0.34, y: 0.44 };

    const ear = computeEar(landmarks, 100, 100, FACE_LANDMARKS.leftEye);
    expect(ear).toBeGreaterThan(0.6);
  });

  it("estimates yaw direction from nose offset", () => {
    const landmarks = createLandmarks();
    landmarks[33] = { x: 0.35, y: 0.4 };
    landmarks[133] = { x: 0.42, y: 0.4 };
    landmarks[263] = { x: 0.65, y: 0.42 };
    landmarks[362] = { x: 0.58, y: 0.42 };
    landmarks[10] = { x: 0.5, y: 0.2 };
    landmarks[4] = { x: 0.6, y: 0.48 };
    landmarks[152] = { x: 0.5, y: 0.8 };

    const pose = computePoseAngles(landmarks, 100, 100, 100, 100);
    expect(pose.yawAngle).toBeLessThan(-10);
  });

  it("computes mouth open ratio from lip distance over mouth width", () => {
    const landmarks = createLandmarks();
    landmarks[FACE_LANDMARKS.mouthLeft] = { x: 0.35, y: 0.55 };
    landmarks[FACE_LANDMARKS.mouthRight] = { x: 0.65, y: 0.55 };
    landmarks[FACE_LANDMARKS.upperLip] = { x: 0.5, y: 0.48 };
    landmarks[FACE_LANDMARKS.lowerLip] = { x: 0.5, y: 0.58 };

    const ratio = computeMouthOpenRatio(landmarks, 100, 100);
    expect(ratio).toBeCloseTo(0.333, 2);
  });
});
