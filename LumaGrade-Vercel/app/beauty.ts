export type BeautySettings = {
  smooth: number;
  brighten: number;
  faceSlim: number;
  eyeBright: number;
  rosy: number;
};

export const BEAUTY_DEFAULTS: BeautySettings = {
  smooth: 0,
  brighten: 0,
  faceSlim: 0,
  eyeBright: 0,
  rosy: 0,
};

export const NATURAL_BEAUTY: BeautySettings = {
  smooth: 36,
  brighten: 18,
  faceSlim: 20,
  eyeBright: 16,
  rosy: 10,
};

type FaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BeautyResult = {
  imageData: ImageData;
  faceDetected: boolean;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, value));

export function hasBeauty(settings: BeautySettings) {
  return Object.values(settings).some((value) => value > 0);
}

function isSkin(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const warmSkin =
    r > 82 &&
    g > 32 &&
    b > 18 &&
    r > g * 1.035 &&
    r > b * 1.08 &&
    max - min > 13;
  const lightSkin =
    r > 178 &&
    g > 142 &&
    b > 118 &&
    r > b &&
    Math.abs(r - g) < 58 &&
    max - min > 8;

  return warmSkin || lightSkin;
}

function findFaceBounds(imageData: ImageData): FaceBounds | null {
  const { width, height, data } = imageData;
  const step = Math.max(3, Math.ceil(Math.max(width, height) / 210));
  const gridWidth = Math.ceil(width / step);
  const gridHeight = Math.ceil(height / step);
  const mask = new Uint8Array(gridWidth * gridHeight);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const y = Math.min(height - 1, gy * step + Math.floor(step / 2));
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const x = Math.min(width - 1, gx * step + Math.floor(step / 2));
      const offset = (y * width + x) * 4;
      if (isSkin(data[offset], data[offset + 1], data[offset + 2])) {
        mask[gy * gridWidth + gx] = 1;
      }
    }
  }

  const visited = new Uint8Array(mask.length);
  let best:
    | {
        count: number;
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        score: number;
      }
    | undefined;
  const directions = [-1, 0, 1];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let count = 0;
    let minX = gridWidth;
    let minY = gridHeight;
    let maxX = 0;
    let maxY = 0;

    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % gridWidth;
      const y = Math.floor(index / gridWidth);
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const dy of directions) {
        for (const dx of directions) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
          const neighbor = ny * gridWidth + nx;
          if (mask[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const coverage = (componentWidth * componentHeight) / (gridWidth * gridHeight);
    if (count < 12 || componentWidth < 4 || componentHeight < 4 || coverage > 0.58) {
      continue;
    }

    const centerX = (minX + maxX) / 2 / gridWidth;
    const centerY = (minY + maxY) / 2 / gridHeight;
    const centrality = 1 - Math.min(1, Math.abs(centerX - 0.5) * 1.3);
    const upperBias = centerY < 0.72 ? 1.12 : 0.82;
    const density = count / (componentWidth * componentHeight);
    const score = count * (0.72 + centrality * 0.28) * upperBias * (0.8 + density);

    if (!best || score > best.score) {
      best = { count, minX, minY, maxX, maxY, score };
    }
  }

  if (!best) return null;

  const componentX = best.minX * step;
  const componentY = best.minY * step;
  const componentWidth = (best.maxX - best.minX + 1) * step;
  const componentHeight = (best.maxY - best.minY + 1) * step;
  const faceWidth = Math.min(width, componentWidth * 1.38);
  const faceHeight = Math.min(height, Math.max(componentHeight * 1.45, faceWidth * 1.05));
  const centerX = componentX + componentWidth / 2;
  const centerY = componentY + componentHeight / 2;
  const x = Math.max(0, Math.min(width - faceWidth, centerX - faceWidth / 2));
  const y = Math.max(0, Math.min(height - faceHeight, centerY - faceHeight * 0.44));

  if (faceWidth < width * 0.045 || faceHeight < height * 0.055) return null;
  return { x, y, width: faceWidth, height: faceHeight };
}

function sampleChannel(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const top =
    source[(y0 * width + x0) * 4 + channel] * (1 - fx) +
    source[(y0 * width + x1) * 4 + channel] * fx;
  const bottom =
    source[(y1 * width + x0) * 4 + channel] * (1 - fx) +
    source[(y1 * width + x1) * 4 + channel] * fx;
  return top * (1 - fy) + bottom * fy;
}

function applyFaceSlim(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  face: FaceBounds,
  amount: number,
) {
  if (amount <= 0) return;
  const source = new Uint8ClampedArray(pixels);
  const centerX = face.x + face.width / 2;
  const centerY = face.y + face.height * 0.5;
  const radiusX = face.width * 0.56;
  const radiusY = face.height * 0.5;
  const strength = (amount / 100) * 0.22;
  const startX = Math.max(0, Math.floor(centerX - radiusX));
  const endX = Math.min(width - 1, Math.ceil(centerX + radiusX));
  const startY = Math.max(0, Math.floor(centerY - radiusY));
  const endY = Math.min(height - 1, Math.ceil(centerY + radiusY));

  for (let y = startY; y <= endY; y += 1) {
    const normalizedY = (y - centerY) / radiusY;
    const vertical = Math.max(0, 1 - normalizedY * normalizedY);
    for (let x = startX; x <= endX; x += 1) {
      const normalizedX = (x - centerX) / radiusX;
      const radial = normalizedX * normalizedX + normalizedY * normalizedY;
      if (radial >= 1) continue;
      const falloff = Math.pow(1 - radial, 1.6) * vertical;
      const sourceX = centerX + (x - centerX) * (1 + strength * falloff);
      const offset = (y * width + x) * 4;
      const blend = Math.min(1, falloff * 1.35);

      for (let channel = 0; channel < 3; channel += 1) {
        const sampled = sampleChannel(source, width, height, sourceX, y, channel);
        pixels[offset + channel] = clampByte(
          source[offset + channel] * (1 - blend) + sampled * blend,
        );
      }
    }
  }
}

function applySkinFinish(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  face: FaceBounds,
  settings: BeautySettings,
) {
  const source = new Uint8ClampedArray(pixels);
  const startX = Math.max(0, Math.floor(face.x));
  const endX = Math.min(width - 1, Math.ceil(face.x + face.width));
  const startY = Math.max(0, Math.floor(face.y));
  const endY = Math.min(height - 1, Math.ceil(face.y + face.height));
  const radius = Math.max(
    1,
    Math.min(5, Math.round((face.width / 420) * (1 + settings.smooth / 42))),
  );
  const smoothMix = (settings.smooth / 100) * 0.72;
  const brighten = (settings.brighten / 100) * 22;
  const rosy = settings.rosy / 100;
  const neighborOffsets = [
    [-radius, 0],
    [radius, 0],
    [0, -radius],
    [0, radius],
    [-radius, -radius],
    [radius, -radius],
    [-radius, radius],
    [radius, radius],
  ];

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const offset = (y * width + x) * 4;
      const r = source[offset];
      const g = source[offset + 1];
      const b = source[offset + 2];
      if (!isSkin(r, g, b)) continue;

      let red = r;
      let green = g;
      let blue = b;
      if (smoothMix > 0) {
        let sumR = r * 2;
        let sumG = g * 2;
        let sumB = b * 2;
        let count = 2;
        for (const [dx, dy] of neighborOffsets) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const ny = Math.max(0, Math.min(height - 1, y + dy));
          const neighborOffset = (ny * width + nx) * 4;
          if (
            isSkin(
              source[neighborOffset],
              source[neighborOffset + 1],
              source[neighborOffset + 2],
            )
          ) {
            sumR += source[neighborOffset];
            sumG += source[neighborOffset + 1];
            sumB += source[neighborOffset + 2];
            count += 1;
          }
        }
        red = r + (sumR / count - r) * smoothMix;
        green = g + (sumG / count - g) * smoothMix;
        blue = b + (sumB / count - b) * smoothMix;
      }

      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const highlightGuard = 1 - Math.max(0, luminance - 210) / 60;
      red += brighten * highlightGuard + rosy * 9;
      green += brighten * highlightGuard * 0.98 + rosy * 1.5;
      blue += brighten * highlightGuard * 0.93 - rosy * 2.5;
      pixels[offset] = clampByte(red);
      pixels[offset + 1] = clampByte(green);
      pixels[offset + 2] = clampByte(blue);
    }
  }
}

