import {
  REGISTER_POSE_STEPS,
  THRESHOLDS,
  VERIFY_CHALLENGE_POOL,
} from "./constants";

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function createChallengeSteps(mode) {
  if (mode === "register") {
    return REGISTER_POSE_STEPS;
  }

  const { verifyStepTimeoutMs } = THRESHOLDS.session;
  return shuffle(VERIFY_CHALLENGE_POOL).slice(0, 2).map((type, index) => ({
    id: `${type}_${index}`,
    type,
    timeoutMs: verifyStepTimeoutMs,
    prompt:
      type === "blink_twice"
        ? "Challenge: chop mat 2 lan lien tiep."
        : type === "turn_left_hold"
          ? "Challenge: quay mat sang trai nhe va giu 0.4 giay."
          : type === "turn_right_hold"
            ? "Challenge: quay mat sang phai nhe va giu 0.4 giay."
            : "Challenge: mo mieng ro trong khung hinh.",
    poseTarget: type === "turn_left_hold" ? "left" : type === "turn_right_hold" ? "right" : "front",
  }));
}

export function createChallengeSession(mode, now) {
  const steps = createChallengeSteps(mode);
  const timestamp = now ?? performance.now();
  return {
    mode,
    steps,
    currentStepIndex: 0,
    stepStartedAt: timestamp,
    sessionStartedAt: timestamp,
    holdStartedAt: null,
    blinkCount: 0,
    challengeSequence: steps.map((step) => step.type),
    status: "running",
    reason: null,
    prompt: steps[0]?.prompt || "",
    poseTarget: steps[0]?.poseTarget || "front",
  };
}

function isStepAligned(step, metrics) {
  const { alignment, pose } = THRESHOLDS;
  if (step.type === "turn_left_hold") {
    return (
      (metrics.turnCenterCheck ?? metrics.centerCheck) &&
      metrics.sizeCheck &&
      Math.abs(metrics.pose.rollAngle) <= alignment.rollMax &&
      Math.abs(metrics.pose.pitchAngle) <= alignment.pitchMax &&
      metrics.pose.yawAngle <= pose.leftYawMin
    );
  }
  if (step.type === "turn_right_hold") {
    return (
      (metrics.turnCenterCheck ?? metrics.centerCheck) &&
      metrics.sizeCheck &&
      Math.abs(metrics.pose.rollAngle) <= alignment.rollMax &&
      Math.abs(metrics.pose.pitchAngle) <= alignment.pitchMax &&
      metrics.pose.yawAngle >= pose.rightYawMin
    );
  }
  if (!metrics.aligned) return false;
  const frontAligned =
    Math.abs(metrics.pose.yawAngle) <= alignment.frontYawMax &&
    Math.abs(metrics.pose.rollAngle) <= alignment.rollMax;
  if (step.type === "open_mouth") {
    return frontAligned && (metrics.mouthOpenRatio ?? 0) >= pose.mouthOpenRatioMin;
  }
  return frontAligned;
}

export function evaluateChallengeFrame(session, metrics) {
  if (!session || session.status !== "running") {
    return { session, event: null };
  }

  const currentStep = session.steps[session.currentStepIndex];
  const overallTimeout =
    session.mode === "verify" ? THRESHOLDS.session.verifySessionTimeoutMs : THRESHOLDS.session.registerSessionTimeoutMs;
  if (!currentStep) {
    return {
      session: { ...session, status: "completed", prompt: "Hoan tat challenge.", poseTarget: "front" },
      event: { type: "session_complete" },
    };
  }

  if (metrics.timestamp - session.sessionStartedAt > overallTimeout) {
    return {
      session: { ...session, status: "failed", reason: "Vuot qua thoi gian cho phep cua phien challenge." },
      event: { type: "session_failed", reason: "Vuot qua thoi gian cho phep cua phien challenge." },
    };
  }

  if (metrics.timestamp - session.stepStartedAt > currentStep.timeoutMs) {
    return {
      session: { ...session, status: "failed", reason: "Khong hoan tat challenge hien tai dung thoi gian." },
      event: { type: "session_failed", reason: "Khong hoan tat challenge hien tai dung thoi gian." },
    };
  }

  const alignedNow = isStepAligned(currentStep, metrics);
  let nextSession = { ...session, prompt: currentStep.prompt, poseTarget: currentStep.poseTarget };

  if (currentStep.type === "blink_once") {
    if (!alignedNow) {
      return { session: nextSession, event: null };
    }
    if (metrics.blinkDetected) {
      nextSession.status = "step_complete";
      return { session: nextSession, event: { type: "step_complete", step: currentStep } };
    }
    return { session: nextSession, event: null };
  }

  if (currentStep.type === "blink_twice") {
    if (!alignedNow) {
      nextSession.blinkCount = 0;
      return { session: nextSession, event: null };
    }
    if (metrics.blinkDetected) {
      nextSession.blinkCount += 1;
      if (nextSession.blinkCount >= 2) {
        nextSession.status = "step_complete";
        return { session: nextSession, event: { type: "step_complete", step: currentStep } };
      }
    }
    return { session: nextSession, event: null };
  }

  if (currentStep.type === "open_mouth") {
    if (alignedNow) {
      nextSession.holdStartedAt = nextSession.holdStartedAt ?? metrics.timestamp;
      const holdMs = metrics.timestamp - nextSession.holdStartedAt;
      if (holdMs >= THRESHOLDS.session.poseHoldMs) {
        nextSession.status = "step_complete";
        return { session: nextSession, event: { type: "step_complete", step: currentStep } };
      }
    } else {
      nextSession.holdStartedAt = null;
    }
    return { session: nextSession, event: null };
  }

  if (alignedNow) {
    nextSession.holdStartedAt = nextSession.holdStartedAt ?? metrics.timestamp;
    const holdMs = metrics.timestamp - nextSession.holdStartedAt;
    if (holdMs >= THRESHOLDS.session.poseHoldMs) {
      nextSession.status = "step_complete";
      return { session: nextSession, event: { type: "step_complete", step: currentStep } };
    }
  } else {
    nextSession.holdStartedAt = null;
  }

  return { session: nextSession, event: null };
}

export function advanceChallengeSession(session, now) {
  const timestamp = now ?? performance.now();
  const nextStepIndex = session.currentStepIndex + 1;
  if (nextStepIndex >= session.steps.length) {
    return {
      ...session,
      currentStepIndex: nextStepIndex,
      status: "completed",
      prompt: "Hoan tat challenge.",
      poseTarget: "front",
      reason: null,
    };
  }

  const nextStep = session.steps[nextStepIndex];
  return {
    ...session,
    currentStepIndex: nextStepIndex,
    stepStartedAt: timestamp,
    holdStartedAt: null,
    blinkCount: 0,
    status: "running",
    reason: null,
    prompt: nextStep.prompt,
    poseTarget: nextStep.poseTarget,
  };
}
