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
  if (quality.blurScore < blurMin) return "Cảnh báo: camera đang mờ, hãy giữ máy ổn định hoặc tăng ánh sáng.";
  if (quality.brightnessMean < brightnessMin) return "Cảnh báo: ảnh đang quá tối, hãy tăng ánh sáng.";
  if (quality.brightnessMean > brightnessMax) return "Cảnh báo: ảnh đang quá sáng, hãy giảm nguồn sáng trực tiếp.";
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
let globalFaceMeshPromise = null;

export const preloadFaceMesh = () => {
  if (typeof window === "undefined" || !window.FaceMesh) {
    return Promise.resolve(null);
  }
  if (globalFaceMeshPromise) {
    return globalFaceMeshPromise;
  }
  globalFaceMeshPromise = new Promise((resolve) => {
    try {
      console.log("Starting background preload of MediaPipe FaceMesh...");
      const faceMesh = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });

      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      
      const onDummyResults = () => {
        console.log("MediaPipe FaceMesh preloaded and warmed up successfully.");
        globalFaceMesh = faceMesh;
        resolve(faceMesh);
      };
      
      faceMesh.onResults(onDummyResults);
      faceMesh.send({ image: canvas }).catch((err) => {
        console.log("MediaPipe FaceMesh warmed up (initial send complete).");
        globalFaceMesh = faceMesh;
        resolve(faceMesh);
      });
    } catch (e) {
      console.error("Failed to preload FaceMesh:", e);
      resolve(null);
    }
  });
  return globalFaceMeshPromise;
};

if (typeof window !== "undefined" && window.FaceMesh) {
  setTimeout(() => {
    preloadFaceMesh().catch((err) => console.error("Error preloading FaceMesh:", err));
  }, 1000);
}

const globalAudioCache = {};

