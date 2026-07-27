"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent,
  WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyLut,
  buildHistogram,
  Histogram,
  Lut3D,
  parseCube,
} from "./lut";

type Adjustments = {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  temperature: number;
  fade: number;
};

type Preset = {
  id: string;
  name: string;
  note: string;
  lutPath: string | null;
  defaultIntensity: number;
  colors: [string, string];
};

type EditorSnapshot = {
  adjustments: Adjustments;
  presetId: string;
  intensity: number;
  lutName: string | null;
  lut: Lut3D | null;
};

const DEFAULTS: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
  fade: 0,
};

const PRESETS: Preset[] = [
  {
    id: "none",
    name: "原片",
    note: "ORIGINAL",
    lutPath: null,
    defaultIntensity: 0,
    colors: ["#8e8b84", "#343c45"],
  },
  {
    id: "portra-400",
    name: "Portra 400",
    note: "光谱模拟 · 自然暖肤",
    lutPath: "/luts/portra-400.cube",
    defaultIntensity: 82,
    colors: ["#e2b68e", "#768d86"],
  },
  {
    id: "gold-200",
    name: "Kodak Gold 200",
    note: "光谱模拟 · 金色日常",
    lutPath: "/luts/gold-200.cube",
    defaultIntensity: 78,
    colors: ["#e8ad59", "#6d7e72"],
  },
  {
    id: "vision3-250d-2383",
    name: "Vision3 250D",
    note: "2383 印片 · 电影日光",
    lutPath: "/luts/vision3-250d-2383.cube",
    defaultIntensity: 78,
    colors: ["#c87851", "#315a63"],
  },
  {
    id: "provia-100f",
    name: "Fuji Provia 100F",
    note: "光谱模拟 · 透明自然",
    lutPath: "/luts/provia-100f.cube",
    defaultIntensity: 72,
    colors: ["#e1a05e", "#438397"],
  },
  {
    id: "velvia-50",
    name: "Fuji Velvia 50",
    note: "光谱模拟 · 浓郁风光",
    lutPath: "/luts/velvia-50.cube",
    defaultIntensity: 68,
    colors: ["#e25744", "#1f637d"],
  },
  {
    id: "fuji-classic-chrome",
    name: "FUJI CC",
    note: "Classic Chrome · 官方样片参考",
    lutPath: "/luts/fuji-classic-chrome.cube",
    defaultIntensity: 88,
    colors: ["#ac9a80", "#4e6870"],
  },
  {
    id: "fuji-nostalgic-neg",
    name: "FUJI NC",
    note: "Nostalgic Neg. · 官方样片参考",
    lutPath: "/luts/fuji-nostalgic-neg.cube",
    defaultIntensity: 86,
    colors: ["#d29761", "#56756f"],
  },
  {
    id: "hasselblad-natural",
    name: "Hasselblad",
    note: "HNCS 理念参考 · 自然层次",
    lutPath: "/luts/hasselblad-natural.cube",
    defaultIntensity: 92,
    colors: ["#cf916c", "#4f8490"],
  },
  {
    id: "leica-classic",
    name: "Leica Classic",
    note: "官方 Look 参考 · 暖调电影感",
    lutPath: "/luts/leica-classic.cube",
    defaultIntensity: 88,
    colors: ["#b95d48", "#34454a"],
  },
  {
    id: "tri-x-400",
    name: "Kodak Tri-X 400",
    note: "光谱模拟 · 经典黑白",
    lutPath: "/luts/tri-x-400.cube",
    defaultIntensity: 100,
    colors: ["#c8c7c2", "#2e2f32"],
  },
];

