import { describe, expect, it } from "vitest";
import { completeSession, createSessionState, latchBlink, markSessionRunning, resetSession } from "../src/session/sessionReducer";

describe("sessionReducer", () => {
  it("marks a session as running", () => {
    const next = markSessionRunning(createSessionState("verify"));
    expect(next.status).toBe("running");
    expect(next.completed).toBe(false);
  });

  it("latches blink until reset", () => {
    const initial = createSessionState("register");
    const blinked = latchBlink(initial);
    const completed = completeSession(blinked, { ok: true });
    expect(blinked.blinkSatisfied).toBe(true);
    expect(completed.blinkSatisfied).toBe(true);
    expect(resetSession(completed).blinkSatisfied).toBe(false);
  });
});
