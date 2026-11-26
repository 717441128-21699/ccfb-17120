import { CHANNELS, FRAME_HEIGHT, FRAME_WIDTH, TARGET_FPS, thresholdForChannel } from '../config';
import { SyntheticSilkwormScene } from '../sim/SyntheticSilkwormScene';
import type {
  ChannelConfig,
  ChannelRuntimeStats,
  DetectionResult,
  GroundTruthFrame,
  WorkerResponse,
} from '../types';
import { calibrationForLightMix } from '../processing/calibration';
import { WebGLStackRenderer } from '../processing/WebGLStackRenderer';
import { colorJump, estimateNoise, meanRGB, sharpnessScore } from '../processing/metrics';
import { alertSettingsStore, pushAlert } from '../state/store';
import { playAlertTone } from '../state/notify';

export interface RatioPoint {
  t: number;
  ratio: number;
  truth?: number;
}

export class ChannelRuntime {
  readonly config: ChannelConfig;
  readonly scene: SyntheticSilkwormScene;
  readonly rawCanvas: HTMLCanvasElement;
  readonly processedCanvas: HTMLCanvasElement;
  readonly sourceCanvas: HTMLCanvasElement;
  private readonly processedCtx: CanvasRenderingContext2D;
  private readonly sourceCtx: CanvasRenderingContext2D;
  private readonly worker: Worker;
  private readonly processStamps: number[] = [];
  private readonly detectStamps: number[] = [];
  private readonly frameTimes: number[] = [];
  private detectFpsEma = 0;
  private processFpsEma = 0;
  private lastProcessAt = 0;
  private lastMetricsAt = 0;
  private prevCorrectedRGB: [number, number, number] | null = null;
  private alertArmed = true;
  private lastAlertAt = 0;
  private video: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;
  private objectUrl: string | null = null;

  groundTruth: GroundTruthFrame | null = null;
  result: DetectionResult | null = null;
  ratioHistory: RatioPoint[] = [];
  stats: ChannelRuntimeStats = {
    processFps: 0,
    captureFps: TARGET_FPS,
    detectFps: 0,
    glMs: 0,
    simMs: 0,
    lastJump: 0,
    maxCorrectedJump: 0,
    rawNoise: 0,
    correctedNoise: 0,
    ringScore: 0,
    connected: true,
    frames: 0,
  };

  constructor(config: ChannelConfig) {
    this.config = config;
    this.scene = new SyntheticSilkwormScene(config);
    this.rawCanvas = this.scene.rawCanvas;
    this.processedCanvas = document.createElement('canvas');
    this.processedCanvas.width = FRAME_WIDTH;
    this.processedCanvas.height = FRAME_HEIGHT;
    const pctx = this.processedCanvas.getContext('2d');
    if (!pctx) throw new Error('processed 2D context unavailable');
    this.processedCtx = pctx;

    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = FRAME_WIDTH;
    this.sourceCanvas.height = FRAME_HEIGHT;
    const sctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sctx) throw new Error('source 2D context unavailable');
    this.sourceCtx = sctx;

    this.worker = new Worker(new URL('../workers/detection.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === 'result') this.handleResult(event.data.result);
    };
    this.worker.onerror = (event) => {
      console.error(`检测 Worker 异常 ${config.id}`, event.message);
    };
  }

  triggerLightSwitch(): void {
    this.scene.switchLight();
  }

