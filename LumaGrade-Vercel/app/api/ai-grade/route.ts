import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  AiConnection,
  AiProviderDetection,
  detectAiProvider,
} from "../../ai-providers";

export const runtime = "nodejs";

type Mode = "grade" | "lut-scan" | "reference-search";

type RequestBody = {
  mode?: Mode;
  images?: unknown;
  metadata?: unknown;
  connection?: unknown;
};

type ResolvedProvider = {
  detection: AiProviderDetection;
  endpoint: string;
  apiKey: string;
  model: string;
  searchModel: string;
};

const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    exposureEv: { type: "number", minimum: -0.6, maximum: 0.6 },
    contrast: { type: "number", minimum: -25, maximum: 25 },
    highlights: { type: "number", minimum: -40, maximum: 40 },
    shadows: { type: "number", minimum: -40, maximum: 40 },
    temperature: { type: "number", minimum: -35, maximum: 35 },
    tint: { type: "number", minimum: -35, maximum: 35 },
    saturation: { type: "number", minimum: -25, maximum: 25 },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    scene: { type: "string", maxLength: 80 },
    rationale: { type: "string", maxLength: 260 },
  },
  required: [
    "exposureEv",
    "contrast",
    "highlights",
    "shadows",
    "temperature",
    "tint",
    "saturation",
    "confidence",
    "scene",
    "rationale",
  ],
};

const LUT_SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    temperature: { type: "number", minimum: -25, maximum: 25 },
    tint: { type: "number", minimum: -25, maximum: 25 },
    saturation: { type: "number", minimum: -25, maximum: 25 },
    contrast: { type: "number", minimum: -25, maximum: 25 },
    shadows: { type: "number", minimum: -30, maximum: 30 },
    highlights: { type: "number", minimum: -30, maximum: 30 },
    redBias: { type: "number", minimum: -20, maximum: 20 },
    greenBias: { type: "number", minimum: -20, maximum: 20 },
    blueBias: { type: "number", minimum: -20, maximum: 20 },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    coherence: { type: "number", minimum: 0, maximum: 100 },
    rationale: { type: "string", maxLength: 300 },
    warnings: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 120 },
    },
  },
  required: [
    "temperature",
    "tint",
    "saturation",
    "contrast",
    "shadows",
    "highlights",
    "redBias",
    "greenBias",
    "blueBias",
    "confidence",
    "coherence",
    "rationale",
    "warnings",
  ],
};

const REFERENCE_SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matchedReference: { type: "string", maxLength: 100 },
    category: {
      type: "string",
      enum: ["camera", "film", "look", "unknown"],
    },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    sourceQuality: { type: "number", minimum: 0, maximum: 100 },
    traits: {
      type: "object",
      additionalProperties: false,
      properties: {
        temperature: { type: "number", minimum: -25, maximum: 25 },
        tint: { type: "number", minimum: -25, maximum: 25 },
        saturation: { type: "number", minimum: -25, maximum: 25 },
        contrast: { type: "number", minimum: -25, maximum: 25 },
        shadows: { type: "number", minimum: -30, maximum: 30 },
        highlights: { type: "number", minimum: -30, maximum: 30 },
        redBias: { type: "number", minimum: -20, maximum: 20 },
        greenBias: { type: "number", minimum: -20, maximum: 20 },
        blueBias: { type: "number", minimum: -20, maximum: 20 },
      },
      required: [
        "temperature",
        "tint",
        "saturation",
        "contrast",
        "shadows",
        "highlights",
        "redBias",
        "greenBias",
        "blueBias",
      ],
    },
    signature: {
      type: "object",
      additionalProperties: false,
      properties: {
        skinTone: { type: "string", maxLength: 120 },
        greens: { type: "string", maxLength: 120 },
        blues: { type: "string", maxLength: 120 },
        reds: { type: "string", maxLength: 120 },
        highlightRollOff: { type: "string", maxLength: 120 },
        shadowColor: { type: "string", maxLength: 120 },
        contrastCurve: { type: "string", maxLength: 120 },
      },
      required: [
        "skinTone",
        "greens",
        "blues",
        "reds",
        "highlightRollOff",
        "shadowColor",
        "contrastCurve",
      ],
    },
    rationale: { type: "string", maxLength: 420 },
    consensus: {
      type: "array",
      maxItems: 5,
      items: { type: "string", maxLength: 150 },
    },
    limitations: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 150 },
    },
  },
  required: [
    "matchedReference",
    "category",
    "confidence",
    "sourceQuality",
    "traits",
    "signature",
    "rationale",
    "consensus",
    "limitations",
  ],
};

