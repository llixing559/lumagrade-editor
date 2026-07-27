"use client";

import {
  ChangeEvent,
  DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Lut3D } from "./lut";
import {
  LutTrainingResult,
  MIN_REFERENCE_IMAGES,
  RECOMMENDED_REFERENCE_IMAGES,
  serializeCube,
  trainReferenceLut,
  TrainingProgress,
} from "./lut-trainer";

type LutCreatorProps = {
  onUseLut: (lut: Lut3D) => void;
  onExit: () => void;
  showToast: (message: string) => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function progressValue(progress: TrainingProgress | null) {
  if (!progress) return 0;
  if (progress.phase === "decode") {
    return Math.round((progress.completed / Math.max(1, progress.total)) * 78);
  }
  if (progress.phase === "solve") return progress.completed ? 88 : 82;
  return Math.round(88 + (progress.completed / Math.max(1, progress.total)) * 12);
}

function confidenceLabel(confidence: number) {
  if (confidence >= 82) return "高可信";
  if (confidence >= 64) return "可用";
  return "建议补样";
}

function Metric({
  label,
  value,
  display,
}: {
  label: string;
  value: number;
  display?: string;
}) {
  return (
    <div className="creatorMetric">
      <div>
        <span>{label}</span>
        <output>{display ?? `${Math.round(value)}%`}</output>
      </div>
      <i>
        <b style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
      </i>
    </div>
  );
}

export default function LutCreator({
  onUseLut,
  onExit,
  showToast,
}: LutCreatorProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const abortController = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [result, setResult] = useState<LutTrainingResult | null>(null);
  const [projectName, setProjectName] = useState("我的专属色彩");

  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const remaining = Math.max(0, MIN_REFERENCE_IMAGES - files.length);
  const canTrain = files.length >= MIN_REFERENCE_IMAGES && !isTraining;

  const addFiles = (incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    );
    const invalidCount = Array.from(incoming).length - valid.length;
    setFiles((current) => {
      const keys = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      );
      const unique = valid.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
      return [...current, ...unique];
    });
    setResult(null);
    setProgress(null);
    if (invalidCount) showToast(`${invalidCount} 个不支持的文件已跳过`);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const removeFile = (target: File) => {
    if (isTraining) return;
    setFiles((current) => current.filter((file) => file !== target));
    setResult(null);
  };

  const train = async () => {
    if (!canTrain) return;
    const controller = new AbortController();
    abortController.current = controller;
    setIsTraining(true);
    setResult(null);
    setProgress({
      phase: "decode",
      completed: 0,
      total: files.length,
      fileName: files[0]?.name,
    });
    try {
      const trained = await trainReferenceLut(
        files,
        projectName.trim() || "LumaGrade Custom Look",
        setProgress,
        controller.signal,
      );
      setResult(trained);
      showToast(`33³ LUT 已生成 · 可信度 ${trained.metrics.confidence}%`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        showToast("训练已取消");
      } else {
        showToast(error instanceof Error ? error.message : "LUT 生成失败");
      }
    } finally {
      abortController.current = null;
      setIsTraining(false);
    }
  };

  const download = () => {
    if (!result) return;
    const renamedLut = {
      ...result.lut,
      title: projectName.trim() || result.lut.title,
    };
    const blob = new Blob([serializeCube(renamedLut)], {
      type: "text/plain;charset=utf-8",
    });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const safeName =
      projectName.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "LumaGrade-LUT";
    link.href = url;
    link.download = `${safeName}-33.cube`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("33³ .cube 文件已下载");
  };

  return (
    <>
      <section
        className={`creatorStage ${isDragging ? "isDragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div className="creatorHero">
          <div>
            <span className="creatorEyebrow">LUMAGRADE COLOR MODEL 01</span>
            <h1>用你的照片，训练专属 33³ LUT</h1>
            <p>
              无需原图对照。系统从一组完成调色的照片中提取共同的色相响应、
              屏幕阶调、色彩分离、饱和度、层次和反差，再生成标准 `.cube` 文件。
            </p>
          </div>
          <button className="creatorExit" onClick={onExit}>
            返回编辑器
          </button>
        </div>

        <div className="creatorDatasetHeader">
          <div>
            <span>训练数据集</span>
            <small>
              最低 {MIN_REFERENCE_IMAGES} 张 · 推荐 {RECOMMENDED_REFERENCE_IMAGES}–50
              张 · 无硬性上限
            </small>
          </div>
          <div className={remaining ? "datasetCount" : "datasetCount ready"}>
            <strong>{files.length}</strong>
            <span>{remaining ? `还差 ${remaining} 张` : "可以训练"}</span>
          </div>
        </div>

        <button
          className="creatorDrop"
          onClick={() => fileInput.current?.click()}
          disabled={isTraining}
        >
          <span className="creatorDropIcon">
            <i />
            <i />
            <i />
          </span>
          <strong>拖入一组已经完成调色的照片</strong>
          <small>支持 JPG、PNG、WebP，可分多次添加，重复文件自动忽略</small>
          <em>选择参考照片</em>
        </button>

        <div className="datasetSummary">
          <div>
            <span>照片</span>
            <strong>{files.length}</strong>
          </div>
          <div>
            <span>数据量</span>
            <strong>{formatBytes(totalSize)}</strong>
          </div>
          <div>
            <span>分析方式</span>
            <strong>逐张取样</strong>
          </div>
          <div>
            <span>隐私</span>
            <strong>本地处理</strong>
          </div>
        </div>

        {files.length > 0 && (
          <div className="creatorFileList">
            <div className="creatorFileHeading">
              <span>已加入的照片</span>
              <button
                disabled={isTraining}
                onClick={() => {
                  setFiles([]);
                  setResult(null);
                  setProgress(null);
                }}
              >
                清空
              </button>
            </div>
            <div>
              {files.slice(0, 18).map((file, index) => (
                <article key={`${file.name}:${file.size}:${file.lastModified}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong title={file.name}>{file.name}</strong>
                    <small>{formatBytes(file.size)}</small>
                  </div>
                  <button
                    aria-label={`移除 ${file.name}`}
                    onClick={() => removeFile(file)}
                    disabled={isTraining}
                  >
                    ×
                  </button>
                </article>
              ))}
              {files.length > 18 && (
                <article className="moreFiles">
                  <span>＋</span>
                  <div>
                    <strong>另外 {files.length - 18} 张</strong>
                    <small>训练时将全部分析</small>
                  </div>
                </article>
              )}
            </div>
          </div>
        )}

        {isTraining && (
          <div className="trainingProgress" aria-live="polite">
            <div>
              <span>
                {progress?.phase === "decode"
                  ? "正在校准色彩样本"
                  : progress?.phase === "solve"
                    ? "正在求解色彩模型"
                    : "正在生成 35,937 个色彩节点"}
              </span>
              <output>{progressValue(progress)}%</output>
            </div>
            <i>
              <b style={{ width: `${progressValue(progress)}%` }} />
            </i>
            <small title={progress?.fileName}>
              {progress?.phase === "decode"
                ? `${progress.completed + 1}/${progress.total} · ${progress.fileName ?? ""}`
                : progress?.phase === "solve"
                  ? "阶调、色相响应与色彩分离模型"
                  : "33 × 33 × 33 标准三维色彩立方体"}
            </small>
          </div>
        )}

        {result && (
          <div className="creatorSuccess">
            <span>✓</span>
            <div>
              <strong>色彩模型训练完成</strong>
              <small>
                已分析 {result.metrics.analyzedImages} 张照片、
                {result.metrics.sampledPixels.toLocaleString()} 个像素样本，生成
                35,937 个色彩节点。
              </small>
            </div>
          </div>
        )}

        {isDragging && (
          <div className="creatorDragOverlay">
            <strong>松开，加入训练数据集</strong>
            <span>照片不会上传到服务器</span>
          </div>
        )}

        <input
          ref={fileInput}
          className="hiddenInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleInput}
        />
      </section>

      <aside className="rightPanel creatorInspector">
        <div className="creatorInspectorTitle">
          <div>
            <span>模型控制台</span>
            <small>REFERENCE → 33³</small>
          </div>
          {result && (
            <em className={result.metrics.confidence >= 64 ? "good" : ""}>
              {confidenceLabel(result.metrics.confidence)}
            </em>
          )}
        </div>

        <label className="creatorName">
          <span>LUT 名称</span>
          <input
            value={projectName}
            maxLength={48}
            disabled={isTraining}
            onChange={(event) => setProjectName(event.target.value)}
          />
        </label>

        {!result ? (
          <>
            <div className="creatorRequirements">
              <strong>如何获得稳定结果</strong>
              <ul>
                <li>所有照片必须来自同一种调色风格</li>
                <li>尽量包含人像、自然、城市和室内场景</li>
                <li>同时提供高光、正常曝光与暗光画面</li>
                <li>不要混入黑白照片或完全不同的滤镜</li>
              </ul>
            </div>
            <div className="creatorScope">
              <span>33³ LUT 可以学习</span>
              <p>全局色相、白平衡倾向、明暗曲线、反差和饱和度响应。</p>
              <span>无法写入 LUT</span>
              <p>锐化、降噪、颗粒、局部蒙版、景深和局部光照。</p>
            </div>
          </>
        ) : (
          <>
            <div className="confidenceScore">
              <span>模型可信度</span>
              <strong>{result.metrics.confidence}</strong>
              <small>/ 100</small>
            </div>
            <div className="creatorMetrics">
              <Metric label="色相覆盖" value={result.metrics.hueCoverage} />
              <Metric label="阶调覆盖" value={result.metrics.toneCoverage} />
              <Metric label="中性样本" value={result.metrics.neutralCoverage} />
              <Metric label="色彩分离" value={result.metrics.separation} />
              <Metric label="饱和响应" value={result.metrics.saturation} />
              <Metric label="灰阶层次" value={result.metrics.gradation} />
              <Metric label="全局反差" value={result.metrics.contrast} />
            </div>
            <div className="spectralReadout">
              <span>RGB 光谱倾向近似</span>
              <div>
                {result.metrics.spectralBalance.map((value, index) => (
                  <i
                    key={index}
                    className={["red", "green", "blue"][index]}
                    style={{ height: `${clampBar(value * 54)}px` }}
                  />
                ))}
              </div>
              <small>
                R {result.metrics.spectralBalance[0].toFixed(2)} · G{" "}
                {result.metrics.spectralBalance[1].toFixed(2)} · B{" "}
                {result.metrics.spectralBalance[2].toFixed(2)}
              </small>
            </div>
            <div className="toneReadout">
              <span>屏幕阶调锚点</span>
              <div>
                <b style={{ left: `${result.metrics.blackPoint * 100}%` }} />
                <b style={{ left: `${result.metrics.midpoint * 100}%` }} />
                <b style={{ left: `${result.metrics.whitePoint * 100}%` }} />
              </div>
              <small>
                黑 {result.metrics.blackPoint.toFixed(2)} · 中{" "}
                {result.metrics.midpoint.toFixed(2)} · 白{" "}
                {result.metrics.whitePoint.toFixed(2)}
              </small>
            </div>
            {result.metrics.warnings.length > 0 && (
              <div className="creatorWarnings">
                {result.metrics.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
          </>
        )}

        <div className="creatorInspectorSpacer" />
        {result ? (
          <div className="creatorResultActions">
            <button className="primary" onClick={download}>
              下载 33³ `.cube`
            </button>
            <button
              onClick={() =>
                onUseLut({
                  ...result.lut,
                  title: projectName.trim() || result.lut.title,
                })
              }
            >
              在编辑器中试用
            </button>
            <button
              className="subtle"
              onClick={() => {
                setResult(null);
                setProgress(null);
              }}
            >
              重新训练
            </button>
          </div>
        ) : (
          <div className="creatorResultActions">
            <button
              className="primary"
              disabled={!canTrain}
              onClick={train}
            >
              {isTraining
                ? "正在训练…"
                : remaining
                  ? `还需 ${remaining} 张照片`
                  : "生成 33³ LUT"}
            </button>
            {isTraining && (
              <button
                onClick={() => abortController.current?.abort()}
              >
                取消
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function clampBar(value: number) {
  return Math.max(8, Math.min(66, value));
}