  async connectWebcam(deviceId?: string): Promise<void> {
    this.disconnectExternalSource();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { width: 640, height: 480 },
      audio: false,
    });
    this.mediaStream = stream;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    this.video = video;
    this.config.sourceKind = 'webcam';
    this.config.sourceLabel = deviceId ? '本机摄像头' : 'USB/本机摄像头';
    this.stats.connected = true;
  }

  async connectUrl(url: string): Promise<void> {
    this.disconnectExternalSource();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.crossOrigin = 'anonymous';
    video.src = url;
    await video.play();
    this.video = video;
    this.config.url = url;
    this.config.sourceKind = 'url';
    this.config.sourceLabel = '视频网关 / 录像地址';
  }

  useSynthetic(): void {
    this.disconnectExternalSource();
    this.config.sourceKind = 'synthetic';
    this.config.sourceLabel = '合成夜间真值画面';
  }

  private disconnectExternalSource(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
  }

  private currentSource(): TexImageSource {
    if (this.video && this.video.readyState >= 2) {
      const vw = this.video.videoWidth || 640;
      const vh = this.video.videoHeight || 480;
      const scale = Math.max(FRAME_WIDTH / vw, FRAME_HEIGHT / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      this.sourceCtx.drawImage(this.video, (FRAME_WIDTH - dw) / 2, (FRAME_HEIGHT - dh) / 2, dw, dh);
      return this.sourceCanvas;
    }
    return this.rawCanvas;
  }

  process(now: number, renderer: WebGLStackRenderer, enhance: ReturnType<typeof getEnhance>): void {
    const due = now - this.lastProcessAt >= 1000 / TARGET_FPS - 8;
    if (!due) return;
    const delta = this.lastProcessAt ? Math.max(1, now - this.lastProcessAt) : 1000 / TARGET_FPS;
    this.lastProcessAt = now;

    const simStart = performance.now();
    let rawDataForMetrics: Uint8ClampedArray | null = null;
    if (this.config.sourceKind === 'synthetic') {
      const rendered = this.scene.render(now);
      this.groundTruth = rendered.groundTruth;
      rawDataForMetrics = rendered.rawImageData.data;
    } else {
      this.groundTruth = null;
      if (this.video && this.video.readyState >= 2) {
        const vw = this.video.videoWidth || FRAME_WIDTH;
        const vh = this.video.videoHeight || FRAME_HEIGHT;
        const scale = Math.max(FRAME_WIDTH / vw, FRAME_HEIGHT / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        this.sourceCtx.drawImage(this.video, (FRAME_WIDTH - dw) / 2, (FRAME_HEIGHT - dh) / 2, dw, dh);
      }
    }
    this.stats.simMs = performance.now() - simStart;

    const glStart = performance.now();
    const lightMix = this.groundTruth?.lightMix ?? 0;
    const pixels = renderer.process(this.config.id, this.currentSource(), {
      calibration: calibrationForLightMix(lightMix),
      channel: this.config,
      temporalFrames: enhance.temporalFrames,
      motionRange: enhance.motionRange,
      denoiseStrength: enhance.denoiseStrength,
      colorCorrection: enhance.colorCorrection,
      flatField: enhance.flatField,
      sharpen: enhance.sharpen,
      showMotionVectors: enhance.showMotionVectors,
    });
    this.stats.glMs = performance.now() - glStart;

    const output = new ImageData(FRAME_WIDTH, FRAME_HEIGHT);
    output.data.set(pixels);
    this.processedCtx.putImageData(output, 0, 0);

    const currentRGB = meanRGB(pixels);
    const jump = colorJump(this.prevCorrectedRGB, currentRGB);
    this.prevCorrectedRGB = currentRGB;
    this.stats.lastJump = jump;
    this.stats.maxCorrectedJump = Math.max(this.stats.maxCorrectedJump * 0.995, jump);

    if (now - this.lastMetricsAt > 700) {
      this.lastMetricsAt = now;
      this.stats.correctedNoise = estimateNoise(pixels, FRAME_WIDTH, FRAME_HEIGHT);
      this.stats.ringScore = sharpnessScore(pixels, FRAME_WIDTH, FRAME_HEIGHT);
      if (rawDataForMetrics) {
        this.stats.rawNoise = estimateNoise(rawDataForMetrics, FRAME_WIDTH, FRAME_HEIGHT);
      }
    }

    this.processStamps.push(now);
    while (this.processStamps.length > 2 && now - this.processStamps[0] > 2000) this.processStamps.shift();
    if (this.processStamps.length >= 2) {
      const first = this.processStamps[0];
      const last = this.processStamps[this.processStamps.length - 1];
      this.processFpsEma = (1000 * (this.processStamps.length - 1)) / Math.max(1, last - first);
      this.stats.processFps = this.processFpsEma;
    } else {
      this.processFpsEma = Math.min(TARGET_FPS, 1000 / delta);
      this.stats.processFps = this.processFpsEma;
    }
    this.stats.frames++;

    // putImageData has copied; transfer the only CPU copy to the worker.
    this.worker.postMessage(
      {
        type: 'frame',
        channelId: this.config.id,
        frame: this.stats.frames,
        timestamp: Date.now(),
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        buffer: output.data.buffer as ArrayBuffer,
        settings: {
          age: this.config.age,
          lightMix: this.groundTruth?.lightMix ?? (this.config.lightPreset === 'ir' ? 1 : 0),
        },
      },
      [output.data.buffer as ArrayBuffer],
    );
  }

  private handleResult(result: DetectionResult): void {
    this.result = result;
    const now = performance.now();
    this.detectStamps.push(now);
    while (this.detectStamps.length > 2 && now - this.detectStamps[0] > 2000) this.detectStamps.shift();
    if (this.detectStamps.length >= 2) {
      const first = this.detectStamps[0];
      const last = this.detectStamps[this.detectStamps.length - 1];
      this.detectFpsEma = (1000 * (this.detectStamps.length - 1)) / Math.max(1, last - first);
      this.stats.detectFps = this.detectFpsEma;
    }

    this.ratioHistory.push({
      t: result.timestamp,
      ratio: result.ratio,
      truth: this.groundTruth?.ratio,
    });
    if (this.ratioHistory.length > 180) this.ratioHistory.shift();

    this.evaluateAlert(result);
  }

  private evaluateAlert(result: DetectionResult): void {
    const settings = alertSettingsStore.get();
    if (!settings.enabled) return;
    const threshold = thresholdForChannel(settings, this.config.id);
    if (result.ratio + 0.001 < threshold - 0.05) this.alertArmed = true;
    if (!this.alertArmed || result.frame < 12 || result.total < 4) return;
    if (result.ratio < threshold) return;
    const now = Date.now();
    if (now - this.lastAlertAt < settings.cooldownSec * 1000) return;

    this.alertArmed = false;
    this.lastAlertAt = now;
    const event = {
      id: `alert-${now}-${this.config.id}`,
      channelId: this.config.id,
      channelName: this.config.name,
      ratio: result.ratio,
      threshold,
      timestamp: now,
      acknowledged: false,
    };
    pushAlert(event);
    if (settings.sound) playAlertTone();
    if (settings.browserNotification && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('熟蚕比例超过设定值', {
        body: `${this.config.name} 熟蚕比例 ${(result.ratio * 100).toFixed(1)}%，阈值 ${(threshold * 100).toFixed(0)}%，请尽快捡蚕上蔟。`,
      });
    }
  }

  destroy(): void {
    this.disconnectExternalSource();
    this.worker.terminate();
  }
}

// Avoid a runtime import cycle in type positioning while reading the store.
import type { EnhanceSettings } from '../types';
import { enhanceStore } from '../state/store';
function getEnhance(): EnhanceSettings {
  return enhanceStore.get();
}

class MonitorRuntime {
  readonly channels: ChannelRuntime[];
  renderer: WebGLStackRenderer | null = null;
  webglError: string | null = null;
  private timer: number | null = null;
  private listeners = new Set<() => void>();
  private running = false;

  constructor() {
    this.channels = CHANNELS.map((config) => new ChannelRuntime(config));
    try {
      if (!WebGLStackRenderer.isSupported()) throw new Error('WebGL2 不可用');
      this.renderer = new WebGLStackRenderer();
    } catch (error) {
      this.webglError = error instanceof Error ? error.message : String(error);
      console.error(this.webglError);
    }
  }

  private runToken = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    const token = ++this.runToken;
    void this.runLoop(token);
    this.emit();
  }

  stop(): void {
    this.running = false;
    this.runToken++;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private async runLoop(token: number): Promise<void> {
    // Yield after every two channels so eight synchronous GPU readbacks never
    // turn into one long page task. A full sweep targets roughly 8 FPS/channel.
    while (this.running && token === this.runToken) {
      const enhance = enhanceStore.get();
      const now = performance.now();
      if (this.renderer) {
        for (let i = 0; i < this.channels.length; i++) {
          try {
            this.channels[i].process(now + i * 4, this.renderer, enhance);
          } catch (error) {
            console.error(`通道 ${this.channels[i].config.id} 处理失败`, error);
            this.channels[i].stats.connected = false;
          }
          if (i % 4 === 3) {
            await new Promise((resolve) => {
              this.timer = window.setTimeout(resolve, 0);
            });
            if (!this.running || token !== this.runToken) return;
          }
        }
      }
      await new Promise((resolve) => {
        this.timer = window.setTimeout(resolve, 8);
      });
    }
  }

  private tick(_now: number): void {
    // Retained for compatibility; scheduling now lives in runLoop().
  }

  triggerAllSwitch(): void {
    this.channels.forEach((c) => c.triggerLightSwitch());
  }

  async connectAllWebcam(): Promise<void> {
    // Browsers only grant one prompt; reuse the returned device where possible.
    for (const channel of this.channels.slice(0, 1)) {
      await channel.connectWebcam();
    }
  }
}

export const monitor = new MonitorRuntime();
