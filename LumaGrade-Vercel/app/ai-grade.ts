import type { AdjustmentValues } from "./image-adjustments";
import type { LutTrainingResult } from "./lut-trainer";

export type AiConfig = {
  enabled: boolean;
  model: string | null;
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

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
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
  const data = new Float32Array(result.lut.data);
  const warmth = advice.temperature / 100;
  const tint = advice.tint / 100;
  const contrast = 1 + (advice.contrast / 100) * strength;
  const saturation = 1 + (advice.saturation / 100) * strength;
  const redGain =
    1 + (warmth * 0.08 + tint * 0.025 + advice.redBias / 1200) * strength;
  const greenGain =
    1 + (-tint * 0.06 + advice.greenBias / 1200) * strength;
  const blueGain =
    1 + (-warmth * 0.08 + tint * 0.025 + advice.blueBias / 1200) * strength;
  const shadow = (advice.shadows / 100) * 0.12 * strength;
  const highlight = (advice.highlights / 100) * 0.1 * strength;

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
    data[offset + 1] = clamp(adjustedLuma + (g - adjustedLuma) * saturation);
    data[offset + 2] = clamp(adjustedLuma + (b - adjustedLuma) * saturation);
  }

  const aiWarning = `GPT 云端扫描已以 ${Math.round(
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
        ...advice.warnings.map((warning) => `GPT：${warning}`),
      ],
    },
  };
}
