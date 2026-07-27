export type Lut3D = {
  title: string;
  size: number;
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
};

function parseTriplet(value: string, label: string) {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
    throw new Error(`${label} 格式不正确`);
  }
  return parts.slice(0, 3) as [number, number, number];
}

export function parseCube(contents: string, fallbackTitle: string): Lut3D {
  let title = fallbackTitle.replace(/\.cube$/i, "");
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (const originalLine of contents.split(/\r?\n/)) {
    const line = originalLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    if (/^TITLE\s+/i.test(line)) {
      title = line.replace(/^TITLE\s+/i, "").replace(/^["']|["']$/g, "");
      continue;
    }

    if (/^LUT_3D_SIZE\s+/i.test(line)) {
      size = Number(line.replace(/^LUT_3D_SIZE\s+/i, "").trim());
      continue;
    }

    if (/^LUT_1D_SIZE\s+/i.test(line)) {
      throw new Error("这个文件是 1D LUT，目前请使用 3D .cube 文件");
    }

    if (/^DOMAIN_MIN\s+/i.test(line)) {
      domainMin = parseTriplet(line.replace(/^DOMAIN_MIN\s+/i, ""), "DOMAIN_MIN");
      continue;
    }

    if (/^DOMAIN_MAX\s+/i.test(line)) {
      domainMax = parseTriplet(line.replace(/^DOMAIN_MAX\s+/i, ""), "DOMAIN_MAX");
      continue;
    }

    if (/^[A-Za-z_]/.test(line)) continue;
    const triplet = parseTriplet(line, "LUT 数据");
    values.push(...triplet);
  }

  if (!Number.isInteger(size) || size < 2 || size > 128) {
    throw new Error("没有找到有效的 LUT_3D_SIZE");
  }

  const expected = size * size * size * 3;
  if (values.length < expected) {
    throw new Error(
      `LUT 数据不完整：需要 ${expected / 3} 组，实际只有 ${Math.floor(values.length / 3)} 组`,
    );
  }

  return {
    title,
    size,
    data: new Float32Array(values.slice(0, expected)),
    domainMin,
    domainMax,
  };
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function sampleLut(lut: Lut3D, r: number, g: number, b: number) {
  const { size, data, domainMin, domainMax } = lut;
  const maxIndex = size - 1;
  const normalizedR = clamp(
    (r - domainMin[0]) / Math.max(0.000001, domainMax[0] - domainMin[0]),
  );
  const normalizedG = clamp(
    (g - domainMin[1]) / Math.max(0.000001, domainMax[1] - domainMin[1]),
  );
  const normalizedB = clamp(
    (b - domainMin[2]) / Math.max(0.000001, domainMax[2] - domainMin[2]),
  );

  const scaledR = normalizedR * maxIndex;
  const scaledG = normalizedG * maxIndex;
  const scaledB = normalizedB * maxIndex;
  const r0 = Math.floor(scaledR);
  const g0 = Math.floor(scaledG);
  const b0 = Math.floor(scaledB);
  const r1 = Math.min(r0 + 1, maxIndex);
  const g1 = Math.min(g0 + 1, maxIndex);
  const b1 = Math.min(b0 + 1, maxIndex);
  const fr = scaledR - r0;
  const fg = scaledG - g0;
  const fb = scaledB - b0;

  const index = (rr: number, gg: number, bb: number) =>
    (rr + gg * size + bb * size * size) * 3;

  const output: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = data[index(r0, g0, b0) + channel];
    const c100 = data[index(r1, g0, b0) + channel];
    const c010 = data[index(r0, g1, b0) + channel];
    const c110 = data[index(r1, g1, b0) + channel];
    const c001 = data[index(r0, g0, b1) + channel];
    const c101 = data[index(r1, g0, b1) + channel];
    const c011 = data[index(r0, g1, b1) + channel];
    const c111 = data[index(r1, g1, b1) + channel];

    const c00 = c000 + (c100 - c000) * fr;
    const c10 = c010 + (c110 - c010) * fr;
    const c01 = c001 + (c101 - c001) * fr;
    const c11 = c011 + (c111 - c011) * fr;
    const c0 = c00 + (c10 - c00) * fg;
    const c1 = c01 + (c11 - c01) * fg;
    output[channel] = c0 + (c1 - c0) * fb;
  }

  return output;
}

export function applyLutToRgb(
  lut: Lut3D,
  r: number,
  g: number,
  b: number,
  intensity = 100,
): [number, number, number] {
  const mix = clamp(intensity / 100);
  const [lutR, lutG, lutB] = sampleLut(lut, r, g, b);
  return [
    clamp(r + (lutR - r) * mix),
    clamp(g + (lutG - g) * mix),
    clamp(b + (lutB - b) * mix),
  ];
}

export function applyLut(imageData: ImageData, lut: Lut3D, intensity: number) {
  const pixels = imageData.data;
  const mix = clamp(intensity / 100);

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const sourceR = pixels[offset] / 255;
    const sourceG = pixels[offset + 1] / 255;
    const sourceB = pixels[offset + 2] / 255;
    const [lutR, lutG, lutB] = sampleLut(lut, sourceR, sourceG, sourceB);
    pixels[offset] = Math.round(
      clamp(sourceR + (lutR - sourceR) * mix) * 255,
    );
    pixels[offset + 1] = Math.round(
      clamp(sourceG + (lutG - sourceG) * mix) * 255,
    );
    pixels[offset + 2] = Math.round(
      clamp(sourceB + (lutB - sourceB) * mix) * 255,
    );
  }

  return imageData;
}

export type Histogram = {
  red: number[];
  green: number[];
  blue: number[];
};

export function buildHistogram(imageData: ImageData, bins = 32): Histogram {
  const histogram: Histogram = {
    red: Array(bins).fill(0),
    green: Array(bins).fill(0),
    blue: Array(bins).fill(0),
  };
  const pixels = imageData.data;
  const stride = Math.max(4, Math.floor(pixels.length / 120000 / 4) * 4);

  for (let offset = 0; offset < pixels.length; offset += stride) {
    histogram.red[Math.min(bins - 1, Math.floor((pixels[offset] / 256) * bins))] +=
      1;
    histogram.green[
      Math.min(bins - 1, Math.floor((pixels[offset + 1] / 256) * bins))
    ] += 1;
    histogram.blue[
      Math.min(bins - 1, Math.floor((pixels[offset + 2] / 256) * bins))
    ] += 1;
  }

  const max = Math.max(
    1,
    ...histogram.red,
    ...histogram.green,
    ...histogram.blue,
  );
  return {
    red: histogram.red.map((value) => value / max),
    green: histogram.green.map((value) => value / max),
    blue: histogram.blue.map((value) => value / max),
  };
}
