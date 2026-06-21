import { useEffect, useRef, useState } from "react";
import { registerFace, verifyAttendance } from "../lib/api";
import { advanceChallengeSession, createChallengeSession, evaluateChallengeFrame } from "../liveness/challengeEngine";
import { FRAME_CONFIG, THRESHOLDS, FACE_LANDMARKS } from "../liveness/constants";
import { createFrameSampler, dataUrlToBlob } from "../liveness/frameSampler";
import { computeAlignmentState, computeEar, computeMouthOpenRatio } from "../liveness/geometry";
import { computeQualitySummary, rankFrames } from "../liveness/quality";
import { evaluateSessionOutcome } from "../liveness/sessionScorer";

function createExpandedContextBox(sourceBox, sourceWidth, sourceHeight) {
  const scale = 2.4;
  const halfWidth = (sourceBox.width * scale) / 2;
  const halfHeight = (sourceBox.height * scale) / 2;
  const centerX = sourceBox.minX + sourceBox.width / 2;
  const centerY = sourceBox.minY + sourceBox.height / 2;
  const minX = Math.max(0, centerX - halfWidth);
  const minY = Math.max(0, centerY - halfHeight);
  const maxX = Math.min(sourceWidth, centerX + halfWidth);
  const maxY = Math.min(sourceHeight, centerY + halfHeight);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    area: Math.max(maxX - minX, 1) * Math.max(maxY - minY, 1),
  };
}

function renderDebugRow(label, value, status = "neutral") {
  return (
    <span className={`debug-line ${status}`}>
      <strong>{label}:</strong> {value}
    </span>
  );
}

function formatQualityState(quality) {
  if (!quality) return null;
  return `blur=${quality.blurScore.toFixed(1)} brightness=${quality.brightnessMean.toFixed(1)} score=${quality.qualityScore.toFixed(3)}`;
}

function getQualityWarning(quality) {
  if (!quality) return null;
  const { blurMin, brightnessMin, brightnessMax } = THRESHOLDS.quality;
  if (quality.blurScore < blurMin) return "Cảnh báo: Camera đang mờ, hãy giữ máy ổn định hoặc tăng ánh sáng.";
  if (quality.brightnessMean < brightnessMin) return "Cảnh báo: Ảnh đang quá tối, hãy tăng ánh sáng.";
  if (quality.brightnessMean > brightnessMax) return "Cảnh báo: Ảnh đang quá sáng, hãy giảm nguồn sáng trực tiếp.";
  return null;
}

function isNeutralRecognitionReady(alignment, mouthOpenRatio) {
  const { alignment: alignmentThresholds, pose } = THRESHOLDS;
  const neutralMouthMax = Math.max(0.18, pose.mouthOpenRatioMin * 0.75);
  return (
    alignment.aligned &&
    alignment.centerCheck &&
    alignment.sizeCheck &&
    Math.abs(alignment.pose.yawAngle) <= alignmentThresholds.frontYawMax &&
    Math.abs(alignment.pose.pitchAngle) <= alignmentThresholds.pitchMax &&
    Math.abs(alignment.pose.rollAngle) <= alignmentThresholds.rollMax &&
    (mouthOpenRatio ?? 0) <= neutralMouthMax
  );
}

let globalFaceMesh = null;

if (typeof window !== "undefined" && window.FaceMesh) {
  try {
    globalFaceMesh = new window.FaceMesh({
      locateFile: (file) => `/libs/mediapipe/${file}`,
    });
    globalFaceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    const dummyCanvas = document.createElement("canvas");
    dummyCanvas.width = 1;
    dummyCanvas.height = 1;
    globalFaceMesh.send({ image: dummyCanvas }).catch(() => {});
  } catch (e) {
    console.warn("Failed early FaceMesh initialization:", e);
  }
}


