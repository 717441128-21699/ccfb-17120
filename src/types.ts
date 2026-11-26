export type PageId = 'access' | 'enhance' | 'ratio' | 'alerts';

export type LightPreset = 'cfl' | 'ir' | 'switch';
export type EffectiveLight = 'cfl' | 'ir';
export type AgeStageId = 'early' | 'middle' | 'late';
export type SourceKind = 'synthetic' | 'webcam' | 'url';

export interface Point {
  x: number;
  y: number;
}

export interface LampConfig {
  /** 0..1, relative to frame width/height */
  x: number;
  y: number;
  /** Relative diagonal radius */
  radius: number;
  ambient: number;
  peak: number;
}

export interface ChannelConfig {
  id: string;
  name: string;
  tray: string;
  seed: number;
  lightPreset: LightPreset;
  age: AgeStageId;
  matureRatio: number;
  lamp: LampConfig;
  sourceKind: SourceKind;
  sourceLabel: string;
  url?: string;
}

export interface WormGroundTruth {
  id: number;
  x: number;
  y: number;
  angle: number;
  length: number;
  thickness: number;
  mature: boolean;
  maturity: number;
}

export interface GroundTruthFrame {
  channelId: string;
  frame: number;
  timestamp: number;
  total: number;
  mature: number;
  ratio: number;
  light: EffectiveLight;
  /** 0 = CFL, 1 = IR. Switching frames may lie between. */
  lightMix: number;
  age: AgeStageId;
  worms: WormGroundTruth[];
}

export interface DetectionBox {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  mature: boolean;
  confidence: number;
  matureScore: number;
  area: number;
  length: number;
  stale?: boolean;
}

export interface DetectionResult {
  channelId: string;
  frame: number;
  timestamp: number;
  total: number;
  mature: number;
  ratio: number;
  rawRatio?: number;
  boxes: DetectionBox[];
  workerMs: number;
  width: number;
  height: number;
  trackerStable: number;
}

export interface ChannelRuntimeStats {
  processFps: number;
  captureFps: number;
  detectFps: number;
  glMs: number;
  simMs: number;
  lastJump: number;
  maxCorrectedJump: number;
  rawNoise: number;
  correctedNoise: number;
  ringScore: number;
  connected: boolean;
  frames: number;
}

export interface EnhanceSettings {
  temporalFrames: number;
  motionRange: number;
  denoiseStrength: number;
  colorCorrection: boolean;
  flatField: number;
  sharpen: number;
  showMotionVectors: boolean;
}

export interface AlertSettings {
  enabled: boolean;
  globalThreshold: number;
  channelThresholds: Record<string, number>;
  browserNotification: boolean;
  sound: boolean;
  cooldownSec: number;
  webhookUrl: string;
}

export interface AlertEvent {
  id: string;
  channelId: string;
  channelName: string;
  ratio: number;
  threshold: number;
  timestamp: number;
  acknowledged: boolean;
}

export interface PersistedSettings {
  enhance: EnhanceSettings;
  alerts: AlertSettings;
}

export interface WorkerRequest {
  type: 'frame';
  channelId: string;
  frame: number;
  timestamp: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  settings: {
    threshold?: number;
    age?: AgeStageId;
    lightMix?: number;
  };
}

export type WorkerResponse =
  | {
      type: 'result';
      result: DetectionResult;
    }
  | {
      type: 'ready';
      channelId: string;
    };
