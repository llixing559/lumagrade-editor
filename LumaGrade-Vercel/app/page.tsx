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
import {
  AdaptiveProfile,
  analyzeAdaptiveProfile,
  applyAdaptiveInput,
  applyAdaptiveOutput,
  LutLayer,
} from "./adaptive-lut";
import {
  AiConfig,
  AiGradeAdvice,
  aiGradeToAdjustments,
} from "./ai-grade";
import {
  AiConnection,
  EMPTY_AI_CONNECTION,
  connectionForRequest,
  detectAiProvider,
  isAiConnectionReady,
} from "./ai-providers";
import {
  AdjustmentValues,
  addAdjustments,
  applyImageAdjustments,
  clampAdjustments,
  EMPTY_ADJUSTMENTS,
  hasAdjustments,
} from "./image-adjustments";
import LutCreator from "./LutCreator";
import AiConnectionPanel from "./AiConnectionPanel";

type Adjustments = AdjustmentValues;

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
  presetIntensity: number;
  intensity: number;
  lutName: string | null;
  lut: Lut3D | null;
};

const DEFAULTS: Adjustments = {
  ...EMPTY_ADJUSTMENTS,
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
    note: "光谱重制 v2 · 奶油暖肤",
    lutPath: "/luts/portra-400.cube",
    defaultIntensity: 100,
    colors: ["#e2b68e", "#768d86"],
  },
  {
    id: "gold-200",
    name: "Kodak Gold 200",
    note: "光谱重制 v2 · 浓郁金色",
    lutPath: "/luts/gold-200.cube",
    defaultIntensity: 100,
    colors: ["#e8ad59", "#6d7e72"],
  },
  {
    id: "vision3-250d-2383",
    name: "Vision3 250D",
    note: "光谱重制 v2 · 2383 电影日光",
    lutPath: "/luts/vision3-250d-2383.cube",
    defaultIntensity: 100,
    colors: ["#c87851", "#315a63"],
  },
  {
    id: "provia-100f",
    name: "Fuji Provia 100F",
    note: "富士官方 LUT · 标准通透",
    lutPath: "/luts/provia-100f.cube",
    defaultIntensity: 100,
    colors: ["#e1a05e", "#438397"],
  },
  {
    id: "velvia-50",
    name: "Fuji Velvia 50",
    note: "富士官方 LUT · 浓郁风光",
    lutPath: "/luts/velvia-50.cube",
    defaultIntensity: 85,
    colors: ["#e25744", "#1f637d"],
  },
  {
    id: "fuji-classic-chrome",
    name: "FUJI CC",
    note: "富士官方 LUT · Classic Chrome",
    lutPath: "/luts/fuji-classic-chrome.cube",
    defaultIntensity: 100,
    colors: ["#ac9a80", "#4e6870"],
  },
  {
    id: "fuji-nostalgic-neg",
    name: "FUJI NC",
    note: "Nostalgic Neg. · 强化琥珀青影",
    lutPath: "/luts/fuji-nostalgic-neg.cube",
    defaultIntensity: 100,
    colors: ["#d29761", "#56756f"],
  },
  {
    id: "hasselblad-natural",
    name: "Hasselblad",
    note: "HNCS 强化参考 · 暖肤蓝调",
    lutPath: "/luts/hasselblad-natural.cube",
    defaultIntensity: 100,
    colors: ["#cf916c", "#4f8490"],
  },
  {
    id: "leica-classic",
    name: "Leica Classic",
    note: "Classic 强化参考 · 暖调褪洗",
    lutPath: "/luts/leica-classic.cube",
    defaultIntensity: 100,
    colors: ["#b95d48", "#34454a"],
  },
  {
    id: "tri-x-400",
    name: "Kodak Tri-X 400",
    note: "光谱重制 v2 · 高反差黑白",
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
      { key: "tint", label: "色调", min: -100, max: 100 },
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

function signed(value: number, digits = 0) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function adaptiveProfileToAdjustments(
  profile: AdaptiveProfile,
): Adjustments {
  return clampAdjustments({
    exposure: (profile.exposureEv + profile.postExposureEv) * 100,
    contrast: (profile.contrast - 1) * 100,
    highlights:
      -(profile.highlightCompression + profile.postHighlightCompression) *
      1000,
    shadows: (profile.shadowLift + profile.postBlackLift) * 1000,
    saturation: 0,
    temperature: profile.temperature,
    tint: profile.tint,
    fade: 0,
  });
}

function copyImageData(imageData: ImageData) {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

export default function Home() {
  const imageInput = useRef<HTMLInputElement>(null);
  const lutInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const renderId = useRef(0);
  const adaptiveAnalysisId = useRef(0);
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
  const [presetIntensity, setPresetIntensity] = useState(0);
  const [presetLut, setPresetLut] = useState<Lut3D | null>(null);
  const [isPresetLoading, setIsPresetLoading] = useState(false);
  const [lutName, setLutName] = useState<string | null>(null);
  const [lut, setLut] = useState<Lut3D | null>(null);
  const [intensity, setIntensity] = useState(100);
  const [manualAdjustments, setManualAdjustments] =
    useState<Adjustments>(DEFAULTS);
  const [localAutoAdjustments, setLocalAutoAdjustments] =
    useState<Adjustments>(DEFAULTS);
  const [aiAdjustments, setAiAdjustments] =
    useState<Adjustments>(DEFAULTS);
  const [activePanel, setActivePanel] = useState<
    "edit" | "presets" | "creator"
  >("edit");
  const [toast, setToast] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [autoAdaptEnabled, setAutoAdaptEnabled] = useState(true);
  const [adaptiveProfile, setAdaptiveProfile] =
    useState<AdaptiveProfile | null>(null);
  const [isAnalyzingAdaptation, setIsAnalyzingAdaptation] = useState(false);
  const [adaptiveAnalysisVersion, setAdaptiveAnalysisVersion] = useState(0);
  const [aiConfig, setAiConfig] = useState<AiConfig>({
    enabled: false,
    model: null,
  });
  const [aiConnection, setAiConnection] =
    useState<AiConnection>(EMPTY_AI_CONNECTION);
  const [gptAssistEnabled, setGptAssistEnabled] = useState(false);
  const [isGptAnalyzing, setIsGptAnalyzing] = useState(false);
  const [gptAdvice, setGptAdvice] = useState<AiGradeAdvice | null>(null);
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
  const aiProvider = useMemo(
    () => detectAiProvider(aiConnection),
    [aiConnection],
  );
  const aiAvailable = useMemo(
    () => isAiConnectionReady(aiConfig, aiConnection),
    [aiConfig, aiConnection],
  );

  const adjustments = useMemo(
    () =>
      clampAdjustments(
        addAdjustments(
          localAutoAdjustments,
          aiAdjustments,
          manualAdjustments,
        ),
      ),
    [aiAdjustments, localAutoAdjustments, manualAdjustments],
  );

  const renderAdjustments = useMemo(
    () => clampAdjustments(addAdjustments(aiAdjustments, manualAdjustments)),
    [aiAdjustments, manualAdjustments],
  );

  const activeLutLayers = useMemo<LutLayer[]>(() => {
    const layers: LutLayer[] = [];
    if (presetLut && presetIntensity > 0) {
      layers.push({ lut: presetLut, intensity: presetIntensity });
    }
    if (lut && intensity > 0) layers.push({ lut, intensity });
    return layers;
  }, [intensity, lut, presetIntensity, presetLut]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai-grade", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取 AI 配置");
        return (await response.json()) as AiConfig;
      })
      .then((config) => setAiConfig(config))
      .catch(() => setAiConfig({ enabled: false, model: null }));
    return () => controller.abort();
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
    adjustments: { ...manualAdjustments },
    presetId,
    presetIntensity,
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
    setManualAdjustments(snapshot.adjustments);
    setPresetId(snapshot.presetId);
    setPresetIntensity(snapshot.presetIntensity);
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
      setAdaptiveProfile(null);
      setLocalAutoAdjustments(DEFAULTS);
      setAiAdjustments(DEFAULTS);
      setGptAdvice(null);
      undoStack.current = [];
      redoStack.current = [];
      syncHistoryState();
      setPresetId("none");
      setPresetIntensity(0);
      setManualAdjustments(DEFAULTS);
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
    const analysisId = ++adaptiveAnalysisId.current;
    const controller = new AbortController();
    let localProfileReady = false;
    if (
      !image ||
      !imageReady ||
      !autoAdaptEnabled ||
      activeLutLayers.length === 0
    ) {
      setAdaptiveProfile(null);
      setLocalAutoAdjustments(DEFAULTS);
      setAiAdjustments(DEFAULTS);
      setGptAdvice(null);
      setIsAnalyzingAdaptation(false);
      setIsGptAnalyzing(false);
      return;
    }

    setIsAnalyzingAdaptation(true);
    setIsGptAnalyzing(false);
    setAdaptiveProfile(null);
    setLocalAutoAdjustments(DEFAULTS);
    setAiAdjustments(DEFAULTS);
    setGptAdvice(null);
    const timer = window.setTimeout(() => {
      const frame = window.requestAnimationFrame(async () => {
        if (analysisId !== adaptiveAnalysisId.current) return;
        try {
          const analysisCanvas = document.createElement("canvas");
          const maxEdge = 760;
          const ratio = Math.min(
            1,
            maxEdge / Math.max(image.naturalWidth, image.naturalHeight),
          );
          analysisCanvas.width = Math.max(
            1,
            Math.round(image.naturalWidth * ratio),
          );
          analysisCanvas.height = Math.max(
            1,
            Math.round(image.naturalHeight * ratio),
          );
          const context = analysisCanvas.getContext("2d", {
            alpha: false,
            willReadFrequently: true,
          });
          if (!context) throw new Error("无法创建智能分析画布");
          context.drawImage(
            image,
            0,
            0,
            analysisCanvas.width,
            analysisCanvas.height,
          );
          const data = context.getImageData(
            0,
            0,
            analysisCanvas.width,
            analysisCanvas.height,
          );
          const profile = analyzeAdaptiveProfile(data, activeLutLayers);
          localProfileReady = true;
          if (analysisId === adaptiveAnalysisId.current) {
            setAdaptiveProfile(profile);
            setLocalAutoAdjustments(
              adaptiveProfileToAdjustments(profile),
            );
            setIsAnalyzingAdaptation(false);
          }

          if (
            gptAssistEnabled &&
            aiAvailable &&
            analysisId === adaptiveAnalysisId.current
          ) {
            setIsGptAnalyzing(true);
            const candidateCanvas = document.createElement("canvas");
            candidateCanvas.width = analysisCanvas.width;
            candidateCanvas.height = analysisCanvas.height;
            const candidateContext = candidateCanvas.getContext("2d");
            if (!candidateContext) throw new Error("无法创建 AI 预览画布");
            let candidate = copyImageData(data);
            candidate = applyAdaptiveInput(candidate, profile);
            for (const layer of activeLutLayers) {
              candidate = applyLut(candidate, layer.lut, layer.intensity);
            }
            candidate = applyAdaptiveOutput(candidate, profile);
            candidateContext.putImageData(candidate, 0, 0);
            const response = await fetch("/api/ai-grade", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "grade",
                images: aiProvider.supportsVision
                  ? [
                      analysisCanvas.toDataURL("image/jpeg", 0.78),
                      candidateCanvas.toDataURL("image/jpeg", 0.78),
                    ]
                  : [],
                connection: connectionForRequest(aiConnection),
                metadata: {
                  preset: preset.name,
                  presetIntensity,
                  customLut: lutName,
                  customLutIntensity: intensity,
                  sourceMedian: profile.sourceMedian,
                  sourceBlack: profile.sourceBlack,
                  sourceWhite: profile.sourceWhite,
                  localExposureEv:
                    profile.exposureEv + profile.postExposureEv,
                  localTemperature: profile.temperature,
                  localTint: profile.tint,
                  clippedBefore: profile.clippedBefore,
                  clippedAfter: profile.clippedAfter,
                },
              }),
              signal: controller.signal,
            });
            const payload = (await response.json()) as {
              error?: string;
              result?: AiGradeAdvice;
            };
            if (!response.ok || !payload.result) {
              throw new Error(payload.error || "AI 智能复核失败");
            }
            if (analysisId === adaptiveAnalysisId.current) {
              setGptAdvice(payload.result);
              setAiAdjustments(aiGradeToAdjustments(payload.result));
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          if (analysisId === adaptiveAnalysisId.current) {
            if (!localProfileReady) {
              setAdaptiveProfile(null);
              setLocalAutoAdjustments(DEFAULTS);
            }
            setAiAdjustments(DEFAULTS);
            setGptAdvice(null);
            showToast(
              error instanceof Error
                ? error.message
                : "智能匹配分析失败，已保留普通 LUT 模式",
            );
          }
        } finally {
          if (analysisId === adaptiveAnalysisId.current) {
            setIsAnalyzingAdaptation(false);
            setIsGptAnalyzing(false);
          }
        }
      });
      if (analysisId !== adaptiveAnalysisId.current) {
        window.cancelAnimationFrame(frame);
      }
    }, 90);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeLutLayers,
    adaptiveAnalysisVersion,
    aiAvailable,
    aiConnection,
    aiProvider.supportsVision,
    autoAdaptEnabled,
    gptAssistEnabled,
    imageReady,
    intensity,
    lutName,
    preset.name,
    presetIntensity,
    showToast,
  ]);

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
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      let imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      let pixelsChanged = false;
      if (
        adaptiveProfile &&
        autoAdaptEnabled &&
        !isShowingOriginal &&
        activeLutLayers.length > 0
      ) {
        imageData = applyAdaptiveInput(imageData, adaptiveProfile);
        pixelsChanged = true;
      }
      if (!isShowingOriginal && hasAdjustments(renderAdjustments)) {
        imageData = applyImageAdjustments(imageData, renderAdjustments);
        pixelsChanged = true;
      }
      if (presetLut && presetIntensity > 0 && !isShowingOriginal) {
        imageData = applyLut(imageData, presetLut, presetIntensity);
        pixelsChanged = true;
      }
      if (lut && !isShowingOriginal && intensity > 0) {
        imageData = applyLut(imageData, lut, intensity);
        pixelsChanged = true;
      }
      if (
        adaptiveProfile &&
        autoAdaptEnabled &&
        !isShowingOriginal &&
        activeLutLayers.length > 0
      ) {
        imageData = applyAdaptiveOutput(imageData, adaptiveProfile);
        pixelsChanged = true;
      }
      if (pixelsChanged) context.putImageData(imageData, 0, 0);
      if (!isShowingOriginal) setHistogram(buildHistogram(imageData));
      setIsRendering(false);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    activeLutLayers.length,
    adaptiveProfile,
    autoAdaptEnabled,
    imageReady,
    intensity,
    isShowingOriginal,
    lut,
    presetIntensity,
    presetLut,
    renderAdjustments,
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
    setManualAdjustments((current) => ({
      ...current,
      [key]: value - localAutoAdjustments[key] - aiAdjustments[key],
    }));
  };

  const reset = () => {
    remember();
    setPresetId("none");
    setPresetIntensity(0);
    setManualAdjustments(DEFAULTS);
    setLocalAutoAdjustments(DEFAULTS);
    setAiAdjustments(DEFAULTS);
    setGptAdvice(null);
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
      context.drawImage(image, 0, 0);
      let data = context.getImageData(
        0,
        0,
        exportCanvas.width,
        exportCanvas.height,
      );
      const exportProfile =
        autoAdaptEnabled && activeLutLayers.length > 0
          ? adaptiveProfile ?? analyzeAdaptiveProfile(data, activeLutLayers)
          : null;
      if (exportProfile) {
        data = applyAdaptiveInput(data, exportProfile);
      }
      if (hasAdjustments(renderAdjustments)) {
        data = applyImageAdjustments(data, renderAdjustments);
      }
      if (presetLut && presetIntensity > 0) {
        data = applyLut(data, presetLut, presetIntensity);
      }
      if (lut && intensity > 0) data = applyLut(data, lut, intensity);
      if (exportProfile) {
        data = applyAdaptiveOutput(data, exportProfile);
      }
      context.putImageData(data, 0, 0);
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
          {activePanel === "creator" ? (
            <>
              <span className="creatorTopLabel">33³ LUT LAB</span>
              <button className="textButton" onClick={() => setActivePanel("edit")}>
                返回编辑器
              </button>
            </>
          ) : (
            <>
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
                disabled={
                  isExporting ||
                  isPresetLoading ||
                  isAnalyzingAdaptation ||
                  isGptAnalyzing
                }
              >
                {isExporting
                  ? "处理中…"
                  : isPresetLoading
                    ? "载入 LUT…"
                    : isAnalyzingAdaptation
                      ? "智能分析…"
                      : isGptAnalyzing
                        ? "AI 复核…"
                      : "导出"}
              </button>
            </>
          )}
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
          <button
            className={
              activePanel === "creator" ? "railButton active" : "railButton"
            }
            onClick={() => setActivePanel("creator")}
          >
            <span className="railGlyph creatorGlyph" />
            <small>制 LUT</small>
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

        {activePanel === "creator" ? (
          <LutCreator
            aiConfig={aiConfig}
            aiConnection={aiConnection}
            onAiConnectionChange={setAiConnection}
            showToast={showToast}
            onExit={() => setActivePanel("edit")}
            onUseLut={(trainedLut) => {
              remember();
              setPresetId("none");
              setPresetIntensity(0);
              setLut(trainedLut);
              setLutName(trainedLut.title);
              setIntensity(100);
              setActivePanel("edit");
              showToast(`已载入 ${trainedLut.title} · 33³`);
            }}
          />
        ) : (
          <>
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
                : isAnalyzingAdaptation
                  ? "正在分析曝光、白平衡与动态范围…"
                : isRendering
                ? "正在渲染…"
                : imageUrl
                  ? lut
                    ? `${lut.size}³ LUT · ${intensity}%${
                        adaptiveProfile && autoAdaptEnabled ? " · 智能匹配" : ""
                      }`
                    : presetLut
                      ? `33³ 内置 LUT · ${presetIntensity}%${
                          adaptiveProfile && autoAdaptEnabled ? " · 智能匹配" : ""
                        }`
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
                    setPresetIntensity(item.defaultIntensity);
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

              {imageUrl && activeLutLayers.length > 0 && (
                <section
                  className={
                    autoAdaptEnabled
                      ? "adaptiveCard enabled"
                      : "adaptiveCard"
                  }
                >
                  <div className="adaptiveHeader">
                    <div>
                      <span className="adaptiveMark">A</span>
                      <div>
                        <strong>智能匹配</strong>
                        <small>按当前照片适配 LUT</small>
                      </div>
                    </div>
                    <button
                      className="adaptiveSwitch"
                      role="switch"
                      aria-checked={autoAdaptEnabled}
                      aria-label="智能匹配"
                      onClick={() => {
                        const next = !autoAdaptEnabled;
                        setAutoAdaptEnabled(next);
                        if (!next) {
                          setAdaptiveProfile(null);
                          setLocalAutoAdjustments(DEFAULTS);
                          setAiAdjustments(DEFAULTS);
                          setGptAdvice(null);
                          setIsGptAnalyzing(false);
                        }
                      }}
                    >
                      <i />
                    </button>
                  </div>

                  {autoAdaptEnabled && (
                    <>
                      {isAnalyzingAdaptation ? (
                        <div className="adaptiveLoading">
                          <i />
                          <span>正在分析曝光、光源和动态范围…</span>
                        </div>
                      ) : adaptiveProfile ? (
                        <>
                          <div className="adaptiveValues">
                            <div>
                              <span>曝光</span>
                              <strong>
                                {signed(
                                  adaptiveProfile.exposureEv +
                                    adaptiveProfile.postExposureEv,
                                  2,
                                )}{" "}
                                EV
                              </strong>
                            </div>
                            <div>
                              <span>色温</span>
                              <strong>
                                {signed(adaptiveProfile.temperature)}
                              </strong>
                            </div>
                            <div>
                              <span>色调</span>
                              <strong>{signed(adaptiveProfile.tint)}</strong>
                            </div>
                            <div>
                              <span>反差</span>
                              <strong>
                                {signed((adaptiveProfile.contrast - 1) * 100)}%
                              </strong>
                            </div>
                          </div>
                          <div className="adaptiveProtection">
                            <span>
                              阴影保护{" "}
                              {Math.round(
                                (adaptiveProfile.shadowLift +
                                  adaptiveProfile.postBlackLift) *
                                  1000,
                              )}
                            </span>
                            <span>
                              高光保护{" "}
                              {Math.round(
                                (adaptiveProfile.highlightCompression +
                                  adaptiveProfile.postHighlightCompression) *
                                  1000,
                              )}
                            </span>
                            <span>
                              溢出{" "}
                              {(adaptiveProfile.clippedBefore * 100).toFixed(1)}
                              % →{" "}
                              {(adaptiveProfile.clippedAfter * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="adaptiveFooter">
                            <span>
                              可信度 {adaptiveProfile.confidence}% · 已写入滑杆
                            </span>
                            <button
                              onClick={() =>
                                setAdaptiveAnalysisVersion(
                                  (version) => version + 1,
                                )
                              }
                            >
                              重新分析
                            </button>
                          </div>
                          <AiConnectionPanel
                            config={aiConfig}
                            value={aiConnection}
                            onChange={setAiConnection}
                            compact
                          />
                          <div
                            className={
                              gptAssistEnabled
                                ? "gptAssist enabled"
                                : "gptAssist"
                            }
                          >
                            <div>
                              <span>AI 智能复核</span>
                              <small>
                                {aiAvailable
                                  ? `${aiProvider.label} · ${
                                      aiProvider.supportsVision
                                        ? "上传两张压缩预览"
                                        : "仅发送本地统计"
                                    }`
                                  : "请选择接口并填写 API Key 与模型"}
                              </small>
                            </div>
                            <button
                              role="switch"
                              aria-checked={gptAssistEnabled}
                              disabled={!aiAvailable}
                              onClick={() => {
                                if (!aiAvailable) {
                                  showToast("请先填写可用的 AI API 接口、密钥和模型");
                                  return;
                                }
                                const next = !gptAssistEnabled;
                                setGptAssistEnabled(next);
                                if (!next) {
                                  setAiAdjustments(DEFAULTS);
                                  setGptAdvice(null);
                                }
                              }}
                            >
                              <i />
                            </button>
                          </div>
                          {isGptAnalyzing && (
                            <div className="gptStatus">
                              <i />
                              {aiProvider.label} 正在复核曝光、白平衡和反差…
                            </div>
                          )}
                          {gptAdvice && !isGptAnalyzing && (
                            <div className="gptResult">
                              <span>
                                {gptAdvice.scene} · 可信度{" "}
                                {Math.round(gptAdvice.confidence)}%
                              </span>
                              <p>{gptAdvice.rationale}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="adaptiveLoading failed">
                          <span>本次未能建立匹配参数，当前使用普通 LUT</span>
                          <button
                            onClick={() =>
                              setAdaptiveAnalysisVersion(
                                (version) => version + 1,
                              )
                            }
                          >
                            重试
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}

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

              {preset.lutPath && (
                <div className="activeLut">
                  <div>
                    <span className="statusDot" />
                    <span title={preset.name}>{preset.name} · 内置预设</span>
                  </div>
                  <button
                    onClick={() => {
                      remember();
                      setPresetId("none");
                      setPresetIntensity(0);
                    }}
                  >
                    关闭
                  </button>
                  <label>
                    <span>预设强度</span>
                    <output>{presetIntensity}%</output>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={presetIntensity}
                    onPointerDown={remember}
                    onChange={(event) =>
                      setPresetIntensity(Number(event.target.value))
                    }
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
                          setManualAdjustments((current) => {
                            const next = { ...current };
                            group.items.forEach(({ key }) => {
                              next[key] =
                                -localAutoAdjustments[key] -
                                aiAdjustments[key];
                            });
                            return next;
                          });
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
          </>
        )}
      </section>

      <footer className="statusbar">
        <span>
          <i className="statusDot" />
          端侧处理
        </span>
        <span>
          {activePanel === "creator"
            ? "本地训练；启用 AI 后按模型能力发送预览或聚合统计"
            : gptAssistEnabled
              ? aiProvider.supportsVision
                ? `AI 开启：压缩预览将发送至 ${aiProvider.label}`
                : `AI 开启：仅发送聚合统计至 ${aiProvider.label}`
              : "照片不会上传至服务器"}
        </span>
        <span className="statusSpacer" />
        <span>{activePanel === "creator" ? "33³ CUBE" : "sRGB"}</span>
        <span>{activePanel === "creator" ? "35,937 节点" : `${zoom}%`}</span>
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
