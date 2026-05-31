import { THRESHOLDS } from "./constants";
import { passesQualityGate } from "./quality";

export function evaluateSessionOutcome({ challengePassed, quality, antiReplay }) {
  const antiReplayThresholds = THRESHOLDS.antiReplay;

  if (!challengePassed) {
    return {
      ok: false,
      verdict: "failed",
      reason: "Challenge-response chua hoan tat.",
    };
  }

  if (!passesQualityGate(quality)) {
    return {
      ok: false,
      verdict: "failed",
      reason: "Khung hinh duoc chon chua dat nguong do net hoac do sang.",
    };
  }

  const suspiciousReplay =
    antiReplayThresholds.enabled &&
    antiReplay &&
    antiReplay.motionCorr > antiReplayThresholds.motionCorrMax &&
    antiReplay.flickerPeakRatio > antiReplayThresholds.flickerPeakMax &&
    antiReplay.stripeScore > antiReplayThresholds.stripeScoreMax;

  if (suspiciousReplay) {
    return {
      ok: false,
      verdict: "failed",
      reason: "Phat hien dau hieu replay video tu motion correlation, flicker va stripe score.",
    };
  }

  return {
    ok: true,
    verdict: !antiReplayThresholds.enabled ? "disabled" : antiReplay?.moireScore > antiReplayThresholds.moireScoreMax ? "warning" : "passed",
    reason:
      !antiReplayThresholds.enabled
        ? "Challenge va quality dat. Anti-replay heuristic da tam tat de uu tien hieu nang."
        : antiReplay?.moireScore > antiReplayThresholds.moireScoreMax
        ? "Phien duoc chap nhan nhung moire score dang cao, can theo doi de tuning."
        : "Challenge, quality va anti-replay deu dat.",
  };
}
