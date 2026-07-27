import { applyLutToRgb, type Lut3D } from "./lut";

export type LutLayer = {
  lut: Lut3D;
  intensity: number;
};

export type AdaptiveProfile = {
  exposureEv: number;
  whiteBalance: [number, number, number];
  temperature: number;
  tint: number;
  contrast: number;
  shadowLift: number;
  highlightCompression: number;
  postExposureEv: number;
  postBlackLift: number;
  postHighlightCompression: number;
  confidence: number;
  neutralConfidence: number;
  sourceMedian: number;
  sourceBlack: number;
  sourceWhite: number;
  outputMedianBefore: number;
  outputMedianAfter: number;
  clippedBefore: number;
  clippedAfter: number;
};

type Rgb = [number, number, number];

const HISTOGRAM_BINS = 256;
const MAX_SAMPLES = 72000;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function srgbToLinear(value: number) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number) {
  const safe = Math.max(0, value);
  return safe <= 0.0031308
    ? safe * 12.92
    : 1.055 * Math.pow(safe, 1 / 2.4) - 0.055;
}

function luma(r: number, g: number, b: number) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function histogramQuantile(histogram: Float64Array, percentile: number) {
  let total = 0;
  for (const value of histogram) total += value;
  if (!total) return percentile;
  const target = total * percentile;
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) return (index + 0.5) / histogram.length;
  }
  return 1;
}

function addHistogramValue(histogram: Float64Array, value: number) {
  histogram[
    Math.min(histogram.length - 1, Math.max(0, Math.floor(value * histogram.length)))
  ] += 1;
}

function transformInputRgb(rgb: Rgb, profile: AdaptiveProfile): Rgb {
  const exposure = Math.pow(2, profile.exposureEv);
  let r = linearToSrgb(
    srgbToLinear(rgb[0]) * exposure * profile.whiteBalance[0],
  );
  let g = linearToSrgb(
    srgbToLinear(rgb[1]) * exposure * profile.whiteBalance[1],
  );
  let b = linearToSrgb(
    srgbToLinear(rgb[2]) * exposure * profile.whiteBalance[2],
  );
  const sourceLuma = Math.max(0.00001, luma(r, g, b));
  let mappedLuma = 0.5 + (sourceLuma - 0.5) * profile.contrast;
  mappedLuma += profile.shadowLift * Math.pow(1 - clamp(mappedLuma), 2);
  mappedLuma -=
    profile.highlightCompression *
    smoothstep(0.58, 1, mappedLuma) *
    Math.max(0, mappedLuma - 0.52);
  mappedLuma = clamp(mappedLuma);
  const scale = mappedLuma / sourceLuma;
  r = clamp(r * scale);
  g = clamp(g * scale);
  b = clamp(b * scale);
  return [r, g, b];
}

function transformOutputRgb(rgb: Rgb, profile: AdaptiveProfile): Rgb {
  const exposure = Math.pow(2, profile.postExposureEv);
  let r = linearToSrgb(srgbToLinear(rgb[0]) * exposure);
  let g = linearToSrgb(srgbToLinear(rgb[1]) * exposure);
  let b = linearToSrgb(srgbToLinear(rgb[2]) * exposure);
  const sourceLuma = Math.max(0.00001, luma(r, g, b));
  let mappedLuma =
    sourceLuma + profile.postBlackLift * Math.pow(1 - clamp(sourceLuma), 2);
  mappedLuma -=
    profile.postHighlightCompression *
    smoothstep(0.62, 1, sourceLuma) *
    Math.max(0, sourceLuma - 0.56);
  mappedLuma = clamp(mappedLuma);
  const scale = mappedLuma / sourceLuma;
  r = clamp(r * scale);
  g = clamp(g * scale);
  b = clamp(b * scale);
  return [r, g, b];
}

function applyLayers(rgb: Rgb, layers: LutLayer[]) {
  return layers.reduce<Rgb>(
    (current, layer) =>
      applyLutToRgb(
        layer.lut,
        current[0],
        current[1],
        current[2],
        layer.intensity,
      ),
    rgb,
  );
}

function collectSamples(imageData: ImageData) {
  const pixels = imageData.data;
  const pixelCount = pixels.length / 4;
  const stride = Math.max(1, Math.floor(pixelCount / MAX_SAMPLES));
  const sampleCount = Math.ceil(pixelCount / stride);
  const samples = new Float32Array(sampleCount * 3);
  let sampleOffset = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    if (pixels[offset + 3] < 128) continue;
    samples[sampleOffset] = pixels[offset] / 255;
    samples[sampleOffset + 1] = pixels[offset + 1] / 255;
    samples[sampleOffset + 2] = pixels[offset + 2] / 255;
    sampleOffset += 3;
  }

  return samples.subarray(0, sampleOffset);
}