function applyEyeBright(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  face: FaceBounds,
  amount: number,
) {
  if (amount <= 0) return;
  const centers = [0.34, 0.66];
  const radiusX = face.width * 0.135;
  const radiusY = face.height * 0.075;
  const strength = amount / 100;

  for (const horizontal of centers) {
    const centerX = face.x + face.width * horizontal;
    const centerY = face.y + face.height * 0.38;
    const startX = Math.max(0, Math.floor(centerX - radiusX));
    const endX = Math.min(width - 1, Math.ceil(centerX + radiusX));
    const startY = Math.max(0, Math.floor(centerY - radiusY));
    const endY = Math.min(height - 1, Math.ceil(centerY + radiusY));

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const nx = (x - centerX) / radiusX;
        const ny = (y - centerY) / radiusY;
        const distance = nx * nx + ny * ny;
        if (distance >= 1) continue;
        const offset = (y * width + x) * 4;
        const luminance =
          pixels[offset] * 0.299 +
          pixels[offset + 1] * 0.587 +
          pixels[offset + 2] * 0.114;
        const falloff = Math.pow(1 - distance, 1.5);
        const lift = Math.min(18, Math.max(3, 190 - luminance) * 0.08) * strength * falloff;
        pixels[offset] = clampByte(pixels[offset] + lift * 0.92);
        pixels[offset + 1] = clampByte(pixels[offset + 1] + lift);
        pixels[offset + 2] = clampByte(pixels[offset + 2] + lift * 1.08);
      }
    }
  }
}

export function applyBeauty(
  imageData: ImageData,
  settings: BeautySettings,
): BeautyResult {
  if (!hasBeauty(settings)) {
    return { imageData, faceDetected: false };
  }

  const face = findFaceBounds(imageData);
  if (!face) {
    return { imageData, faceDetected: false };
  }

  const { data, width, height } = imageData;
  applyFaceSlim(data, width, height, face, settings.faceSlim);
  applySkinFinish(data, width, height, face, settings);
  applyEyeBright(data, width, height, face, settings.eyeBright);

  return { imageData, faceDetected: true };
}
