import { useEffect, useMemo, useRef, useState } from "react";
import { registerFace, verifyAttendance } from "../lib/api";

const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [263, 387, 385, 362, 380, 373];
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const LEFT_INNER_EYE = 133;
const RIGHT_INNER_EYE = 362;
const FOREHEAD_TOP = 10;
const NOSE_TIP = 4;
const CHIN = 152;
const ALIGNMENT_HOLD_MS = 2000;
const EAR_MIN_BASELINE = 0.19;
const EAR_FLOOR_CLOSE = 0.12;
const EAR_FLOOR_RECOVER = 0.18;
const MIN_BLINK_FRAMES = 1;
const MAX_BLINK_FRAMES = 8;

function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function meanPoint(points) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
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
  if (!Number.isFinite(angle)) return 0;
  if (angle > 90) return angle - 180;
  if (angle < -90) return angle + 180;
  return angle;
}

function computeEar(landmarks, sourceWidth, sourceHeight, eyeIndexes) {
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

function computePoseAngles(landmarks, sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const leftEyeOuter = normalizedToDisplay(landmarks[LEFT_EYE_OUTER], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const rightEyeOuter = normalizedToDisplay(landmarks[RIGHT_EYE_OUTER], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const leftEyeInner = normalizedToDisplay(landmarks[LEFT_INNER_EYE], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const rightEyeInner = normalizedToDisplay(landmarks[RIGHT_INNER_EYE], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const leftEyeCenter = meanPoint(LEFT_EYE.map((index) => normalizedToDisplay(landmarks[index], sourceWidth, sourceHeight, displayWidth, displayHeight)));
  const rightEyeCenter = meanPoint(RIGHT_EYE.map((index) => normalizedToDisplay(landmarks[index], sourceWidth, sourceHeight, displayWidth, displayHeight)));
  const forehead = normalizedToDisplay(landmarks[FOREHEAD_TOP], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const nose = normalizedToDisplay(landmarks[NOSE_TIP], sourceWidth, sourceHeight, displayWidth, displayHeight);
  const chin = normalizedToDisplay(landmarks[CHIN], sourceWidth, sourceHeight, displayWidth, displayHeight);

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

function evaluatePoseState(pose) {
  const rollOk = Math.abs(pose.rollAngle) <= 10;
  const yawOk = Math.abs(pose.yawAngle) <= 11;
  const pitchOk = Math.abs(pose.pitchAngle) <= 14;

  if (!yawOk) return { ok: false, label: "Cảnh báo: mặt đang quay lệch sang trái hoặc phải." };
  if (!rollOk) return { ok: false, label: "Cảnh báo: đầu đang nghiêng sang một bên." };
  if (!pitchOk) return { ok: false, label: "Cảnh báo: bạn đang cúi hoặc ngửa đầu." };
  return { ok: true, label: "Thông báo: tư thế đầu đã đúng." };
}

async function blobFromCrop(sourceImage, sourceBox) {
  const sourceWidth = sourceImage.videoWidth || sourceImage.naturalWidth || sourceImage.width;
  const sourceHeight = sourceImage.videoHeight || sourceImage.naturalHeight || sourceImage.height;
  const faceCenterX = sourceBox.minX + sourceBox.width / 2;
  const faceCenterY = sourceBox.minY + sourceBox.height / 2;
  const cropSide = Math.max(sourceBox.width * 1.9, sourceBox.height * 2.05, 220);
  let cropX = Math.round(faceCenterX - cropSide / 2);
  let cropY = Math.round(faceCenterY - cropSide / 2 - sourceBox.height * 0.08);
  let cropWidth = Math.round(cropSide);
  let cropHeight = Math.round(cropSide);
  cropX = Math.max(cropX, 0);
  cropY = Math.max(cropY, 0);
  cropWidth = Math.min(cropWidth, sourceWidth - cropX);
  cropHeight = Math.min(cropHeight, sourceHeight - cropY);
  const size = Math.min(cropWidth, cropHeight);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d").drawImage(sourceImage, cropX, cropY, size, size, 0, 0, size, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Không thể tạo ảnh khuôn mặt."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.92);
  });
}

export default function CameraSession({ mode, studentId, active, onComplete, onStop }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const viewportRef = useRef(null);
  const cameraRef = useRef(null);
  const faceMeshRef = useRef(null);
  const streamRef = useRef(null);
  const sessionRef = useRef({
    latestEar: null,
    readyForBlink: false,
    readyForSubmit: false,
    requestInFlight: false,
    capturePreparing: false,
    alignmentStartTs: null,
    baselineEar: null,
    blinkState: "idle",
    blinkFrameCount: 0,
    blinkSatisfied: false,
    latestSourceBox: null,
    stopped: false,
  });
  const [telemetry, setTelemetry] = useState({
    status: "Chờ bắt đầu",
    hint: "Thông báo: bấm bắt đầu để mở camera.",
    ear: "--",
    tone: "info",
  });
  const [blockingMessage, setBlockingMessage] = useState("");

  const isRegister = mode === "register";
  const buttonLabel = useMemo(
    () => (isRegister ? "Đang đăng ký khuôn mặt" : "Đang điểm danh"),
    [isRegister],
  );

  useEffect(() => {
    if (!active || !studentId.trim()) return undefined;

    let cancelled = false;
    const state = sessionRef.current;
    state.stopped = false;
    state.readyForSubmit = false;
    state.requestInFlight = false;
    state.capturePreparing = false;
    state.latestSourceBox = null;
    setBlockingMessage("");

    const stopSession = ({ notifyParent = false } = {}) => {
      if (state.stopped) return;
      state.stopped = true;
      cameraRef.current?.stop?.();
      const stream = streamRef.current || videoRef.current?.srcObject;
      if (stream?.getTracks) {
        stream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      const ctx = overlayRef.current?.getContext("2d");
      if (ctx && overlayRef.current) {
        ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }
      if (notifyParent) {
        onStop?.();
      }
    };

    const resizeCanvas = () => {
      const viewport = viewportRef.current?.getBoundingClientRect();
      if (!viewport || !overlayRef.current) return;
      overlayRef.current.width = viewport.width;
      overlayRef.current.height = viewport.height;
    };

    const getOvalMetrics = () => {
      const width = overlayRef.current.width * 0.46;
      const height = overlayRef.current.height * 0.58;
      return {
        centerX: overlayRef.current.width / 2,
        centerY: overlayRef.current.height - overlayRef.current.height * 0.08 - height / 2,
        width,
        height,
        area: Math.PI * (width / 2) * (height / 2),
      };
    };

    const resetTracking = () => {
      state.readyForBlink = false;
      state.readyForSubmit = false;
      state.alignmentStartTs = null;
      state.baselineEar = null;
      state.blinkState = "idle";
      state.blinkFrameCount = 0;
      state.blinkSatisfied = false;
    };

    const updateBlinkState = (ear, alignedNow) => {
      if (!state.readyForBlink || !alignedNow || state.requestInFlight || state.capturePreparing || state.readyForSubmit) {
        state.blinkState = "idle";
        state.blinkFrameCount = 0;
        return false;
      }

      if (state.baselineEar == null) {
        state.baselineEar = ear;
      } else if (ear > EAR_MIN_BASELINE * 0.8) {
        state.baselineEar = state.baselineEar * 0.9 + ear * 0.1;
      }

      if (state.baselineEar < EAR_MIN_BASELINE) return false;

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
          const validBlink = state.blinkFrameCount >= MIN_BLINK_FRAMES && state.blinkFrameCount <= MAX_BLINK_FRAMES;
          state.blinkState = "idle";
          state.blinkFrameCount = 0;
          if (validBlink) state.blinkSatisfied = true;
          return validBlink;
        }

        state.blinkState = "idle";
        state.blinkFrameCount = 0;
      }

      return false;
    };

    const drawOverlay = (displayBox, anchorPoint, tone) => {
      const ctx = overlayRef.current.getContext("2d");
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      if (!displayBox || !anchorPoint) return;
      ctx.save();
      ctx.strokeStyle = tone === "success" ? "rgba(120,242,179,0.98)" : tone === "error" ? "rgba(255,138,138,0.98)" : "rgba(255,212,73,0.98)";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(displayBox.minX, displayBox.minY, displayBox.width, displayBox.height);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(anchorPoint.x, anchorPoint.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const submitCapture = async (blob) => {
      state.requestInFlight = true;
      setBlockingMessage(isRegister ? "Đang gửi ảnh đăng ký..." : "Đang gửi ảnh điểm danh...");
      setTelemetry((current) => ({
        ...current,
        status: buttonLabel,
        hint: isRegister ? "Thông báo: đang gửi ảnh đăng ký." : "Thông báo: đang gửi ảnh điểm danh.",
        tone: "info",
      }));
      try {
        const data = isRegister ? await registerFace(studentId, blob) : await verifyAttendance(studentId, blob);
        stopSession();
        onComplete({
          mode,
          ok: data.status === "Registered" || data.status === "Success",
          status: data.status,
          studentId: data.student_id,
          score: data.score,
          reason: data.reason || null,
          createdAt: data.created_at,
        });
      } catch (error) {
        stopSession();
        onComplete({
          mode,
          ok: false,
          status: "Failed",
          studentId,
          score: null,
          reason: error.message,
          createdAt: new Date().toISOString(),
        });
      } finally {
        state.requestInFlight = false;
        setBlockingMessage("");
      }
    };

    const submitCurrentFrame = async () => {
      if (!state.readyForSubmit || state.requestInFlight || state.capturePreparing) {
        return;
      }
      if (!videoRef.current || !state.latestSourceBox) {
        onComplete({
          mode,
          ok: false,
          status: "Failed",
          studentId,
          reason: "Camera chưa có khung hình hợp lệ để gửi.",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      state.capturePreparing = true;
      setBlockingMessage(isRegister ? "Đang chụp ảnh đăng ký..." : "Đang chụp ảnh điểm danh...");
      setTelemetry((current) => ({
        ...current,
        hint: isRegister ? "Thông báo: đang chụp ảnh đăng ký." : "Thông báo: đang chụp ảnh điểm danh.",
        tone: "success",
      }));

      try {
        const faceBlob = await blobFromCrop(videoRef.current, state.latestSourceBox);
        await submitCapture(faceBlob);
      } catch (error) {
        stopSession();
        onComplete({
          mode,
          ok: false,
          status: "Failed",
          studentId,
          score: null,
          reason: error.message,
          createdAt: new Date().toISOString(),
        });
      } finally {
        state.capturePreparing = false;
        if (!state.requestInFlight) {
          setBlockingMessage("");
        }
      }
    };

    state.submitCurrentFrame = submitCurrentFrame;

    const handleLandmarkResults = async (results) => {
      const faceLandmarks = results.multiFaceLandmarks?.[0];
      const sourceImage = results.image;
      if (!sourceImage || state.stopped) return;
      resizeCanvas();

      if (!faceLandmarks) {
        resetTracking();
        drawOverlay(null, null, "info");
        setTelemetry({ status: buttonLabel, hint: "Cảnh báo: không thấy khuôn mặt trong camera.", ear: "--", tone: "error" });
        return;
      }

      const displayWidth = overlayRef.current.width;
      const displayHeight = overlayRef.current.height;
      const displayPoints = faceLandmarks.map((point) => normalizedToDisplay(point, sourceImage.width, sourceImage.height, displayWidth, displayHeight));
      const sourcePoints = faceLandmarks.map((point) => normalizedToSource(point, sourceImage.width, sourceImage.height));
      const displayBox = computeFaceBox(displayPoints);
      const sourceBox = computeFaceBox(sourcePoints);
      state.latestSourceBox = sourceBox;
      const oval = getOvalMetrics();

      const forehead = normalizedToDisplay(faceLandmarks[FOREHEAD_TOP], sourceImage.width, sourceImage.height, displayWidth, displayHeight);
      const nose = normalizedToDisplay(faceLandmarks[NOSE_TIP], sourceImage.width, sourceImage.height, displayWidth, displayHeight);
      const anchorPoint = { x: nose.x, y: nose.y * 0.7 + forehead.y * 0.3 };
      const ovalTarget = { x: oval.centerX, y: oval.centerY - oval.height * 0.08 };
      const centerCheck =
        Math.abs(anchorPoint.x - ovalTarget.x) <= oval.width * 0.12 &&
        Math.abs(anchorPoint.y - ovalTarget.y) <= oval.height * 0.12;

      const pose = computePoseAngles(faceLandmarks, sourceImage.width, sourceImage.height, displayWidth, displayHeight);
      const poseState = evaluatePoseState(pose);
      const sizeRatio = displayBox.area / oval.area;
      const sizeCheck = sizeRatio >= 0.6 && sizeRatio <= 0.9;
      const aligned = centerCheck && poseState.ok && sizeCheck;

      const leftEar = computeEar(faceLandmarks, sourceImage.width, sourceImage.height, LEFT_EYE);
      const rightEar = computeEar(faceLandmarks, sourceImage.width, sourceImage.height, RIGHT_EYE);
      const ear = (leftEar + rightEar) / 2;
      state.latestEar = ear;

      drawOverlay(displayBox, anchorPoint, state.requestInFlight || state.readyForSubmit ? "success" : aligned ? "info" : "error");

      if (state.readyForSubmit) {
        setTelemetry({
          status: buttonLabel,
          hint: isRegister
            ? "Thông báo: đã đủ điều kiện. Giữ nguyên mặt và bấm Chụp đăng ký."
            : "Thông báo: đã đủ điều kiện. Giữ nguyên mặt và bấm Chụp điểm danh.",
          ear: ear.toFixed(3),
          tone: "success",
        });
        return;
      }

      if (aligned) {
        if (!state.alignmentStartTs) state.alignmentStartTs = performance.now();
        const heldMs = performance.now() - state.alignmentStartTs;
        if (heldMs >= ALIGNMENT_HOLD_MS) {
          state.readyForBlink = true;
        }
      } else {
        resetTracking();
      }

      const blinkDetected = updateBlinkState(ear, aligned);
      if ((blinkDetected || state.blinkSatisfied) && aligned && !state.capturePreparing) {
        state.readyForSubmit = true;
        setTelemetry({
          status: buttonLabel,
          hint: isRegister
            ? "Thông báo: đã đủ điều kiện, hệ thống đang đăng ký khuôn mặt."
            : "Thông báo: đã đủ điều kiện, hệ thống đang điểm danh.",
          ear: ear.toFixed(3),
          tone: "success",
        });
        submitCurrentFrame();
        return;
      }

      let hint = "Thông báo: giữ nguyên tư thế.";
      let tone = "info";
      if (!centerCheck) {
        hint = "Cảnh báo: đưa mặt vào giữa khung.";
        tone = "error";
      } else if (!poseState.ok) {
        hint = poseState.label;
        tone = "error";
      } else if (!sizeCheck) {
        hint = sizeRatio < 0.6 ? "Cảnh báo: hãy đưa mặt sát lại gần camera." : "Cảnh báo: hãy lùi nhẹ ra sau.";
        tone = "error";
      } else if (!state.readyForBlink) {
        const remaining = Math.max((ALIGNMENT_HOLD_MS - (performance.now() - (state.alignmentStartTs || performance.now()))) / 1000, 0).toFixed(1);
        hint = `Thông báo: giữ nguyên tư thế thêm ${remaining}s.`;
      } else if (!state.blinkSatisfied) {
        hint = "Thông báo: hãy chớp mắt vài lần.";
      }

      setTelemetry({
        status: buttonLabel,
        hint,
        ear: ear.toFixed(3),
        tone,
      });
    };

    const start = async () => {
      resizeCanvas();
      setTelemetry({
        status: buttonLabel,
        hint: "Thông báo: trình duyệt đang mở quyền camera.",
        ear: "--",
        tone: "info",
      });

      if (!videoRef.current || !overlayRef.current || !viewportRef.current) {
        throw new Error("Khung camera chưa sẵn sàng. Hãy bấm bắt đầu lại.");
      }
      if (!window.FaceMesh) {
        throw new Error("MediaPipe Face Mesh chưa tải xong. Hãy tải lại trang và thử lại.");
      }
      if (!window.Camera) {
        throw new Error("MediaPipe Camera Utils chưa tải xong. Hãy tải lại trang và thử lại.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Trình duyệt hiện tại không hỗ trợ truy cập camera.");
      }
      if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
        throw new Error("Camera yêu cầu HTTPS hoặc chạy trên localhost.");
      }

      const faceMesh = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      faceMesh.onResults((results) => {
        handleLandmarkResults(results).catch((error) => {
          stopSession();
          onComplete({
            mode,
            ok: false,
            status: "Failed",
            studentId,
            reason: error.message,
            createdAt: new Date().toISOString(),
          });
        });
      });
      faceMeshRef.current = faceMesh;

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 640 },
            aspectRatio: 1,
          },
          audio: false,
        });
      } catch (error) {
        const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        throw new Error(
          blocked
            ? "Trình duyệt đang chặn quyền camera. Hãy cho phép camera rồi bắt đầu lại."
            : "Không thể mở camera trên thiết bị này.",
        );
      }
      if (cancelled) return;
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Khung video chưa sẵn sàng. Hãy bấm bắt đầu lại.");
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (!sessionRef.current.stopped) {
            await faceMesh.send({ image: videoRef.current });
          }
        },
        width: 640,
        height: 640,
      });
      cameraRef.current = camera;
      await camera.start();
      if (cancelled) {
        stopSession();
        return;
      }
      setTelemetry({
        status: buttonLabel,
        hint: "Thông báo: camera đã sẵn sàng, hãy đặt khuôn mặt vào khung.",
        ear: "--",
        tone: "info",
      });
    };

    start().catch((error) => {
      if (cancelled) {
        return;
      }
      stopSession();
      onComplete({
        mode,
        ok: false,
        status: "Failed",
        studentId,
        reason: error.message || "Không thể mở camera.",
        createdAt: new Date().toISOString(),
      });
    });

    return () => {
      cancelled = true;
      stopSession();
    };
  }, [active, studentId, mode, isRegister, buttonLabel, onComplete, onStop]);

  return (
    <section className="camera-surface">
      <div ref={viewportRef} className="viewport">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={overlayRef} />
        <div className={`oval-guide ${telemetry.tone === "success" ? "ready" : telemetry.tone === "error" ? "error" : "tracking"}`} />
        <div className="telemetry">
          <span>Trạng thái: {telemetry.status}</span>
          <span>{telemetry.hint}</span>
        </div>
        {blockingMessage ? (
          <div className="blocking-overlay" role="status" aria-live="polite">
            <div className="spinner" />
            <strong>{blockingMessage}</strong>
            <span>Vui lòng giữ nguyên trang cho tới khi có kết quả.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
