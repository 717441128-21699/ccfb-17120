import type { AlertSettings, ChannelConfig, EnhanceSettings } from './types';

export const FRAME_WIDTH = 224;
export const FRAME_HEIGHT = 168;
export const TARGET_FPS = 6;
export const MIN_REQUIRED_FPS = 5;

export const AGE_LABELS: Record<string, string> = {
  early: '五龄第2天 · 盛食期',
  middle: '五龄第4天 · 贮丝期',
  late: '五龄末 · 熟蚕批次',
};

export const LIGHT_LABELS: Record<string, string> = {
  cfl: '节能灯',
  ir: '红外补光',
  switch: '节能灯/红外切换',
};

export const DEFAULT_ENHANCE: EnhanceSettings = {
  temporalFrames: 4,
  motionRange: 3,
  denoiseStrength: 0.82,
  colorCorrection: true,
  flatField: 0.86,
  sharpen: 0.55,
  showMotionVectors: false,
};

export const DEFAULT_ALERTS: AlertSettings = {
  enabled: true,
  globalThreshold: 0.35,
  channelThresholds: {},
  browserNotification: true,
  sound: true,
  cooldownSec: 30,
  webhookUrl: '',
};

export const CHANNELS: ChannelConfig[] = [
  {
    id: 'tray-a1',
    name: 'A1 匾',
    tray: '蚕架一层左',
    seed: 101,
    lightPreset: 'cfl',
    age: 'early',
    matureRatio: 0.08,
    lamp: { x: 0.43, y: -0.18, radius: 0.92, ambient: 0.2, peak: 1.18 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 节能灯',
  },
  {
    id: 'tray-a2',
    name: 'A2 匾',
    tray: '蚕架一层右',
    seed: 202,
    lightPreset: 'cfl',
    age: 'early',
    matureRatio: 0.17,
    lamp: { x: 0.68, y: -0.12, radius: 0.95, ambient: 0.19, peak: 1.16 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 节能灯',
  },
  {
    id: 'tray-b1',
    name: 'B1 匾',
    tray: '蚕架二层左',
    seed: 303,
    lightPreset: 'switch',
    age: 'middle',
    matureRatio: 0.29,
    lamp: { x: 0.36, y: -0.16, radius: 0.9, ambient: 0.18, peak: 1.2 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 自动切换',
  },
  {
    id: 'tray-b2',
    name: 'B2 匾',
    tray: '蚕架二层右',
    seed: 404,
    lightPreset: 'ir',
    age: 'middle',
    matureRatio: 0.38,
    lamp: { x: 0.62, y: -0.2, radius: 0.94, ambient: 0.16, peak: 1.22 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 红外',
  },
  {
    id: 'tray-c1',
    name: 'C1 匾',
    tray: '蚕架三层左',
    seed: 505,
    lightPreset: 'cfl',
    age: 'middle',
    matureRatio: 0.46,
    lamp: { x: 0.48, y: -0.14, radius: 0.91, ambient: 0.18, peak: 1.18 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 节能灯',
  },
  {
    id: 'tray-c2',
    name: 'C2 匾',
    tray: '蚕架三层右',
    seed: 606,
    lightPreset: 'switch',
    age: 'late',
    matureRatio: 0.55,
    lamp: { x: 0.72, y: -0.18, radius: 0.93, ambient: 0.17, peak: 1.2 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 自动切换',
  },
  {
    id: 'tray-d1',
    name: 'D1 匾',
    tray: '上蔟预备左',
    seed: 707,
    lightPreset: 'ir',
    age: 'late',
    matureRatio: 0.67,
    lamp: { x: 0.4, y: -0.16, radius: 0.88, ambient: 0.16, peak: 1.24 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 红外',
  },
  {
    id: 'tray-d2',
    name: 'D2 匾',
    tray: '上蔟预备右',
    seed: 808,
    lightPreset: 'switch',
    age: 'late',
    matureRatio: 0.64,
    lamp: { x: 0.58, y: -0.22, radius: 0.9, ambient: 0.15, peak: 1.24 },
    sourceKind: 'synthetic',
    sourceLabel: '合成夜间真值 · 批量熟蚕',
  },
];

export function thresholdForChannel(alerts: AlertSettings, channelId: string): number {
  const v = alerts.channelThresholds[channelId];
  return typeof v === 'number' && Number.isFinite(v) ? v : alerts.globalThreshold;
}
