import { FACE_LANDMARKS, THRESHOLDS } from "./constants";

export function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export function meanPoint(points) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function getCoverTransform(sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return {
    scale,
    offsetX: (displayWidth - renderedWidth) / 2,
    offsetY: (displayHeight - renderedHeight) / 2,
  };
}

export function normalizedToDisplay(landmark, sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const transform = getCoverTransform(sourceWidth, sourceHeight, displayWidth, displayHeight);
  const sourceX = landmark.x * sourceWidth;
  const sourceY = landmark.y * sourceHeight;
  return {
    x: displayWidth - (sourceX * transform.scale + transform.offsetX),
    y: sourceY * transform.scale + transform.offsetY,
  };
}

export function normalizedToSource(landmark, sourceWidth, sourceHeight) {
  return {
    x: landmark.x * sourceWidth,
    y: landmark.y * sourceHeight,
  };
}

export function computeFaceBox(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    area: Math.max(maxX - minX, 0) * Math.max(maxY - minY, 0),
  };
}

export function normalizeRollAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  if (angle > 90) return angle - 180;
  if (angle < -90) return angle + 180;
  return angle;
}

export function computeEar(landmarks, sourceWidth, sourceHeight, eyeIndexes) {
  const p1 = normalizedToSource(landmarks[eyeIndexes[0]], sourceWidth, sourceHeight);
  const p2 = normalizedToSource(landmarks[eyeIndexes[1]], sourceWidth, sourceHeight);
  const p3 = normalizedToSource(landmarks[eyeIndexes[2]], sourceWidth, sourceHeight);
  const p4 = normalizedToSource(landmarks[eyeIndexes[3]], sourceWidth, sourceHeight);
  const p5 = normalizedToSource(landmarks[eyeIndexes[4]], sourceWidth, sourceHeight);
  const p6 = normalizedToSource(landmarks[eyeIndexes[5]], sourceWidth, sourceHeight);
  const horizontal = distance(p1, p4);
  if (horizontal === 0) return 0;
  return (distance(p2, p6) + distance(p3, p5)) / (2 * horizontal);
}

export function computeMouthOpenRatio(landmarks, sourceWidth, sourceHeight) {
  const left = normalizedToSource(landmarks[FACE_LANDMARKS.mouthLeft], sourceWidth, sourceHeight);
  const right = normalizedToSource(landmarks[FACE_LANDMARKS.mouthRight], sourceWidth, sourceHeight);
  const upper = normalizedToSource(landmarks[FACE_LANDMARKS.upperLip], sourceWidth, sourceHeight);
  const lower = normalizedToSource(landmarks[FACE_LANDMARKS.lowerLip], sourceWidth, sourceHeight);
  const mouthWidth = distance(left, right);
  if (mouthWidth === 0) return 0;
  return distance(upper, lower) / mouthWidth;
}

