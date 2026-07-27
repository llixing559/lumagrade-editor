/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function transpile(fileName, dependencyMap = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "app", fileName),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (request) => dependencyMap[request] ?? require(request);
  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

function buildStressLut(size = 33) {
  const data = new Float32Array(size ** 3 * 3);
  let offset = 0;
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        const r = red / (size - 1);
        const g = green / (size - 1);
        const b = blue / (size - 1);
        data[offset] = Math.min(1, Math.pow(r, 0.82) * 1.12 + 0.018);
        data[offset + 1] = Math.min(1, Math.pow(g, 0.88) * 1.04 + 0.008);
        data[offset + 2] = Math.min(1, Math.pow(b, 0.96) * 0.88);
        offset += 3;
      }
    }
  }
  return {
    title: "Warm Highlight Stress",
    size,
    data,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  };
}

function buildIdentityLut(size = 33) {
  const data = new Float32Array(size ** 3 * 3);
  let offset = 0;
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        data[offset] = red / (size - 1);
        data[offset + 1] = green / (size - 1);
        data[offset + 2] = blue / (size - 1);
        offset += 3;
      }
    }
  }
  return {
    title: "Identity",
    size,
    data,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  };
}

function buildWarmHighKeyImage(width = 420, height = 280) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const horizontal = x / (width - 1);
      const vertical = y / (height - 1);
      const highlight = Math.pow(horizontal, 0.7) * 0.42;
      const detail = (Math.sin(x * 0.11) * Math.cos(y * 0.07) + 1) * 0.035;
      const base = 0.39 + vertical * 0.22 + highlight + detail;
      data[offset] = Math.min(1, base * 1.1) * 255;
      data[offset + 1] = Math.min(1, base * 0.99) * 255;
      data[offset + 2] = Math.min(1, base * 0.82) * 255;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function buildNeutralImage(lowKey = false, width = 360, height = 240) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const horizontal = x / (width - 1);
      const vertical = y / (height - 1);
      const detail = Math.sin(x * 0.08) * Math.cos(y * 0.06) * 0.018;
      const value = lowKey
        ? 0.035 + horizontal * 0.29 + vertical * 0.09 + detail
        : 0.13 + horizontal * 0.58 + vertical * 0.12 + detail;
      const encoded = Math.round(Math.max(0, Math.min(1, value)) * 255);
      data[offset] = encoded;
      data[offset + 1] = encoded;
      data[offset + 2] = encoded;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function cloneImageData(imageData) {
  return {
    data: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
  };
}

function stats(imageData) {
  let clipped = 0;
  let mean = 0;
  const pixels = imageData.data;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const r = pixels[offset] / 255;
    const g = pixels[offset + 1] / 255;
    const b = pixels[offset + 2] / 255;
    mean += r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (
      r <= 0.003 ||
      g <= 0.003 ||
      b <= 0.003 ||
      r >= 0.997 ||
      g >= 0.997 ||
      b >= 0.997
    ) {
      clipped += 1;
    }
  }
  const count = pixels.length / 4;
  return { clipped: clipped / count, mean: mean / count };
}

function main() {
  const lutTools = transpile("lut.ts");
  const adaptive = transpile("adaptive-lut.ts", { "./lut": lutTools });
  const lut = buildStressLut();
  const layer = { lut, intensity: 100 };
  const source = buildWarmHighKeyImage();
  const profile = adaptive.analyzeAdaptiveProfile(source, [layer]);

  const plain = cloneImageData(source);
  lutTools.applyLut(plain, lut, 100);
  const plainStats = stats(plain);

  const matched = cloneImageData(source);
  adaptive.applyAdaptiveInput(matched, profile);
  lutTools.applyLut(matched, lut, 100);
  adaptive.applyAdaptiveOutput(matched, profile);
  const matchedStats = stats(matched);

  const numericFields = [
    profile.exposureEv,
    profile.postExposureEv,
    profile.contrast,
    ...profile.whiteBalance,
    profile.clippedBefore,
    profile.clippedAfter,
  ];
  if (numericFields.some((value) => !Number.isFinite(value))) {
    throw new Error("Adaptive profile contains an invalid number");
  }
  if (profile.whiteBalance.some((value) => value < 0.78 || value > 1.24)) {
    throw new Error("White-balance correction exceeded its safety limit");
  }
  if (matchedStats.clipped >= plainStats.clipped) {
    throw new Error(
      `Clipping did not improve: ${plainStats.clipped} -> ${matchedStats.clipped}`,
    );
  }
  if (matchedStats.mean < 0.2 || matchedStats.mean > 0.82) {
    throw new Error(`Adaptive output exposure is unsafe: ${matchedStats.mean}`);
  }
  if (profile.temperature === 0 && profile.tint === 0) {
    throw new Error("Warm-cast test did not produce a white-balance correction");
  }

  const identityLayer = { lut: buildIdentityLut(), intensity: 100 };
  const neutral = buildNeutralImage();
  const neutralProfile = adaptive.analyzeAdaptiveProfile(neutral, [
    identityLayer,
  ]);
  if (
    Math.abs(neutralProfile.temperature) > 2 ||
    Math.abs(neutralProfile.tint) > 2 ||
    Math.abs(neutralProfile.exposureEv + neutralProfile.postExposureEv) > 0.22
  ) {
    throw new Error(
      `Neutral image was over-corrected: ${JSON.stringify(neutralProfile)}`,
    );
  }

  const lowKey = buildNeutralImage(true);
  const lowKeyBefore = stats(lowKey);
  const lowKeyProfile = adaptive.analyzeAdaptiveProfile(lowKey, [
    identityLayer,
  ]);
  const lowKeyMatched = cloneImageData(lowKey);
  adaptive.applyAdaptiveInput(lowKeyMatched, lowKeyProfile);
  lutTools.applyLut(lowKeyMatched, identityLayer.lut, 100);
  adaptive.applyAdaptiveOutput(lowKeyMatched, lowKeyProfile);
  const lowKeyAfter = stats(lowKeyMatched);
  if (
    lowKeyAfter.mean - lowKeyBefore.mean > 0.13 ||
    lowKeyAfter.mean > 0.36
  ) {
    throw new Error(
      `Low-key intent was not preserved: ${lowKeyBefore.mean} -> ${lowKeyAfter.mean}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        exposureEv: Number(profile.exposureEv.toFixed(3)),
        postExposureEv: Number(profile.postExposureEv.toFixed(3)),
        whiteBalance: profile.whiteBalance.map((value) =>
          Number(value.toFixed(3)),
        ),
        temperature: profile.temperature,
        contrast: Number(profile.contrast.toFixed(3)),
        clippingWithoutMatch: Number((plainStats.clipped * 100).toFixed(2)),
        clippingWithMatch: Number((matchedStats.clipped * 100).toFixed(2)),
        outputMean: Number(matchedStats.mean.toFixed(3)),
        confidence: profile.confidence,
        neutralCorrectionEv: Number(
          (
            neutralProfile.exposureEv + neutralProfile.postExposureEv
          ).toFixed(3),
        ),
        lowKeyMeanBefore: Number(lowKeyBefore.mean.toFixed(3)),
        lowKeyMeanAfter: Number(lowKeyAfter.mean.toFixed(3)),
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
