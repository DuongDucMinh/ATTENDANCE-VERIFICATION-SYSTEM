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
  if (quality.blurScore < blurMin) return "Canh bao: camera dang mo, hay giu may on dinh hoac tang anh sang.";
  if (quality.brightnessMean < brightnessMin) return "Canh bao: anh dang qua toi, hay tang anh sang.";
  if (quality.brightnessMean > brightnessMax) return "Canh bao: anh dang qua sang, hay giam nguon sang truc tiep.";
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
    status: "Cho bat dau",
    hint: "Thong bao: bam bat dau de mo camera.",
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
      setBlockingMessage("Dang tong hop anh xac nhan diem danh...");

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
        failSession(error.message || "Khong the hoan tat challenge.");
      } finally {
        state.processing = false;
        setBlockingMessage("");
      }
    };

    const handleStepCompletion = async (step) => {
      if (state.processing || state.stopped) return;
      state.processing = true;
      setBlockingMessage(mode === "register" ? `Dang luu mau ${step.poseTarget}...` : "Dang tong hop ket qua diem danh...");

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

          setTelemetry({
            status: "Dang dang ky khuon mat",
            hint: `Mau ${step.poseTarget} da luu. ${nextChallenge.prompt}`,
            tone: "success",
          });
          return;
        }

        const nextChallenge = advanceChallengeSession(state.challenge, performance.now());
        if (nextChallenge.status !== "completed") {
          state.challenge = nextChallenge;
          setTelemetry((current) => ({
            ...current,
            status: "Dang diem danh",
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
          status: "Dang diem danh",
          hint: "Challenge da xong. Quay ve mat thang va giu on dinh de chup anh xac nhan.",
          tone: "success",
        });
        return;
      } catch (error) {
        failSession(error.message || "Khong the hoan tat challenge.");
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
            status: mode === "register" ? "Dang dang ky khuon mat" : "Dang diem danh",
            hint: `Thong bao: giu nguyen tu the trong khung them ${(remainingMs / 1000).toFixed(1)}s truoc khi bat dau challenge.`,
            tone: "info",
          });
          return;
        }

        state.alignmentStartedAt = null;
        let preAlignHint = "Thong bao: dua mat vao dung khung va giu on dinh truoc khi bat dau challenge.";
        let preAlignTone = "info";

        if (!alignment.centerCheck) {
          preAlignHint = "Canh bao: dua mat vao giua khung.";
          preAlignTone = "error";
        } else if (!alignment.poseState.ok) {
          preAlignHint = alignment.poseState.label;
          preAlignTone = "error";
        } else if (!alignment.sizeCheck) {
          preAlignHint =
            alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
              ? "Canh bao: hay dua mat sat hon vao camera."
              : "Canh bao: hay lui nhe ra sau.";
          preAlignTone = "error";
        }

        const qualityWarning = getQualityWarning(previewQuality);
        setTelemetry({
          status: mode === "register" ? "Dang dang ky khuon mat" : "Dang diem danh",
          hint: qualityWarning ?? preAlignHint,
          tone: qualityWarning ? "error" : preAlignTone,
        });
        return;
      }

      if (mode === "verify" && state.verifyNeutralCapture) {
        updateDebug({
          phase: "neutral_capture",
          currentStepType: "neutral_capture",
          currentStepPrompt: "Quay ve mat thang va giu on dinh de chup anh xac nhan.",
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
          failSession("Da hoan tat challenge nhung khong giu duoc mat thang on dinh de chup anh xac nhan.");
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
            status: "Dang diem danh",
            hint: `Challenge da dat. Giu mat thang them ${(remainingMs / 1000).toFixed(1)}s de chup anh xac nhan.`,
            tone: "success",
          });
          return;
        }

        state.neutralCaptureStartedAt = null;
        let neutralHint = "Quay ve mat thang, nhin vao camera va giu khuon mat on dinh de chup anh xac nhan.";
        let neutralTone = "info";
        if (!alignment.centerCheck) {
          neutralHint = "Canh bao: dua mat vao giua khung de chup anh xac nhan.";
          neutralTone = "error";
        } else if (!alignment.sizeCheck) {
          neutralHint =
            alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
              ? "Canh bao: hay dua mat sat hon vao camera."
              : "Canh bao: hay lui nhe ra sau.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.yawAngle) > THRESHOLDS.alignment.frontYawMax) {
          neutralHint = "Canh bao: hay quay mat ve thang truoc camera.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.pitchAngle) > THRESHOLDS.alignment.pitchMax) {
          neutralHint = "Canh bao: hay giu dau thang, khong cui hoac ngua.";
          neutralTone = "error";
        } else if (Math.abs(alignment.pose.rollAngle) > THRESHOLDS.alignment.rollMax) {
          neutralHint = "Canh bao: hay giu dau thang, khong nghieng.";
          neutralTone = "error";
        } else if ((mouthOpenRatio ?? 0) > Math.max(0.18, THRESHOLDS.pose.mouthOpenRatioMin * 0.75)) {
          neutralHint = "Canh bao: hay ngam mieng va giu bieu cam tu nhien.";
          neutralTone = "error";
        }

        const qualityWarning = getQualityWarning(previewQuality);
        setTelemetry({
          status: "Dang diem danh",
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
        hint = "Canh bao: ban dang quay sang phai, hay quay sang trai theo yeu cau.";
        tone = "error";
      } else if (currentStep?.type === "turn_right_hold" && alignment.pose.yawAngle < -THRESHOLDS.alignment.wrongTurnYaw) {
        hint = "Canh bao: ban dang quay sang trai, hay quay sang phai theo yeu cau.";
        tone = "error";
      } else if (!alignment.centerCheck && !isTurnChallenge) {
        hint = "Canh bao: dua mat vao giua khung.";
        tone = "error";
      } else if (isTurnChallenge && !turnCenterCheck) {
        hint = "Canh bao: khi quay mat, van can giu khuon mat nam trong vung trung tam mo rong.";
        tone = "error";
      } else if (isTurnChallenge && Math.abs(alignment.pose.rollAngle) > THRESHOLDS.alignment.rollMax) {
        hint = "Canh bao: ban dang nghieng dau, hay giu dau thang khi quay mat.";
        tone = "error";
      } else if (isTurnChallenge && Math.abs(alignment.pose.pitchAngle) > THRESHOLDS.alignment.pitchMax) {
        hint = "Canh bao: khong cui hoac ngua dau khi thuc hien quay mat.";
        tone = "error";
      } else if (!isTurnChallenge && !alignment.poseState.ok) {
        hint = alignment.poseState.label;
        tone = "error";
      } else if (!alignment.sizeCheck) {
        hint =
          alignment.sizeRatio < THRESHOLDS.alignment.faceSizeMinRatio
            ? "Canh bao: hay dua mat sat hon vao camera."
            : "Canh bao: hay lui nhe ra sau.";
        tone = "error";
      }

      const qualityWarning = getQualityWarning(previewQuality);
      if (qualityWarning) {
        hint = qualityWarning;
        tone = "error";
      }

      setTelemetry({
        status: mode === "register" ? "Dang dang ky khuon mat" : "Dang diem danh",
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
        status: mode === "register" ? "Dang dang ky khuon mat" : "Dang diem danh",
        hint: "Thong bao: dua mat vao dung khung va giu on dinh truoc khi bat dau challenge.",
        tone: "info",
      });

      if (!videoRef.current || !overlayRef.current || !viewportRef.current) {
        throw new Error("Khung camera chua san sang. Hay bat dau lai.");
      }
      if (!window.FaceMesh || !window.Camera) {
        throw new Error("MediaPipe chua tai xong. Hay tai lai trang.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Trinh duyet hien tai khong ho tro camera.");
      }
      if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
        throw new Error("Camera yeu cau HTTPS hoac localhost.");
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
          failSession(error.message || "Khong the xu ly khung hinh camera.");
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
        throw new Error(blocked ? "Trinh duyet dang chan quyen camera." : "Khong the mo camera tren thiet bi nay.");
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
      failSession(error.message || "Khong the mo camera.");
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
      <div className="camera-layout">
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
        <div ref={viewportRef} className="viewport">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={overlayRef} />
          <div className={`oval-guide ${telemetry.tone === "success" ? "ready" : telemetry.tone === "error" ? "error" : "tracking"}`} />
          <div className="telemetry">
            <span>Trang thai: {telemetry.status}</span>
            <span>{telemetry.hint}</span>
          </div>
          {blockingMessage ? (
            <div className="blocking-overlay" role="status" aria-live="polite">
              <div className="spinner" />
              <strong>{blockingMessage}</strong>
              <span>Vui long giu nguyen trang cho toi khi co ket qua.</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
