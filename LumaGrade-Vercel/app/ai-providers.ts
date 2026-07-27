import type { AiConfig } from "./ai-grade";

export type AiProviderId =
  | "site"
  | "openai"
  | "azure-openai"
  | "gemini"
  | "anthropic"
  | "deepseek"
  | "doubao"
  | "openrouter"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "siliconflow"
  | "xai"
  | "mistral"
  | "groq"
  | "together"
  | "minimax"
  | "compatible"
  | "unknown";

export type AiAdapter = "site" | "openai" | "gemini" | "anthropic" | "chat";

export type AiConnection = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export type AiProviderDetection = {
  id: AiProviderId;
  label: string;
  adapter: AiAdapter;
  supportsVision: boolean;
  supportsSearch: boolean;
  officialEndpoint: boolean;
  note: string;
};

type ProviderRule = {
  id: Exclude<AiProviderId, "site" | "compatible" | "unknown">;
  label: string;
  hosts: RegExp[];
  adapter: Exclude<AiAdapter, "site">;
  vision: boolean | "model";
  search?: boolean;
  note: string;
};

const VISION_MODEL_PATTERN =
  /(vision|vl|multimodal|gpt-|gemini|claude|pixtral|llava|qwen.*vl|glm-4v|seed)/i;

const PROVIDER_RULES: ProviderRule[] = [
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    hosts: [/\.openai\.azure\.com$/i, /\.services\.ai\.azure\.com$/i],
    adapter: "chat",
    vision: "model",
    note: "使用 Azure API Key；接口需包含部署路径和 api-version。",
  },
  {
    id: "openai",
    label: "OpenAI / GPT",
    hosts: [/(^|\.)api\.openai\.com$/i],
    adapter: "openai",
    vision: true,
    search: true,
    note: "支持视觉结构化扫描与联网参考检索。",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    hosts: [
      /(^|\.)generativelanguage\.googleapis\.com$/i,
      /(^|\.)aiplatform\.googleapis\.com$/i,
    ],
    adapter: "gemini",
    vision: true,
    search: true,
    note: "Google AI Studio API Key 可用；Vertex OAuth 接口不在本页处理。",
  },
  {
    id: "anthropic",
    label: "Anthropic / Claude",
    hosts: [/(^|\.)api\.anthropic\.com$/i],
    adapter: "anthropic",
    vision: true,
    note: "支持 Claude 视觉扫描；不自动代替联网搜索。",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hosts: [/(^|\.)api\.deepseek\.com$/i],
    adapter: "chat",
    vision: false,
    note: "官方公开 API 按文本模型处理，仅发送本地聚合统计，不发送照片。",
  },
  {
    id: "doubao",
    label: "豆包 / 火山方舟",
    hosts: [
      /(^|\.)ark\.cn-beijing\.volces\.com$/i,
      /(^|\.)ark\.volces\.com$/i,
    ],
    adapter: "chat",
    vision: true,
    note: "视觉能力取决于所填模型或方舟接入点 ID。",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    hosts: [/(^|\.)openrouter\.ai$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用；能力取决于所选上游模型。",
  },
  {
    id: "qwen",
    label: "阿里云百炼 / 通义千问",
    hosts: [/(^|\.)dashscope\.aliyuncs\.com$/i],
    adapter: "chat",
    vision: "model",
    note: "按百炼 OpenAI 兼容接口调用，视觉模型名通常包含 VL。",
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    hosts: [/(^|\.)api\.moonshot\.(cn|ai)$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用，能力取决于模型。",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    hosts: [/(^|\.)open\.bigmodel\.cn$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用，视觉模型名通常包含 4V/Vision。",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    hosts: [/(^|\.)api\.siliconflow\.(cn|com)$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用；能力取决于所选模型。",
  },
  {
    id: "xai",
    label: "xAI / Grok",
    hosts: [/(^|\.)api\.x\.ai$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用；能力取决于所选模型。",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    hosts: [/(^|\.)api\.mistral\.ai$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用，Pixtral 等模型支持视觉。",
  },
  {
    id: "groq",
    label: "Groq",
    hosts: [/(^|\.)api\.groq\.com$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用；能力取决于所选模型。",
  },
  {
    id: "together",
    label: "Together AI",
    hosts: [/(^|\.)api\.together\.xyz$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用；能力取决于所选模型。",
  },
  {
    id: "minimax",
    label: "MiniMax",
    hosts: [/(^|\.)api\.minimax\.(io|chat)$/i],
    adapter: "chat",
    vision: "model",
    note: "按 OpenAI 兼容格式调用；能力取决于所选模型。",
  },
];

export const EMPTY_AI_CONNECTION: AiConnection = {
  endpoint: "",
  apiKey: "",
  model: "",
};

export const AI_ENDPOINT_PRESETS = [
  {
    id: "site",
    label: "站点默认",
    endpoint: "",
    model: "",
  },
  {
    id: "openai",
    label: "OpenAI / GPT",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5.6",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.5-flash",
  },
  {
    id: "anthropic",
    label: "Anthropic / Claude",
    endpoint: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    id: "doubao",
    label: "豆包 / 火山方舟",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
  },
] as const;

function parseEndpoint(endpoint: string) {
  try {
    return new URL(endpoint.trim());
  } catch {
    return null;
  }
}

function modelSupportsVision(model: string) {
  return VISION_MODEL_PATTERN.test(model.trim());
}

export function detectAiProvider(
  connection: Pick<AiConnection, "endpoint" | "apiKey" | "model">,
): AiProviderDetection {
  const endpoint = connection.endpoint.trim();
  if (!endpoint) {
    return {
      id: "site",
      label: "站点默认 AI",
      adapter: "site",
      supportsVision: true,
      supportsSearch: true,
      officialEndpoint: true,
      note: "使用部署者在服务端配置的默认模型与密钥。",
    };
  }

  const url = parseEndpoint(endpoint);
  const host = url?.hostname.toLowerCase() ?? "";
  const rule = PROVIDER_RULES.find((item) =>
    item.hosts.some((pattern) => pattern.test(host)),
  );
  if (rule) {
    return {
      id: rule.id,
      label: rule.label,
      adapter: rule.adapter,
      supportsVision:
        rule.vision === "model" ? modelSupportsVision(connection.model) : rule.vision,
      supportsSearch: Boolean(rule.search),
      officialEndpoint: true,
      note: rule.note,
    };
  }

  const model = connection.model.trim();
  const key = connection.apiKey.trim();
  if (/^sk-ant-/i.test(key) || /\/messages\/?$/i.test(url?.pathname ?? "")) {
    return {
      id: "anthropic",
      label: "Claude 兼容接口",
      adapter: "anthropic",
      supportsVision: true,
      supportsSearch: false,
      officialEndpoint: false,
      note: "根据密钥或模型名识别；自定义地址必须兼容 Anthropic Messages API。",
    };
  }
  if (/^AIza/.test(key) || /:generateContent$/i.test(url?.pathname ?? "")) {
    return {
      id: "gemini",
      label: "Gemini 兼容接口",
      adapter: "gemini",
      supportsVision: true,
      supportsSearch: false,
      officialEndpoint: false,
      note: "根据密钥或模型名识别；自定义地址必须兼容 Gemini generateContent。",
    };
  }

  if (url?.protocol === "https:") {
    return {
      id: "compatible",
      label: "OpenAI 兼容模型",
      adapter: "chat",
      supportsVision: modelSupportsVision(model),
      supportsSearch: false,
      officialEndpoint: false,
      note: modelSupportsVision(model)
        ? "将按 OpenAI Chat Completions 兼容格式尝试视觉输入。"
        : "未从模型名确认视觉能力，默认只发送本地聚合统计。",
    };
  }

  return {
    id: "unknown",
    label: "未识别接口",
    adapter: "chat",
    supportsVision: false,
    supportsSearch: false,
    officialEndpoint: false,
    note: "请输入有效的 HTTPS API 接口。",
  };
}

export function isAiConnectionReady(
  config: AiConfig,
  connection: AiConnection,
) {
  if (!connection.endpoint.trim()) return config.enabled;
  return Boolean(
    parseEndpoint(connection.endpoint)?.protocol === "https:" &&
      connection.apiKey.trim() &&
      connection.model.trim(),
  );
}

export function connectionForRequest(connection: AiConnection) {
  if (!connection.endpoint.trim()) return undefined;
  return {
    endpoint: connection.endpoint.trim(),
    apiKey: connection.apiKey.trim(),
    model: connection.model.trim(),
  };
}