function blankProfile(): AdaptiveProfile {
  return {
    exposureEv: 0,
    whiteBalance: [1, 1, 1],
    temperature: 0,
    tint: 0,
    contrast: 1,
    shadowLift: 0,
    highlightCompression: 0,
    postExposureEv: 0,
    postBlackLift: 0,
    postHighlightCompression: 0,
    confidence: 0,
    neutralConfidence: 0,
    sourceMedian: 0.5,
    sourceBlack: 0.05,
    sourceWhite: 0.95,
    outputMedianBefore: 0.5,
    outputMedianAfter: 0.5,
    clippedBefore: 0,
    clippedAfter: 0,
  };
}

function estimateWhiteBalance(samples: Float32Array) {
  let neutralR = 0;
  let neutralG = 0;
  let neutralB = 0;
  let neutralWeight = 0;
  let grayR = 0;
  let grayG = 0;
  let grayB = 0;
  let grayWeight = 0;
  const pixelCount = samples.length / 3;

  for (let offset = 0; offset < samples.length; offset += 3) {
    const r = samples[offset];
    const g = samples[offset + 1];
    const b = samples[offset + 2];
    const brightness = luma(r, g, b);
    if (brightness < 0.06 || brightness > 0.97) continue;
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const chromaRatio = (maximum - minimum) / Math.max(0.035, maximum);
    const middleWeight = 1 - Math.abs(brightness - 0.5) * 0.85;

    if (chromaRatio < 0.16) {
      const weight = Math.pow(1 - chromaRatio / 0.16, 2) * middleWeight;
      neutralR += srgbToLinear(r) * weight;
      neutralG += srgbToLinear(g) * weight;
      neutralB += srgbToLinear(b) * weight;
      neutralWeight += weight;
    }

    const grayWorldWeight = Math.pow(brightness, 2.5) * (0.45 + middleWeight * 0.55);
    grayR += Math.pow(srgbToLinear(r), 6) * grayWorldWeight;
    grayG += Math.pow(srgbToLinear(g), 6) * grayWorldWeight;
    grayB += Math.pow(srgbToLinear(b), 6) * grayWorldWeight;
    grayWeight += grayWorldWeight;
  }

  const neutralRatio = neutralWeight / Math.max(1, pixelCount);
  const neutralConfidence = clamp(neutralRatio / 0.085);
  let channelR: number;
  let channelG: number;
  let channelB: number;
  let correctionStrength: number;

  if (neutralConfidence > 0.2) {
    channelR = neutralR / Math.max(0.000001, neutralWeight);
    channelG = neutralG / Math.max(0.000001, neutralWeight);
    channelB = neutralB / Math.max(0.000001, neutralWeight);
    correctionStrength = 0.42 + neutralConfidence * 0.34;
  } else {
    channelR = Math.pow(grayR / Math.max(0.000001, grayWeight), 1 / 6);
    channelG = Math.pow(grayG / Math.max(0.000001, grayWeight), 1 / 6);
    channelB = Math.pow(grayB / Math.max(0.000001, grayWeight), 1 / 6);
    correctionStrength = 0.16;
  }

  const target = (channelR + channelG + channelB) / 3;
  const rawR = clamp(target / Math.max(0.0001, channelR), 0.78, 1.24);
  const rawG = clamp(target / Math.max(0.0001, channelG), 0.78, 1.24);
  const rawB = clamp(target / Math.max(0.0001, channelB), 0.78, 1.24);
  const whiteBalance: [number, number, number] = [
    1 + (rawR - 1) * correctionStrength,
    1 + (rawG - 1) * correctionStrength,
    1 + (rawB - 1) * correctionStrength,
  ];
  const temperature = clamp(
    (whiteBalance[0] - whiteBalance[2]) * 210,
    -100,
    100,
  );
  const tint = clamp(
    ((whiteBalance[0] + whiteBalance[2]) / 2 - whiteBalance[1]) * 230,
    -100,
    100,
  );

  return {
    whiteBalance,
    neutralConfidence,
    temperature: Math.round(temperature),
    tint: Math.round(tint),
  };
}

function evaluateOutput(
  samples: Float32Array,
  profile: AdaptiveProfile,
  layers: LutLayer[],
  includeOutputSafety: boolean,
) {
  const histogram = new Float64Array(HISTOGRAM_BINS);
  let clipped = 0;
  let count = 0;

  for (let offset = 0; offset < samples.length; offset += 3) {
    let rgb = transformInputRgb(
      [samples[offset], samples[offset + 1], samples[offset + 2]],
      profile,
    );
    rgb = applyLayers(rgb, layers);
    if (includeOutputSafety) rgb = transformOutputRgb(rgb, profile);
    const outputLuma = luma(rgb[0], rgb[1], rgb[2]);
    addHistogramValue(histogram, outputLuma);
    if (
      rgb[0] <= 0.003 ||
      rgb[1] <= 0.003 ||
      rgb[2] <= 0.003 ||
      rgb[0] >= 0.997 ||
      rgb[1] >= 0.997 ||
      rgb[2] >= 0.997
    ) {
      clipped += 1;
    }
    count += 1;
  }

  return {
    median: histogramQuantile(histogram, 0.5),
    black: histogramQuantile(histogram, 0.01),
    white: histogramQuantile(histogram, 0.99),
    clipped: clipped / Math.max(1, count),
  };
}

