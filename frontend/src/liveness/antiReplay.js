function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (!values.length) return 0;
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
}

function pearsonCorrelation(seriesA, seriesB) {
  if (seriesA.length !== seriesB.length || seriesA.length < 2) return 0;
  const meanA = mean(seriesA);
  const meanB = mean(seriesB);
  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;
  for (let index = 0; index < seriesA.length; index += 1) {
    const deltaA = seriesA[index] - meanA;
    const deltaB = seriesB[index] - meanB;
    numerator += deltaA * deltaB;
    denominatorA += deltaA * deltaA;
    denominatorB += deltaB * deltaB;
  }
  if (denominatorA === 0 || denominatorB === 0) return 0;
  return numerator / Math.sqrt(denominatorA * denominatorB);
}

function boxCenter(box) {
  return { x: box.minX + box.width / 2, y: box.minY + box.height / 2 };
}

function sampleOuterMotion(currentFrame, previousFrame) {
  const { width, gray } = currentFrame;
  const face = currentFrame.faceBox;
  const center = currentFrame.centerBox;
  let diff = 0;
  let count = 0;

  for (let y = Math.max(0, Math.floor(center.minY)); y < Math.min(currentFrame.height, Math.ceil(center.maxY)); y += 1) {
    for (let x = Math.max(0, Math.floor(center.minX)); x < Math.min(currentFrame.width, Math.ceil(center.maxX)); x += 1) {
      const insideFace = x >= face.minX && x <= face.maxX && y >= face.minY && y <= face.maxY;
      if (insideFace) continue;
      const index = y * width + x;
      diff += Math.abs(gray[index] - previousFrame.gray[index]);
      count += 1;
    }
  }

  return count === 0 ? 0 : diff / count;
}

function computePatchBrightness(frame, patch) {
  let sum = 0;
  let count = 0;
  const startX = Math.max(0, Math.floor(patch.minX));
  const endX = Math.min(frame.width, Math.ceil(patch.maxX));
  const startY = Math.max(0, Math.floor(patch.minY));
  const endY = Math.min(frame.height, Math.ceil(patch.maxY));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      sum += frame.gray[y * frame.width + x];
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function createFlickerPatches(faceBox) {
  const forehead = {
    minX: faceBox.minX + faceBox.width * 0.28,
    maxX: faceBox.minX + faceBox.width * 0.72,
    minY: faceBox.minY + faceBox.height * 0.08,
    maxY: faceBox.minY + faceBox.height * 0.26,
  };
  const leftCheek = {
    minX: faceBox.minX + faceBox.width * 0.12,
    maxX: faceBox.minX + faceBox.width * 0.34,
    minY: faceBox.minY + faceBox.height * 0.46,
    maxY: faceBox.minY + faceBox.height * 0.7,
  };
  const rightCheek = {
    minX: faceBox.minX + faceBox.width * 0.66,
    maxX: faceBox.minX + faceBox.width * 0.88,
    minY: faceBox.minY + faceBox.height * 0.46,
    maxY: faceBox.minY + faceBox.height * 0.7,
  };
  return [forehead, leftCheek, rightCheek];
}

function computeFlickerPeakRatio(frames) {
  const series = frames.map((frame) => {
    const patches = createFlickerPatches(frame.faceBox);
    return mean(patches.map((patch) => computePatchBrightness(frame, patch)));
  });
  if (series.length < 4) return 0;
  const avg = mean(series);
  const detrended = series.map((value) => value - avg);
  const magnitudes = [];
  for (let frequency = 1; frequency < detrended.length; frequency += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < detrended.length; index += 1) {
      const angle = (-2 * Math.PI * frequency * index) / detrended.length;
      real += detrended[index] * Math.cos(angle);
      imaginary += detrended[index] * Math.sin(angle);
    }
    magnitudes.push(Math.hypot(real, imaginary));
  }
  const avgMagnitude = mean(magnitudes);
  if (avgMagnitude === 0) return 0;
  return Math.max(...magnitudes) / avgMagnitude;
}

function computeStripeScore(frame) {
  const rowMeans = [];
  const colMeans = [];
  const { faceBox } = frame;
  const startX = Math.max(0, Math.floor(faceBox.minX));
  const endX = Math.min(frame.width, Math.ceil(faceBox.maxX));
  const startY = Math.max(0, Math.floor(faceBox.minY));
  const endY = Math.min(frame.height, Math.ceil(faceBox.maxY));

  for (let y = startY; y < endY; y += 1) {
    let sum = 0;
    let count = 0;
    for (let x = startX; x < endX; x += 1) {
      sum += frame.gray[y * frame.width + x];
      count += 1;
    }
    if (count) rowMeans.push(sum / count);
  }

  for (let x = startX; x < endX; x += 1) {
    let sum = 0;
    let count = 0;
    for (let y = startY; y < endY; y += 1) {
      sum += frame.gray[y * frame.width + x];
      count += 1;
    }
    if (count) colMeans.push(sum / count);
  }

  return 0.5 * variance(rowMeans) + 0.5 * variance(colMeans);
}

function computeMoireScore(frame) {
  const { faceBox, gray, width } = frame;
  let gxSum = 0;
  let gySum = 0;
  let count = 0;
  const startX = Math.max(1, Math.floor(faceBox.minX));
  const endX = Math.min(frame.width - 1, Math.ceil(faceBox.maxX));
  const startY = Math.max(1, Math.floor(faceBox.minY));
  const endY = Math.min(frame.height - 1, Math.ceil(faceBox.maxY));

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const topLeft = gray[(y - 1) * width + (x - 1)];
      const top = gray[(y - 1) * width + x];
      const topRight = gray[(y - 1) * width + (x + 1)];
      const left = gray[y * width + (x - 1)];
      const right = gray[y * width + (x + 1)];
      const bottomLeft = gray[(y + 1) * width + (x - 1)];
      const bottom = gray[(y + 1) * width + x];
      const bottomRight = gray[(y + 1) * width + (x + 1)];

      const gx = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gy = topLeft + 2 * top + topRight - bottomLeft - 2 * bottom - bottomRight;
      gxSum += Math.abs(gx);
      gySum += Math.abs(gy);
      count += 1;
    }
  }

  if (count === 0) return 0;
  const gxMean = gxSum / count;
  const gyMean = gySum / count;
  return Math.abs(gxMean - gyMean) / (gxMean + gyMean + 1e-6);
}

export function summarizeAntiReplay(frames, selectedFrame) {
  if (!frames.length || !selectedFrame) {
    return {
      motionCorr: 0,
      flickerPeakRatio: 0,
      stripeScore: 0,
      moireScore: 0,
    };
  }

  const faceMotionSeries = [];
  const outerMotionSeries = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const previousCenter = boxCenter(previous.faceBox);
    const currentCenter = boxCenter(current.faceBox);
    faceMotionSeries.push(Math.hypot(currentCenter.x - previousCenter.x, currentCenter.y - previousCenter.y));
    outerMotionSeries.push(sampleOuterMotion(current, previous));
  }

  return {
    motionCorr: Number(pearsonCorrelation(faceMotionSeries, outerMotionSeries).toFixed(3)),
    flickerPeakRatio: Number(computeFlickerPeakRatio(frames).toFixed(3)),
    stripeScore: Number(computeStripeScore(selectedFrame).toFixed(3)),
    moireScore: Number(computeMoireScore(selectedFrame).toFixed(3)),
  };
}
