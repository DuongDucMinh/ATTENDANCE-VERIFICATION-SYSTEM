import { describe, expect, it } from "vitest";
import { computeQualitySummary, rankFrames } from "../src/liveness/quality";

function createFrame(width, height, generator) {
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gray[y * width + x] = generator(x, y);
    }
  }
  return {
    width,
    height,
    gray,
    faceBox: { minX: 2, minY: 2, maxX: width - 2, maxY: height - 2, width: width - 4, height: height - 4 },
  };
}

describe("liveness quality", () => {
  it("scores a sharp checkerboard higher than a flat frame", () => {
    const sharp = createFrame(24, 24, (x, y) => ((x + y) % 2 === 0 ? 220 : 20));
    const flat = createFrame(24, 24, () => 128);

    const sharpQuality = computeQualitySummary(sharp);
    const flatQuality = computeQualitySummary(flat);

    expect(sharpQuality.blurScore).toBeGreaterThan(flatQuality.blurScore);
    expect(sharpQuality.qualityScore).toBeGreaterThan(flatQuality.qualityScore);
  });

  it("ranks frames by quality score", () => {
    const brightSharp = createFrame(24, 24, (x, y) => ((x + y) % 2 === 0 ? 180 : 70));
    const darkFlat = createFrame(24, 24, () => 18);
    const ranked = rankFrames([darkFlat, brightSharp]);
    expect(ranked[0].quality.qualityScore).toBeGreaterThan(ranked[1].quality.qualityScore);
  });
});
