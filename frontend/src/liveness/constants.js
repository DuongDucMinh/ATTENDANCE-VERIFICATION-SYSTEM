export const FACE_LANDMARKS = {
  leftEye: [33, 160, 158, 133, 153, 144],
  rightEye: [263, 387, 385, 362, 380, 373],
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftInnerEye: 133,
  rightInnerEye: 362,
  foreheadTop: 10,
  noseTip: 4,
  chin: 152,
  mouthLeft: 61,
  mouthRight: 291,
  upperLip: 13,
  lowerLip: 14,
};

export const FRAME_CONFIG = {
  sampleSize: 160,
  maxBufferedFrames: 16,
  sampleEveryNFrames: 2,
};

export const THRESHOLDS = {
  session: {
    alignmentHoldMs: 1200,
    poseHoldMs: 400,
    verifyStepTimeoutMs: 10000,
    verifySessionTimeoutMs: 20000,
    verifyNeutralCaptureHoldMs: 600,
    verifyNeutralCaptureTimeoutMs: 6000,
    registerSessionTimeoutMs: 30000,
  },
  blink: {
    minBaselineEar: 0.16,
    closeFloorEar: 0.12,
    recoverFloorEar: 0.16,
    minBlinkFrames: 1,
    maxBlinkFrames: 24,
  },
  alignment: {
    strictCenterX: 0.12,
    strictCenterY: 0.12,
    turnCenterX: 0.24,
    turnCenterY: 0.16,
    wrongTurnYaw: 8,
    frontYawMax: 11,
    rollMax: 10,
    pitchMax: 14,
    faceSizeMinRatio: 0.6,
    faceSizeMaxRatio: 0.9,
  },
  pose: {
    leftYawMin: -14,
    rightYawMin: 14,
    mouthOpenRatioMin: 0.24,
  },
  quality: {
    blurMin: 12,
    brightnessMin: 40,
    brightnessMax: 220,
    qualityMin: 0.25,
  },
  antiReplay: {
    enabled: false,
    motionCorrMax: 0.92,
    flickerPeakMax: 2.6,
    stripeScoreMax: 180,
    moireScoreMax: 0.34,
  },
};

export const VERIFY_CHALLENGE_POOL = ["blink_twice", "turn_left_hold", "turn_right_hold", "open_mouth"];

export const REGISTER_POSE_STEPS = [
  {
    id: "front",
    type: "blink_once",
    prompt: "Giữ mặt thẳng trong khung và chớp mắt 1 lần.",
    poseTarget: "front",
    timeoutMs: 12000,
  },
  {
    id: "left",
    type: "turn_left_hold",
    prompt: "Quay mặt sang trái nhẹ và giữ 0,4 giây.",
    poseTarget: "left",
    timeoutMs: 8000,
  },
  {
    id: "right",
    type: "turn_right_hold",
    prompt: "Quay mặt sang phải nhẹ và giữ 0,4 giây.",
    poseTarget: "right",
    timeoutMs: 8000,
  },
];