const KNOWN_OFFICIAL_HOSTS = new Set([
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "api.anthropic.com",
  "api.deepseek.com",
  "ark.cn-beijing.volces.com",
  "ark.volces.com",
  "openrouter.ai",
  "api.openrouter.ai",
  "dashscope.aliyuncs.com",
  "api.moonshot.cn",
  "api.moonshot.ai",
  "open.bigmodel.cn",
  "api.siliconflow.cn",
  "api.siliconflow.com",
  "api.x.ai",
  "api.mistral.ai",
  "api.groq.com",
  "api.together.xyz",
  "api.minimax.io",
  "api.minimax.chat",
]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function recordOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown, fallback = "", maxLength = 420) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function numberValue(
  value: unknown,
  min: number,
  max: number,
  fallback = 0,
) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function stringArray(value: unknown, maximum: number, maxLength: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean)
        .slice(0, maximum)
    : [];
}

function normalizeGrade(value: unknown) {
  const source = recordOf(value);
  if (!source) throw new Error("AI 返回的单图分析不是有效对象");
  return {
    exposureEv: numberValue(source.exposureEv, -0.6, 0.6),
    contrast: numberValue(source.contrast, -25, 25),
    highlights: numberValue(source.highlights, -40, 40),
    shadows: numberValue(source.shadows, -40, 40),
    temperature: numberValue(source.temperature, -35, 35),
    tint: numberValue(source.tint, -35, 35),
    saturation: numberValue(source.saturation, -25, 25),
    confidence: numberValue(source.confidence, 0, 100, 20),
    scene: textValue(source.scene, "未分类场景", 80),
    rationale: textValue(source.rationale, "AI 未提供详细说明", 260),
  };
}

function normalizeLutScan(value: unknown) {
  const source = recordOf(value);
  if (!source) throw new Error("AI 返回的 LUT 扫描不是有效对象");
  return {
    temperature: numberValue(source.temperature, -25, 25),
    tint: numberValue(source.tint, -25, 25),
    saturation: numberValue(source.saturation, -25, 25),
    contrast: numberValue(source.contrast, -25, 25),
    shadows: numberValue(source.shadows, -30, 30),
    highlights: numberValue(source.highlights, -30, 30),
    redBias: numberValue(source.redBias, -20, 20),
    greenBias: numberValue(source.greenBias, -20, 20),
    blueBias: numberValue(source.blueBias, -20, 20),
    confidence: numberValue(source.confidence, 0, 100, 20),
    coherence: numberValue(source.coherence, 0, 100, 20),
    rationale: textValue(source.rationale, "AI 未提供详细说明", 300),
    warnings: stringArray(source.warnings, 4, 120),
  };
}

function normalizeReference(value: unknown) {
  const source = recordOf(value);
  if (!source) throw new Error("AI 返回的联网参考不是有效对象");
  const traits = recordOf(source.traits) ?? {};
  const signature = recordOf(source.signature) ?? {};
  const category = ["camera", "film", "look", "unknown"].includes(
    String(source.category),
  )
    ? String(source.category)
    : "unknown";
  return {
    matchedReference: textValue(source.matchedReference, "未确认参考", 100),
    category,
    confidence: numberValue(source.confidence, 0, 100, 15),
    sourceQuality: numberValue(source.sourceQuality, 0, 100, 15),
    traits: {
      temperature: numberValue(traits.temperature, -25, 25),
      tint: numberValue(traits.tint, -25, 25),
      saturation: numberValue(traits.saturation, -25, 25),
      contrast: numberValue(traits.contrast, -25, 25),
      shadows: numberValue(traits.shadows, -30, 30),
      highlights: numberValue(traits.highlights, -30, 30),
      redBias: numberValue(traits.redBias, -20, 20),
      greenBias: numberValue(traits.greenBias, -20, 20),
      blueBias: numberValue(traits.blueBias, -20, 20),
    },
    signature: {
      skinTone: textValue(signature.skinTone, "未确认", 120),
      greens: textValue(signature.greens, "未确认", 120),
      blues: textValue(signature.blues, "未确认", 120),
      reds: textValue(signature.reds, "未确认", 120),
      highlightRollOff: textValue(signature.highlightRollOff, "未确认", 120),
      shadowColor: textValue(signature.shadowColor, "未确认", 120),
      contrastCurve: textValue(signature.contrastCurve, "未确认", 120),
    },
    rationale: textValue(source.rationale, "AI 未提供详细说明", 420),
    consensus: stringArray(source.consensus, 5, 150),
    limitations: stringArray(source.limitations, 4, 150),
  };
}

