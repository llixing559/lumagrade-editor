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

function expectProvider(ai, connection, id, vision, search = false) {
  const result = ai.detectAiProvider(connection);
  if (
    result.id !== id ||
    result.supportsVision !== vision ||
    result.supportsSearch !== search
  ) {
    throw new Error(
      `Provider detection mismatch for ${connection.endpoint}: ${JSON.stringify(
        result,
      )}`,
    );
  }
}

function main() {
  const ai = transpile("ai-providers.ts");
  const base = { apiKey: "secret-key", model: "model" };
  expectProvider(
    ai,
    { ...base, endpoint: "https://api.openai.com/v1", model: "gpt-5.6" },
    "openai",
    true,
    true,
  );
  expectProvider(
    ai,
    {
      ...base,
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3.5-flash",
    },
    "gemini",
    true,
    true,
  );
  expectProvider(
    ai,
    {
      ...base,
      endpoint: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5",
    },
    "anthropic",
    true,
  );
  expectProvider(
    ai,
    {
      ...base,
      endpoint: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    },
    "deepseek",
    false,
  );
  expectProvider(
    ai,
    {
      ...base,
      endpoint: "https://ark.cn-beijing.volces.com/api/v3",
      model: "ep-123",
    },
    "doubao",
    true,
  );
  expectProvider(
    ai,
    {
      ...base,
      endpoint: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-5",
    },
    "openrouter",
    true,
  );
  expectProvider(
    ai,
    {
      ...base,
      endpoint: "https://models.example.com/v1",
      model: "qwen-vl-plus",
    },
    "compatible",
    true,
  );
  expectProvider(
    ai,
    {
      ...base,
      endpoint: "not-a-url",
      model: "unknown",
    },
    "unknown",
    false,
  );

  if (
    ai.isAiConnectionReady(
      { enabled: false, model: null },
      { endpoint: "", apiKey: "", model: "" },
    )
  ) {
    throw new Error("Unconfigured site default should not be ready");
  }
  if (
    !ai.isAiConnectionReady(
      { enabled: false, model: null },
      {
        endpoint: "https://api.deepseek.com/v1",
        apiKey: "secret",
        model: "deepseek-chat",
      },
    )
  ) {
    throw new Error("Complete user-provided connection should be ready");
  }

  console.log("AI provider detection tests passed");
}

main();
