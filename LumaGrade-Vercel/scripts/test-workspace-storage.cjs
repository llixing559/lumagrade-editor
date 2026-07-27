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

async function main() {
  const storage = transpile("workspace-storage.ts");
  const source = new File([new Uint8Array([12, 34, 56, 78])], "sample.jpg", {
    type: "image/jpeg",
    lastModified: 123456,
  });
  const stored = storage.fileToStored(source);
  const restored = storage.storedToFile(stored);
  const bytes = new Uint8Array(await restored.arrayBuffer());

  if (
    restored.name !== source.name ||
    restored.type !== source.type ||
    restored.lastModified !== source.lastModified ||
    bytes.join(",") !== "12,34,56,78"
  ) {
    throw new Error("Stored image did not round-trip correctly");
  }
  if (storage.MAX_PERSISTED_TRAINING_BYTES !== 350 * 1024 * 1024) {
    throw new Error("Training workspace persistence limit changed unexpectedly");
  }
  const quotaMessage = storage.workspaceErrorMessage(
    new DOMException("full", "QuotaExceededError"),
  );
  if (!quotaMessage.includes("存储空间不足")) {
    throw new Error("Quota errors are not translated for the UI");
  }

  console.log("Workspace storage tests passed");
}

main();
