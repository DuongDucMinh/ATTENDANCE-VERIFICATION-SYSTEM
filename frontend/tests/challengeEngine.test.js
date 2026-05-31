import { describe, expect, it, vi } from "vitest";
import { advanceChallengeSession, createChallengeSession, evaluateChallengeFrame } from "../src/liveness/challengeEngine";

describe("challenge engine", () => {
  it("walks through the 3-step enrollment flow", () => {
    const session = createChallengeSession("register", 0);
    const frontReady = evaluateChallengeFrame(session, {
      timestamp: 100,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: 0, rollAngle: 0, pitchAngle: 0 },
      blinkDetected: false,
    });
    const front = evaluateChallengeFrame(frontReady.session, {
      timestamp: 1300,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: 0, rollAngle: 0, pitchAngle: 0 },
      blinkDetected: true,
    });
    expect(front.event.type).toBe("step_complete");

    const leftSession = advanceChallengeSession(front.session, 1300);
    const leftReady = evaluateChallengeFrame(leftSession, {
      timestamp: 1400,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: -16, rollAngle: 0, pitchAngle: 0 },
      blinkDetected: false,
    });
    const left = evaluateChallengeFrame(leftReady.session, {
      timestamp: 1800,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: -16, rollAngle: 0, pitchAngle: 0 },
      blinkDetected: false,
    });
    expect(left.event.type).toBe("step_complete");

    const rightSession = advanceChallengeSession(left.session, 1800);
    const rightReady = evaluateChallengeFrame(rightSession, {
      timestamp: 1900,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: 17, rollAngle: 0, pitchAngle: 0 },
      blinkDetected: false,
    });
    const right = evaluateChallengeFrame(rightReady.session, {
      timestamp: 2300,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: 17, rollAngle: 0, pitchAngle: 0 },
      blinkDetected: false,
    });
    expect(right.event.type).toBe("step_complete");
  });

  it("fails verify sessions that exceed the overall timeout", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const session = createChallengeSession("verify", 0);
    const result = evaluateChallengeFrame(session, {
      timestamp: 21000,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: 0, rollAngle: 0, pitchAngle: 0 },
      blinkDetected: false,
    });
    expect(result.event.type).toBe("session_failed");
    Math.random.mockRestore();
  });

  it("completes the open-mouth verify challenge when the mouth ratio is high enough", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.95);
    const session = createChallengeSession("verify", 0);
    const openMouthSession = {
      ...session,
      steps: [{ id: "open_mouth_0", type: "open_mouth", timeoutMs: 8000, prompt: "open", poseTarget: "front" }],
      challengeSequence: ["open_mouth"],
    };
    const ready = evaluateChallengeFrame(openMouthSession, {
      timestamp: 100,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: 0, rollAngle: 0, pitchAngle: 0 },
      mouthOpenRatio: 0.32,
      blinkDetected: false,
    });
    const completed = evaluateChallengeFrame(ready.session, {
      timestamp: 500,
      aligned: true,
      centerCheck: true,
      turnCenterCheck: true,
      sizeCheck: true,
      pose: { yawAngle: 0, rollAngle: 0, pitchAngle: 0 },
      mouthOpenRatio: 0.32,
      blinkDetected: false,
    });

    expect(completed.event.type).toBe("step_complete");
    Math.random.mockRestore();
  });
});