function parseJsonText(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 没有返回可解析的 JSON");
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }
}

function normalizeResult(mode: Mode, value: unknown) {
  if (mode === "grade") return normalizeGrade(value);
  if (mode === "lut-scan") return normalizeLutScan(value);
  return normalizeReference(value);
}

function schemaFor(mode: Mode) {
  if (mode === "grade") return GRADE_SCHEMA;
  if (mode === "lut-scan") return LUT_SCAN_SCHEMA;
  return REFERENCE_SEARCH_SCHEMA;
}

function isDataImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
  );
}

function splitDataImage(value: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i.exec(value);
  if (!match) throw new Error("图像预览格式无效");
  return { mimeType: match[1].toLowerCase(), data: match[2] };
}

function meaningfulReferenceName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 80);
  if (name.length < 3) return null;
  const genericNames = new Set([
    "我的专属色彩",
    "我的lut",
    "自定义lut",
    "专属lut",
    "custom lut",
    "my lut",
    "untitled",
  ]);
  return genericNames.has(name.toLocaleLowerCase()) ? null : name;
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return false;
  }
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224
  );
}

async function validateEndpoint(rawEndpoint: string) {
  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    throw new Error("API 接口地址无效");
  }
  if (url.protocol !== "https:") throw new Error("API 接口必须使用 HTTPS");
  if (url.username || url.password) {
    throw new Error("请不要把密钥写在 API 接口地址中");
  }
  if (
    ["key", "api_key", "token", "access_token"].some((name) =>
      url.searchParams.has(name),
    )
  ) {
    throw new Error("请把密钥填写在 API Key 栏，不要放在网址参数中");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("API 接口主机不可用");
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("不允许访问内网 API 地址");
  } else if (!KNOWN_OFFICIAL_HOSTS.has(host)) {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
      throw new Error("自定义 API 地址必须解析到公开网络");
    }
  }
  return url;
}

function connectionRecord(value: unknown): AiConnection | null {
  const record = recordOf(value);
  if (!record) return null;
  return {
    endpoint: textValue(record.endpoint, "", 500),
    apiKey: textValue(record.apiKey, "", 600),
    model: textValue(record.model, "", 160),
  };
}

async function resolveProvider(value: unknown): Promise<ResolvedProvider> {
  const connection = connectionRecord(value);
  if (!connection?.endpoint) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("站点未配置默认 AI，请填写自己的 API 接口");
    const model = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6";
    return {
      detection: detectAiProvider({
        endpoint: "https://api.openai.com/v1",
        apiKey,
        model,
      }),
      endpoint: "https://api.openai.com/v1",
      apiKey,
      model,
      searchModel:
        process.env.OPENAI_SEARCH_MODEL?.trim() || model,
    };
  }
  if (!connection.apiKey || !connection.model) {
    throw new Error("请完整填写 API 接口、API Key 和模型 / 接入点 ID");
  }
  const url = await validateEndpoint(connection.endpoint);
  const detection = detectAiProvider(connection);
  if (detection.id === "unknown") throw new Error(detection.note);
  return {
    detection,
    endpoint: url.toString(),
    apiKey: connection.apiKey,
    model: connection.model,
    searchModel: connection.model,
  };
}