export function computePoseAngles(landmarks, sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const leftEyeOuter = normalizedToDisplay(landmarks[FACE_LANDMARKS.leftEyeOuter], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const rightEyeOuter = normalizedToDisplay(landmarks[FACE_LANDMARKS.rightEyeOuter], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const leftEyeInner = normalizedToDisplay(landmarks[FACE_LANDMARKS.leftInnerEye], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const rightEyeInner = normalizedToDisplay(landmarks[FACE_LANDMARKS.rightInnerEye], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const leftEyeCenter = meanPoint(
    FACE_LANDMARKS.leftEye.map((index) => normalizedToDisplay(landmarks[index], sourceWidth, sourceHeight, displayWidth, displayHeight)),
  );
  const rightEyeCenter = meanPoint(
    FACE_LANDMARKS.rightEye.map((index) => normalizedToDisplay(landmarks[index], sourceWidth, sourceHeight, displayWidth, displayHeight)),
  );
  const forehead = normalizedToDisplay(landmarks[FACE_LANDMARKS.foreheadTop], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const nose = normalizedToDisplay(landmarks[FACE_LANDMARKS.noseTip], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const chin = normalizedToDisplay(landmarks[FACE_LANDMARKS.chin], sourceWidth, sourceHeight, displayWidth, displayHeight);

  const rollLeftRef = meanPoint([leftEyeOuter, leftEyeInner]);
  const rollRightRef = meanPoint([rightEyeOuter, rightEyeInner]);
  const rawRoll = Math.atan2(rollRightRef.y - rollLeftRef.y, rollRightRef.x - rollLeftRef.x) * (180 / Math.PI);
  const rollAngle = normalizeRollAngle(rawRoll);

  const eyeSpan = Math.max(Math.abs(rightEyeOuter.x - leftEyeOuter.x), 1);
  const eyeMid = meanPoint([leftEyeCenter, rightEyeCenter]);
  const yawAngle = Math.atan(((nose.x - eyeMid.x) / eyeSpan) * 2.2) * (180 / Math.PI);

  const faceHeight = Math.max(chin.y - forehead.y, 1);
  const faceMidY = forehead.y + faceHeight / 2;
  const pitchAngle = Math.atan(((nose.y - faceMidY) / faceHeight) * 3.6) * (180 / Math.PI);

  return { rollAngle, yawAngle, pitchAngle };
}

export function evaluatePoseState(pose) {
  const { frontYawMax, rollMax, pitchMax } = THRESHOLDS.alignment;
  const rollOk = Math.abs(pose.rollAngle) <= rollMax;
  const yawOk = Math.abs(pose.yawAngle) <= frontYawMax;
  const pitchOk = Math.abs(pose.pitchAngle) <= pitchMax;

  if (!yawOk) return { ok: false, label: "Giữ đầu thẳng, nhìn trực diện" };
  if (!rollOk) return { ok: false, label: "Giữ đầu thẳng, không nghiêng" };
  if (!pitchOk) return { ok: false, label: "Giữ đầu thẳng, không cúi/ngửa" };
  return { ok: true, label: "Nhìn thẳng vào camera" };
}

export function getOvalMetrics(overlayWidth, overlayHeight) {
  const width = overlayWidth * 0.54;
  const height = overlayHeight * 0.66;
  return {
    centerX: overlayWidth / 2,
    centerY: overlayHeight - overlayHeight * 0.07 - height / 2,
    width,
    height,
    area: Math.PI * (width / 2) * (height / 2),
  };
}

export function computeAlignmentState(faceLandmarks, sourceImage, overlayWidth, overlayHeight) {
  const displayPoints = faceLandmarks.map((point) =>
    normalizedToDisplay(point, sourceImage.width, sourceImage.height, overlayWidth, overlayHeight),
  );
  const sourcePoints = faceLandmarks.map((point) => normalizedToSource(point, sourceImage.width, sourceImage.height));
  const displayBox = computeFaceBox(displayPoints);
  const sourceBox = computeFaceBox(sourcePoints);
  const oval = getOvalMetrics(overlayWidth, overlayHeight);

  const forehead = normalizedToDisplay(
    faceLandmarks[FACE_LANDMARKS.foreheadTop],
    sourceImage.width,
    sourceImage.height,
    overlayWidth,
    overlayHeight,
  );
  const nose = normalizedToDisplay(faceLandmarks[FACE_LANDMARKS.noseTip], sourceImage.width, sourceImage.height, overlayWidth, overlayHeight);
  const anchorPoint = { x: nose.x, y: nose.y * 0.7 + forehead.y * 0.3 };
  const ovalTarget = { x: oval.centerX, y: oval.centerY - oval.height * 0.08 };
  const centerOffsetX = Math.abs(anchorPoint.x - ovalTarget.x) / Math.max(oval.width, 1);
  const centerOffsetY = Math.abs(anchorPoint.y - ovalTarget.y) / Math.max(oval.height, 1);
  const centerCheck =
    centerOffsetX <= THRESHOLDS.alignment.strictCenterX &&
    centerOffsetY <= THRESHOLDS.alignment.strictCenterY;

  const pose = computePoseAngles(faceLandmarks, sourceImage.width, sourceImage.height, overlayWidth, overlayHeight);
  const poseState = evaluatePoseState(pose);
  const sizeRatio = displayBox.area / oval.area;
  const sizeCheck =
    sizeRatio >= THRESHOLDS.alignment.faceSizeMinRatio &&
    sizeRatio <= THRESHOLDS.alignment.faceSizeMaxRatio;

  return {
    displayPoints,
    sourcePoints,
    displayBox,
    sourceBox,
    anchorPoint,
    oval,
    centerCheck,
    centerOffsetX,
    centerOffsetY,
    pose,
    poseState,
    sizeRatio,
    sizeCheck,
    aligned: centerCheck && poseState.ok && sizeCheck,
  };
}

export function clampBox(box, width, height) {
  const minX = Math.max(0, Math.min(width, box.minX));
  const minY = Math.max(0, Math.min(height, box.minY));
  const maxX = Math.max(minX, Math.min(width, box.maxX));
  const maxY = Math.max(minY, Math.min(height, box.maxY));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
    area: Math.max(maxX - minX, 1) * Math.max(maxY - minY, 1),
  };
}
