/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function transpile(fileName) {
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
  new Function("require", "module", "exports", output)(
    require,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

function buildGradient(width = 320, height = 180) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = Math.min(
        1,
        0.018 +
          (x / (width - 1)) * 0.975 +
          Math.sin(y * 0.13) * 0.008,
      );
      const encoded = Math.round(value * 255);
      data[offset] = encoded;
      data[offset + 1] = encoded;
      data[offset + 2] = encoded;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function clone(imageData) {
  return {
    data: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
  };
}

function stats(imageData) {
  let mean = 0;
  let redMinusBlue = 0;
  let clipped = 0;
  const luminance = [];
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const r = imageData.data[offset] / 255;
    const g = imageData.data[offset + 1] / 255;
    const b = imageData.data[offset + 2] / 255;
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    mean += luma;
    redMinusBlue += r - b;
    luminance.push(luma);
    if (Math.max(r, g, b) >= 0.997) clipped += 1;
  }
  luminance.sort((a, b) => a - b);
  const count = luminance.length;
  return {
    mean: mean / count,
    redMinusBlue: redMinusBlue / count,
    clipped: clipped / count,
    shadow: luminance[Math.floor(count * 0.05)],
  };
}

function main() {
  const adjustments = transpile("image-adjustments.ts");
  const ai = transpile("ai-grade.ts");
  const source = buildGradient();
  const baseline = stats(source);

  const exposed = clone(source);
  adjustments.applyImageAdjustments(exposed, {
    ...adjustments.EMPTY_ADJUSTMENTS,
    exposure: 60,
  });
  const exposedStats = stats(exposed);
  if (exposedStats.mean <= baseline.mean + 0.08) {
    throw new Error("Exposure slider did not visibly increase image brightness");
  }

  const protectedHighlights = clone(exposed);
  adjustments.applyImageAdjustments(protectedHighlights, {
    ...adjustments.EMPTY_ADJUSTMENTS,
    highlights: -70,
  });
  const protectedStats = stats(protectedHighlights);
  if (protectedStats.clipped >= exposedStats.clipped) {
    throw new Error("Highlight slider did not reduce clipping");
  }

  const liftedShadows = clone(source);
  adjustments.applyImageAdjustments(liftedShadows, {
    ...adjustments.EMPTY_ADJUSTMENTS,
    shadows: 70,
  });
  const shadowStats = stats(liftedShadows);
  if (shadowStats.shadow <= baseline.shadow + 0.015) {
    throw new Error("Shadow slider did not lift dark tones");
  }

  const warmed = clone(source);
  adjustments.applyImageAdjustments(warmed, {
    ...adjustments.EMPTY_ADJUSTMENTS,
    temperature: 60,
  });
  const warmStats = stats(warmed);
  if (warmStats.redMinusBlue <= baseline.redMinusBlue + 0.025) {
    throw new Error("Temperature slider did not create a warm channel shift");
  }

  const aiDelta = ai.aiGradeToAdjustments({
    exposureEv: 2,
    contrast: 99,
    highlights: -99,
    shadows: 99,
    temperature: 99,
    tint: -99,
    saturation: 99,
    confidence: 80,
    scene: "test",
    rationale: "test",
  });
  if (
    aiDelta.exposure !== 60 ||
    aiDelta.contrast !== 25 ||
    aiDelta.highlights !== -40 ||
    aiDelta.temperature !== 35
  ) {
    throw new Error("AI correction safety bounds were not enforced");
  }

  const lutData = new Float32Array(33 ** 3 * 3);
  for (let offset = 0; offset < lutData.length; offset += 3) {
    const value = ((offset / 3) % 33) / 32;
    lutData[offset] = value;
    lutData[offset + 1] = value;
    lutData[offset + 2] = value;
  }
  const result = {
    lut: {
      title: "test",
      size: 33,
      data: lutData,
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    },
    metrics: { confidence: 70, warnings: [] },
  };
  const refined = ai.refineLutWithAiScan(result, {
    temperature: 18,
    tint: 3,
    saturation: 10,
    contrast: 8,
    shadows: 4,
    highlights: -8,
    redBias: 6,
    greenBias: 0,
    blueBias: -4,
    confidence: 86,
    coherence: 82,
    rationale: "consistent warm look",
    warnings: [],
  });
  let lutDelta = 0;
  for (let index = 0; index < lutData.length; index += 1) {
    if (!Number.isFinite(refined.lut.data[index])) {
      throw new Error("GPT-refined LUT contains an invalid value");
    }
    lutDelta += Math.abs(refined.lut.data[index] - lutData[index]);
  }
  if (lutDelta / lutData.length < 0.0001) {
    throw new Error("GPT scan did not influence the LUT");
  }

  const onlineReference = {
    query: "Leica M9",
    matchedReference: "Leica M9",
    category: "camera",
    confidence: 88,
    sourceQuality: 82,
    traits: {
      temperature: 8,
      tint: 5,
      saturation: 7,
      contrast: 9,
      shadows: -3,
      highlights: -7,
      redBias: 5,
      greenBias: -2,
      blueBias: -3,
    },
    signature: {
      skinTone: "warm",
      greens: "restrained",
      blues: "deep",
      reds: "clear",
      highlightRollOff: "firm",
      shadowColor: "slightly cool",
      contrastCurve: "moderate",
    },
    rationale: "repeated source consensus",
    consensus: ["warm skin and distinct reds"],
    limitations: [],
    sources: [
      { title: "Official", url: "https://example.com/1", domain: "example.com" },
      { title: "Review", url: "https://example.org/2", domain: "example.org" },
      { title: "Review 2", url: "https://example.net/3", domain: "example.net" },
    ],
  };
  const referenced = ai.refineLutWithOnlineReference(result, onlineReference);
  let referenceDelta = 0;
  for (let index = 0; index < lutData.length; index += 1) {
    const value = referenced.lut.data[index];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("Online-reference LUT escaped the valid [0, 1] range");
    }
    referenceDelta += Math.abs(value - lutData[index]);
  }
  const meanReferenceDelta = referenceDelta / lutData.length;
  if (meanReferenceDelta < 0.00003 || meanReferenceDelta > 0.02) {
    throw new Error(
      `Online reference influence is outside its low-weight bounds: ${meanReferenceDelta}`,
    );
  }

  const uncertain = ai.refineLutWithOnlineReference(result, {
    ...onlineReference,
    matchedReference: "ambiguous",
    category: "unknown",
    confidence: 24,
    sourceQuality: 18,
    sources: [],
  });
  if (uncertain.lut.data !== result.lut.data) {
    throw new Error("Uncertain online reference should not modify LUT data");
  }

  console.log(
    JSON.stringify(
      {
        meanBefore: Number(baseline.mean.toFixed(3)),
        meanAfterExposure: Number(exposedStats.mean.toFixed(3)),
        clippingBeforeProtection: Number(
          (exposedStats.clipped * 100).toFixed(2),
        ),
        clippingAfterProtection: Number(
          (protectedStats.clipped * 100).toFixed(2),
        ),
        shadowBefore: Number(baseline.shadow.toFixed(3)),
        shadowAfter: Number(shadowStats.shadow.toFixed(3)),
        warmChannelShift: Number(warmStats.redMinusBlue.toFixed(3)),
        meanLutDelta: Number((lutDelta / lutData.length).toFixed(5)),
        meanReferenceDelta: Number(meanReferenceDelta.toFixed(5)),
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
