const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

class MockBitmap {
  constructor(seed) {
    this.width = 240;
    this.height = 180;
    this.seed = seed;
  }

  close() {}
}

global.ImageBitmap = MockBitmap;
global.window = {
  createImageBitmap: true,
  setTimeout,
};
global.createImageBitmap = async (file) => new MockBitmap(file.seed);
global.document = {
  createElement(tag) {
    if (tag !== "canvas") throw new Error(`Unexpected element: ${tag}`);
    let image;
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          drawImage(nextImage) {
            image = nextImage;
          },
          getImageData(_x, _y, width, height) {
            const pixels = new Uint8ClampedArray(width * height * 4);
            const seed = image.seed;
            for (let y = 0; y < height; y += 1) {
              for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 4;
                const horizontal = x / Math.max(1, width - 1);
                const vertical = y / Math.max(1, height - 1);
                const wave = (Math.sin((x + seed * 17) * 0.071) + 1) / 2;
                const baseR = 0.62 * horizontal + 0.25 * wave + 0.08 * vertical;
                const baseG = 0.55 * vertical + 0.28 * (1 - wave) + 0.1 * horizontal;
                const baseB =
                  0.48 * (1 - horizontal) + 0.31 * vertical + 0.16 * wave;
                pixels[offset] =
                  Math.max(0, Math.min(1, Math.pow(baseR, 0.91) * 1.035)) * 255;
                pixels[offset + 1] =
                  Math.max(0, Math.min(1, Math.pow(baseG, 0.97) * 0.985)) * 255;
                pixels[offset + 2] =
                  Math.max(0, Math.min(1, Math.pow(baseB, 1.06) * 0.96)) * 255;
                pixels[offset + 3] = 255;
              }
            }
            return { data: pixels };
          },
        };
      },
    };
  },
};

function loadTrainer() {
  const sourcePath = path.join(__dirname, "..", "app", "lut-trainer.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    require,
    module,
    module.exports,
  );
  return module.exports;
}

async function main() {
  const trainer = loadTrainer();
  const files = Array.from({ length: 12 }, (_, index) => ({
    name: `reference-${String(index + 1).padStart(2, "0")}.jpg`,
    type: "image/jpeg",
    size: 180000,
    lastModified: index,
    seed: index + 1,
  }));

  let minimumGuardWorked = false;
  try {
    await trainer.trainReferenceLut(files.slice(0, 11), "Too Small");
  } catch (error) {
    minimumGuardWorked = /至少需要 12 张/.test(String(error.message));
  }
  if (!minimumGuardWorked) throw new Error("Minimum reference guard failed");

  const result = await trainer.trainReferenceLut(files, "Synthetic Warm Look");
  if (result.lut.size !== 33) throw new Error("LUT size is not 33");
  if (result.lut.data.length !== 33 ** 3 * 3) {
    throw new Error("LUT node count is incorrect");
  }

  let absoluteDelta = 0;
  for (let blue = 0; blue < 33; blue += 1) {
    for (let green = 0; green < 33; green += 1) {
      for (let red = 0; red < 33; red += 1) {
        const offset = (red + green * 33 + blue * 33 * 33) * 3;
        const values = [
          result.lut.data[offset],
          result.lut.data[offset + 1],
          result.lut.data[offset + 2],
        ];
        if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
          throw new Error("LUT contains an invalid value");
        }
        absoluteDelta += Math.abs(values[0] - red / 32);
        absoluteDelta += Math.abs(values[1] - green / 32);
        absoluteDelta += Math.abs(values[2] - blue / 32);
      }
    }
  }
  const meanDelta = absoluteDelta / (33 ** 3 * 3);
  if (meanDelta < 0.004 || meanDelta > 0.24) {
    throw new Error(`Unexpected LUT strength: ${meanDelta}`);
  }

  let previousGray = -1;
  for (let index = 0; index < 33; index += 1) {
    const offset = (index + index * 33 + index * 33 * 33) * 3;
    const gray =
      result.lut.data[offset] * 0.2126 +
      result.lut.data[offset + 1] * 0.7152 +
      result.lut.data[offset + 2] * 0.0722;
    if (gray + 0.005 < previousGray) throw new Error("Gray ramp is not monotonic");
    previousGray = gray;
  }

  const cube = trainer.serializeCube(result.lut);
  const dataLines = cube
    .split(/\r?\n/)
    .filter((line) => /^\d+\.\d+ \d+\.\d+ \d+\.\d+$/.test(line));
  if (dataLines.length !== 33 ** 3) throw new Error("Serialized node count is wrong");

  console.log(
    JSON.stringify(
      {
        nodes: dataLines.length,
        meanDelta: Number(meanDelta.toFixed(5)),
        confidence: result.metrics.confidence,
        hueCoverage: result.metrics.hueCoverage,
        toneCoverage: result.metrics.toneCoverage,
        sampledPixels: result.metrics.sampledPixels,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
