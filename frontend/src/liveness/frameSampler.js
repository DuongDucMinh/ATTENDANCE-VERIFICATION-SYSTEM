import { FRAME_CONFIG } from "./constants";
import { clampBox } from "./geometry";

function extractGray(imageData) {
  const gray = new Float32Array(imageData.width * imageData.height);
  for (let index = 0; index < gray.length; index += 1) {
    const base = index * 4;
    const r = imageData.data[base];
    const g = imageData.data[base + 1];
    const b = imageData.data[base + 2];
    gray[index] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

function scaleBox(box, sourceWidth, sourceHeight, width, height) {
  return clampBox(
    {
      minX: (box.minX / sourceWidth) * width,
      minY: (box.minY / sourceHeight) * height,
      maxX: (box.maxX / sourceWidth) * width,
      maxY: (box.maxY / sourceHeight) * height,
    },
    width,
    height,
  );
}

function computeCropRect(sourceImage, sourceBox) {
  const sourceWidth = sourceImage.videoWidth || sourceImage.naturalWidth || sourceImage.width;
  const sourceHeight = sourceImage.videoHeight || sourceImage.naturalHeight || sourceImage.height;
  const faceCenterX = sourceBox.minX + sourceBox.width / 2;
  const faceCenterY = sourceBox.minY + sourceBox.height / 2;
  const cropSide = Math.max(sourceBox.width * 1.9, sourceBox.height * 2.05, 220);
  let cropX = Math.round(faceCenterX - cropSide / 2);
  let cropY = Math.round(faceCenterY - cropSide / 2 - sourceBox.height * 0.08);
  let cropWidth = Math.round(cropSide);
  let cropHeight = Math.round(cropSide);
  cropX = Math.max(cropX, 0);
  cropY = Math.max(cropY, 0);
  cropWidth = Math.min(cropWidth, sourceWidth - cropX);
  cropHeight = Math.min(cropHeight, sourceHeight - cropY);
  const size = Math.max(1, Math.min(cropWidth, cropHeight));
  return { cropX, cropY, size };
}

export function dataUrlToBlob(dataUrl) {
  const [meta, encoded] = dataUrl.split(",");
  const mimeMatch = /data:(.*?);base64/.exec(meta);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export function createFrameSampler(options = {}) {
  const sampleSize = options.sampleSize ?? FRAME_CONFIG.sampleSize;
  const maxFrames = options.maxFrames ?? FRAME_CONFIG.maxBufferedFrames;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const cropCanvas = document.createElement("canvas");
  const cropCtx = cropCanvas.getContext("2d");
  const frames = [];

  return {
    clear() {
      frames.length = 0;
    },
    size() {
      return frames.length;
    },
    getFrames() {
      return [...frames];
    },
    push({ sourceImage, sourceBox, centerBox, challengeLabel, frameIndex, timestamp, pose, mouthOpenRatio }) {
      const sourceWidth = sourceImage.videoWidth || sourceImage.naturalWidth || sourceImage.width;
      const sourceHeight = sourceImage.videoHeight || sourceImage.naturalHeight || sourceImage.height;
      ctx.drawImage(sourceImage, 0, 0, sampleSize, sampleSize);
      const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
      const gray = extractGray(imageData);

      const cropRect = computeCropRect(sourceImage, sourceBox);
      cropCanvas.width = cropRect.size;
      cropCanvas.height = cropRect.size;
      cropCtx.drawImage(sourceImage, cropRect.cropX, cropRect.cropY, cropRect.size, cropRect.size, 0, 0, cropRect.size, cropRect.size);

      frames.push({
        width: sampleSize,
        height: sampleSize,
        gray,
        faceBox: scaleBox(sourceBox, sourceWidth, sourceHeight, sampleSize, sampleSize),
        centerBox: scaleBox(centerBox, sourceWidth, sourceHeight, sampleSize, sampleSize),
        challengeLabel,
        frameIndex,
        timestamp,
        pose,
        mouthOpenRatio,
        cropDataUrl: cropCanvas.toDataURL("image/jpeg", 0.92),
      });

      if (frames.length > maxFrames) {
        frames.shift();
      }
    },
  };
}
