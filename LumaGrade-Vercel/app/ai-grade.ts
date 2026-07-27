import type { AdjustmentValues } from "./image-adjustments";
import type { LutTrainingResult } from "./lut-trainer";

export type AiConfig = {
  enabled: boolean;
  model: string | null;
  searchModel?: string | null;
};

export type AiGradeAdvice = {
  exposureEv: number;
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  saturation: number;
  confidence: number;
  scene: string;
  rationale: string;
};

export type AiLutScanAdvice = {
  temperature: number;
  tint: number;
  saturation: number;
  contrast: number;
  shadows: number;
  highlights: number;
  redBias: number;
  greenBias: number;
  blueBias: number;
  confidence: number;
  coherence: number;
  rationale: string;
  warnings: string[];
};

export type OnlineReferenceSource = {
  title: string;
  url: string;
  domain: string;
};

export type OnlineReferenceTraits = {
  temperature: number;
  tint: number;
  saturation: number;
  contrast: number;
  shadows: number;
  highlights: number;
  redBias: number;
  greenBias: number;
  blueBias: number;
};

export type OnlineReference = {
  query: string;
  matchedReference: string;
  category: "camera" | "film" | "look" | "unknown";
  confidence: number;
  sourceQuality: number;
  traits: OnlineReferenceTraits;
  signature: {
    skinTone: string;
    greens: string;
    blues: string;
    reds: string;
    highlightRollOff: string;
    shadowColor: string;
    contrastCurve: string;
  };
  rationale: string;
  consensus: string[];
  limitations: string[];
  sources: OnlineReferenceSource[];
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function applyBoundedLutRefinement(
  source: Float32Array,
  traits: OnlineReferenceTraits,
  strength: number,
) {
  const data = new Float32Array(source);
  const warmth = clamp(traits.temperature, -25, 25) / 100;
  const tint = clamp(traits.tint, -25, 25) / 100;
  const contrast =
    1 + (clamp(traits.contrast, -25, 25) / 100) * strength;
  const saturation =
    1 + (clamp(traits.saturation, -25, 25) / 100) * strength;
  const redGain =
    1 +
    (warmth * 0.08 +
      tint * 0.025 +
      clamp(traits.redBias, -20, 20) / 1200) *
      strength;
  const greenGain =
    1 +
    (-tint * 0.06 + clamp(traits.greenBias, -20, 20) / 1200) *
      strength;
  const blueGain =
    1 +
    (-warmth * 0.08 +
      tint * 0.025 +
      clamp(traits.blueBias, -20, 20) / 1200) *
      strength;
  const shadow =
    (clamp(traits.shadows, -30, 30) / 100) * 0.12 * strength;
  const highlight =
    (clamp(traits.highlights, -30, 30) / 100) * 0.1 * strength;

  for (let offset = 0; offset < data.length; offset += 3) {
    let r = clamp(data[offset] * redGain);
    let g = clamp(data[offset + 1] * greenGain);
    let b = clamp(data[offset + 2] * blueGain);
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let mapped =
      0.5 +
      (luma - 0.5) * contrast +
      shadow * Math.pow(1 - luma, 2) +
      highlight * Math.pow(luma, 2);
    mapped = clamp(mapped);
    const scale = mapped / Math.max(0.00001, luma);
    r = clamp(r * scale);
    g = clamp(g * scale);
    b = clamp(b * scale);
    const adjustedLuma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    data[offset] = clamp(adjustedLuma + (r - adjustedLuma) * saturation);
    data[offset + 1] = clamp(
      adjustedLuma + (g - adjustedLuma) * saturation,
    );
    data[offset + 2] = clamp(
      adjustedLuma + (b - adjustedLuma) * saturation,
    );
  }

  return data;
}

export function aiGradeToAdjustments(
  advice: AiGradeAdvice,
): AdjustmentValues {
  return {
    exposure: Math.round(clamp(advice.exposureEv * 100, -60, 60)),
    contrast: Math.round(clamp(advice.contrast, -25, 25)),
    highlights: Math.round(clamp(advice.highlights, -40, 40)),
    shadows: Math.round(clamp(advice.shadows, -40, 40)),
    saturation: Math.round(clamp(advice.saturation, -25, 25)),
    temperature: Math.round(clamp(advice.temperature, -35, 35)),
    tint: Math.round(clamp(advice.tint, -35, 35)),
    fade: 0,
  };
}

export function refineLutWithAiScan(
  result: LutTrainingResult,
  advice: AiLutScanAdvice,
): LutTrainingResult {
  const confidence = clamp(advice.confidence / 100);
  const coherence = clamp(advice.coherence / 100);
  const strength = Math.min(0.28, confidence * coherence * 0.3);
  const data = applyBoundedLutRefinement(result.lut.data, advice, strength);

  const aiWarning = `AI 智能扫描已以 ${Math.round(
    strength * 100,
  )}% 权重参与模型求解：${advice.rationale}`;
  return {
    ...result,
    lut: { ...result.lut, data },
    metrics: {
      ...result.metrics,
      confidence: Math.round(
        result.metrics.confidence * 0.86 + advice.confidence * 0.14,
      ),
      warnings: [
        ...result.metrics.warnings,
        aiWarning,
        ...advice.warnings.map((warning) => `AI：${warning}`),
      ],
    },
  };
}

export function refineLutWithOnlineReference(
  result: LutTrainingResult,
  reference: OnlineReference,
): LutTrainingResult {
  const confidence = clamp(reference.confidence / 100);
  const sourceQuality = clamp(reference.sourceQuality / 100);
  const sourceFactor = clamp(reference.sources.length / 4);
  const strength = Math.min(
    0.18,
    confidence * sourceQuality * (0.72 + sourceFactor * 0.28) * 0.2,
  );

  if (strength < 0.025 || reference.category === "unknown") {
    return {
      ...result,
      metrics: {
        ...result.metrics,
        warnings: [
          ...result.metrics.warnings,
          `联网参考“${reference.matchedReference}”证据不足，未参与 LUT 求解。`,
        ],
      },
    };
  }

  const data = applyBoundedLutRefinement(
    result.lut.data,
    reference.traits,
    strength,
  );
  return {
    ...result,
    lut: { ...result.lut, data },
    metrics: {
      ...result.metrics,
      confidence: Math.round(
        result.metrics.confidence * 0.92 + reference.confidence * 0.08,
      ),
      warnings: [
        ...result.metrics.warnings,
        `联网参考“${reference.matchedReference}”已以 ${Math.round(
          strength * 100,
        )}% 权重参与求解；用户照片统计仍为主模型。`,
        ...reference.limitations.map((item) => `联网参考：${item}`),
      ],
    },
  };
}