export const unlockAndPreloadAudio = () => {
  if (typeof window === "undefined") return;
  const names = [
    "align", "center", "closer", "further", "blink_once",
    "blink_twice", "turn_left", "turn_right", "open_mouth",
    "neutral", "success", "fail"
  ];
  console.log("Unlocking and preloading audio assets for mobile browsers...");
  names.forEach(name => {
    try {
      let audio = globalAudioCache[name];
      if (!audio) {
        audio = new Audio(`/audio/${name}.mp3`);
        globalAudioCache[name] = audio;
      }
      audio.load();

      // Mute the audio and set volume to 0 to prevent a clashing chorus on start
      const originalVolume = audio.volume;
      const originalMuted = audio.muted;
      audio.volume = 0;
      audio.muted = true;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          audio.pause();
          audio.currentTime = 0;
          // Restore original volume and muted state after successful play-pause
          audio.volume = originalVolume;
          audio.muted = originalMuted;
        }).catch(() => {
          // Restore on error too
          audio.volume = originalVolume;
          audio.muted = originalMuted;
        });
      }
    } catch (e) {
      console.warn(`Failed to unlock/preload audio for ${name}:`, e);
    }
  });
};

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
  const showDebugRef = useRef(false);
  const lastDebugUpdateRef = useRef(0);
  const lastPlayedRef = useRef({ name: "", timestamp: 0 });

  useEffect(() => {
    showDebugRef.current = showDebug;
  }, [showDebug]);

  const playAudio = (name, minIntervalMs = 2000) => {
    try {
      const now = performance.now();
      const last = lastPlayedRef.current;

      if (last.name === name && now - last.timestamp < minIntervalMs) {
        return;
      }

      // Pause all audio elements in the cache to guarantee no overlapping sounds play together
      Object.values(globalAudioCache).forEach(a => {
        try {
          a.pause();
          a.currentTime = 0;
        } catch (e) {}
      });

      let audio = globalAudioCache[name];
      if (!audio) {
        audio = new Audio(`/audio/${name}.mp3`);
        globalAudioCache[name] = audio;
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
      Object.values(globalAudioCache).forEach(audio => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch (e) {}
      });
    };
  }, []);

  const determineAudioFile = (text) => {
    if (text.includes("chớp mắt 2 lần")) return "blink_twice";
    if (text.includes("chớp mắt 1 lần")) return "blink_once";

    // Wrong-turn instructions have high priority to avoid matching wrong parts
    if (text.includes("hãy quay sang trái")) return "turn_left";
    if (text.includes("hãy quay sang phải")) return "turn_right";

    // General turn instructions
    if (text.includes("quay mặt sang trái") || text.includes("quay sang trái")) return "turn_left";
    if (text.includes("quay mặt sang phải") || text.includes("quay sang phải")) return "turn_right";

    if (text.includes("há miệng")) return "open_mouth";

    if (text.includes("mắt thẳng") || text.includes("về thẳng")) return "neutral";
    if (text.includes("đầu thẳng") || text.includes("ngậm miệng")) return "neutral";

    if (text.includes("không thấy khuôn mặt")) return "align";
    if (text.includes("đưa mặt vào giữa khung") || text.includes("trung tâm")) return "center";
    if (text.includes("sát hơn")) return "closer";
    if (text.includes("lùi nhẹ")) return "further";

    return null;
  };

  useEffect(() => {
    if (!telemetry.hint) return;
    const text = telemetry.hint.toLowerCase();
    const audioFile = determineAudioFile(text);

    if (audioFile) {
      playAudio(audioFile);
    }
  }, [telemetry.hint]);

  useEffect(() => {
    if (
      telemetry.status === "Success" ||
      telemetry.status === "Registered" ||
      telemetry.hint?.includes("thành công")
    ) {
      playAudio("success", 0);
    } else if (
      telemetry.status === "Failed" ||
      telemetry.hint?.includes("thất bại")
    ) {
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
    state.alignmentStartedAt = null;
    state.verifyNeutralCapture = false;
    state.neutralCaptureStartedAt = null;
    state.neutralCapturePhaseStartedAt = null;
    samplerRef.current.clear();
    setBlockingMessage("");

    let cancelled = false;

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
      if (globalFaceMesh) {
        try {
          globalFaceMesh.onResults(() => {});
        } catch (e) {
          // ignore
        }
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
        throw new Error("Khong thu duoc frame hop le cho challenge hien tai.");
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
        const data = await verifyAttendance(studentId, blob, captureMeta);
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
      const poseTargetVi = step.poseTarget === "left" ? "quay trái" : step.poseTarget === "right" ? "quay phải" : "nhìn thẳng";
      setBlockingMessage(mode === "register" ? `Đang lưu mẫu ${poseTargetVi}...` : "Đang tổng hợp kết quả điểm danh...");

      try {
        if (mode === "register") {
          const { captureMeta, blob } = await finalizeBurst({
            step,
            submitMode: "register",
            poseLabel: step.poseTarget,
            challengeSequence: [step.type],
          });
          const data = await registerFace(studentId, step.poseTarget, blob, captureMeta);
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

          const poseTargetVi = step.poseTarget === "left" ? "quay trái" : step.poseTarget === "right" ? "quay phải" : "nhìn thẳng";
          setTelemetry({
            status: "Đang đăng ký khuôn mặt",
            hint: `Mẫu ${poseTargetVi} đã lưu. ${nextChallenge.prompt}`,
            tone: "success",
          });
          return;
        }

        const nextChallenge = advanceChallengeSession(state.challenge, performance.now());
        if (nextChallenge.status !== "completed") {
          state.challenge = nextChallenge;
          setTelemetry((current) => ({
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
        setTelemetry({
          status: "Đang điểm danh",
          hint: "Thử thách đã xong. Quay về mắt thẳng và giữ ổn định để chụp ảnh xác nhận.",
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
      resizeCanvas();
      state.frameIndex += 1;

      if (!faceLandmarks) {
        drawOverlay(null, null, "info");
        setTelemetry((current) => ({
          ...current,
          status: mode === "register" ? "Dang dang ky khuon mat" : "Dang diem danh",
          hint: "Canh bao: khong thay khuon mat trong camera.",
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
      const now = performance.now();
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

        if (alignment.aligned) {
          state.alignmentStartedAt = state.alignmentStartedAt ?? now;
          const heldMs = now - state.alignmentStartedAt;
          const remainingMs = Math.max(0, THRESHOLDS.session.alignmentHoldMs - heldMs);

          if (heldMs >= THRESHOLDS.session.alignmentHoldMs) {
            state.alignmentReady = true;
            state.challenge = createChallengeSession(mode, now);
            samplerRef.current.clear();
            setTelemetry({
              status: mode === "register" ? "Dang dang ky khuon mat" : "Dang diem danh",
              hint: state.challenge.prompt,
              tone: "success",
            });
            return;
          }

          setTelemetry({
            status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
            hint: `Thông báo: giữ nguyên tư thế trong khung thêm ${(remainingMs / 1000).toFixed(1)}s trước khi bắt đầu thử thách.`,
            tone: "info",
          });
          return;
        }

        state.alignmentStartedAt = null;
        let preAlignHint = "Thông báo: đưa mặt vào đúng khung và giữ ổn định trước khi bắt đầu thử thách.";
        let preAlignTone = "info";

        if (!alignment.centerCheck) {
          preAlignHint = "Cảnh báo: đưa mặt vào giữa khung.";
          preAlignTone = "error";
        } else if (!alignment.poseState.ok) {
          preAlignHint = alignment.poseState.label;
          preAlignTone = "error";
        } else if (!alignment.sizeCheck) {
          preAlignHint =
            alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
              ? "Cảnh báo: hãy đưa mặt sát hơn vào camera."
              : "Cảnh báo: hãy lùi nhẹ ra sau.";
          preAlignTone = "error";
        }

        const qualityWarning = getQualityWarning(previewQuality);
        setTelemetry({
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
          currentStepPrompt: "Quay về mắt thẳng và giữ ổn định để chụp ảnh xác nhận.",
          alignment,
          ear,
          mouthOpenRatio,
          blinkDetected,
          quality: previewQuality,
        });

        if (
          state.neutralCapturePhaseStartedAt &&
          now - state.neutralCapturePhaseStartedAt > THRESHOLDS.session.verifyNeutralCaptureTimeoutMs
        ) {
          failSession("Đã hoàn tất thử thách nhưng không giữ được mặt thẳng ổn định để chụp ảnh xác nhận.");
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

          setTelemetry({
            status: "Đang điểm danh",
            hint: `Thử thách đã đạt. Giữ mặt thẳng thêm ${(remainingMs / 1000).toFixed(1)}s để chụp ảnh xác nhận.`,
            tone: "success",
          });
          return;
        }

        state.neutralCaptureStartedAt = null;
        let neutralHint = "Quay về mắt thẳng, nhìn vào camera và giữ khuôn mặt ổn định để chụp ảnh xác nhận.";
        let neutralTone = "info";
        if (!alignment.centerCheck) {
          neutralHint = "Cảnh báo: đưa mặt vào giữa khung để chụp ảnh xác nhận.";
          neutralTone = "error";
        } else if (!alignment.sizeCheck) {
          neutralHint =
            alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
              ? "Cảnh báo: hãy đưa mặt sát hơn vào camera."
              : "Cảnh báo: hãy lùi nhẹ ra sau.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.yawAngle) > THRESHOLDS.alignment.frontYawMax) {
          neutralHint = "Cảnh báo: hãy quay mặt về thẳng trước camera.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.pitchAngle) > THRESHOLDS.alignment.pitchMax) {
          neutralHint = "Cảnh báo: hãy giữ đầu thẳng, không cúi hoặc ngửa.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.rollAngle) > THRESHOLDS.alignment.rollMax) {
          neutralHint = "Cảnh báo: hãy giữ đầu thẳng, không nghiêng.";
          neutralTone = "error";
        } else if ((mouthOpenRatio ?? 0) > Math.max(0.18, THRESHOLDS.pose.mouthOpenRatioMin * 0.75)) {
          neutralHint = "Cảnh báo: hãy ngậm miệng và giữ biểu cảm tự nhiên.";
          neutralTone = "error";
        }

        const qualityWarning = getQualityWarning(previewQuality);
        setTelemetry({
          status: "Đang điểm danh",
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
        hint = "Cảnh báo: bạn đang quay sang phải, hãy quay sang trái theo yêu cầu.";
        tone = "error";
      } else if (currentStep?.type === "turn_right_hold" && alignment.pose.yawAngle < -THRESHOLDS.alignment.wrongTurnYaw) {
        hint = "Cảnh báo: bạn đang quay sang trái, hãy quay sang phải theo yêu cầu.";
        tone = "error";
      } else if (!alignment.centerCheck && !isTurnChallenge) {
        hint = "Cảnh báo: đưa mặt vào giữa khung.";
        tone = "error";
      } else if (isTurnChallenge && !turnCenterCheck) {
        hint = "Cảnh báo: khi quay mặt, vẫn cần giữ khuôn mặt nằm trong vùng trung tâm mở rộng.";
        tone = "error";
      } else if (isTurnChallenge && Math.abs(alignment.pose.rollAngle) > THRESHOLDS.alignment.rollMax) {
        hint = "Cảnh báo: bạn đang nghiêng đầu, hãy giữ đầu thẳng khi quay mặt.";
        tone = "error";
      } else if (isTurnChallenge && Math.abs(alignment.pose.pitchAngle) > THRESHOLDS.alignment.pitchMax) {
        hint = "Cảnh báo: không cúi hoặc ngửa đầu khi thực hiện quay mặt.";
        tone = "error";
      } else if (!isTurnChallenge && !alignment.poseState.ok) {
        hint = alignment.poseState.label;
        tone = "error";
      } else if (!alignment.sizeCheck) {
        hint =
          alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
            ? "Cảnh báo: hãy đưa mặt sát hơn vào camera."
            : "Cảnh báo: hãy lùi nhẹ ra sau.";
        tone = "error";
      }

      const qualityWarning = getQualityWarning(previewQuality);
      if (qualityWarning) {
        hint = qualityWarning;
        tone = "error";
      }

      setTelemetry({
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
      setTelemetry({
        status: mode === "register" ? "Đang đăng ký khuôn mặt" : "Đang điểm danh",
        hint: "Thông báo: đưa mặt vào đúng khung và giữ ổn định trước khi bắt đầu thử thách.",
        tone: "info",
      });

      if (!videoRef.current || !overlayRef.current || !viewportRef.current) {
        throw new Error("Khung camera chưa sẵn sàng. Hãy bắt đầu lại.");
      }
      if (!window.FaceMesh || !window.Camera) {
        throw new Error("MediaPipe chưa tải xong. Hãy tải lại trang.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Trình duyệt hiện tại không hỗ trợ camera.");
      }
      if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
        throw new Error("Camera yêu cầu HTTPS hoặc localhost.");
      }

      let faceMesh = globalFaceMesh;
      if (!faceMesh) {
        faceMesh = await preloadFaceMesh();
      }
      if (!faceMesh) {
        throw new Error("MediaPipe FaceMesh chưa sẵn sàng. Hãy bắt đầu lại.");
      }
      faceMesh.onResults((results) => {
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
        throw new Error(blocked ? "Trình duyệt đang chặn quyền camera." : "Không thể mở camera trên thiết bị này.");
      }

      if (cancelled) return;
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (cancelled) return;

      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (!sessionRef.current.stopped && !sessionRef.current.processing) {
            await faceMesh.send({ image: videoRef.current });
          }
        },
        width: 640,
        height: 640,
      });
      cameraRef.current = camera;
      await camera.start();
    };

    start().catch((error) => {
      if (cancelled) return;
      failSession(error.message || "Không thể mở camera.");
    });

    return () => {
      cancelled = true;
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
            {renderDebugRow("Giai đoạn", debugState.phase)}
            {renderDebugRow("Bước", debugState.currentStepPrompt || "--")}
            {renderDebugRow("Căn giữa", alignmentStatus ? "Đạt" : "Chưa đạt", alignmentStatus ? "pass" : "fail")}
            {renderDebugRow("Kích thước", debugState.sizeCheck ? "Đạt" : "Chưa đạt", debugState.sizeCheck ? "pass" : "fail")}
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
              "Độ nét",
              `${debugState.quality?.blurScore ?? "--"} / ${THRESHOLDS.quality.blurMin}`,
              debugState.quality ? (debugState.quality.blurScore >= THRESHOLDS.quality.blurMin ? "pass" : "fail") : "neutral",
            )}
            {renderDebugRow(
              "Độ sáng",
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