const CONTROL_GROUPS: Array<{
  title: string;
  items: Array<{
    key: keyof Adjustments;
    label: string;
    min: number;
    max: number;
  }>;
}> = [
  {
    title: "光线",
    items: [
      { key: "exposure", label: "曝光", min: -100, max: 100 },
      { key: "contrast", label: "对比度", min: -100, max: 100 },
      { key: "highlights", label: "高光", min: -100, max: 100 },
      { key: "shadows", label: "阴影", min: -100, max: 100 },
    ],
  },
  {
    title: "色彩",
    items: [
      { key: "temperature", label: "色温", min: -100, max: 100 },
      { key: "saturation", label: "饱和度", min: -100, max: 100 },
      { key: "fade", label: "褪色", min: 0, max: 100 },
    ],
  },
];

function LogoMark() {
  return (
    <span className="logoMark" aria-hidden="true">
      Lg
    </span>
  );
}

function buildCssFilter(values: Adjustments) {
  const brightness = Math.max(
    0,
    1 + values.exposure / 120 + values.highlights / 500,
  );
  const contrast = Math.max(0, 1 + values.contrast / 100);
  const saturation = Math.max(0, 1 + values.saturation / 100);
  const shadowLift = Math.max(0, values.shadows) / 900;
  const temperature =
    values.temperature > 0
      ? `sepia(${values.temperature / 700})`
      : `hue-rotate(${values.temperature / 8}deg)`;
  const fade =
    values.fade > 0
      ? `contrast(${1 - values.fade / 350}) brightness(${1 + values.fade / 650})`
      : "";

  return [
    `brightness(${brightness + shadowLift})`,
    `contrast(${contrast})`,
    `saturate(${saturation})`,
    temperature,
    fade,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function Home() {
  const imageInput = useRef<HTMLInputElement>(null);
  const lutInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const renderId = useRef(0);
  const presetRequestId = useRef(0);
  const presetLutCache = useRef<Map<string, Lut3D>>(new Map());
  const undoStack = useRef<EditorSnapshot[]>([]);
  const redoStack = useRef<EditorSnapshot[]>([]);
  const panStart = useRef<{
    pointerX: number;
    pointerY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(0);
  const [fileName, setFileName] = useState("未命名照片");
  const [dimensions, setDimensions] = useState("等待导入");
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isShowingOriginal, setIsShowingOriginal] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [presetId, setPresetId] = useState("none");
  const [presetLut, setPresetLut] = useState<Lut3D | null>(null);
  const [isPresetLoading, setIsPresetLoading] = useState(false);
  const [lutName, setLutName] = useState<string | null>(null);
  const [lut, setLut] = useState<Lut3D | null>(null);
  const [intensity, setIntensity] = useState(100);
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULTS);
  const [activePanel, setActivePanel] = useState<"edit" | "presets">("edit");
  const [toast, setToast] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [histogram, setHistogram] = useState<Histogram>({
    red: Array(32).fill(0),
    green: Array(32).fill(0),
    blue: Array(32).fill(0),
  });
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });

  const preset = useMemo(
    () => PRESETS.find((item) => item.id === presetId) ?? PRESETS[0],
    [presetId],
  );

  const filter = useMemo(
    () => buildCssFilter(adjustments),
    [adjustments],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    const requestId = ++presetRequestId.current;
    const controller = new AbortController();

    const loadPreset = async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;

      const path = preset.lutPath;
      if (!path) {
        setPresetLut(null);
        setIsPresetLoading(false);
        return;
      }

      const cached = presetLutCache.current.get(path);
      if (cached) {
        setPresetLut(cached);
        setIsPresetLoading(false);
        return;
      }

      setPresetLut(null);
      setIsPresetLoading(true);

      try {
        const response = await fetch(path, {
          cache: "force-cache",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`无法载入内置 LUT（${response.status}）`);
        const contents = await response.text();
        const parsed = parseCube(contents, preset.name);
        presetLutCache.current.set(path, parsed);
        if (requestId === presetRequestId.current) setPresetLut(parsed);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (requestId === presetRequestId.current) {
          setPresetLut(null);
          showToast(error instanceof Error ? error.message : "内置 LUT 载入失败");
        }
      } finally {
        if (requestId === presetRequestId.current) setIsPresetLoading(false);
      }
    };

    void loadPreset();

    return () => controller.abort();
  }, [preset, showToast]);

  const currentSnapshot = (): EditorSnapshot => ({
    adjustments: { ...adjustments },
    presetId,
    intensity,
    lutName,
    lut,
  });

  const syncHistoryState = () => {
    setHistoryState({
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    });
  };

  const remember = () => {
    undoStack.current.push(currentSnapshot());
    if (undoStack.current.length > 40) undoStack.current.shift();
    redoStack.current = [];
    syncHistoryState();
  };

  const restoreSnapshot = (snapshot: EditorSnapshot) => {
    setAdjustments(snapshot.adjustments);
    setPresetId(snapshot.presetId);
    setIntensity(snapshot.intensity);
    setLutName(snapshot.lutName);
    setLut(snapshot.lut);
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(currentSnapshot());
    restoreSnapshot(previous);
    syncHistoryState();
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(currentSnapshot());
    restoreSnapshot(next);
    syncHistoryState();
  };

  const loadImage = useCallback(
    (file?: File) => {
      if (!file || !file.type.startsWith("image/")) {
        showToast("请选择 JPG、PNG 或 WebP 图片");
        return;
      }
      const nextUrl = URL.createObjectURL(file);
      setImageUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setFileName(file.name);
      undoStack.current = [];
      redoStack.current = [];
      syncHistoryState();
      setPresetId("none");
      setAdjustments(DEFAULTS);
      setZoom(100);
      setPan({ x: 0, y: 0 });
    },
    [showToast],
  );

  useEffect(() => {
    if (!imageUrl) return;
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxWidth = 1440;
      const maxHeight = 1000;
      const ratio = Math.min(
        maxWidth / image.naturalWidth,
        maxHeight / image.naturalHeight,
        1,
      );
      canvas.width = Math.round(image.naturalWidth * ratio);
      canvas.height = Math.round(image.naturalHeight * ratio);
      setImageReady((version) => version + 1);
    };
    image.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !canvas.width) return;
    const currentRender = ++renderId.current;
    setIsRendering(true);

    const frame = window.requestAnimationFrame(() => {
      if (currentRender !== renderId.current) return;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.filter = isShowingOriginal ? "none" : filter;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.filter = "none";

      let imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      let pixelsChanged = false;
      if (presetLut && !isShowingOriginal) {
        imageData = applyLut(imageData, presetLut, preset.defaultIntensity);
        pixelsChanged = true;
      }
      if (lut && !isShowingOriginal && intensity > 0) {
        imageData = applyLut(imageData, lut, intensity);
        pixelsChanged = true;
      }
      if (pixelsChanged) context.putImageData(imageData, 0, 0);
      if (!isShowingOriginal) setHistogram(buildHistogram(imageData));
      setIsRendering(false);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    filter,
    imageReady,
    intensity,
    isShowingOriginal,
    lut,
    preset.defaultIntensity,
    presetLut,
  ]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    loadImage(event.dataTransfer.files[0]);
  };

  const changeZoom = (nextZoom: number) => {
    const clamped = Math.max(50, Math.min(400, Math.round(nextZoom)));
    setZoom(clamped);
    if (clamped === 100) setPan({ x: 0, y: 0 });
  };

  const onCanvasWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!imageUrl) return;
    event.preventDefault();
    const step = event.deltaY > 0 ? -10 : 10;
    setZoom((current) => Math.max(50, Math.min(400, current + step)));
  };

  const startPan = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!imageUrl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsPanning(true);
  };

  const movePan = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!panStart.current) return;
    setPan({
      x: panStart.current.panX + event.clientX - panStart.current.pointerX,
      y: panStart.current.panY + event.clientY - panStart.current.pointerY,
    });
  };

  const endPan = () => {
    panStart.current = null;
    setIsPanning(false);
  };

  const updateAdjustment = (key: keyof Adjustments, value: number) => {
    setAdjustments((current) => ({ ...current, [key]: value }));
  };

  const reset = () => {
    remember();
    setPresetId("none");
    setAdjustments(DEFAULTS);
    setIntensity(100);
    setLutName(null);
    setLut(null);
    setZoom(100);
    setPan({ x: 0, y: 0 });
    showToast("已还原全部调整");
  };

  const loadLut = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".cube")) {
      showToast("目前支持标准 .cube LUT 文件");
      return;
    }
    try {
      const parsed = parseCube(await file.text(), file.name);
      remember();
      setLut(parsed);
      setLutName(parsed.title || file.name);
      setActivePanel("edit");
      showToast(`已载入 ${parsed.size}³ LUT · ${parsed.title}`);
    } catch (error) {
      setLut(null);
      setLutName(null);
      showToast(error instanceof Error ? error.message : "无法读取这个 LUT");
    } finally {
      event.target.value = "";
    }
  };

  const downloadPreview = async () => {
    const image = imageRef.current;
    if (!image || !imageUrl) {
      showToast("请先导入一张照片");
      return;
    }
    if (isPresetLoading) {
      showToast("请等待内置 LUT 载入完成");
      return;
    }
    try {
      setIsExporting(true);
      showToast("正在渲染全分辨率照片…");
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = image.naturalWidth;
      exportCanvas.height = image.naturalHeight;
      const context = exportCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("浏览器无法创建导出画布");
      context.filter = filter;
      context.drawImage(image, 0, 0);
      context.filter = "none";
      if (presetLut || (lut && intensity > 0)) {
        let data = context.getImageData(
          0,
          0,
          exportCanvas.width,
          exportCanvas.height,
        );
        if (presetLut) {
          data = applyLut(data, presetLut, preset.defaultIntensity);
        }
        if (lut && intensity > 0) data = applyLut(data, lut, intensity);
        context.putImageData(data, 0, 0);
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        exportCanvas.toBlob(resolve, "image/jpeg", 0.95),
      );
      if (!blob) throw new Error("导出失败，请换一张较小的照片");
      const link = document.createElement("a");
      const downloadUrl = URL.createObjectURL(blob);
      link.download = `LumaGrade-${fileName.replace(/\.[^.]+$/, "")}.jpg`;
      link.href = downloadUrl;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      showToast(`已导出 ${image.naturalWidth} × ${image.naturalHeight}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "导出失败");
    } finally {
      setIsExporting(false);
    }
  };

  const comparisonHandlers = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsShowingOriginal(true);
    },
    onPointerUp: () => setIsShowingOriginal(false),
    onPointerCancel: () => setIsShowingOriginal(false),
    onPointerLeave: () => setIsShowingOriginal(false),
  };

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <span>LUMAGRADE</span>
          <span className="beta">BETA</span>
        </div>

        <div className="documentTitle" title={fileName}>
          <span>{fileName}</span>
          <small>{dimensions}</small>
        </div>

        <div className="topActions">
          <button
            className="historyButton"
            aria-label="撤销"
            disabled={!historyState.canUndo}
            onClick={undo}
          >
            ↶
          </button>
          <button
            className="historyButton"
            aria-label="重做"
            disabled={!historyState.canRedo}
            onClick={redo}
          >
            ↷
          </button>
          <button className="textButton" onClick={reset}>
            重置
          </button>
          <button
            className="compareButton"
            disabled={!imageUrl}
            {...comparisonHandlers}
          >
            <span className="compareIcon" />
            按住看原图
          </button>
          <button
            className="exportButton"
            onClick={downloadPreview}
            disabled={isExporting || isPresetLoading}
          >
            {isExporting ? "处理中…" : isPresetLoading ? "载入 LUT…" : "导出"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="leftRail" aria-label="主工具">
          <button
            className={activePanel === "edit" ? "railButton active" : "railButton"}
            onClick={() => setActivePanel("edit")}
          >
            <span className="railGlyph slidersGlyph" />
            <small>编辑</small>
          </button>
          <button
            className={
              activePanel === "presets" ? "railButton active" : "railButton"
            }
            onClick={() => setActivePanel("presets")}
          >
            <span className="railGlyph gridGlyph" />
            <small>滤镜</small>
          </button>
          <div className="railSpacer" />
          <button
            className="railButton importRail"
            onClick={() => imageInput.current?.click()}
          >
            <span className="railGlyph plusGlyph" />
            <small>导入</small>
          </button>
        </aside>

        <section
          className={`stage ${isDragging ? "isDragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <div className="stageMeta">
            <span>{isShowingOriginal ? "原始照片" : preset.name}</span>
            <span>
              {isPresetLoading
                ? "正在载入 33³ 内置 LUT…"
                : isRendering
                ? "正在渲染…"
                : imageUrl
                  ? lut
                    ? `${lut.size}³ LUT · ${intensity}%`
                    : presetLut
                      ? `33³ 内置 LUT · ${preset.defaultIntensity}%`
                      : "适合画面"
                  : "本地处理 · 不上传照片"}
            </span>
          </div>

          <div
            className={`canvasFrame ${imageUrl ? "hasImage" : ""} ${
              isPanning ? "isPanning" : ""
            }`}
            onWheel={onCanvasWheel}
          >
            <canvas
              ref={canvasRef}
              aria-label="可拖拽移动的照片画布"
              onPointerDown={startPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDoubleClick={() => {
                setZoom(100);
                setPan({ x: 0, y: 0 });
              }}
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom / 100})`,
              }}
            />
            {imageUrl && (
              <>
                <div className="viewerControls">
                  <button
                    aria-label="缩小"
                    onClick={() => changeZoom(zoom - 10)}
                  >
                    −
                  </button>
                  <output>{zoom}%</output>
                  <button
                    aria-label="放大"
                    onClick={() => changeZoom(zoom + 10)}
                  >
                    ＋
                  </button>
                  <button
                    className="fitButton"
                    onClick={() => {
                      setZoom(100);
                      setPan({ x: 0, y: 0 });
                    }}
                  >
                    适合
                  </button>
                </div>
                <div className="panHint">拖拽移动 · 滚轮缩放 · 双击复位</div>
              </>
            )}
            {!imageUrl && (
              <button
                className="emptyState"
                onClick={() => imageInput.current?.click()}
              >
                <span className="emptyArtwork">
                  <span />
                  <span />
                  <span />
                </span>
                <strong>把照片拖到这里</strong>
                <small>或点击选择 JPG、PNG、WebP</small>
                <em>选择照片</em>
              </button>
            )}
            {isDragging && (
              <div className="dropOverlay">
                <strong>松开即可开始编辑</strong>
                <span>照片仅在你的浏览器中处理</span>
              </div>
            )}
          </div>

          <div className="presetDock" aria-label="内置滤镜">
            <div className="dockHeading">
              <div>
                <span>快速风格</span>
                <small>33³ 真实 LUT · 点击预览</small>
              </div>
              <span className="dockCount">{PRESETS.length} 款</span>
            </div>
            <div className="presetList">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  className={presetId === item.id ? "presetCard active" : "presetCard"}
                  onClick={() => {
                    if (item.id === presetId) return;
                    remember();
                    setPresetId(item.id);
                  }}
                >
                  <span
                    className="presetSwatch"
                    style={{
                      background: `linear-gradient(135deg, ${item.colors[0]}, ${item.colors[1]})`,
                    }}
                  >
                    <i />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.note}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="rightPanel">
          <div className="panelTabs">
            <button
              className={activePanel === "edit" ? "active" : ""}
              onClick={() => setActivePanel("edit")}
            >
              调整
            </button>
            <button
              className={activePanel === "presets" ? "active" : ""}
              onClick={() => setActivePanel("presets")}
            >
              LUT
            </button>
          </div>

          {activePanel === "presets" ? (
            <div className="lutPanel">
              <div className="lutIntro">
                <span className="cubeIcon">
                  <i />
                </span>
                <strong>载入你的 LUT</strong>
                <p>支持标准 3D `.cube` 文件，适配常见相机与调色软件。</p>
              </div>
              <button
                className="lutDrop"
                onClick={() => lutInput.current?.click()}
              >
                <span>＋</span>
                <strong>{lutName ?? "选择 .cube 文件"}</strong>
                <small>{lutName ? "点击可替换" : "文件只在本地读取"}</small>
              </button>
              <div className="compatibility">
                <span>兼容</span>
                <div>
                  <small>17×17×17</small>
                  <small>33×33×33</small>
                  <small>65×65×65</small>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="histogram" aria-label="实时色彩直方图">
                <div className="histogramBars red">
                  {histogram.red.map((value, index) => (
                    <i
                      key={index}
                      style={{
                        height: `${Math.max(2, value * 90)}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="histogramBars green">
                  {histogram.green.map((value, index) => (
                    <i
                      key={index}
                      style={{
                        height: `${Math.max(2, value * 90)}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="histogramBars blue">
                  {histogram.blue.map((value, index) => (
                    <i
                      key={index}
                      style={{
                        height: `${Math.max(2, value * 90)}%`,
                      }}
                    />
                  ))}
                </div>
                <span>RGB</span>
              </div>

              {lutName && (
                <div className="activeLut">
                  <div>
                    <span className="statusDot" />
                    <span title={lutName}>{lutName}</span>
                  </div>
                  <button
                    onClick={() => {
                      remember();
                      setLutName(null);
                      setLut(null);
                    }}
                  >
                    移除
                  </button>
                  <label>
                    <span>强度</span>
                    <output>{intensity}%</output>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={intensity}
                    onPointerDown={remember}
                    onChange={(event) => setIntensity(Number(event.target.value))}
                  />
                </div>
              )}

              <div className="controls">
                {CONTROL_GROUPS.map((group) => (
                  <section className="controlGroup" key={group.title}>
                    <div className="groupTitle">
                      <strong>{group.title}</strong>
                      <button
                        onClick={() => {
                          remember();
                          setAdjustments((current) => {
                            const next = { ...current };
                            group.items.forEach(({ key }) => {
                              next[key] = DEFAULTS[key];
                            });
                            return next;
                          })
                        }}
                      >
                        ↺
                      </button>
                    </div>
                    {group.items.map((item) => (
                      <label className="sliderRow" key={item.key}>
                        <span>{item.label}</span>
                        <output>
                          {adjustments[item.key] > 0 ? "+" : ""}
                          {adjustments[item.key]}
                        </output>
                        <input
                          type="range"
                          min={item.min}
                          max={item.max}
                          value={adjustments[item.key]}
                          onPointerDown={remember}
                          onDoubleClick={() => updateAdjustment(item.key, 0)}
                          onChange={(event) =>
                            updateAdjustment(item.key, Number(event.target.value))
                          }
                        />
                      </label>
                    ))}
                  </section>
                ))}
              </div>
            </>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <span>
          <i className="statusDot" />
          端侧处理
        </span>
        <span>照片不会上传至服务器</span>
        <span className="statusSpacer" />
        <span>sRGB</span>
        <span>{zoom}%</span>
      </footer>

      <input
        ref={imageInput}
        className="hiddenInput"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => loadImage(event.target.files?.[0])}
      />
      <input
        ref={lutInput}
        className="hiddenInput"
        type="file"
        accept=".cube"
        onChange={loadLut}
      />
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
