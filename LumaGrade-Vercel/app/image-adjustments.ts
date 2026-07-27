export type AdjustmentValues = {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  temperature: number;
  tint: number;
  fade: number;
};

export const EMPTY_ADJUSTMENTS: AdjustmentValues = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
};

const ADJUSTMENT_KEYS = Object.keys(
  EMPTY_ADJUSTMENTS,
) as Array<keyof AdjustmentValues>;

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

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

export function addAdjustments(
  ...groups: AdjustmentValues[]
): AdjustmentValues {
  const result = { ...EMPTY_ADJUSTMENTS };
  for (const group of groups) {
    for (const key of ADJUSTMENT_KEYS) result[key] += group[key];
  }
  return result;
}

export function clampAdjustments(
  values: AdjustmentValues,
): AdjustmentValues {
  return {
    exposure: Math.round(clamp(values.exposure, -100, 100)),
    contrast: Math.round(clamp(values.contrast, -100, 100)),
    highlights: Math.round(clamp(values.highlights, -100, 100)),
    shadows: Math.round(clamp(values.shadows, -100, 100)),
    saturation: Math.round(clamp(values.saturation, -100, 100)),
    temperature: Math.round(clamp(values.temperature, -100, 100)),
    tint: Math.round(clamp(values.tint, -100, 100)),
    fade: Math.round(clamp(values.fade, 0, 100)),
  };
}

export function hasAdjustments(values: AdjustmentValues) {
  return ADJUSTMENT_KEYS.some((key) => Math.abs(values[key]) >= 0.5);
}

export function applyImageAdjustments(
  imageData: ImageData,
  values: AdjustmentValues,
) {
  if (!hasAdjustments(values)) return imageData;
  const exposure = Math.pow(2, values.exposure / 100);
  const contrast = Math.max(0, 1 + values.contrast / 100);
  const saturation = Math.max(0, 1 + values.saturation / 100);
  const warmth = values.temperature / 100;
  const tint = values.tint / 100;
  const redBalance = clamp(1 + warmth * 0.16 + tint * 0.035, 0.72, 1.3);
  const greenBalance = clamp(1 - Math.abs(warmth) * 0.018 - tint * 0.08, 0.72, 1.3);
  const blueBalance = clamp(1 - warmth * 0.16 + tint * 0.035, 0.72, 1.3);
  const shadowAmount = values.shadows / 100;
  const highlightAmount = values.highlights / 100;
  const fadeAmount = values.fade / 100;
  const pixels = imageData.data;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    let r = srgbToLinear(pixels[offset] / 255) * exposure * redBalance;
    let g = srgbToLinear(pixels[offset + 1] / 255) * exposure * greenBalance;
    let b = srgbToLinear(pixels[offset + 2] / 255) * exposure * blueBalance;
    const sourceLuma = Math.max(
      0.00001,
      r * 0.2126 + g * 0.7152 + b * 0.0722,
    );
    let mappedLuma = 0.18 + (sourceLuma - 0.18) * contrast;
    mappedLuma += shadowAmount * Math.pow(1 - clamp(sourceLuma), 2) * 0.18;
    mappedLuma +=
      highlightAmount * smoothstep(0.24, 1, sourceLuma) * 0.16;
    mappedLuma += fadeAmount * Math.pow(1 - clamp(sourceLuma), 2) * 0.055;
    mappedLuma = clamp(mappedLuma);
    const scale = mappedLuma / sourceLuma;
    r = linearToSrgb(r * scale);
    g = linearToSrgb(g * scale);
    b = linearToSrgb(b * scale);
    const displayLuma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = clamp(displayLuma + (r - displayLuma) * saturation);
    g = clamp(displayLuma + (g - displayLuma) * saturation);
    b = clamp(displayLuma + (b - displayLuma) * saturation);
    pixels[offset] = Math.round(r * 255);
    pixels[offset + 1] = Math.round(g * 255);
    pixels[offset + 2] = Math.round(b * 255);
  }

  return imageData;
}