export default function CameraSession({ mode, studentId, active, onComplete, onStop }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const viewportRef = useRef(null);
  const cameraRef = useRef(null);
  const streamRef = useRef(null);
  const samplerRef = useRef(createFrameSampler());
  const sessionRef = useRef({
    stopped: false,
    processing: false,
    frameIndex: 0,
    baselineEar: null,
    blinkState: "idle",
    blinkFrameCount: 0,
    challenge: null,
    alignmentReady: false,
    alignmentPhaseStartedAt: null,
    alignmentStartedAt: null,
    verifyNeutralCapture: false,
    neutralCaptureStartedAt: null,
    neutralCapturePhaseStartedAt: null,
  });

  const [telemetry, setTelemetry] = useState({
    status: "Chờ bắt đầu",
    hint: "Thông báo: Bấm bắt đầu để mở camera.",
    tone: "info",
  });

  const updateTelemetry = (nextVal) => {
    setTelemetry((prev) => {
      const resolved = typeof nextVal === "function" ? nextVal(prev) : nextVal;
      if (
        prev.status === resolved.status &&
        prev.hint === resolved.hint &&
        prev.tone === resolved.tone
      ) {
        return prev;
      }
      return resolved;
    });
  };
  const [debugState, setDebugState] = useState({
    phase: "pre_alignment",
    currentStepType: null,
    currentStepPrompt: null,
    centerCheck: false,
    turnCenterCheck: false,
    sizeCheck: false,
    pose: null,
    ear: null,
    mouthOpenRatio: null,
    blinkDetected: false,
    quality: null,
  });
  const [blockingMessage, setBlockingMessage] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  const lastPlayedRef = useRef({ name: "", timestamp: 0 });
  const audioCacheRef = useRef({});

  const showDebugRef = useRef(false);
  const lastDebugUpdateRef = useRef(0);

  useEffect(() => {
    showDebugRef.current = showDebug;
  }, [showDebug]);

  const playAudio = (name, minIntervalMs = 2000) => {
    const now = performance.now();
    const last = lastPlayedRef.current;
    
    if (last.name === name && now - last.timestamp < minIntervalMs) {
      return;
    }

    try {
      if (window.currentPlayingAudio) {
        window.currentPlayingAudio.pause();
        window.currentPlayingAudio.currentTime = 0;
      }

      let audio = audioCacheRef.current[name];
      if (!audio) {
        audio = new Audio(`/audio/${name}.mp3`);
        audioCacheRef.current[name] = audio;
      }
      
      window.currentPlayingAudio = audio;
      audio.play().catch((err) => {
        console.warn("Audio autoplay blocked by browser or failed:", err);
      });
      lastPlayedRef.current = { name, timestamp: now };
    } catch (e) {
      console.error("Failed to play audio:", e);
    }
  };

  useEffect(() => {
    return () => {
      if (window.currentPlayingAudio) {
        window.currentPlayingAudio.pause();
        window.currentPlayingAudio.currentTime = 0;
        window.currentPlayingAudio = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!telemetry.hint) return;
    let text = telemetry.hint.toLowerCase();
    
    let audioFile = null;
    
    if (text.includes("chờ bắt đầu") || text.includes("bấm bắt đầu")) {
      // do nothing
    } else if (text.includes("quay sang trái theo yêu cầu")) {
      audioFile = "turn_left";
    } else if (text.includes("quay sang phải theo yêu cầu")) {
      audioFile = "turn_right";
    } else if (
      text.includes("không thấy khuôn mặt") ||
      text.includes("khong thay khuon mat") ||
      text.includes("đưa mặt vào đúng khung") ||
      text.includes("đưa mặt vào khung")
    ) {
      audioFile = "align";
    } else if (
      text.includes("vùng trung tâm") ||
      text.includes("giữa khung") ||
      text.includes("giữa") ||
      text.includes("cân giữa") ||
      text.includes("gia khung") ||
      text.includes("cai giua")
    ) {
      audioFile = "center";
    } else if (text.includes("sát hơn") || text.includes("sat hon")) {
      audioFile = "closer";
    } else if (text.includes("lùi nhẹ") || text.includes("lui nhe")) {
      audioFile = "further";
    } else if (text.includes("chớp mắt 1 lần") || text.includes("chop mat 1 lan")) {
      audioFile = "blink_once";
    } else if (text.includes("chớp mắt 2 lần") || text.includes("chop mat 2 lan")) {
      audioFile = "blink_twice";
    } else if (text.includes("quay mặt sang trái") || text.includes("quay sang trai") || text.includes("xoay đầu sang trái") || text.includes("xoay sang trai")) {
      audioFile = "turn_left";
    } else if (text.includes("quay mặt sang phải") || text.includes("quay sang phai") || text.includes("xoay đầu sang phải") || text.includes("xoay sang phai")) {
      audioFile = "turn_right";
    } else if (text.includes("há miệng") || text.includes("mo mieng") || text.includes("mở miệng")) {
      audioFile = "open_mouth";
    } else if (
      text.includes("nhìn thẳng") ||
      text.includes("quay ve mat thang") ||
      text.includes("nhìn vào camera") ||
      text.includes("nhin vao camera") ||
      text.includes("đầu thẳng") ||
      text.includes("nghiêng đầu") ||
      text.includes("cúi hoặc ngửa") ||
      text.includes("ngậm miệng")
    ) {
      audioFile = "neutral";
    }

    if (audioFile) {
      playAudio(audioFile);
    }
  }, [telemetry.hint]);

  useEffect(() => {
    if (telemetry.status === "Success" || telemetry.status === "Registered" || telemetry.hint?.includes("thành công") || telemetry.hint?.includes("thanh cong")) {
      playAudio("success", 0);
    } else if (telemetry.status === "Failed" || telemetry.hint?.includes("thất bại") || telemetry.hint?.includes("that bai")) {
      playAudio("fail", 0);
    }
  }, [telemetry.status]);

  useEffect(() => {
    if (!active || !studentId.trim()) return undefined;

    const state = sessionRef.current;
    state.stopped = false;
    state.processing = false;
    state.frameIndex = 0;
    state.baselineEar = null;
    state.blinkState = "idle";
    state.blinkFrameCount = 0;
    state.challenge = null;
    state.alignmentReady = false;
    state.alignmentPhaseStartedAt = null;
    state.alignmentStartedAt = null;
    state.verifyNeutralCapture = false;
    state.neutralCaptureStartedAt = null;
    state.neutralCapturePhaseStartedAt = null;
    samplerRef.current.clear();
    setBlockingMessage("");

    let cancelled = false;

    const startupTimeout = setTimeout(() => {
      if (!state.stopped && !state.processing && state.alignmentPhaseStartedAt === null) {
        failSession("Không thể khởi động camera hoặc bộ nhận diện khuôn mặt. Vui lòng thử lại.");
      }
    }, 15000);

    const stopSession = ({ notifyParent = false } = {}) => {
      if (state.stopped) return;
      state.stopped = true;
      clearTimeout(startupTimeout);
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
      if (notifyParent) onStop?.();
    };

    const resizeCanvas = () => {
      const viewport = viewportRef.current?.getBoundingClientRect();
      if (!viewport || !overlayRef.current) return;
      overlayRef.current.width = viewport.width;
      overlayRef.current.height = viewport.height;
    };

    const drawOverlay = (displayBox, anchorPoint, tone) => {
      const ctx = overlayRef.current?.getContext("2d");
      if (!ctx || !overlayRef.current) return;
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      if (!displayBox || !anchorPoint) return;
      ctx.save();
      ctx.strokeStyle =
        tone === "success"
          ? "rgba(120,242,179,0.98)"
          : tone === "error"
            ? "rgba(255,138,138,0.98)"
            : "rgba(255,212,73,0.98)";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(displayBox.minX, displayBox.minY, displayBox.width, displayBox.height);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(anchorPoint.x, anchorPoint.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const updateBlinkState = (ear, alignedNow) => {
      const { blink } = THRESHOLDS;
      if (!alignedNow) {
        state.blinkState = "idle";
        state.blinkFrameCount = 0;
        return false;
      }

      if (state.baselineEar == null) {
        state.baselineEar = ear;
      } else if (ear > blink.minBaselineEar * 0.8) {
        state.baselineEar = state.baselineEar * 0.9 + ear * 0.1;
      }

      if (state.baselineEar < blink.minBaselineEar) return false;

      const closeThreshold = Math.max(blink.closeFloorEar, state.baselineEar * 0.68);
      const recoverThreshold = Math.max(blink.recoverFloorEar, state.baselineEar * 0.82);

      if (state.blinkState === "idle") {
        if (ear < closeThreshold) {
          state.blinkState = "closing";
          state.blinkFrameCount = 1;
        }
        return false;
      }

      if (state.blinkState === "closing") {
        if (ear < closeThreshold) {
          state.blinkFrameCount = Math.min(state.blinkFrameCount + 1, blink.maxBlinkFrames);
          return false;
        }

        if (ear > recoverThreshold) {
          const validBlink =
            state.blinkFrameCount >= blink.minBlinkFrames &&
            state.blinkFrameCount <= blink.maxBlinkFrames;
          state.blinkState = "idle";
          state.blinkFrameCount = 0;
          return validBlink;
        }

        state.blinkState = "idle";
        state.blinkFrameCount = 0;
      }

      return false;
    };

    const updateDebug = ({ phase, currentStepType, currentStepPrompt, alignment, ear, mouthOpenRatio, blinkDetected, quality }) => {
      if (!showDebugRef.current) return;
      const now = performance.now();
      if (now - lastDebugUpdateRef.current < 200) return;
      lastDebugUpdateRef.current = now;

      setDebugState({
        phase,
        currentStepType,
        currentStepPrompt,
        centerCheck: Boolean(alignment?.centerCheck),
        turnCenterCheck: alignment
          ? alignment.centerOffsetX <= THRESHOLDS.alignment.turnCenterX &&
            alignment.centerOffsetY <= THRESHOLDS.alignment.turnCenterY
          : false,
        sizeCheck: Boolean(alignment?.sizeCheck),
        pose: alignment
          ? {
              yawAngle: Number(alignment.pose.yawAngle.toFixed(2)),
              pitchAngle: Number(alignment.pose.pitchAngle.toFixed(2)),
              rollAngle: Number(alignment.pose.rollAngle.toFixed(2)),
            }
          : null,
        ear: Number.isFinite(ear) ? Number(ear.toFixed(3)) : null,
        mouthOpenRatio: Number.isFinite(mouthOpenRatio) ? Number(mouthOpenRatio.toFixed(3)) : null,
        blinkDetected,
        quality,
      });
    };

    const failSession = (reason) => {
      stopSession();
      onComplete({
        mode,
        ok: false,
        status: "Failed",
        studentId,
        score: null,
        reason,
        createdAt: new Date().toISOString(),
      });
    };

    const finalizeBurst = async ({ step = null, submitMode, poseLabel, challengeSequence }) => {
      const frames = samplerRef.current.getFrames();
      const rankedFrames = rankFrames(frames, { purpose: submitMode === "verify" ? "verify" : "quality" });
      const selected = rankedFrames[0];
      if (!selected) {
        throw new Error("Không thu được khung hình hợp lệ cho thử thách hiện tại.");
      }

      const antiReplay = { motionCorr: 0, flickerPeakRatio: 0, stripeScore: 0, moireScore: 0 };
      const outcome = evaluateSessionOutcome({
        challengePassed: true,
        quality: selected.quality,
        antiReplay,
      });

      if (!outcome.ok) {
        throw new Error(outcome.reason);
      }

      const captureMeta = {
        challenge_sequence: challengeSequence,
        challenge_result: "passed",
        quality: {
          blur_score: selected.quality.blurScore,
          brightness_mean: selected.quality.brightnessMean,
          quality_score: selected.quality.qualityScore,
        },
        anti_replay: {
          motion_corr: 0,
          flicker_peak_ratio: 0,
          stripe_score: 0,
          moire_score: 0,
          verdict: outcome.verdict,
        },
        selected_frame: {
          frame_index: selected.frame.frameIndex,
          sampled_frame_count: frames.length,
          recognition_suitability: selected.recognitionSuitability,
          rank_score: selected.rankScore,
          face_box: {
            min_x: Number(selected.frame.faceBox.minX.toFixed(2)),
            min_y: Number(selected.frame.faceBox.minY.toFixed(2)),
            max_x: Number(selected.frame.faceBox.maxX.toFixed(2)),
            max_y: Number(selected.frame.faceBox.maxY.toFixed(2)),
          },
          center_box: {
            min_x: Number(selected.frame.centerBox.minX.toFixed(2)),
            min_y: Number(selected.frame.centerBox.minY.toFixed(2)),
            max_x: Number(selected.frame.centerBox.maxX.toFixed(2)),
            max_y: Number(selected.frame.centerBox.maxY.toFixed(2)),
          },
        },
        pose_label: poseLabel,
        telemetry: {
          quality_state: formatQualityState(selected.quality),
          outcome: outcome.reason,
        },
      };

      return {
        captureMeta,
        blob: dataUrlToBlob(selected.frame.cropDataUrl),
      };
    };

    const completeVerifyNeutralCapture = async () => {
      if (state.processing || state.stopped) return;
      state.processing = true;
      setBlockingMessage("Đang tổng hợp ảnh xác nhận điểm danh...");

      try {
        const { captureMeta, blob } = await finalizeBurst({
          submitMode: "verify",
          poseLabel: "front",
          challengeSequence: state.challenge?.challengeSequence || [],
        });
        const data = await verifyAttendance(studentId, blob, captureMeta, (attempt) => {
          setBlockingMessage(`Kết nối mạng yếu, đang thử gửi lại lần ${attempt}...`);
        });
        stopSession();
        onComplete({
          mode,
          ok: data.status === "Success",
          status: data.status,
          studentId: data.student_id,
          score: data.score,
          reason: data.reason || null,
          createdAt: data.created_at,
          meta: data.meta,
        });
      } catch (error) {
        failSession(error.message || "Không thể hoàn thành thử thách.");
      } finally {
        state.processing = false;
        setBlockingMessage("");
      }
    };

    const handleStepCompletion = async (step) => {
      if (state.processing || state.stopped) return;
      state.processing = true;
      setBlockingMessage(mode === "register" ? `Đang lưu mẫu ${step.poseTarget}...` : "Đang tổng hợp kết quả điểm danh...");

      try {
        if (mode === "register") {
          const { captureMeta, blob } = await finalizeBurst({
            step,
            submitMode: "register",
            poseLabel: step.poseTarget,
            challengeSequence: [step.type],
          });
          const data = await registerFace(studentId, step.poseTarget, blob, captureMeta, (attempt) => {
            setBlockingMessage(`Kết nối mạng yếu, đang thử gửi lại lần ${attempt}...`);
          });
          const nextChallenge = advanceChallengeSession(state.challenge, performance.now());
          state.challenge = nextChallenge;
          samplerRef.current.clear();

          if (nextChallenge.status === "completed") {
            stopSession();
            onComplete({
              mode,
              ok: true,
              status: data.status,
              studentId: data.student_id,
              score: null,
              reason: null,
              createdAt: data.created_at,
            });
            return;
          }

          updateTelemetry({
            status: "Đang đăng ký khuôn mặt",
            hint: `Mẫu ${step.poseTarget} đã lưu. ${nextChallenge.prompt}`,
            tone: "success",
          });
          return;
        }

        const nextChallenge = advanceChallengeSession(state.challenge, performance.now());
        if (nextChallenge.status !== "completed") {
          state.challenge = nextChallenge;
          updateTelemetry((current) => ({
            ...current,
            status: "Đang điểm danh",
            hint: nextChallenge.prompt,
            tone: "info",
          }));
          return;
        }

        state.challenge = nextChallenge;
        state.verifyNeutralCapture = true;
        state.neutralCaptureStartedAt = null;
        state.neutralCapturePhaseStartedAt = performance.now();
        samplerRef.current.clear();
        updateTelemetry({
          status: "Đang chụp ảnh xác nhận",
          hint: "Thử thách đã xong. Quay về mặt thẳng và giữ ổn định 1 giây để chụp ảnh xác nhận.",
          tone: "success",
        });
        return;
      } catch (error) {
        failSession(error.message || "Không thể hoàn thành thử thách.");
      } finally {
        state.processing = false;
        setBlockingMessage("");
      }
    };

    const handleLandmarkResults = async (results) => {
      const faceLandmarks = results.multiFaceLandmarks?.[0];
      const sourceImage = results.image;
      if (!sourceImage || state.stopped) return;

      const now = performance.now();
      if (state.alignmentPhaseStartedAt === null) {
        state.alignmentPhaseStartedAt = now;
        clearTimeout(startupTimeout);
      }

      state.frameIndex += 1;

      if (!faceLandmarks) {
        drawOverlay(null, null, "info");

        if (!state.alignmentReady) {
          const phaseStartedAt = state.alignmentPhaseStartedAt ?? now;
          state.alignmentPhaseStartedAt = phaseStartedAt;

          if (now - phaseStartedAt > THRESHOLDS.session.verifyStabilityTimeoutMs) {
            failSession("Đã quá thời gian giữ ổn định 1 giây trước thử thách.");
            return;
          }

          updateTelemetry((current) => ({
            ...current,
            status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
            hint: "Cảnh báo: Không thấy khuôn mặt. Hãy đưa mặt vào khung và giữ ổn định 1 giây.",
            tone: "error",
          }));
          return;
        }

        if (mode === "verify" && state.verifyNeutralCapture) {
          if (
            state.neutralCapturePhaseStartedAt &&
            now - state.neutralCapturePhaseStartedAt > THRESHOLDS.session.verifyStabilityTimeoutMs
          ) {
            failSession("Đã quá thời gian giữ ổn định 1 giây để chụp ảnh xác nhận.");
            return;
          }

          updateTelemetry((current) => ({
            ...current,
            status: "Đang chụp ảnh xác nhận",
            hint: "Cảnh báo: Không thấy khuôn mặt. Hãy quay lại giữ mặt thẳng ổn định 1 giây để chụp ảnh xác nhận.",
            tone: "error",
          }));
          return;
        }

        updateTelemetry((current) => ({
          ...current,
          status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
          hint: "Cảnh báo: Không thấy khuôn mặt trong camera.",
          tone: "error",
        }));
        return;
      }

      const alignment = computeAlignmentState(faceLandmarks, sourceImage, overlayRef.current.width, overlayRef.current.height);
      const leftEar = computeEar(faceLandmarks, sourceImage.width, sourceImage.height, FACE_LANDMARKS.leftEye);
      const rightEar = computeEar(faceLandmarks, sourceImage.width, sourceImage.height, FACE_LANDMARKS.rightEye);
      const ear = (leftEar + rightEar) / 2;
      const mouthOpenRatio = computeMouthOpenRatio(faceLandmarks, sourceImage.width, sourceImage.height);
      const blinkDetected = updateBlinkState(ear, alignment.aligned);
      const currentStep = state.challenge?.steps?.[state.challenge.currentStepIndex] ?? null;
      const turnCenterCheck =
        alignment.centerOffsetX <= THRESHOLDS.alignment.turnCenterX &&
        alignment.centerOffsetY <= THRESHOLDS.alignment.turnCenterY;
      const neutralRecognitionReady = isNeutralRecognitionReady(alignment, mouthOpenRatio);

      drawOverlay(
        alignment.displayBox,
        alignment.anchorPoint,
        state.processing ? "success" : alignment.aligned ? "info" : "error",
      );

      const samplingReady = alignment.sourceBox.width > 0 && alignment.sourceBox.height > 0;
      if (
        state.alignmentReady &&
        !state.processing &&
        samplingReady &&
        state.frameIndex % FRAME_CONFIG.sampleEveryNFrames === 0 &&
        (mode !== "verify" || !state.verifyNeutralCapture || neutralRecognitionReady)
      ) {
        samplerRef.current.push({
          sourceImage: videoRef.current,
          sourceBox: alignment.sourceBox,
          centerBox: createExpandedContextBox(alignment.sourceBox, sourceImage.width, sourceImage.height),
          challengeLabel: state.verifyNeutralCapture ? "neutral_capture" : state.challenge?.prompt || "pre_alignment",
          frameIndex: state.frameIndex,
          timestamp: now,
          pose: {
            yawAngle: alignment.pose.yawAngle,
            pitchAngle: alignment.pose.pitchAngle,
            rollAngle: alignment.pose.rollAngle,
          },
          mouthOpenRatio,
        });
      }

      const bufferedFrames = samplerRef.current.getFrames();
      const rankedPreview = bufferedFrames.length
        ? rankFrames(bufferedFrames, { purpose: mode === "verify" ? "verify" : "quality" })
        : [];
      const previewQuality =
        rankedPreview[0]?.quality ??
        (bufferedFrames.length ? computeQualitySummary(bufferedFrames[bufferedFrames.length - 1]) : null);

      if (!state.alignmentReady) {
        updateDebug({
          phase: "pre_alignment",
          currentStepType: currentStep?.type || null,
          currentStepPrompt: currentStep?.prompt || null,
          alignment,
          ear,
          mouthOpenRatio,
          blinkDetected,
          quality: previewQuality,
        });

        if (
          state.alignmentPhaseStartedAt &&
          now - state.alignmentPhaseStartedAt > THRESHOLDS.session.verifyStabilityTimeoutMs
        ) {
          failSession("Đã quá thời gian giữ ổn định 1 giây trước thử thách.");
          return;
        }

        if (alignment.aligned) {
          state.alignmentStartedAt = state.alignmentStartedAt ?? now;
          const heldMs = now - state.alignmentStartedAt;
          const remainingMs = Math.max(0, THRESHOLDS.session.alignmentHoldMs - heldMs);

          if (heldMs >= THRESHOLDS.session.alignmentHoldMs) {
            state.alignmentReady = true;
            state.alignmentPhaseStartedAt = null;
            state.challenge = createChallengeSession(mode, now);
            samplerRef.current.clear();
            updateTelemetry({
              status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
              hint: state.challenge.prompt,
              tone: "success",
            });
            return;
          }

          updateTelemetry({
            status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
            hint: `Thông báo: Giữ nguyên tư thế trong khung 1 giây trước khi bắt đầu thử thách. Còn lại ${(remainingMs / 1000).toFixed(1)}s.`,
            tone: "info",
          });
          return;
        }

        state.alignmentStartedAt = null;
        let preAlignHint = "Thông báo: Đưa mặt vào đúng khung và giữ ổn định 1 giây trước khi bắt đầu thử thách.";
        let preAlignTone = "info";

        if (!alignment.centerCheck) {
          preAlignHint = "Cảnh báo: Đưa mặt vào giữa khung.";
          preAlignTone = "error";
        } else if (!alignment.poseState.ok) {
          preAlignHint = alignment.poseState.label;
          preAlignTone = "error";
        } else if (!alignment.sizeCheck) {
          preAlignHint =
            alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
              ? "Cảnh báo: Hãy đưa mặt sát hơn vào camera."
              : "Cảnh báo: Hãy lùi nhẹ ra sau.";
          preAlignTone = "error";
        }

        const qualityWarning = getQualityWarning(previewQuality);
        updateTelemetry({
          status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
          hint: qualityWarning ?? preAlignHint,
          tone: qualityWarning ? "error" : preAlignTone,
        });
        return;
      }

      if (mode === "verify" && state.verifyNeutralCapture) {
        updateDebug({
          phase: "neutral_capture",
          currentStepType: "neutral_capture",
          currentStepPrompt: "Quay về mặt thẳng và giữ ổn định 1 giây để chụp ảnh xác nhận.",
          alignment,
          ear,
          mouthOpenRatio,
          blinkDetected,
          quality: previewQuality,
        });

        if (
          state.neutralCapturePhaseStartedAt &&
          now - state.neutralCapturePhaseStartedAt > THRESHOLDS.session.verifyStabilityTimeoutMs
        ) {
          failSession("Đã quá thời gian giữ ổn định 1 giây để chụp ảnh xác nhận.");
          return;
        }

        if (neutralRecognitionReady) {
          state.neutralCaptureStartedAt = state.neutralCaptureStartedAt ?? now;
          const heldMs = now - state.neutralCaptureStartedAt;
          const remainingMs = Math.max(0, THRESHOLDS.session.verifyNeutralCaptureHoldMs - heldMs);

          if (heldMs >= THRESHOLDS.session.verifyNeutralCaptureHoldMs) {
            await completeVerifyNeutralCapture();
            return;
          }

          updateTelemetry({
            status: "Đang chụp ảnh xác nhận",
            hint: `Thử thách đã đạt. Giữ mặt thẳng 1 giây để chụp ảnh xác nhận. Còn lại ${(remainingMs / 1000).toFixed(1)}s.`,
            tone: "success",
          });
          return;
        }

        state.neutralCaptureStartedAt = null;
        let neutralHint = "Quay về mặt thẳng, nhìn vào camera và giữ khuôn mặt ổn định 1 giây để chụp ảnh xác nhận.";
        let neutralTone = "info";
        if (!alignment.centerCheck) {
          neutralHint = "Cảnh báo: Đưa mặt vào giữa khung để chụp ảnh xác nhận và giữ ổn định 1 giây.";
          neutralTone = "error";
        } else if (!alignment.sizeCheck) {
          neutralHint =
            alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
              ? "Cảnh báo: Hãy đưa mặt sát hơn vào camera."
              : "Cảnh báo: Hãy lùi nhẹ ra sau.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.yawAngle) > THRESHOLDS.alignment.frontYawMax) {
          neutralHint = "Cảnh báo: Hãy quay mặt thẳng về trước camera.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.pitchAngle) > THRESHOLDS.alignment.pitchMax) {
          neutralHint = "Cảnh báo: Hãy giữ đầu thẳng, không cúi hoặc ngửa.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.rollAngle) > THRESHOLDS.alignment.rollMax) {
          neutralHint = "Cảnh báo: Hãy giữ đầu thẳng, không nghiêng.";
          neutralTone = "error";
        } else if ((mouthOpenRatio ?? 0) > Math.max(0.18, THRESHOLDS.pose.mouthOpenRatioMin * 0.75)) {
          neutralHint = "Cảnh báo: Hãy ngậm miệng và giữ biểu cảm tự nhiên.";
          neutralTone = "error";
        }

        const qualityWarning = getQualityWarning(previewQuality);
        updateTelemetry({
          status: "Đang chụp ảnh xác nhận",
          hint: qualityWarning ?? neutralHint,
          tone: qualityWarning ? "error" : neutralTone,
        });
        return;
      }

      const { session: nextChallenge, event } = evaluateChallengeFrame(state.challenge, {
        timestamp: now,
        aligned: alignment.aligned,
        centerCheck: alignment.centerCheck,
        turnCenterCheck,
        sizeCheck: alignment.sizeCheck,
        pose: alignment.pose,
        mouthOpenRatio,
        blinkDetected,
      });

      state.challenge = nextChallenge;
      updateDebug({
        phase: "challenge",
        currentStepType: currentStep?.type || null,
        currentStepPrompt: currentStep?.prompt || null,
        alignment,
        ear,
        mouthOpenRatio,
        blinkDetected,
        quality: previewQuality,
      });

      if (event?.type === "session_failed") {
        failSession(event.reason);
        return;
      }

      let hint = state.challenge.prompt;
      let tone = "info";
      const isTurnChallenge = currentStep?.type === "turn_left_hold" || currentStep?.type === "turn_right_hold";

      if (currentStep?.type === "turn_left_hold" && alignment.pose.yawAngle > THRESHOLDS.alignment.wrongTurnYaw) {
        hint = "Cảnh báo: Bạn đang quay sang phải, hãy quay sang trái theo yêu cầu.";
        tone = "error";
      } else if (currentStep?.type === "turn_right_hold" && alignment.pose.yawAngle < -THRESHOLDS.alignment.wrongTurnYaw) {
        hint = "Cảnh báo: Bạn đang quay sang trái, hãy quay sang phải theo yêu cầu.";
        tone = "error";
      } else if (!alignment.centerCheck && !isTurnChallenge) {
        hint = "Cảnh báo: Đưa mặt vào giữa khung.";
        tone = "error";
      } else if (isTurnChallenge && !turnCenterCheck) {
        hint = "Cảnh báo: Khi quay mặt, vẫn cần giữ khuôn mặt nằm trong vùng trung tâm.";
        tone = "error";
      } else if (isTurnChallenge && Math.abs(alignment.pose.rollAngle) > THRESHOLDS.alignment.rollMax) {
        hint = "Cảnh báo: Bạn đang nghiêng đầu, hãy giữ đầu thẳng khi quay mặt.";
        tone = "error";
      } else if (isTurnChallenge && Math.abs(alignment.pose.pitchAngle) > THRESHOLDS.alignment.pitchMax) {
        hint = "Cảnh báo: Không cúi hoặc ngửa đầu khi thực hiện quay mặt.";
        tone = "error";
      } else if (!isTurnChallenge && !alignment.poseState.ok) {
        hint = alignment.poseState.label;
        tone = "error";
      } else if (!alignment.sizeCheck) {
        hint =
          alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
            ? "Cảnh báo: Hãy đưa mặt sát hơn vào camera."
            : "Cảnh báo: Hãy lùi nhẹ ra sau.";
        tone = "error";
      }

      const qualityWarning = getQualityWarning(previewQuality);
      if (qualityWarning) {
        hint = qualityWarning;
        tone = "error";
      }

      updateTelemetry({
        status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
        hint,
        tone,
      });

      if (event?.type === "step_complete") {
        await handleStepCompletion(event.step);
      }
    };

    const start = async () => {
      resizeCanvas();
      updateTelemetry({
        status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
        hint: "Thông báo: Đưa mặt vào đúng khung và giữ ổn định 1 giây trước khi bắt đầu thử thách.",
        tone: "info",
      });

      if (!videoRef.current || !overlayRef.current || !viewportRef.current) {
        throw new Error("Khung camera chưa sẵn sàng. Hãy bắt đầu lại.");
      }
      if (!window.FaceMesh || !window.Camera) {
        throw new Error("Thư viện MediaPipe chưa tải xong. Hãy tải lại trang.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Trình duyệt hiện tại không hỗ trợ camera.");
      }
      if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
        throw new Error("Camera yêu cầu kết nối HTTPS hoặc localhost.");
      }

      if (!globalFaceMesh) {
        globalFaceMesh = new window.FaceMesh({
          locateFile: (file) => `/libs/mediapipe/${file}`,
        });
        globalFaceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
      }
      const faceMesh = globalFaceMesh;
      faceMesh.onResults((results) => {
        if (sessionRef.current.stopped) return;
        handleLandmarkResults(results).catch((error) => {
          failSession(error.message || "Không thể xử lý khung hình camera.");
        });
      });

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
        throw new Error(blocked ? "Trình duyệt đang chặn quyền truy cập camera." : "Không thể mở camera trên thiết bị này.");
      }

      if (cancelled) return;
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (cancelled) return;
      resizeCanvas();

      let isAnalyzing = false;
      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (sessionRef.current.stopped || sessionRef.current.processing) {
            return;
          }
          if (isAnalyzing) return;
          isAnalyzing = true;
          try {
            await faceMesh.send({ image: videoRef.current });
          } catch (err) {
            console.error("Inference frame error:", err);
          } finally {
            isAnalyzing = false;
          }
        },
        width: 640,
        height: 640,
      });
      cameraRef.current = camera;
      await camera.start();
    };

    window.addEventListener("resize", resizeCanvas);

    start().catch((error) => {
      if (cancelled) return;
      failSession(error.message || "Không thể mở camera.");
    });

    return () => {
      cancelled = true;
      window.removeEventListener("resize", resizeCanvas);
      stopSession();
    };
  }, [active, studentId, mode, onComplete, onStop]);

  const alignmentStatus = debugState.currentStepType === "turn_left_hold" || debugState.currentStepType === "turn_right_hold"
    ? debugState.turnCenterCheck
    : debugState.centerCheck;

  return (
    <section className="camera-surface">
      <div className="camera-header">
        <h3>{mode === "register" ? "Đăng ký khuôn mặt" : "Xác nhận điểm danh"}</h3>
        <button type="button" className="close-btn" onClick={onStop} aria-label="Đóng camera">✕</button>
      </div>

      <div className="camera-layout">
        <div ref={viewportRef} className="viewport">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={overlayRef} />
          <div className={`oval-guide ${telemetry.tone === "success" ? "ready" : telemetry.tone === "error" ? "error" : "tracking"}`} />
          
          <div className={`hud-card ${telemetry.tone}`}>
            <div className="hud-eyebrow">{telemetry.status}</div>
            <div className="hud-instruction">{telemetry.hint}</div>
          </div>

          {blockingMessage ? (
            <div className="blocking-overlay" role="status" aria-live="polite">
              <div className="spinner" />
              <strong>{blockingMessage}</strong>
              <span>Vui lòng giữ nguyên trang cho tới khi có kết quả.</span>
            </div>
          ) : null}
        </div>

        <div className="camera-controls">
          <button type="button" className="ghost-btn cancel-btn" onClick={onStop}>
            Hủy bỏ
          </button>
          <button type="button" className="ghost-btn debug-toggle-btn" onClick={() => setShowDebug(!showDebug)}>
            {showDebug ? "Ẩn debug" : "Hiện debug"}
          </button>
        </div>

        {showDebug && (
          <div className="debug-panel">
            <strong>Debug realtime</strong>
            {renderDebugRow("Pha", debugState.phase)}
            {renderDebugRow("Buoc", debugState.currentStepPrompt || "--")}
            {renderDebugRow("Can giua", alignmentStatus ? "Dat" : "Chua dat", alignmentStatus ? "pass" : "fail")}
            {renderDebugRow("Kich thuoc", debugState.sizeCheck ? "Dat" : "Chua dat", debugState.sizeCheck ? "pass" : "fail")}
            {renderDebugRow(
              "Pose",
              `yaw=${debugState.pose?.yawAngle ?? "--"} pitch=${debugState.pose?.pitchAngle ?? "--"} roll=${debugState.pose?.rollAngle ?? "--"}`,
            )}
            {renderDebugRow(
              "EAR / Blink",
              `${debugState.ear ?? "--"} | ${debugState.blinkDetected ? "DETECTED" : "NO"}`,
              debugState.blinkDetected ? "pass" : "neutral",
            )}
            {debugState.currentStepType === "open_mouth"
              ? renderDebugRow(
                  "Mouth open",
                  `${debugState.mouthOpenRatio ?? "--"} / ${THRESHOLDS.pose.mouthOpenRatioMin}`,
                  debugState.mouthOpenRatio != null
                    ? debugState.mouthOpenRatio >= THRESHOLDS.pose.mouthOpenRatioMin
                      ? "pass"
                      : "fail"
                    : "neutral",
                )
              : null}
            {renderDebugRow(
              "Do net",
              `${debugState.quality?.blurScore ?? "--"} / ${THRESHOLDS.quality.blurMin}`,
              debugState.quality ? (debugState.quality.blurScore >= THRESHOLDS.quality.blurMin ? "pass" : "fail") : "neutral",
            )}
            {renderDebugRow(
              "Do sang",
              `${debugState.quality?.brightnessMean ?? "--"} / [${THRESHOLDS.quality.brightnessMin}, ${THRESHOLDS.quality.brightnessMax}]`,
              debugState.quality
                ? debugState.quality.brightnessMean >= THRESHOLDS.quality.brightnessMin &&
                  debugState.quality.brightnessMean <= THRESHOLDS.quality.brightnessMax
                  ? "pass"
                  : "fail"
                : "neutral",
            )}
            {renderDebugRow(
              "Quality",
              `${debugState.quality?.qualityScore ?? "--"} / ${THRESHOLDS.quality.qualityMin}`,
              debugState.quality ? (debugState.quality.qualityScore >= THRESHOLDS.quality.qualityMin ? "pass" : "fail") : "neutral",
            )}
          </div>
        )}
      </div>
    </section>
  );
}
