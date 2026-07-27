import type { Lut3D } from "./lut";

export const MIN_REFERENCE_IMAGES = 12;
export const RECOMMENDED_REFERENCE_IMAGES = 24;

const HUE_BINS = 24;
const LIGHT_BINS = 8;
const HISTOGRAM_BINS = 256;
const CHROMA_BINS = 160;
const MAX_ANALYSIS_EDGE = 720;
const TARGET_SAMPLES_PER_IMAGE = 42000;

type Lab = {
  L: number;
  a: number;
  b: number;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

export type TrainingMetrics = {
  imageCount: number;
  analyzedImages: number;
  sampledPixels: number;
  confidence: number;
  hueCoverage: number;
  toneCoverage: number;
  neutralCoverage: number;
  saturation: number;
  contrast: number;
  separation: number;
  gradation: number;
  spectralBalance: [number, number, number];
  blackPoint: number;
  midpoint: number;
  whitePoint: number;
  warnings: string[];
};

export type LutTrainingResult = {
  lut: Lut3D;
  metrics: TrainingMetrics;
  toneCurve: number[];
  hueResponse: number[];
  saturationResponse: number[];
  failedFiles: string[];
};

export type TrainingProgress = {
  completed: number;
  total: number;
  phase: "decode" | "solve" | "cube";
  fileName?: string;
};

type TrainingAccumulator = {
  sampledPixels: number;
  luminanceHistogram: Float64Array;
  redHistogram: Float64Array;
  greenHistogram: Float64Array;
  blueHistogram: Float64Array;
  chromaHistogram: Float64Array;
  hueCounts: Float64Array;
  hueChroma: Float64Array;
  hueSin: Float64Array;
  hueCos: Float64Array;
  lightCounts: Float64Array;
  neutralCounts: Float64Array;
  neutralA: Float64Array;
  neutralB: Float64Array;
  sumL: number;
  sumL2: number;
  sumChroma: number;
  sumChroma2: number;
  sumA: number;
  sumB: number;
  sumA2: number;
  sumB2: number;
  sumAB: number;
};

const PERCENTILES = [0.01, 0.05, 0.15, 0.25, 0.5, 0.75, 0.85, 0.95, 0.99];
const NATURAL_TONE_PRIOR = [0.012, 0.052, 0.145, 0.255, 0.47, 0.695, 0.82, 0.94, 0.985];

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
    ? 12.92 * safe
    : 1.055 * Math.pow(safe, 1 / 2.4) - 0.055;
}

function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const lRoot = Math.cbrt(Math.max(0, l));
  const mRoot = Math.cbrt(Math.max(0, m));
  const sRoot = Math.cbrt(Math.max(0, s));

  return {
    L: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabToRgb(L: number, a: number, b: number): Rgb {
  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function createAccumulator(): TrainingAccumulator {
  return {
    sampledPixels: 0,
    luminanceHistogram: new Float64Array(HISTOGRAM_BINS),
    redHistogram: new Float64Array(HISTOGRAM_BINS),
    greenHistogram: new Float64Array(HISTOGRAM_BINS),
    blueHistogram: new Float64Array(HISTOGRAM_BINS),
    chromaHistogram: new Float64Array(CHROMA_BINS),
    hueCounts: new Float64Array(HUE_BINS),
    hueChroma: new Float64Array(HUE_BINS),
    hueSin: new Float64Array(HUE_BINS),
    hueCos: new Float64Array(HUE_BINS),
    lightCounts: new Float64Array(LIGHT_BINS),
    neutralCounts: new Float64Array(LIGHT_BINS),
    neutralA: new Float64Array(LIGHT_BINS),
    neutralB: new Float64Array(LIGHT_BINS),
    sumL: 0,
    sumL2: 0,
    sumChroma: 0,
    sumChroma2: 0,
    sumA: 0,
    sumB: 0,
    sumA2: 0,
    sumB2: 0,
    sumAB: 0,
  };
}

function histogramQuantile(histogram: Float64Array, percentile: number) {
  let total = 0;
  for (const value of histogram) total += value;
  if (!total) return percentile;
  const target = total * percentile;
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) {
      return (index + 0.5) / histogram.length;
    }
  }
  return 1;
}

function interpolateCurve(x: number, xs: number[], ys: number[]) {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let upper = 1;
  while (upper < xs.length && xs[upper] < x) upper += 1;
  const lower = upper - 1;
  const amount = (x - xs[lower]) / Math.max(0.000001, xs[upper] - xs[lower]);
  const eased = amount * amount * (3 - 2 * amount);
  return ys[lower] + (ys[upper] - ys[lower]) * eased;
}

