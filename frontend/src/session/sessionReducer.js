export function createSessionState(mode) {
  return {
    mode,
    status: "idle",
    blinkSatisfied: false,
    completed: false,
    result: null,
  };
}

export function markSessionRunning(state) {
  return { ...state, status: "running", completed: false, result: null };
}

export function latchBlink(state) {
  return { ...state, blinkSatisfied: true };
}

export function completeSession(state, result) {
  return { ...state, status: "completed", completed: true, result };
}

export function resetSession(state) {
  return createSessionState(state.mode);
}
