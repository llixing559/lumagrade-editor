type Mode = "grade" | "lut-scan";

type RequestBody = {
  mode?: Mode;
  images?: unknown;
  metadata?: unknown;
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

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return null;
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function isDataImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
  );
}

export async function GET() {
  return Response.json({
    enabled: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_API_KEY
      ? process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6"
      : null,
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "GPT 云端增强尚未配置" },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }

  const mode = body.mode;
  const maximumImages = mode === "grade" ? 2 : mode === "lut-scan" ? 8 : 0;
  if (
    !maximumImages ||
    !Array.isArray(body.images) ||
    body.images.length < 1 ||
    body.images.length > maximumImages ||
    !body.images.every(isDataImage)
  ) {
    return Response.json({ error: "图像输入无效" }, { status: 400 });
  }
  const images = body.images as string[];
  if (
    images.some((image) => image.length > 1_600_000) ||
    images.reduce((sum, image) => sum + image.length, 0) > 6_000_000
  ) {
    return Response.json({ error: "云端预览图过大" }, { status: 413 });
  }

  const model = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6";
  const isGrade = mode === "grade";
  const instructions = isGrade
    ? `你是专业数字影像调色师。第一张图是原始照片，第二张图（如有）是本地算法和当前 LUT 后的预览。
只判断全局曝光、白平衡、反差、高光、阴影和饱和度的剩余问题，输出幅度克制的修正增量。
保留低调、高调、日落、舞台灯等创作意图；不要把风格色偏一律中和，也不要建议局部修图。`
    : `你是电影色彩科学与 LUT 质量控制专家。这些图来自同一组已完成调色的参考成片。
判断整组照片反复出现的共同色彩倾向、阶调、分离度和风格一致性，输出用于本地统计模型的低权重校准量。
不要根据单张主体颜色臆造全局白平衡；样本不一致时降低 coherence 并写入 warnings。`;
  const metadata =
    body.metadata && typeof body.metadata === "object"
      ? JSON.stringify(body.metadata).slice(0, 3500)
      : "{}";
  const text = isGrade
    ? `本地量化分析如下：${metadata}\n请复核当前结果并返回后续修正增量。`
    : `本地训练摘要如下：${metadata}\n请扫描参考组并返回稳定的低权重校准量。`;
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text },
    ...images.map((imageUrl) => ({
      type: "input_image",
      image_url: imageUrl,
      detail: "high",
    })),
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        instructions,
        input: [{ role: "user", content }],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: isGrade ? "photo_grade" : "lut_scan",
            strict: true,
            schema: isGrade ? GRADE_SCHEMA : LUT_SCAN_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof (payload as { error?: { message?: unknown } }).error?.message ===
          "string"
          ? (payload as { error: { message: string } }).error.message
          : "OpenAI API 请求失败";
      return Response.json({ error: message }, { status: response.status });
    }
    const outputText = extractText(payload);
    if (!outputText) throw new Error("GPT 没有返回结构化结果");
    return Response.json({
      mode,
      model,
      result: JSON.parse(outputText) as unknown,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "GPT 分析超时，请稍后重试"
        : error instanceof Error
          ? error.message
          : "GPT 分析失败";
    return Response.json({ error: message }, { status: 502 });
  }
}
