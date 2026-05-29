const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [263, 387, 385, 362, 380, 373];
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const FOREHEAD_TOP = 10;
const NOSE_TIP = 4;
const CHIN = 152;
const LEFT_INNER_EYE = 133;
const RIGHT_INNER_EYE = 362;
const ALIGNMENT_HOLD_MS = 2000;
const EAR_MIN_BASELINE = 0.19;
const EAR_FLOOR_CLOSE = 0.12;
const EAR_FLOOR_RECOVER = 0.18;
const MIN_BLINK_FRAMES = 1;
const MAX_BLINK_FRAMES = 8;

const dom = {
  video: document.getElementById("video"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  freezeCanvas: document.getElementById("freezeCanvas"),
  viewport: document.getElementById("viewport"),
  ovalGuide: document.getElementById("ovalGuide"),
  telemetryEar: document.getElementById("telemetryEar"),
  telemetryStatus: document.getElementById("telemetryStatus"),
  telemetryHint: document.getElementById("telemetryHint"),
  liveGuideBadge: document.getElementById("liveGuideBadge"),
  studentId: document.getElementById("studentId"),
  expectedId: document.getElementById("expectedId"),
  thresholdSlider: document.getElementById("thresholdSlider"),
  thresholdValue: document.getElementById("thresholdValue"),
  startCameraBtn: document.getElementById("startCameraBtn"),
  registerFaceBtn: document.getElementById("registerFaceBtn"),
  quickViewDbBtn: document.getElementById("quickViewDbBtn"),
  resetBtn: document.getElementById("resetBtn"),
  evaluationToggle: document.getElementById("evaluationToggle"),
  evaluationPanel: document.getElementById("evaluationPanel"),
  expectedGroup: document.getElementById("expectedGroup"),
  thresholdGroup: document.getElementById("thresholdGroup"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  logWindow: document.getElementById("logWindow"),
  systemNotice: document.getElementById("systemNotice"),
  workflowTitle: document.getElementById("workflowTitle"),
  workflowCopy: document.getElementById("workflowCopy"),
  toastStack: document.getElementById("toastStack"),
  metricAttempts: document.getElementById("metricAttempts"),
  metricEvaluated: document.getElementById("metricEvaluated"),
  metricTP: document.getElementById("metricTP"),
  metricFP: document.getElementById("metricFP"),
  criteriaFace: document.getElementById("criteriaFace"),
  criteriaCenter: document.getElementById("criteriaCenter"),
  criteriaPose: document.getElementById("criteriaPose"),
  criteriaSize: document.getElementById("criteriaSize"),
  criteriaHold: document.getElementById("criteriaHold"),
  criteriaBlink: document.getElementById("criteriaBlink"),
  poseRollRaw: document.getElementById("poseRollRaw"),
  poseRollStable: document.getElementById("poseRollStable"),
  poseYawRaw: document.getElementById("poseYawRaw"),
  poseYawStable: document.getElementById("poseYawStable"),
  posePitchRaw: document.getElementById("posePitchRaw"),
  posePitchStable: document.getElementById("posePitchStable"),
  poseDecision: document.getElementById("poseDecision"),
  poseFrames: document.getElementById("poseFrames"),
  modeInputs: Array.from(document.querySelectorAll('input[name="mode"]')),
};

const state = {
  faceMesh: null,
  camera: null,
  streamReady: false,
  requestInFlight: false,
  capturePreparing: false,
  readyForBlink: false,
  readyForSubmit: false,
  alignmentStartTs: null,
  baselineEar: null,
  blinkState: "idle",
  blinkFrameCount: 0,
  blinkSatisfied: false,
  currentMode: "register",
  smoothedPose: null,
  poseGoodFrames: 0,
  poseBadFrames: 0,
  latestSourceBox: null,
  latestDisplayBox: null,
  latestEar: null,
  pendingFaceBlob: null,
  metrics: {
    verifyAttempts: 0,
    evaluatedRuns: 0,
    truePositive: 0,
    falsePositive: 0,
  },
  criteriaLogState: {
    face: null,
    center: null,
    pose: null,
    size: null,
    hold: null,
    blink: null,
  },
};

function getSelectedMode() {
  return dom.modeInputs.find((input) => input.checked)?.value || "register";
}

function getTimestamp() {
  return new Date().toLocaleString();
}

function setTelemetry(status, hint, ear = state.latestEar) {
  dom.telemetryStatus.textContent = `Trạng thái: ${status}`;
  dom.telemetryHint.textContent = `Gợi ý: ${hint}`;
  dom.telemetryEar.textContent = `EAR: ${ear == null ? "--" : ear.toFixed(3)}`;
  dom.liveGuideBadge.textContent = hint;
}

function setSystemNotice(message, level = "info") {
  dom.systemNotice.textContent = message;
  dom.systemNotice.className = `system-notice ${level}`;
}

function notify(message, level = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${level}`;
  toast.textContent = message;
  dom.toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function appendLog(message, level = "info") {
  const entry = document.createElement("p");
  entry.className = `log-entry ${level}`;
  entry.textContent = message;
  dom.logWindow.prepend(entry);
}

function updateMetricsView() {
  dom.metricAttempts.textContent = state.metrics.verifyAttempts;
  dom.metricEvaluated.textContent = state.metrics.evaluatedRuns;
  dom.metricTP.textContent = state.metrics.truePositive;
  dom.metricFP.textContent = state.metrics.falsePositive;
}

function formatPoseAngle(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function updatePoseDebugPanel(poseState = null) {
  if (!poseState) {
    dom.poseRollRaw.textContent = "--";
    dom.poseRollStable.textContent = "--";
    dom.poseYawRaw.textContent = "--";
    dom.poseYawStable.textContent = "--";
    dom.posePitchRaw.textContent = "--";
    dom.posePitchStable.textContent = "--";
    dom.poseDecision.textContent = "--";
    dom.poseFrames.textContent = "0";
    return;
  }

  dom.poseRollRaw.textContent = formatPoseAngle(poseState.rawPose?.rollAngle);
  dom.poseRollStable.textContent = formatPoseAngle(poseState.smoothedPose?.rollAngle);
  dom.poseYawRaw.textContent = formatPoseAngle(poseState.rawPose?.yawAngle);
  dom.poseYawStable.textContent = formatPoseAngle(poseState.smoothedPose?.yawAngle);
  dom.posePitchRaw.textContent = formatPoseAngle(poseState.rawPose?.pitchAngle);
  dom.posePitchStable.textContent = formatPoseAngle(poseState.smoothedPose?.pitchAngle);
  dom.poseDecision.textContent = poseState.ok ? "ĐẠT" : poseState.label;
  dom.poseFrames.textContent = String(state.poseGoodFrames);
}

function updateThresholdLabel() {
  dom.thresholdValue.textContent = Number(dom.thresholdSlider.value).toFixed(2);
}

function resizeCanvases() {
  const { width, height } = dom.viewport.getBoundingClientRect();
  dom.overlayCanvas.width = width;
  dom.overlayCanvas.height = height;
  dom.freezeCanvas.width = width;
  dom.freezeCanvas.height = height;
}

function setGuideState(stateName = "tracking") {
  dom.ovalGuide.classList.remove("tracking", "ready", "error");
  if (stateName) {
    dom.ovalGuide.classList.add(stateName);
  }
}

function updateRegisterButtonState() {
  const inRegisterMode = state.currentMode === "register";
  const canRegister =
    inRegisterMode &&
    state.streamReady &&
    state.readyForSubmit &&
    !state.requestInFlight &&
    Boolean(dom.studentId.value.trim());

  dom.registerFaceBtn.disabled = !canRegister;
  dom.registerFaceBtn.classList.toggle("hidden", !inRegisterMode);
}

function clearPreparedCapture() {
  state.readyForSubmit = false;
  state.pendingFaceBlob = null;
  updateRegisterButtonState();
}

function setCriteriaRow(element, ok, reachedText = "Đạt", notReachedText = "Chưa đạt") {
  element.classList.remove("ok", "fail");
  element.classList.add(ok ? "ok" : "fail");
  const stateLabel = element.querySelector("strong");
  if (stateLabel) {
    stateLabel.textContent = ok ? reachedText : notReachedText;
  }
}

function updateCriteriaChecklist(criteria) {
  setCriteriaRow(dom.criteriaFace, criteria.faceDetected, "Đạt", "Chưa phát hiện");
  setCriteriaRow(dom.criteriaCenter, criteria.center, "Đạt", "Lệch tâm");
  setCriteriaRow(dom.criteriaPose, criteria.pose, "Đạt", criteria.poseLabel || "Đầu chưa thẳng");
  setCriteriaRow(dom.criteriaSize, criteria.size, "Đạt", criteria.sizeTooSmall ? "Mặt quá xa" : "Chưa phù hợp");
  setCriteriaRow(dom.criteriaHold, criteria.hold, "Đã giữ đủ 2 giây", "Chưa đủ 2 giây");
  setCriteriaRow(dom.criteriaBlink, criteria.blink, "Đạt", "Chưa chớp mắt hợp lệ");
}

function logCriteriaTransitions(criteria) {
  const map = {
    face: ["Phát hiện khuôn mặt", criteria.faceDetected],
    center: ["Căn giữa", criteria.center],
    pose: ["Giữ thẳng đầu", criteria.pose],
    size: ["Kích thước mặt", criteria.size],
    hold: ["Giữ ổn định 2 giây", criteria.hold],
    blink: ["Chớp mắt hợp lệ", criteria.blink],
  };

  Object.entries(map).forEach(([key, [label, nowValue]]) => {
    if (state.criteriaLogState[key] === null) {
      state.criteriaLogState[key] = nowValue;
      return;
    }
    if (state.criteriaLogState[key] !== nowValue) {
      state.criteriaLogState[key] = nowValue;
      appendLog(
        `[${getTimestamp()}] Tiêu chí "${label}" ${nowValue ? "ĐẠT" : "MẤT"}.`,
        nowValue ? "success" : "error",
      );
    }
  });
}

function resetTrackingState() {
  state.readyForBlink = false;
  state.alignmentStartTs = null;
  state.baselineEar = null;
  state.blinkState = "idle";
  state.blinkFrameCount = 0;
  state.blinkSatisfied = false;
  state.smoothedPose = null;
  state.poseGoodFrames = 0;
  state.poseBadFrames = 0;
}

function resetWorkflow() {
  state.requestInFlight = false;
  state.capturePreparing = false;
  clearPreparedCapture();
  resetTrackingState();
  updatePoseDebugPanel();
  setGuideState(null);
  setFreezeVisible(false);

  const ctx = dom.overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, dom.overlayCanvas.width, dom.overlayCanvas.height);

  setTelemetry("Chờ", "Đặt lại thành công. Căn mặt lại từ đầu.");
  setSystemNotice("Đã đặt lại quy trình nhận diện.", "info");
  notify("Đã đặt lại quy trình nhận diện.", "info");
  appendLog(`[${getTimestamp()}] Workflow reset by user.`, "info");
}

function updateModeUI() {
  state.currentMode = getSelectedMode();
  const inRegisterMode = state.currentMode === "register";

  dom.expectedGroup.classList.toggle("hidden", inRegisterMode);
  dom.thresholdGroup.classList.toggle("hidden", inRegisterMode);

  dom.workflowTitle.textContent = inRegisterMode ? "Hướng dẫn Đăng ký" : "Hướng dẫn Xác minh";
  dom.workflowCopy.textContent = inRegisterMode
    ? "Nhập mã sinh viên, căn mặt vào khung, giữ ổn định 2 giây, chớp mắt. Khi khung xanh, bấm Đăng ký khuôn mặt."
    : "Căn mặt vào khung, giữ ổn định 2 giây, chớp mắt. Khi khung xanh, hệ thống tự động crop và gửi ảnh lên backend.";

  clearPreparedCapture();
  resetTrackingState();
  updatePoseDebugPanel();
  setGuideState(null);
  setFreezeVisible(false);
  updateRegisterButtonState();

  if (inRegisterMode) {
    setSystemNotice("Chế độ Đăng ký: khi khung xanh, bấm Đăng ký khuôn mặt để lưu mã sinh viên.", "info");
  } else {
    setSystemNotice("Chế độ Xác minh: khi khung xanh, hệ thống tự động gửi ảnh lên backend.", "info");
  }
}

function getCoverTransform(sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return {
    scale,
    offsetX: (displayWidth - renderedWidth) / 2,
    offsetY: (displayHeight - renderedHeight) / 2,
  };
}

function normalizedToDisplay(landmark, sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const transform = getCoverTransform(sourceWidth, sourceHeight, displayWidth, displayHeight);
  const sourceX = landmark.x * sourceWidth;
  const sourceY = landmark.y * sourceHeight;
  return {
    x: displayWidth - (sourceX * transform.scale + transform.offsetX),
    y: sourceY * transform.scale + transform.offsetY,
  };
}

function normalizedToSource(landmark, sourceWidth, sourceHeight) {
  return {
    x: landmark.x * sourceWidth,
    y: landmark.y * sourceHeight,
  };
}

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function meanPoint(points) {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function computeEar(landmarks, sourceWidth, sourceHeight, eyeIndexes) {
  const p1 = normalizedToSource(landmarks[eyeIndexes[0]], sourceWidth, sourceHeight);
  const p2 = normalizedToSource(landmarks[eyeIndexes[1]], sourceWidth, sourceHeight);
  const p3 = normalizedToSource(landmarks[eyeIndexes[2]], sourceWidth, sourceHeight);
  const p4 = normalizedToSource(landmarks[eyeIndexes[3]], sourceWidth, sourceHeight);
  const p5 = normalizedToSource(landmarks[eyeIndexes[4]], sourceWidth, sourceHeight);
  const p6 = normalizedToSource(landmarks[eyeIndexes[5]], sourceWidth, sourceHeight);

  const verticalA = distance(p2, p6);
  const verticalB = distance(p3, p5);
  const horizontal = distance(p1, p4);

  if (horizontal === 0) {
    return 0;
  }

  return (verticalA + verticalB) / (2 * horizontal);
}

function getOvalMetrics() {
  const viewportRect = dom.viewport.getBoundingClientRect();
  const ovalRect = dom.ovalGuide.getBoundingClientRect();
  return {
    centerX: ovalRect.left - viewportRect.left + ovalRect.width / 2,
    centerY: ovalRect.top - viewportRect.top + ovalRect.height / 2,
    width: ovalRect.width,
    height: ovalRect.height,
    area: Math.PI * (ovalRect.width / 2) * (ovalRect.height / 2),
  };
}

function computeFaceBox(points) {
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

function normalizeRollAngle(angle) {
  if (!Number.isFinite(angle)) {
    return 0;
  }

  if (angle > 90) {
    return angle - 180;
  }

  if (angle < -90) {
    return angle + 180;
  }

  return angle;
}

function computePoseAngles(landmarks, sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const leftEyeOuter = normalizedToDisplay(
    landmarks[LEFT_EYE_OUTER],
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
  );
  const rightEyeOuter = normalizedToDisplay(
    landmarks[RIGHT_EYE_OUTER],
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
  );
  const leftEyeInner = normalizedToDisplay(
    landmarks[LEFT_INNER_EYE],
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
  );
  const rightEyeInner = normalizedToDisplay(
    landmarks[RIGHT_INNER_EYE],
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
  );
  const leftEyeCenter = meanPoint(
    LEFT_EYE.map((index) =>
      normalizedToDisplay(landmarks[index], sourceWidth, sourceHeight, displayWidth, displayHeight),
    ),
  );
  const rightEyeCenter = meanPoint(
    RIGHT_EYE.map((index) =>
      normalizedToDisplay(landmarks[index], sourceWidth, sourceHeight, displayWidth, displayHeight),
    ),
  );
  const forehead = normalizedToDisplay(
    landmarks[FOREHEAD_TOP],
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
  );
  const nose = normalizedToDisplay(
    landmarks[NOSE_TIP],
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
  );
  const chin = normalizedToDisplay(
    landmarks[CHIN],
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
  );
  const rollLeftRef = meanPoint([leftEyeOuter, leftEyeInner]);
  const rollRightRef = meanPoint([rightEyeOuter, rightEyeInner]);
  const rawRollAngle = Math.atan2(
    rollRightRef.y - rollLeftRef.y,
    rollRightRef.x - rollLeftRef.x,
  ) * (180 / Math.PI);
  const rollAngle = normalizeRollAngle(rawRollAngle);

  const eyeSpan = Math.max(Math.abs(rightEyeOuter.x - leftEyeOuter.x), 1);
  const eyeMid = meanPoint([leftEyeCenter, rightEyeCenter]);
  const yawAngle = Math.atan(((nose.x - eyeMid.x) / eyeSpan) * 2.2) * (180 / Math.PI);

  const faceHeight = Math.max(chin.y - forehead.y, 1);
  const faceMidY = forehead.y + faceHeight / 2;
  const pitchAngle = Math.atan(((nose.y - faceMidY) / faceHeight) * 3.6) * (180 / Math.PI);

  return {
    rollAngle,
    yawAngle,
    pitchAngle,
    debug: {
      leftEyeOuter,
      leftEyeInner,
      rightEyeOuter,
      rightEyeInner,
      rollLeftRef,
      rollRightRef,
      rawRollAngle,
    },
  };
}

function evaluatePoseState(pose) {
  const rollOk = Math.abs(pose.rollAngle) <= 10;
  const yawOk = Math.abs(pose.yawAngle) <= 11;
  const pitchOk = Math.abs(pose.pitchAngle) <= 14;

  let label = "Đầu chưa thẳng";
  if (!yawOk) {
    label = "Xoay ngang quá mức";
  } else if (!rollOk) {
    label = "Nghiêng đầu quá mức";
  } else if (!pitchOk) {
    label = "Cúi/ngửa đầu quá mức";
  }

  return {
    ok: rollOk && yawOk,
    label,
    rollOk,
    yawOk,
    pitchOk,
  };
}

function getSmoothedPose(pose) {
  if (!state.smoothedPose) {
    state.smoothedPose = { ...pose };
    return state.smoothedPose;
  }

  const alpha = 0.18;
  state.smoothedPose = {
    ...pose,
    rollAngle: state.smoothedPose.rollAngle * (1 - alpha) + pose.rollAngle * alpha,
    yawAngle: state.smoothedPose.yawAngle * (1 - alpha) + pose.yawAngle * alpha,
    pitchAngle: state.smoothedPose.pitchAngle * (1 - alpha) + pose.pitchAngle * alpha,
  };
  return state.smoothedPose;
}

function getStablePoseState(rawPose, smoothedPose) {
  const rawState = evaluatePoseState(rawPose);
  const smoothState = evaluatePoseState(smoothedPose);

  if (rawState.ok) {
    state.poseGoodFrames += 1;
    state.poseBadFrames = 0;
  } else {
    state.poseBadFrames += 1;
    state.poseGoodFrames = 0;
  }

  return {
    ok: rawState.ok,
    label: rawState.ok ? "Đạt" : rawState.label,
    rawState,
    smoothState,
    rawPose,
    smoothedPose,
  };
}

function drawPoseDebug(ctx, poseDebug) {
  if (!poseDebug) {
    return;
  }

  const points = [
    poseDebug.leftEyeOuter,
    poseDebug.leftEyeInner,
    poseDebug.rightEyeOuter,
    poseDebug.rightEyeInner,
  ];

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(95, 194, 255, 0.95)";
  ctx.fillStyle = "rgba(95, 194, 255, 0.95)";

  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "rgba(120, 242, 179, 1)";
  [poseDebug.rollLeftRef, poseDebug.rollRightRef].forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.beginPath();
  ctx.moveTo(poseDebug.rollLeftRef.x, poseDebug.rollLeftRef.y);
  ctx.lineTo(poseDebug.rollRightRef.x, poseDebug.rollRightRef.y);
  ctx.stroke();
  ctx.restore();
}

function drawDiagnostics(displayBox, anchorPoint, isGood, poseDebug = null) {
  const ctx = dom.overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, dom.overlayCanvas.width, dom.overlayCanvas.height);

  if (!displayBox || !anchorPoint) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = isGood ? "rgba(120,242,179,0.95)" : "rgba(255,138,138,0.95)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(displayBox.minX, displayBox.minY, displayBox.width, displayBox.height);

  ctx.fillStyle = isGood ? "rgba(120,242,179,0.95)" : "rgba(255,138,138,0.95)";
  ctx.beginPath();
  ctx.arc(anchorPoint.x, anchorPoint.y, 5, 0, Math.PI * 2);
  ctx.fill();
  drawPoseDebug(ctx, poseDebug);
  ctx.restore();
}

function setFreezeVisible(visible) {
  dom.freezeCanvas.classList.toggle("hidden", !visible);
}

function drawFreezeFrame(sourceImage) {
  const ctx = dom.freezeCanvas.getContext("2d");
  const displayWidth = dom.freezeCanvas.width;
  const displayHeight = dom.freezeCanvas.height;
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const transform = getCoverTransform(sourceImage.width, sourceImage.height, displayWidth, displayHeight);
  ctx.save();
  ctx.translate(displayWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(
    sourceImage,
    transform.offsetX,
    transform.offsetY,
    sourceImage.width * transform.scale,
    sourceImage.height * transform.scale,
  );
  ctx.restore();
}

async function cropFaceBlob(sourceImage) {
  if (!state.latestSourceBox) {
    throw new Error("No face bounds available for cropping.");
  }

  const faceCenterX = state.latestSourceBox.minX + state.latestSourceBox.width / 2;
  const faceCenterY = state.latestSourceBox.minY + state.latestSourceBox.height / 2;
  const cropSide = Math.max(
    state.latestSourceBox.width * 1.9,
    state.latestSourceBox.height * 2.05,
    220,
  );

  // Bias the crop slightly upward so the detector keeps more forehead and less chest.
  let cropX = Math.round(faceCenterX - cropSide / 2);
  let cropY = Math.round(faceCenterY - cropSide / 2 - state.latestSourceBox.height * 0.08);
  let cropWidth = Math.round(cropSide);
  let cropHeight = Math.round(cropSide);

  cropX = Math.max(cropX, 0);
  cropY = Math.max(cropY, 0);
  cropWidth = Math.min(cropWidth, sourceImage.width - cropX);
  cropHeight = Math.min(cropHeight, sourceImage.height - cropY);

  if (cropWidth > cropHeight) {
    cropWidth = cropHeight;
  } else if (cropHeight > cropWidth) {
    cropHeight = cropWidth;
  }

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;
  const cropCtx = cropCanvas.getContext("2d");
  cropCtx.drawImage(
    sourceImage,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  return new Promise((resolve, reject) => {
    cropCanvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to convert face crop to JPEG blob."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

async function submitCapture(blob) {
  const formData = new FormData();
  formData.append("file", blob, `${state.currentMode}.jpg`);

  if (state.currentMode === "register") {
    formData.append("student_id", dom.studentId.value.trim());
  } else {
    formData.append("threshold", Number(dom.thresholdSlider.value).toFixed(2));
  }

  const endpoint = state.currentMode === "register" ? "/api/register" : "/api/verify";
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

function registerVerificationMetrics(apiResult) {
  state.metrics.verifyAttempts += 1;

  const expectedId = dom.expectedId.value.trim();
  if (expectedId) {
    state.metrics.evaluatedRuns += 1;
    if (apiResult.status === "Success" && apiResult.student_id === expectedId) {
      state.metrics.truePositive += 1;
    } else if (apiResult.status === "Success" && apiResult.student_id !== expectedId) {
      state.metrics.falsePositive += 1;
    }
  }

  updateMetricsView();
}

function evaluateAlignment(landmarks, sourceWidth, sourceHeight) {
  const displayWidth = dom.overlayCanvas.width;
  const displayHeight = dom.overlayCanvas.height;
  const displayPoints = landmarks.map((landmark) =>
    normalizedToDisplay(landmark, sourceWidth, sourceHeight, displayWidth, displayHeight),
  );
  const sourcePoints = landmarks.map((landmark) => normalizedToSource(landmark, sourceWidth, sourceHeight));
  const displayBox = computeFaceBox(displayPoints);
  const sourceBox = computeFaceBox(sourcePoints);
  const oval = getOvalMetrics();

  const forehead = normalizedToDisplay(landmarks[FOREHEAD_TOP], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const nose = normalizedToDisplay(landmarks[NOSE_TIP], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const anchorPoint = {
    x: nose.x,
    y: (nose.y * 0.7) + (forehead.y * 0.3),
  };
  const ovalTarget = {
    x: oval.centerX,
    y: oval.centerY - oval.height * 0.08,
  };

  const centerCheck =
    Math.abs(anchorPoint.x - ovalTarget.x) <= oval.width * 0.12 &&
    Math.abs(anchorPoint.y - ovalTarget.y) <= oval.height * 0.12;

  const rawPose = computePoseAngles(landmarks, sourceWidth, sourceHeight, displayWidth, displayHeight);
  const smoothedPose = getSmoothedPose(rawPose);
  const poseState = getStablePoseState(rawPose, smoothedPose);
  const poseCheck = poseState.ok;

  const sizeRatio = displayBox.area / oval.area;
  const sizeCheck = sizeRatio >= 0.6 && sizeRatio <= 0.9;

  return {
    centerCheck,
    poseCheck,
    sizeCheck,
    sizeRatio,
    aligned: centerCheck && poseCheck && sizeCheck,
    anchorPoint,
    ovalTarget,
    pose: smoothedPose,
    rawPose,
    poseState,
    poseDebug: rawPose.debug,
    displayBox,
    sourceBox,
  };
}

function buildLiveHint(criteria) {
  if (!criteria.faceDetected) {
    return "Không thấy khuôn mặt. Hãy đưa mặt vào vùng camera.";
  }
  if (!criteria.center) {
    return "Hãy đưa mặt vào giữa khung vàng.";
  }
  if (!criteria.pose) {
    return criteria.poseHint || "Hãy giữ thẳng đầu và nhìn thẳng vào camera.";
  }
  if (!criteria.size) {
    if (criteria.sizeTooSmall) {
      return "Khuôn mặt hơi nhỏ. Hãy đưa mặt sát lại gần camera.";
    }
    return "Khuôn mặt quá gần khung. Hãy lùi nhẹ ra sau.";
  }
  if (!criteria.hold) {
    return "Giữ nguyên tư thế thêm một chút để đủ 2 giây.";
  }
  if (!criteria.blink) {
    return "Giữ nguyên tư thế và chớp mắt một lần.";
  }
  return "Giữ nguyên tư thế.";
}

function updateBlinkState(ear, alignedNow) {
  if (
    !state.streamReady ||
    !state.readyForBlink ||
    !alignedNow ||
    state.requestInFlight ||
    state.capturePreparing ||
    state.readyForSubmit
  ) {
    state.blinkState = "idle";
    state.blinkFrameCount = 0;
    return false;
  }

  if (state.baselineEar == null) {
    state.baselineEar = ear;
  } else if (ear > EAR_MIN_BASELINE * 0.8) {
    state.baselineEar = state.baselineEar * 0.9 + ear * 0.1;
  }

  if (state.baselineEar < EAR_MIN_BASELINE) {
    return false;
  }

  const closeThreshold = Math.max(EAR_FLOOR_CLOSE, state.baselineEar * 0.68);
  const recoverThreshold = Math.max(EAR_FLOOR_RECOVER, state.baselineEar * 0.88);

  if (state.blinkState === "idle") {
    if (ear < closeThreshold) {
      state.blinkState = "closing";
      state.blinkFrameCount = 1;
    }
    return false;
  }

  if (state.blinkState === "closing") {
    if (ear < closeThreshold) {
      state.blinkFrameCount += 1;
      if (state.blinkFrameCount > MAX_BLINK_FRAMES) {
        state.blinkState = "idle";
        state.blinkFrameCount = 0;
      }
      return false;
    }

    if (ear > recoverThreshold) {
      const validBlink =
        state.blinkFrameCount >= MIN_BLINK_FRAMES && state.blinkFrameCount <= MAX_BLINK_FRAMES;
      state.blinkState = "idle";
      state.blinkFrameCount = 0;
      if (validBlink) {
        state.blinkSatisfied = true;
      }
      return validBlink;
    }

    state.blinkState = "idle";
    state.blinkFrameCount = 0;
  }

  return false;
}

async function submitPreparedCapture() {
  if (!state.pendingFaceBlob) {
    setSystemNotice("Chưa có ảnh khuôn mặt sẵn sàng để gửi.", "error");
    notify("Chưa có ảnh khuôn mặt sẵn sàng để gửi.", "error");
    return;
  }

  state.requestInFlight = true;
  updateRegisterButtonState();
  setSystemNotice(
    state.currentMode === "register"
      ? "Dang gui anh khuon mat de dang ky..."
      : "Dang gui anh khuon mat de xac minh...",
    "info",
  );

  try {
    const { data } = await submitCapture(state.pendingFaceBlob);

    if (state.currentMode === "verify") {
      registerVerificationMetrics(data);
    }

    if (data.status === "Success" || data.status === "Registered") {
      const logLine =
        state.currentMode === "verify"
          ? `[${getTimestamp()}] Xác minh ID: ${data.student_id} | Điểm cosine: ${Number(data.score).toFixed(3)} | Trạng thái hệ thống: THÀNH CÔNG`
          : `[${getTimestamp()}] Đã đăng ký ID: ${data.student_id} | Trạng thái hệ thống: ĐÃ LƯU`;

      appendLog(logLine, "success");
      setTelemetry("Thành công", "Backend đã xử lý thành công.");
      setSystemNotice(
        state.currentMode === "verify"
          ? `Xác minh thành công: ${data.student_id} | Điểm ${Number(data.score).toFixed(3)}`
          : `Đăng ký thành công cho mã sinh viên ${data.student_id}.`,
        "success",
      );
      notify(
        state.currentMode === "verify"
          ? `Xác minh thành công cho ${data.student_id}.`
          : `Đã đăng ký khuôn mặt cho ${data.student_id}.`,
        "success",
      );
    } else {
      const logLine =
        state.currentMode === "verify"
          ? `[${getTimestamp()}] Xác minh ID: N/A | Điểm cosine: ${Number(data.score || 0).toFixed(3)} | Trạng thái hệ thống: THẤT BẠI | Lý do: ${data.reason}`
          : `[${getTimestamp()}] Đăng ký thất bại | Lý do: ${data.reason}`;

      appendLog(logLine, "error");
      setTelemetry("Thất bại", data.reason || "Thao tác thất bại.");
      setSystemNotice(data.reason || "Backend từ chối yêu cầu.", "error");
      notify(data.reason || "Backend từ chối yêu cầu.", "error");
      setGuideState("error");
    }
  } catch (error) {
    appendLog(`[${getTimestamp()}] Request error: ${error.message}`, "error");
    setTelemetry("Thất bại", error.message || "Lỗi yêu cầu không mong muốn.");
    setSystemNotice(error.message || "Lỗi yêu cầu không mong muốn.", "error");
    notify(error.message || "Lỗi yêu cầu không mong muốn.", "error");
    setGuideState("error");
  } finally {
    state.requestInFlight = false;
    clearPreparedCapture();
    resetTrackingState();
    updateRegisterButtonState();
    window.setTimeout(() => {
      setFreezeVisible(false);
      setGuideState(null);
    }, 900);
  }
}

async function prepareReadyCapture(sourceImage) {
  if (state.capturePreparing || state.requestInFlight || state.readyForSubmit) {
    return;
  }

  state.capturePreparing = true;
  setTelemetry("Đang xử lý", "Chớp mắt hợp lệ. Đang crop khuôn mặt...");
  setSystemNotice("Chớp mắt hợp lệ. Đang chuẩn bị ảnh khuôn mặt.", "info");

  try {
    const faceBlob = await cropFaceBlob(sourceImage);
    state.pendingFaceBlob = faceBlob;
    state.readyForSubmit = true;
    resetTrackingState();
    setGuideState("ready");
    setFreezeVisible(true);
    drawFreezeFrame(sourceImage);
    updateRegisterButtonState();

    if (state.currentMode === "register") {
      setTelemetry("Sẵn sàng", "Khung xanh. Bấm Đăng ký khuôn mặt để lưu mã sinh viên.");
      setSystemNotice("Khuôn mặt đã hợp lệ. Bấm Đăng ký khuôn mặt để lưu.", "success");
      notify("Khuôn mặt đã hợp lệ. Bạn có thể bấm Đăng ký khuôn mặt.", "success");
      appendLog(`[${getTimestamp()}] Face capture ready for registration.`, "success");
    } else {
      setTelemetry("Sẵn sàng", "Khung xanh. Hệ thống đang tự động xác minh...");
      setSystemNotice("Khuôn mặt đã hợp lệ. Hệ thống đang tự động xác minh.", "success");
      notify("Khuôn mặt đã hợp lệ. Hệ thống đang tự động xác minh.", "success");
      appendLog(`[${getTimestamp()}] Face capture ready for auto verification.`, "success");
      await submitPreparedCapture();
    }
  } catch (error) {
    setGuideState("error");
    setTelemetry("Thất bại", error.message || "Không thể tạo crop khuôn mặt.");
    setSystemNotice(error.message || "Không thể tạo crop khuôn mặt.", "error");
    notify(error.message || "Không thể tạo crop khuôn mặt.", "error");
    appendLog(`[${getTimestamp()}] Capture preparation failed: ${error.message}`, "error");
    clearPreparedCapture();
  } finally {
    state.capturePreparing = false;
    updateRegisterButtonState();
  }
}

function handleLandmarkResults(results) {
  resizeCanvases();

  const faceLandmarks = results.multiFaceLandmarks?.[0];
  const sourceImage = results.image;

  if (!sourceImage) {
    return;
  }

  if (!faceLandmarks) {
    state.latestSourceBox = null;
    state.latestDisplayBox = null;
    drawDiagnostics(null, null, false);
    updatePoseDebugPanel();

    if (!state.readyForSubmit) {
      resetTrackingState();
      setGuideState(null);
      const noFaceCriteria = {
        faceDetected: false,
        center: false,
        pose: false,
        poseLabel: "Chưa có dữ liệu pose",
        poseHint: "Không thấy khuôn mặt. Hãy đưa mặt vào vùng camera.",
        size: false,
        sizeTooSmall: false,
        hold: false,
        blink: false,
      };
      updateCriteriaChecklist(noFaceCriteria);
      logCriteriaTransitions(noFaceCriteria);
      if (state.streamReady && !state.requestInFlight && !state.capturePreparing) {
        setTelemetry("Đang theo dõi", buildLiveHint(noFaceCriteria));
      }
    }
    return;
  }

  const alignment = evaluateAlignment(faceLandmarks, sourceImage.width, sourceImage.height);
  state.latestSourceBox = alignment.sourceBox;
  state.latestDisplayBox = alignment.displayBox;
  updatePoseDebugPanel(alignment.poseState);

  const leftEar = computeEar(faceLandmarks, sourceImage.width, sourceImage.height, LEFT_EYE);
  const rightEar = computeEar(faceLandmarks, sourceImage.width, sourceImage.height, RIGHT_EYE);
  const ear = (leftEar + rightEar) / 2;
  state.latestEar = ear;

  drawDiagnostics(
    alignment.displayBox,
    alignment.anchorPoint,
    alignment.aligned || state.readyForSubmit,
    alignment.poseDebug,
  );

  if (state.readyForSubmit) {
    setGuideState("ready");
      setTelemetry(
      "Sẵn sàng",
      state.currentMode === "register"
        ? "Khung xanh. Bấm Đăng ký khuôn mặt để lưu mã sinh viên."
        : "Khung xanh. Hệ thống đang xử lý xác minh.",
      ear,
    );
    return;
  }

  let holdReached = false;
  if (alignment.aligned) {
    if (!state.alignmentStartTs) {
      state.alignmentStartTs = performance.now();
    }

    const heldMs = performance.now() - state.alignmentStartTs;
    if (heldMs >= ALIGNMENT_HOLD_MS) {
      state.readyForBlink = true;
      holdReached = true;
      setGuideState("tracking");
      setTelemetry("Yêu cầu chớp mắt", "Căn tốt. Hãy chớp mắt một lần.", ear);
    } else {
      const remaining = ((ALIGNMENT_HOLD_MS - heldMs) / 1000).toFixed(1);
      setGuideState("tracking");
      setTelemetry("Đang căn chỉnh", `Đang căn chuẩn. Giữ thêm ${remaining}s.`, ear);
    }
  } else {
    resetTrackingState();
    setGuideState(null);
    setTelemetry("Đang căn chỉnh", "Căn lại khuôn mặt, nhìn thẳng, và giữ đúng kích thước.", ear);
  }

  const blinkDetected = updateBlinkState(ear, alignment.aligned);
  const criteriaSnapshot = {
    faceDetected: true,
    center: alignment.centerCheck,
    pose: alignment.poseCheck,
    poseLabel: alignment.poseState.label,
    poseHint: alignment.poseState.label === "Xoay ngang quá mức"
      ? "Mặt đang quay lệch sang trái/phải. Hãy nhìn thẳng vào camera."
      : alignment.poseState.label === "Nghiêng đầu quá mức"
        ? "Đầu đang nghiêng sang một bên. Hãy giữ thẳng đầu."
        : alignment.poseState.label === "Cúi/ngửa đầu quá mức"
          ? "Bạn đang cúi hoặc ngửa đầu. Hãy giữ đầu thẳng tự nhiên."
          : "Giữ thẳng đầu và nhìn thẳng vào camera.",
    size: alignment.sizeCheck,
    sizeTooSmall: alignment.sizeRatio < 0.6,
    hold: holdReached || state.readyForBlink,
    blink: state.readyForSubmit || state.blinkSatisfied || blinkDetected,
  };
  updateCriteriaChecklist(criteriaSnapshot);
  logCriteriaTransitions(criteriaSnapshot);

  if (!state.readyForSubmit && !state.requestInFlight && !state.capturePreparing) {
    const liveHint = buildLiveHint(criteriaSnapshot);
    const status = criteriaSnapshot.hold ? "Yêu cầu chớp mắt" : "Đang căn chỉnh";
    setTelemetry(status, liveHint, ear);
  }

  if (blinkDetected && alignment.aligned) {
    prepareReadyCapture(sourceImage);
  }
}

async function initFaceMesh() {
  if (state.faceMesh) {
    return state.faceMesh;
  }

  const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  faceMesh.onResults(handleLandmarkResults);
  state.faceMesh = faceMesh;
  return faceMesh;
}

async function startCamera() {
  if (state.camera) {
    setSystemNotice("Camera đã được bật trước đó.", "info");
    notify("Camera đã được bật trước đó.", "info");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const message = "Trình duyệt không hỗ trợ truy cập camera (getUserMedia).";
    setTelemetry("Thất bại", message);
    setSystemNotice(message, "error");
    notify(message, "error");
    throw new Error(message);
  }

  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    const message = "Camera yêu cầu HTTPS hoặc chạy trên localhost.";
    setTelemetry("Thất bại", message);
    setSystemNotice(message, "error");
    notify(message, "error");
    throw new Error(message);
  }

  try {
    if (navigator.permissions && navigator.permissions.query) {
      const result = await navigator.permissions.query({ name: "camera" });
      if (result.state === "denied") {
        const deniedMessage = "Quyền camera đang bị chặn. Hãy mở quyền camera trong cài đặt trình duyệt.";
        setSystemNotice(deniedMessage, "error");
        notify(deniedMessage, "error");
      } else if (result.state === "prompt") {
        setSystemNotice("Trình duyệt sẽ hỏi quyền camera sau khi bạn bấm cho phép.", "info");
      }
    }
  } catch (_err) {
    // Permissions API không có trên một số trình duyệt; bỏ qua an toàn.
  }

  resizeCanvases();
  const faceMesh = await initFaceMesh();
  setSystemNotice("Đang mở camera...", "info");
  notify("Đang mở camera...", "info");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 640 },
        aspectRatio: 1,
      },
      audio: false,
    });
    dom.video.srcObject = stream;
    await dom.video.play();
  } catch (error) {
    appendLog(`[${getTimestamp()}] Camera access denied: ${error.message}`, "error");
    setTelemetry("Thất bại", "Không thể truy cập webcam.");
    const deniedMessage =
      "Không mở được camera. Hãy bấm biểu tượng camera trên thanh địa chỉ và chọn Cho phép, rồi thử lại.";
    setSystemNotice(deniedMessage, "error");
    notify(deniedMessage, "error");
    throw error;
  }

  state.camera = new Camera(dom.video, {
    onFrame: async () => {
      if (!state.faceMesh) {
        return;
      }
      await faceMesh.send({ image: dom.video });
    },
    width: 640,
    height: 640,
  });

  await state.camera.start();
  state.streamReady = true;
  updateRegisterButtonState();
  appendLog(`[${getTimestamp()}] Camera stream initialized.`, "success");
  setTelemetry("Chờ", "Camera đã sẵn sàng. Đưa khuôn mặt vào khung để bắt đầu.");
  setSystemNotice("Camera đã sẵn sàng.", "success");
  notify("Camera đã sẵn sàng.", "success");
}

async function onRegisterClick() {
  if (!state.streamReady) {
    setSystemNotice("Hãy bật camera trước.", "error");
    notify("Hãy bật camera trước.", "error");
    return;
  }

  if (!dom.studentId.value.trim()) {
    setSystemNotice("Mã sinh viên là bắt buộc khi đăng ký.", "error");
    notify("Mã sinh viên là bắt buộc khi đăng ký.", "error");
    return;
  }

  if (!state.readyForSubmit || !state.pendingFaceBlob) {
    setSystemNotice("Chưa có khuôn mặt hợp lệ. Căn chuẩn và chớp mắt để khung chuyển xanh.", "error");
    notify("Chưa có khuôn mặt hợp lệ để đăng ký.", "error");
    return;
  }

  setSystemNotice("Đăng ký khuôn mặt đang được gửi lên backend.", "info");
  notify("Đang gửi dữ liệu đăng ký khuôn mặt.", "info");
  await submitPreparedCapture();
}

async function quickViewFaceDb() {
  try {
    setSystemNotice("Đang tải dữ liệu nhanh từ face_db.pkl ...", "info");
    const response = await fetch("/api/db/summary");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.reason || "Không thể đọc dữ liệu CSDL khuôn mặt.");
    }

    const previewText = data.records.length
      ? data.records
          .map(
            (row) =>
              `- ${row.student_id}: dim=${row.embedding_dim}, preview=[${row.embedding_preview.join(", ")}]`,
          )
          .join("\n")
      : "- (chưa có dữ liệu)";

    const message = `Tệp: ${data.db_path}\nTổng sinh viên: ${data.total_students}\n${previewText}`;
    setSystemNotice("Đã tải dữ liệu CSDL khuôn mặt. Xem chi tiết trong thông báo nổi và log.", "success");
    notify(`CSDL khuôn mặt có ${data.total_students} bản ghi.`, "success");
    appendLog(`[${getTimestamp()}] DB Summary\n${message}`, "info");
    alert(message);
  } catch (error) {
    setSystemNotice(error.message || "Không tải được dữ liệu CSDL khuôn mặt.", "error");
    notify(error.message || "Không tải được dữ liệu CSDL khuôn mặt.", "error");
    appendLog(`[${getTimestamp()}] DB summary failed: ${error.message}`, "error");
  }
}

function bindEvents() {
  updateThresholdLabel();
  updateModeUI();
  updateMetricsView();
  updatePoseDebugPanel();
  resizeCanvases();
  updateRegisterButtonState();

  dom.thresholdSlider.addEventListener("input", updateThresholdLabel);
  dom.startCameraBtn.addEventListener("click", () => {
    startCamera().catch((error) => {
      appendLog(`[${getTimestamp()}] Start camera failed: ${error.message}`, "error");
    });
  });
  dom.registerFaceBtn.addEventListener("click", () => {
    onRegisterClick().catch((error) => {
      setSystemNotice(error.message || "Đăng ký thất bại.", "error");
      notify(error.message || "Đăng ký thất bại.", "error");
    });
  });
  dom.quickViewDbBtn.addEventListener("click", () => {
    quickViewFaceDb().catch((error) => {
      setSystemNotice(error.message || "Không thể xem nhanh dữ liệu.", "error");
      notify(error.message || "Không thể xem nhanh dữ liệu.", "error");
    });
  });
  dom.resetBtn.addEventListener("click", resetWorkflow);
  dom.clearLogBtn.addEventListener("click", () => {
    dom.logWindow.innerHTML = "";
    notify("Đã xóa nhật ký mô phỏng.", "info");
  });
  dom.evaluationToggle.addEventListener("change", () => {
    dom.evaluationPanel.classList.toggle("hidden", !dom.evaluationToggle.checked);
  });
  dom.modeInputs.forEach((input) =>
    input.addEventListener("change", () => {
      updateModeUI();
      notify(
        state.currentMode === "register"
          ? "Đã chuyển sang chế độ Đăng ký."
          : "Đã chuyển sang chế độ Xác minh.",
        "info",
      );
    }),
  );
  dom.studentId.addEventListener("input", updateRegisterButtonState);
  window.addEventListener("resize", resizeCanvases);
}

bindEvents();
appendLog(`[${getTimestamp()}] Giao diện sẵn sàng. Hãy bật camera để bắt đầu.`, "info");
setSystemNotice("Giao diện đã sẵn sàng. Hãy bật camera để bắt đầu.", "info");
