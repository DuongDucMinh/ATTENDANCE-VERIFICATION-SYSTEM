import { describe, expect, it } from "vitest";
import { summarizeAntiReplay } from "../src/liveness/antiReplay";

function createFrame(index, options = {}) {
  const width = 20;
  const height = 20;
  const gray = new Float32Array(width * height);
  const stripe = options.stripe ?? false;
  const flicker = options.flicker ?? 0;
  const outerShift = options.outerShift ?? 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 120 + flicker;
      if (stripe && x % 2 === 0) value += 50;
      if (!stripe && x > 10) value += outerShift;
      gray[y * width + x] = value;
    }
  }

  return {
    width,
    height,
    gray,
    faceBox: {
      minX: 5 + index,
      minY: 4,
      maxX: 13 + index,
      maxY: 16,
      width: 8,
      height: 12,
    },
    centerBox: {
      minX: 2,
      minY: 2,
      maxX: 18,
      maxY: 18,
      width: 16,
      height: 16,
    },
  };
}

describe("anti replay heuristics", () => {
  it("reports low motion correlation for live-like motion", () => {
    const frames = [
      createFrame(0, { flicker: 0, outerShift: 0 }),
      createFrame(1, { flicker: 1, outerShift: 0 }),
      createFrame(2, { flicker: 0, outerShift: 0 }),
      createFrame(3, { flicker: 1, outerShift: 0 }),
    ];

    const summary = summarizeAntiReplay(frames, frames[frames.length - 1]);
    expect(summary.motionCorr).toBeLessThan(0.5);
  });

  it("reports stronger stripe signals on striped frames", () => {
    const striped = createFrame(1, { stripe: true, flicker: 6, outerShift: 4 });
    const clean = createFrame(1, { stripe: false, flicker: 0, outerShift: 0 });

    const stripedSummary = summarizeAntiReplay([striped, striped, striped, striped], striped);
    const cleanSummary = summarizeAntiReplay([clean, clean, clean, clean], clean);

    expect(stripedSummary.stripeScore).toBeGreaterThan(cleanSummary.stripeScore);
  });
});
