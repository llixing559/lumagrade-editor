"use client";

import {
  AI_ENDPOINT_PRESETS,
  AiConnection,
  detectAiProvider,
} from "./ai-providers";
import type { AiConfig } from "./ai-grade";

type AiConnectionPanelProps = {
  config: AiConfig;
  value: AiConnection;
  onChange: (connection: AiConnection) => void;
  disabled?: boolean;
  compact?: boolean;
};

export default function AiConnectionPanel({
  config,
  value,
  onChange,
  disabled = false,
  compact = false,
}: AiConnectionPanelProps) {
  const detection = detectAiProvider(value);
  const selectedPreset =
    AI_ENDPOINT_PRESETS.find((preset) => preset.endpoint === value.endpoint)?.id ??
    "custom";
  const siteReady = !value.endpoint && config.enabled;

  return (
    <section
      className={`aiConnectionPanel ${compact ? "compact" : ""}`}
      aria-label="AI API 接口"
    >
      <div className="aiConnectionHeading">
        <div>
          <strong>AI API 接口</strong>
          <small>自动识别厂商与协议</small>
        </div>
        <em className={detection.id === "unknown" ? "unknown" : ""}>
          {detection.label}
        </em>
      </div>

      <label>
        <span>快速选择</span>
        <select
          value={selectedPreset}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === "custom") {
              onChange({
                endpoint: value.endpoint || "https://",
                model: value.model,
                apiKey: value.apiKey,
              });
              return;
            }
            const preset = AI_ENDPOINT_PRESETS.find(
              (item) => item.id === event.target.value,
            );
            if (!preset) return;
            onChange({
              endpoint: preset.endpoint,
              model: preset.model,
              apiKey: "",
            });
          }}
        >
          {AI_ENDPOINT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          <option value="custom">自定义 OpenAI 兼容接口</option>
        </select>
      </label>

      {value.endpoint ? (
        <div className="aiConnectionFields">
          <label>
            <span>API 接口</span>
            <input
              type="url"
              inputMode="url"
              value={value.endpoint}
              disabled={disabled}
              placeholder="https://api.example.com/v1"
              onChange={(event) =>
                onChange({ ...value, endpoint: event.target.value })
              }
            />
          </label>
          <label>
            <span>模型 / 接入点 ID</span>
            <input
              value={value.model}
              disabled={disabled}
              spellCheck={false}
              placeholder={
                detection.id === "doubao" ? "ep-... 或模型 ID" : "model-name"
              }
              onChange={(event) =>
                onChange({ ...value, model: event.target.value })
              }
            />
          </label>
          <label className="aiKeyField">
            <span>API Key</span>
            <input
              type="password"
              value={value.apiKey}
              disabled={disabled}
              autoComplete="new-password"
              spellCheck={false}
              placeholder="仅本次页面使用"
              onChange={(event) =>
                onChange({ ...value, apiKey: event.target.value })
              }
            />
          </label>
        </div>
      ) : (
        <p className={siteReady ? "aiSiteStatus ready" : "aiSiteStatus"}>
          {siteReady
            ? `${config.model ?? "默认模型"} 已由部署端配置`
            : "站点未配置默认密钥；请选择厂商并填写自己的 API。"}
        </p>
      )}

      <div className="aiCapabilityLine">
        <span>{detection.supportsVision ? "视觉扫描" : "统计扫描"}</span>
        <span>{detection.supportsSearch ? "联网参考" : "不含联网搜索"}</span>
        <span>{detection.officialEndpoint ? "官方接口" : "兼容接口"}</span>
      </div>
      <p className="aiProviderNote">{detection.note}</p>
      <small className="aiPrivacyNote">
        密钥仅保存在当前页面内，刷新即清除；随单次 HTTPS 请求转发，服务端不保存。
      </small>
    </section>
  );
}