function smoothCircular(values: number[], passes = 2) {
  let current = [...values];
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((value, index) => {
      const previous = current[(index - 1 + current.length) % current.length];
      const next = current[(index + 1) % current.length];
      return previous * 0.25 + value * 0.5 + next * 0.25;
    });
  }
  return current;
}

function circularSample(values: number[], normalizedHue: number) {
  const scaled = ((normalizedHue % 1) + 1) % 1 * values.length;
  const lower = Math.floor(scaled) % values.length;
  const upper = (lower + 1) % values.length;
  const amount = scaled - Math.floor(scaled);
  return values[lower] + (values[upper] - values[lower]) * amount;
}

function linearSample(values: number[], normalizedValue: number) {
  const scaled = clamp(normalizedValue) * (values.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(values.length - 1, lower + 1);
  const amount = scaled - lower;
  return values[lower] + (values[upper] - values[lower]) * amount;
}

async function decodeImage(file: File) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取 ${file.name}`));
    };
    image.src = url;
  });
}

function getDecodedDimensions(image: ImageBitmap | HTMLImageElement) {
  if (image instanceof ImageBitmap) {
    return { width: image.width, height: image.height };
  }
  return { width: image.naturalWidth, height: image.naturalHeight };
}

function closeDecodedImage(image: ImageBitmap | HTMLImageElement) {
  if (image instanceof ImageBitmap) image.close();
}

async function analyzeFile(file: File, accumulator: TrainingAccumulator) {
  const image = await decodeImage(file);
  try {
    const dimensions = getDecodedDimensions(image);
    const ratio = Math.min(
      1,
      MAX_ANALYSIS_EDGE / Math.max(dimensions.width, dimensions.height),
    );
    const width = Math.max(1, Math.round(dimensions.width * ratio));
    const height = Math.max(1, Math.round(dimensions.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
      colorSpace: "srgb",
    });
    if (!context) throw new Error("浏览器无法创建色彩分析画布");
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const pixelCount = width * height;
    const stridePixels = Math.max(1, Math.floor(pixelCount / TARGET_SAMPLES_PER_IMAGE));

    for (let pixel = 0; pixel < pixelCount; pixel += stridePixels) {
      const offset = pixel * 4;
      if (data[offset + 3] < 128) continue;
      const r = data[offset] / 255;
      const g = data[offset + 1] / 255;
      const b = data[offset + 2] / 255;
      const lab = rgbToOklab(r, g, b);
      const L = clamp(lab.L);
      const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
      const angle = Math.atan2(lab.b, lab.a);
      const hue = ((angle / (Math.PI * 2)) + 1) % 1;
      const lightBin = Math.min(LIGHT_BINS - 1, Math.floor(L * LIGHT_BINS));

      accumulator.sampledPixels += 1;
      accumulator.luminanceHistogram[
        Math.min(HISTOGRAM_BINS - 1, Math.floor(L * HISTOGRAM_BINS))
      ] += 1;
      accumulator.redHistogram[Math.min(255, Math.floor(r * 256))] += 1;
      accumulator.greenHistogram[Math.min(255, Math.floor(g * 256))] += 1;
      accumulator.blueHistogram[Math.min(255, Math.floor(b * 256))] += 1;
      accumulator.chromaHistogram[
        Math.min(CHROMA_BINS - 1, Math.floor((chroma / 0.4) * CHROMA_BINS))
      ] += 1;
      accumulator.lightCounts[lightBin] += 1;
      accumulator.sumL += L;
      accumulator.sumL2 += L * L;
      accumulator.sumChroma += chroma;
      accumulator.sumChroma2 += chroma * chroma;
      accumulator.sumA += lab.a;
      accumulator.sumB += lab.b;
      accumulator.sumA2 += lab.a * lab.a;
      accumulator.sumB2 += lab.b * lab.b;
      accumulator.sumAB += lab.a * lab.b;

      if (chroma < 0.035 && L > 0.08 && L < 0.96) {
        accumulator.neutralCounts[lightBin] += 1;
        accumulator.neutralA[lightBin] += lab.a;
        accumulator.neutralB[lightBin] += lab.b;
      }

      if (chroma > 0.018 && L > 0.035 && L < 0.985) {
        const hueBin = Math.min(HUE_BINS - 1, Math.floor(hue * HUE_BINS));
        const weight = Math.min(0.22, chroma) / 0.22;
        accumulator.hueCounts[hueBin] += 1;
        accumulator.hueChroma[hueBin] += chroma;
        accumulator.hueSin[hueBin] += Math.sin(angle) * weight;
        accumulator.hueCos[hueBin] += Math.cos(angle) * weight;
      }
    }
  } finally {
    closeDecodedImage(image);
  }
}

function solveProfile(
  accumulator: TrainingAccumulator,
  imageCount: number,
  analyzedImages: number,
  failedFiles: string[],
) {
  const sampledPixels = Math.max(1, accumulator.sampledPixels);
  const observedTone = PERCENTILES.map((percentile) =>
    histogramQuantile(accumulator.luminanceHistogram, percentile),
  );
  const imageConfidence = clamp((analyzedImages - MIN_REFERENCE_IMAGES + 1) / 24);
  const toneSpan = observedTone[7] - observedTone[1];
  const toneCoverage = clamp((toneSpan - 0.42) / 0.45);
  const toneStrength = 0.48 + 0.22 * imageConfidence + 0.12 * toneCoverage;
  const solvedTone = observedTone.map((value, index) => {
    const prior = NATURAL_TONE_PRIOR[index];
    const maximumShift = index <= 1 || index >= 7 ? 0.105 : 0.16;
    return clamp(
      prior + clamp(value - prior, -maximumShift, maximumShift) * toneStrength,
    );
  });
  solvedTone[0] = Math.min(solvedTone[0], 0.035);
  solvedTone[solvedTone.length - 1] = Math.max(
    solvedTone[solvedTone.length - 1],
    0.965,
  );
  for (let index = 1; index < solvedTone.length; index += 1) {
    solvedTone[index] = Math.max(solvedTone[index], solvedTone[index - 1] + 0.006);
  }

  const toneCurve = Array.from({ length: 256 }, (_, index) =>
    interpolateCurve(index / 255, [0, ...NATURAL_TONE_PRIOR, 1], [0, ...solvedTone, 1]),
  );

  const chromaMedian = histogramQuantile(accumulator.chromaHistogram, 0.5) * 0.4;
  const chromaHigh = histogramQuantile(accumulator.chromaHistogram, 0.85) * 0.4;
  const meanChroma = accumulator.sumChroma / sampledPixels;
  const targetSaturation = clamp(
    1 + (chromaMedian - 0.071) * 3.1 + (chromaHigh - 0.165) * 0.8,
    0.7,
    1.34,
  );

  const hueThreshold = sampledPixels / HUE_BINS / 45;
  const coveredHueBins = Array.from(accumulator.hueCounts).filter(
    (count) => count >= hueThreshold,
  ).length;
  const hueCoverage = coveredHueBins / HUE_BINS;

  const rawSaturationResponse = Array.from({ length: HUE_BINS }, (_, index) => {
    const count = accumulator.hueCounts[index];
    if (count < hueThreshold * 0.3) return targetSaturation;
    const localChroma = accumulator.hueChroma[index] / Math.max(1, count);
    const relative = clamp(localChroma / Math.max(0.03, meanChroma), 0.55, 1.7);
    const localCharacter = 1 + (relative - 1) * 0.23 * hueCoverage;
    return clamp(targetSaturation * localCharacter, 0.62, 1.45);
  });
  const saturationResponse = smoothCircular(rawSaturationResponse, 3);

  const rawHueResponse = Array.from({ length: HUE_BINS }, (_, index) => {
    const count = accumulator.hueCounts[index];
    if (count < hueThreshold) return 0;
    const measured =
      ((Math.atan2(accumulator.hueSin[index], accumulator.hueCos[index]) /
        (Math.PI * 2)) +
        1) %
      1;
    const center = (index + 0.5) / HUE_BINS;
    let delta = measured - center;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    const binLimit = 0.5 / HUE_BINS;
    const centered = clamp(delta, -binLimit, binLimit);
    return centered * 0.34 * hueCoverage;
  });
  const hueResponse = smoothCircular(rawHueResponse, 3);

  const neutralTotal = Array.from(accumulator.neutralCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const neutralCoverage = clamp(neutralTotal / (sampledPixels * 0.075));
  const castA = Array.from({ length: LIGHT_BINS }, (_, index) => {
    const count = accumulator.neutralCounts[index];
    if (count < 20) return 0;
    return clamp(accumulator.neutralA[index] / count, -0.025, 0.025) * 0.7;
  });
  const castB = Array.from({ length: LIGHT_BINS }, (_, index) => {
    const count = accumulator.neutralCounts[index];
    if (count < 20) return 0;
    return clamp(accumulator.neutralB[index] / count, -0.025, 0.025) * 0.7;
  });

  const meanA = accumulator.sumA / sampledPixels;
  const meanB = accumulator.sumB / sampledPixels;
  const varianceA = Math.max(0, accumulator.sumA2 / sampledPixels - meanA * meanA);
  const varianceB = Math.max(0, accumulator.sumB2 / sampledPixels - meanB * meanB);
  const covarianceAB = accumulator.sumAB / sampledPixels - meanA * meanB;
  const trace = varianceA + varianceB;
  const determinant = Math.max(0, varianceA * varianceB - covarianceAB * covarianceAB);
  const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * determinant));
  const eigenHigh = (trace + discriminant) / 2;
  const eigenLow = Math.max(0.000001, (trace - discriminant) / 2);
  const separationRatio = Math.sqrt(eigenHigh / eigenLow);
  const separation = clamp(52 + (separationRatio - 1.65) * 22, 20, 96);
  const separationCurve = clamp(1 + (separation - 55) / 420, 0.9, 1.12);

  const meanL = accumulator.sumL / sampledPixels;
  const varianceL = Math.max(0, accumulator.sumL2 / sampledPixels - meanL * meanL);
  const contrast = clamp(32 + Math.sqrt(varianceL) * 245, 20, 98);
  const saturation = clamp(22 + meanChroma * 430, 10, 98);
  let luminanceEntropy = 0;
  for (const count of accumulator.luminanceHistogram) {
    if (!count) continue;
    const probability = count / sampledPixels;
    luminanceEntropy -= probability * Math.log(probability);
  }
  luminanceEntropy /= Math.log(HISTOGRAM_BINS);
  const gradation = clamp(18 + luminanceEntropy * 88, 20, 98);

  const redMean = histogramMean(accumulator.redHistogram);
  const greenMean = histogramMean(accumulator.greenHistogram);
  const blueMean = histogramMean(accumulator.blueHistogram);
  const rgbMean = Math.max(0.000001, (redMean + greenMean + blueMean) / 3);
  const spectralBalance: [number, number, number] = [
    redMean / rgbMean,
    greenMean / rgbMean,
    blueMean / rgbMean,
  ];

  const confidence = Math.round(
    clamp(
      0.33 * clamp(analyzedImages / RECOMMENDED_REFERENCE_IMAGES) +
        0.32 * hueCoverage +
        0.22 * toneCoverage +
        0.13 * neutralCoverage,
    ) * 100,
  );

  const warnings: string[] = [];
  if (hueCoverage < 0.58) warnings.push("色相覆盖偏窄，建议补充天空、植物、肤色与高饱和物体");
  if (toneCoverage < 0.55) warnings.push("阶调跨度不足，建议补充明亮场景和暗光场景");
  if (neutralCoverage < 0.42) warnings.push("中性色样本较少，白平衡与灰阶判断会更保守");
  if (analyzedImages < RECOMMENDED_REFERENCE_IMAGES) {
    warnings.push(`已达到最低要求；增加到 ${RECOMMENDED_REFERENCE_IMAGES} 张以上会更稳定`);
  }
  if (failedFiles.length) warnings.push(`${failedFiles.length} 张照片无法读取，已自动跳过`);

  return {
    solvedTone,
    toneCurve,
    hueResponse,
    saturationResponse,
    castA,
    castB,
    separationCurve,
    metrics: {
      imageCount,
      analyzedImages,
      sampledPixels: accumulator.sampledPixels,
      confidence,
      hueCoverage: Math.round(hueCoverage * 100),
      toneCoverage: Math.round(toneCoverage * 100),
      neutralCoverage: Math.round(neutralCoverage * 100),
      saturation: Math.round(saturation),
      contrast: Math.round(contrast),
      separation: Math.round(separation),
      gradation: Math.round(gradation),
      spectralBalance,
      blackPoint: solvedTone[1],
      midpoint: solvedTone[4],
      whitePoint: solvedTone[7],
      warnings,
    } satisfies TrainingMetrics,
  };
}

function histogramMean(histogram: Float64Array) {
  let total = 0;
  let weighted = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    total += histogram[index];
    weighted += histogram[index] * ((index + 0.5) / histogram.length);
  }
  return weighted / Math.max(1, total);
}

function fitGamut(L: number, a: number, b: number) {
  let chromaScale = 1;
  let rgb = oklabToRgb(L, a, b);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    if (
      rgb.r >= 0 &&
      rgb.r <= 1 &&
      rgb.g >= 0 &&
      rgb.g <= 1 &&
      rgb.b >= 0 &&
      rgb.b <= 1
    ) {
      return rgb;
    }
    chromaScale *= 0.86;
    rgb = oklabToRgb(L, a * chromaScale, b * chromaScale);
  }
  return {
    r: clamp(rgb.r),
    g: clamp(rgb.g),
    b: clamp(rgb.b),
  };
}

function buildLut(
  title: string,
  solution: ReturnType<typeof solveProfile>,
  onProgress?: (progress: TrainingProgress) => void,
) {
  const size = 33;
  const data = new Float32Array(size * size * size * 3);
  let offset = 0;

  for (let blueIndex = 0; blueIndex < size; blueIndex += 1) {
    onProgress?.({
      phase: "cube",
      completed: blueIndex,
      total: size,
    });
    const sourceB = blueIndex / (size - 1);
    for (let greenIndex = 0; greenIndex < size; greenIndex += 1) {
      const sourceG = greenIndex / (size - 1);
      for (let redIndex = 0; redIndex < size; redIndex += 1) {
        const sourceR = redIndex / (size - 1);
        const lab = rgbToOklab(sourceR, sourceG, sourceB);
        const sourceChroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
        const sourceHue =
          ((Math.atan2(lab.b, lab.a) / (Math.PI * 2)) + 1) % 1;
        const mappedL = linearSample(solution.toneCurve, lab.L);
        const hueShift = circularSample(solution.hueResponse, sourceHue);
        const mappedHue = (sourceHue + hueShift + 1) % 1;
        const saturationScale = circularSample(
          solution.saturationResponse,
          sourceHue,
        );
        const chromaShape =
          1 + (solution.separationCurve - 1) * clamp(sourceChroma / 0.18);
        const mappedChroma = sourceChroma * saturationScale * chromaShape;
        const angle = mappedHue * Math.PI * 2;
        const neutralProtection = clamp(sourceChroma / 0.055);
        const castWeight = 1 - neutralProtection * 0.35;
        const mappedA =
          Math.cos(angle) * mappedChroma +
          linearSample(solution.castA, mappedL) * castWeight;
        const mappedB =
          Math.sin(angle) * mappedChroma +
          linearSample(solution.castB, mappedL) * castWeight;
        const rgb = fitGamut(mappedL, mappedA, mappedB);

        data[offset] = rgb.r;
        data[offset + 1] = rgb.g;
        data[offset + 2] = rgb.b;
        offset += 3;
      }
    }
  }

  onProgress?.({ phase: "cube", completed: size, total: size });
  return {
    title,
    size,
    data,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  } satisfies Lut3D;
}

export async function trainReferenceLut(
  files: File[],
  title: string,
  onProgress?: (progress: TrainingProgress) => void,
  signal?: AbortSignal,
): Promise<LutTrainingResult> {
  if (files.length < MIN_REFERENCE_IMAGES) {
    throw new Error(`至少需要 ${MIN_REFERENCE_IMAGES} 张参考照片`);
  }

  const accumulator = createAccumulator();
  const failedFiles: string[] = [];
  let analyzedImages = 0;

  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) throw new DOMException("训练已取消", "AbortError");
    const file = files[index];
    onProgress?.({
      phase: "decode",
      completed: index,
      total: files.length,
      fileName: file.name,
    });
    try {
      await analyzeFile(file, accumulator);
      analyzedImages += 1;
    } catch {
      failedFiles.push(file.name);
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  if (analyzedImages < MIN_REFERENCE_IMAGES) {
    throw new Error(
      `成功读取的照片只有 ${analyzedImages} 张，仍需至少 ${MIN_REFERENCE_IMAGES} 张`,
    );
  }

  onProgress?.({ phase: "solve", completed: 0, total: 1 });
  const solution = solveProfile(
    accumulator,
    files.length,
    analyzedImages,
    failedFiles,
  );
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  onProgress?.({ phase: "solve", completed: 1, total: 1 });
  const lut = buildLut(title || "LumaGrade Custom Look", solution, onProgress);

  return {
    lut,
    metrics: solution.metrics,
    toneCurve: solution.toneCurve,
    hueResponse: solution.hueResponse,
    saturationResponse: solution.saturationResponse,
    failedFiles,
  };
}

export function serializeCube(lut: Lut3D) {
  const lines = [
    `TITLE "${lut.title.replace(/"/g, "'")}"`,
    `# Generated by LumaGrade Reference LUT Lab`,
    `# Unsupervised reference-photo color model`,
    `LUT_3D_SIZE ${lut.size}`,
    `DOMAIN_MIN ${lut.domainMin.join(" ")}`,
    `DOMAIN_MAX ${lut.domainMax.join(" ")}`,
  ];
  for (let offset = 0; offset < lut.data.length; offset += 3) {
    lines.push(
      `${lut.data[offset].toFixed(7)} ${lut.data[offset + 1].toFixed(7)} ${lut.data[
        offset + 2
      ].toFixed(7)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
