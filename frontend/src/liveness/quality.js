import { THRESHOLDS } from "./constants";

function forEachPixel(gray, width, box, callback) {
  const startX = Math.max(1, Math.floor(box.minX));
  const endX = Math.min(width - 1, Math.ceil(box.maxX));
  const startY = Math.max(1, Math.floor(box.minY));
  const endY = Math.min(Math.floor(gray.length / width) - 1, Math.ceil(box.maxY));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      callback(x, y, gray[y * width + x]);
    }
  }
}

export function computeBrightnessMean(gray, width, box) {
  let sum = 0;
  let count = 0;
  forEachPixel(gray, width, box, (_x, _y, value) => {
    sum += value;
    count += 1;
  });
  return count === 0 ? 0 : sum / count;
}

export function computeBlurScore(gray, width, box) {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  forEachPixel(gray, width, box, (x, y, value) => {
    const laplacian =
      4 * value -
      gray[(y - 1) * width + x] -
      gray[(y + 1) * width + x] -
      gray[y * width + (x - 1)] -
      gray[y * width + (x + 1)];
    sum += laplacian;
    sumSquares += laplacian * laplacian;
    count += 1;
  });
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(sumSquares / count - mean * mean, 0);
}

export function computeQualitySummary(frame) {
  const { blurMin, brightnessMin, brightnessMax } = THRESHOLDS.quality;
  const blurScore = computeBlurScore(frame.gray, frame.width, frame.faceBox);
  const brightnessMean = computeBrightnessMean(frame.gray, frame.width, frame.faceBox);
  const brightnessNormalized =
    brightnessMean < brightnessMin
      ? brightnessMean / Math.max(brightnessMin, 1)
      : brightnessMean > brightnessMax
        ? Math.max(0, (255 - brightnessMean) / Math.max(255 - brightnessMax, 1))
        : 1;
  const blurNormalized = Math.min(1, blurScore / Math.max(blurMin * 8, 1));
  const qualityScore = Number((0.65 * blurNormalized + 0.35 * brightnessNormalized).toFixed(3));

  return {
    blurScore: Number(blurScore.toFixed(3)),
    brightnessMean: Number(brightnessMean.toFixed(3)),
    qualityScore,
  };
}

function computeRecognitionSuitability(frame) {
  const pose = frame.pose || {};
  const yawScore = Math.max(0, 1 - Math.abs(pose.yawAngle ?? 0) / 35);
  const pitchScore = Math.max(0, 1 - Math.abs(pose.pitchAngle ?? 0) / 25);
  const rollScore = Math.max(0, 1 - Math.abs(pose.rollAngle ?? 0) / 20);
  const mouthRatio = frame.mouthOpenRatio ?? 0;
  const mouthScore = mouthRatio <= 0.18 ? 1 : Math.max(0, 1 - (mouthRatio - 0.18) / 0.22);
  return Number((0.35 * yawScore + 0.25 * pitchScore + 0.2 * rollScore + 0.2 * mouthScore).toFixed(3));
}

export function rankFrames(frames, options = {}) {
  const purpose = options.purpose || "quality";
  return frames
    .map((frame) => {
      const quality = computeQualitySummary(frame);
      const recognitionSuitability = computeRecognitionSuitability(frame);
      const rankScore =
        purpose === "verify"
          ? Number((0.72 * quality.qualityScore + 0.28 * recognitionSuitability).toFixed(3))
          : quality.qualityScore;
      return { frame, quality, recognitionSuitability, rankScore };
    })
    .sort((left, right) => right.rankScore - left.rankScore);
}

export function passesQualityGate(quality) {
  const { blurMin, brightnessMin, brightnessMax, qualityMin } = THRESHOLDS.quality;
  return (
    quality.blurScore >= blurMin &&
    quality.brightnessMean >= brightnessMin &&
    quality.brightnessMean <= brightnessMax &&
    quality.qualityScore >= qualityMin
  );
}