export function analyzeAdaptiveProfile(
  imageData: ImageData,
  layers: LutLayer[],
): AdaptiveProfile {
  if (!layers.length || imageData.data.length < 16) return blankProfile();
  const samples = collectSamples(imageData);
  const inputHistogram = new Float64Array(HISTOGRAM_BINS);

  for (let offset = 0; offset < samples.length; offset += 3) {
    addHistogramValue(
      inputHistogram,
      luma(samples[offset], samples[offset + 1], samples[offset + 2]),
    );
  }

  const sourceBlack = histogramQuantile(inputHistogram, 0.05);
  const sourceMedian = histogramQuantile(inputHistogram, 0.5);
  const sourceWhite = histogramQuantile(inputHistogram, 0.95);
  const sourcePeak = histogramQuantile(inputHistogram, 0.995);
  const span = sourceWhite - sourceBlack;
  const lowKey = sourceMedian < 0.24 && sourceWhite < 0.68;
  const highKey = sourceMedian > 0.66 && sourceBlack > 0.18;
  const targetMedian = lowKey
    ? Math.max(sourceMedian, 0.285)
    : highKey
      ? Math.min(sourceMedian, 0.615)
      : clamp(0.415 + (sourceWhite - 0.82) * 0.13, 0.36, 0.49);
  const exposureStrength = lowKey || highKey ? 0.38 : 0.58;
  let exposureEv = clamp(
    Math.log2(targetMedian / Math.max(0.025, sourceMedian)) * exposureStrength,
    -0.9,
    0.9,
  );
  const predictedPeak = sourcePeak * Math.pow(2, exposureEv * 0.72);
  if (predictedPeak > 0.985) {
    exposureEv += Math.log2(0.985 / predictedPeak) * 0.78;
  }
  exposureEv = clamp(exposureEv, -0.9, 0.9);

  const whiteBalance = estimateWhiteBalance(samples);
  const contrast = clamp(1 + (0.72 - span) * 0.31, 0.88, 1.13);
  const shadowLift =
    sourceBlack < 0.045 && sourceMedian > 0.2
      ? clamp((0.045 - sourceBlack) * 1.15, 0, 0.045)
      : 0;
  const highlightCompression =
    sourcePeak > 0.91
      ? clamp((sourcePeak - 0.91) * 0.95, 0, 0.085)
      : 0;

  const profile: AdaptiveProfile = {
    ...blankProfile(),
    exposureEv,
    whiteBalance: whiteBalance.whiteBalance,
    temperature: whiteBalance.temperature,
    tint: whiteBalance.tint,
    contrast,
    shadowLift,
    highlightCompression,
    neutralConfidence: whiteBalance.neutralConfidence,
    sourceMedian,
    sourceBlack,
    sourceWhite,
  };

  const before = evaluateOutput(samples, profile, layers, false);
  const creativeDrift = before.median - targetMedian;
  if (Math.abs(creativeDrift) > 0.065) {
    profile.postExposureEv = clamp(
      Math.log2(targetMedian / Math.max(0.03, before.median)) * 0.36,
      -0.48,
      0.48,
    );
  }
  profile.postBlackLift =
    before.black < 0.012 || before.clipped > 0.06
      ? clamp(0.014 + (0.012 - before.black) * 0.75, 0, 0.032)
      : 0;
  profile.postHighlightCompression =
    before.white > 0.965 || before.clipped > 0.035
      ? clamp(
          (before.white - 0.95) * 0.75 + Math.max(0, before.clipped - 0.035) * 0.16,
          0,
          0.095,
        )
      : 0;

  const after = evaluateOutput(samples, profile, layers, true);
  profile.outputMedianBefore = before.median;
  profile.outputMedianAfter = after.median;
  profile.clippedBefore = before.clipped;
  profile.clippedAfter = after.clipped;
  const rangeConfidence = clamp((span - 0.38) / 0.45);
  const clippingImprovement =
    before.clipped > 0.01
      ? clamp((before.clipped - after.clipped) / before.clipped)
      : 1;
  profile.confidence = Math.round(
    clamp(
      0.45 +
        whiteBalance.neutralConfidence * 0.22 +
        rangeConfidence * 0.18 +
        clippingImprovement * 0.15,
    ) * 100,
  );
  return profile;
}

export function applyAdaptiveInput(
  imageData: ImageData,
  profile: AdaptiveProfile,
) {
  const pixels = imageData.data;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const rgb = transformInputRgb(
      [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255],
      profile,
    );
    pixels[offset] = Math.round(rgb[0] * 255);
    pixels[offset + 1] = Math.round(rgb[1] * 255);
    pixels[offset + 2] = Math.round(rgb[2] * 255);
  }
  return imageData;
}

export function applyAdaptiveOutput(
  imageData: ImageData,
  profile: AdaptiveProfile,
) {
  const pixels = imageData.data;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const rgb = transformOutputRgb(
      [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255],
      profile,
    );
    pixels[offset] = Math.round(rgb[0] * 255);
    pixels[offset + 1] = Math.round(rgb[1] * 255);
    pixels[offset + 2] = Math.round(rgb[2] * 255);
  }
  return imageData;
}