function endpointWithPath(rawEndpoint: string, suffix: string) {
  const url = new URL(rawEndpoint);
  const cleanPath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${cleanPath}${suffix}`;
  return url.toString();
}

function openAiEndpoint(provider: ResolvedProvider) {
  const url = new URL(provider.endpoint);
  if (url.hostname === "api.openai.com") {
    url.pathname = "/v1/responses";
    url.search = "";
    return url.toString();
  }
  if (/\/responses\/?$/.test(url.pathname)) return url.toString();
  return endpointWithPath(provider.endpoint, "/responses");
}

function geminiEndpoint(provider: ResolvedProvider) {
  const url = new URL(provider.endpoint);
  if (/:generateContent$/.test(url.pathname)) return url.toString();
  const path = url.pathname.replace(/\/+$/, "");
  const versionPath = /\/v1(?:beta)?$/.test(path) ? path : `${path}/v1beta`;
  url.pathname = `${versionPath}/models/${encodeURIComponent(
    provider.model,
  )}:generateContent`;
  url.search = "";
  return url.toString();
}

function anthropicEndpoint(provider: ResolvedProvider) {
  const url = new URL(provider.endpoint);
  if (/\/messages\/?$/.test(url.pathname)) return url.toString();
  return endpointWithPath(provider.endpoint, "/messages");
}

function chatEndpoint(provider: ResolvedProvider) {
  const url = new URL(provider.endpoint);
  if (
    provider.detection.id === "azure-openai" &&
    /\/openai\/deployments\//.test(url.pathname)
  ) {
    return url.toString();
  }
  if (/\/chat\/completions\/?$/.test(url.pathname)) return url.toString();
  return endpointWithPath(provider.endpoint, "/chat/completions");
}

function promptFor(mode: Mode, metadata: Record<string, unknown>) {
  const summary = JSON.stringify(metadata).slice(
    0,
    mode === "reference-search" ? 6000 : 4000,
  );
  if (mode === "grade") {
    return {
      instructions: `你是专业数字影像调色师。第一张图是原始照片，第二张图（如有）是本地算法和当前 LUT 后的预览。只判断全局曝光、白平衡、反差、高光、阴影和饱和度的剩余问题，输出幅度克制的修正增量。保留低调、高调、日落、舞台灯等创作意图；不要把风格色偏一律中和，也不要建议局部修图。`,
      input: `本地量化分析如下：${summary}\n请复核当前结果并返回后续修正增量。`,
    };
  }
  if (mode === "lut-scan") {
    return {
      instructions: `你是电影色彩科学与 LUT 质量控制专家。输入照片来自同一组已完成调色的参考成片；如果没有照片，则只能依据本地聚合统计。判断整组照片反复出现的共同色彩倾向、阶调、分离度和风格一致性，输出用于本地统计模型的低权重校准量。不要根据单张主体颜色臆造全局白平衡；样本不一致时降低 coherence 并写入 warnings。`,
      input: `本地训练摘要如下：${summary}\n请返回稳定、克制的低权重校准量。`,
    };
  }
  return {
    instructions: `你是影像色彩研究员。必须先联网检索用户给出的相机、胶片或影像风格名称，再把可靠网页中反复出现的色彩描述整理为低权重 LUT 先验。优先厂商官方资料、官方样片和有可复核样片的专业评测；社区共识只能补充。不要下载、复制或声称还原专有 LUT，不要把营销措辞当测量数据。资料冲突或证据不足时降低 confidence/sourceQuality，category 使用 unknown。数值只能表示克制的风格倾向，不能声称复现传感器真实光谱响应。`,
    input: `目标名称：${String(metadata.projectName ?? "")}\n本地照片统计摘要：${summary}\n请检索并判断最可信的对应对象；用户照片统计始终是主模型。`,
  };
}

function extractOpenAiText(payload: unknown) {
  const source = recordOf(payload);
  if (!source) return null;
  if (typeof source.output_text === "string") return source.output_text;
  if (!Array.isArray(source.output)) return null;
  for (const item of source.output) {
    const content = recordOf(item)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = recordOf(part)?.text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function safeSource(value: unknown) {
  const source = recordOf(value);
  const rawUrl = typeof source?.url === "string" ? source.url : "";
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return {
      title: textValue(
        source?.title,
        url.hostname.replace(/^www\./, ""),
        180,
      ),
      url: url.toString(),
      domain: url.hostname.replace(/^www\./, ""),
    };
  } catch {
    return null;
  }
}

function extractOpenAiSources(payload: unknown) {
  const output = recordOf(payload)?.output;
  if (!Array.isArray(output)) return [];
  const sources: Array<{ title: string; url: string; domain: string }> = [];
  const add = (candidate: unknown) => {
    const source = safeSource(candidate);
    if (source && !sources.some((item) => item.url === source.url)) {
      sources.push(source);
    }
  };
  for (const item of output) {
    const record = recordOf(item);
    if (!record) continue;
    const action = recordOf(record.action);
    if (Array.isArray(action?.sources)) action.sources.forEach(add);
    if (!Array.isArray(record.content)) continue;
    for (const content of record.content) {
      const annotations = recordOf(content)?.annotations;
      if (Array.isArray(annotations)) annotations.forEach(add);
    }
  }
  return sources.slice(0, 8);
}

function providerError(payload: unknown, fallback: string) {
  const source = recordOf(payload);
  const error = recordOf(source?.error);
  if (typeof error?.message === "string") return error.message.slice(0, 500);
  if (typeof source?.message === "string") return source.message.slice(0, 500);
  return fallback;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeout = 45_000,
) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("AI 接口返回了重定向，出于安全原因未继续访问");
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return { response, payload };
}

async function callOpenAi(
  provider: ResolvedProvider,
  mode: Mode,
  images: string[],
  metadata: Record<string, unknown>,
) {
  const prompts = promptFor(mode, metadata);
  const schema = schemaFor(mode);
  if (mode === "reference-search") {
    const { response, payload } = await fetchJson(
      openAiEndpoint(provider),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: provider.searchModel,
          store: false,
          reasoning: { effort: "low" },
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
          include: ["web_search_call.action.sources"],
          instructions: prompts.instructions,
          input: prompts.input,
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "lut_reference_search",
              strict: true,
              schema,
            },
          },
        }),
      },
      55_000,
    );
    if (!response.ok) {
      throw new Error(providerError(payload, "OpenAI 联网参考检索失败"));
    }
    const text = extractOpenAiText(payload);
    if (!text) throw new Error("OpenAI 没有返回结构化结果");
    return {
      value: parseJsonText(text),
      sources: extractOpenAiSources(payload),
    };
  }

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: prompts.input },
    ...images.map((imageUrl) => ({
      type: "input_image",
      image_url: imageUrl,
      detail: "high",
    })),
  ];
  const { response, payload } = await fetchJson(openAiEndpoint(provider), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      store: false,
      reasoning: { effort: "low" },
      instructions: prompts.instructions,
      input: [{ role: "user", content }],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: mode === "grade" ? "photo_grade" : "lut_scan",
          strict: true,
          schema,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(providerError(payload, "OpenAI API 请求失败"));
  const text = extractOpenAiText(payload);
  if (!text) throw new Error("OpenAI 没有返回结构化结果");
  return { value: parseJsonText(text), sources: [] };
}

function extractGeminiText(payload: unknown) {
  const candidates = recordOf(payload)?.candidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    const parts = recordOf(recordOf(candidate)?.content)?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const text = recordOf(part)?.text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function extractGeminiSources(payload: unknown) {
  const candidates = recordOf(payload)?.candidates;
  if (!Array.isArray(candidates)) return [];
  const sources: Array<{ title: string; url: string; domain: string }> = [];
  for (const candidate of candidates) {
    const chunks = recordOf(candidate)?.groundingMetadata;
    const groundingChunks = recordOf(chunks)?.groundingChunks;
    if (!Array.isArray(groundingChunks)) continue;
    for (const chunk of groundingChunks) {
      const web = recordOf(recordOf(chunk)?.web);
      const source = safeSource({
        title: web?.title,
        url: web?.uri,
      });
      if (source && !sources.some((item) => item.url === source.url)) {
        sources.push(source);
      }
    }
  }
  return sources.slice(0, 8);
}

async function callGemini(
  provider: ResolvedProvider,
  mode: Mode,
  images: string[],
  metadata: Record<string, unknown>,
) {
  const prompts = promptFor(mode, metadata);
  const parts: Array<Record<string, unknown>> = [{ text: prompts.input }];
  for (const image of images) {
    const parsed = splitDataImage(image);
    parts.push({
      inline_data: {
        mime_type: parsed.mimeType,
        data: parsed.data,
      },
    });
  }
  const isSearch = mode === "reference-search";
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: prompts.instructions }] },
    contents: [{ role: "user", parts }],
    generationConfig: isSearch
      ? { temperature: 0.1 }
      : {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: schemaFor(mode),
        },
  };
  if (isSearch) {
    body.tools = [{ google_search: {} }];
    parts[0] = {
      text: `${prompts.input}\n必须只返回 JSON 对象，结构严格符合：${JSON.stringify(
        schemaFor(mode),
      )}`,
    };
  }
  const { response, payload } = await fetchJson(
    geminiEndpoint(provider),
    {
      method: "POST",
      headers: {
        "x-goog-api-key": provider.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    isSearch ? 55_000 : 45_000,
  );
  if (!response.ok) throw new Error(providerError(payload, "Gemini API 请求失败"));
  const text = extractGeminiText(payload);
  if (!text) throw new Error("Gemini 没有返回结构化结果");
  return {
    value: parseJsonText(text),
    sources: isSearch ? extractGeminiSources(payload) : [],
  };
}

function extractAnthropicText(payload: unknown) {
  const content = recordOf(payload)?.content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    const text = recordOf(part)?.text;
    if (typeof text === "string") return text;
  }
  return null;
}

async function callAnthropic(
  provider: ResolvedProvider,
  mode: Mode,
  images: string[],
  metadata: Record<string, unknown>,
) {
  if (mode === "reference-search") {
    throw new Error("Claude 接口未启用联网参考工具，请改用 OpenAI 或 Gemini");
  }
  const prompts = promptFor(mode, metadata);
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `${prompts.input}\n只返回 JSON 对象，严格符合此结构：${JSON.stringify(
        schemaFor(mode),
      )}`,
    },
  ];
  for (const image of images) {
    const parsed = splitDataImage(image);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: parsed.mimeType,
        data: parsed.data,
      },
    });
  }
  const { response, payload } = await fetchJson(anthropicEndpoint(provider), {
    method: "POST",
    headers: {
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1600,
      temperature: 0.1,
      system: prompts.instructions,
      messages: [{ role: "user", content }],
    }),
  });
  if (!response.ok) throw new Error(providerError(payload, "Claude API 请求失败"));
  const text = extractAnthropicText(payload);
  if (!text) throw new Error("Claude 没有返回结构化结果");
  return { value: parseJsonText(text), sources: [] };
}

function extractChatText(payload: unknown) {
  const choices = recordOf(payload)?.choices;
  if (!Array.isArray(choices)) return null;
  for (const choice of choices) {
    const content = recordOf(recordOf(choice)?.message)?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const part of content) {
        const text = recordOf(part)?.text;
        if (typeof text === "string") return text;
      }
    }
  }
  return null;
}

async function callCompatibleChat(
  provider: ResolvedProvider,
  mode: Mode,
  images: string[],
  metadata: Record<string, unknown>,
) {
  if (mode === "reference-search") {
    throw new Error(
      `${provider.detection.label} 未配置可验证的联网搜索工具，请改用 OpenAI 或 Gemini`,
    );
  }
  const prompts = promptFor(mode, metadata);
  const userContent = provider.detection.supportsVision
    ? [
        {
          type: "text",
          text: `${prompts.input}\n只返回 JSON 对象，严格符合：${JSON.stringify(
            schemaFor(mode),
          )}`,
        },
        ...images.map((imageUrl) => ({
          type: "image_url",
          image_url: { url: imageUrl },
        })),
      ]
    : `${prompts.input}\n当前接口按文本统计模式运行，没有原图视觉输入。只返回 JSON 对象，严格符合：${JSON.stringify(
        schemaFor(mode),
      )}`;
  const requestBody = {
    model: provider.model,
    temperature: 0.1,
    messages: [
      { role: "system", content: prompts.instructions },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.detection.id === "azure-openai") {
    headers["api-key"] = provider.apiKey;
  } else {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  const execute = (body: Record<string, unknown>) =>
    fetchJson(chatEndpoint(provider), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  let { response, payload } = await execute(requestBody);
  if (response.status === 400) {
    const retryBody = { ...requestBody } as Record<string, unknown>;
    delete retryBody.response_format;
    ({ response, payload } = await execute(retryBody));
  }
  if (!response.ok) {
    throw new Error(
      providerError(payload, `${provider.detection.label} API 请求失败`),
    );
  }
  const text = extractChatText(payload);
  if (!text) throw new Error(`${provider.detection.label} 没有返回结构化结果`);
  return { value: parseJsonText(text), sources: [] };
}

async function runProvider(
  provider: ResolvedProvider,
  mode: Mode,
  images: string[],
  metadata: Record<string, unknown>,
) {
  if (provider.detection.adapter === "openai") {
    return callOpenAi(provider, mode, images, metadata);
  }
  if (provider.detection.adapter === "gemini") {
    return callGemini(provider, mode, images, metadata);
  }
  if (provider.detection.adapter === "anthropic") {
    return callAnthropic(provider, mode, images, metadata);
  }
  return callCompatibleChat(provider, mode, images, metadata);
}

export async function GET() {
  const enabled = Boolean(process.env.OPENAI_API_KEY);
  return Response.json({
    enabled,
    model: enabled
      ? process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6"
      : null,
    searchModel: enabled
      ? process.env.OPENAI_SEARCH_MODEL?.trim() ||
        process.env.OPENAI_VISION_MODEL?.trim() ||
        "gpt-5.6"
      : null,
  });
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }

  const mode = body.mode;
  if (
    mode !== "grade" &&
    mode !== "lut-scan" &&
    mode !== "reference-search"
  ) {
    return Response.json({ error: "AI 扫描模式无效" }, { status: 400 });
  }

  let provider: ResolvedProvider;
  try {
    provider = await resolveProvider(body.connection);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "AI 接口配置无效" },
      { status: 400 },
    );
  }

  const metadata = recordOf(body.metadata) ?? {};
  if (mode === "reference-search") {
    const projectName = meaningfulReferenceName(metadata.projectName);
    if (!projectName) {
      return Response.json(
        { error: "请填写具体参考名称，例如“徕卡 M9”或“富士 Classic Chrome”" },
        { status: 400 },
      );
    }
    if (!provider.detection.supportsSearch) {
      return Response.json(
        {
          error: `${provider.detection.label} 当前未接入可验证的联网搜索工具，请改用 OpenAI 或 Gemini`,
        },
        { status: 400 },
      );
    }
    metadata.projectName = projectName;
  }

  const maximumImages = mode === "grade" ? 2 : mode === "lut-scan" ? 8 : 0;
  const rawImages = Array.isArray(body.images) ? body.images : [];
  if (
    rawImages.length > maximumImages ||
    !rawImages.every(isDataImage) ||
    (provider.detection.supportsVision &&
      mode !== "reference-search" &&
      rawImages.length < 1)
  ) {
    return Response.json({ error: "图像输入无效" }, { status: 400 });
  }
  const images = provider.detection.supportsVision
    ? (rawImages as string[])
    : [];
  if (
    images.some((image) => image.length > 1_600_000) ||
    images.reduce((sum, image) => sum + image.length, 0) > 6_000_000
  ) {
    return Response.json({ error: "AI 扫描预览图过大" }, { status: 413 });
  }

  try {
    const output = await runProvider(provider, mode, images, metadata);
    const result = normalizeResult(mode, output.value);
    if (mode === "reference-search") {
      const reference = result as ReturnType<typeof normalizeReference>;
      if (!output.sources.length) {
        reference.confidence = Math.min(reference.confidence, 35);
        reference.sourceQuality = Math.min(reference.sourceQuality, 25);
        reference.limitations = [
          ...reference.limitations,
          "没有取得可展示的网页来源，结果不会参与 LUT 求解。",
        ].slice(0, 4);
      }
      return Response.json({
        mode,
        model: provider.model,
        provider: {
          id: provider.detection.id,
          label: provider.detection.label,
          vision: provider.detection.supportsVision,
          search: provider.detection.supportsSearch,
        },
        result: {
          ...reference,
          query: String(metadata.projectName ?? ""),
          sources: output.sources,
        },
      });
    }
    return Response.json({
      mode,
      model: provider.model,
      provider: {
        id: provider.detection.id,
        label: provider.detection.label,
        vision: provider.detection.supportsVision,
        search: provider.detection.supportsSearch,
      },
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `${provider.detection.label} 分析超时，请稍后重试`
        : error instanceof Error
          ? error.message
          : `${provider.detection.label} 分析失败`;
    return Response.json({ error: message }, { status: 502 });
  }
}
