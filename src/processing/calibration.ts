import type { ChannelConfig } from '../types';

export interface ColorCalibration {
  offset: [number, number, number];
  gain: [number, number, number];
  rows: [number[], number[], number[]];
  exposure: number;
  gamma: number;
  irPseudo: number;
  flatRef: number;
  sigma: number;
}

const IDENTITY_ROWS: [number[], number[], number[]] = [
  [1.06, -0.03, -0.02],
  [-0.02, 1.05, -0.025],
  [0.03, -0.09, 1.16],
];

const IR_ROWS: [number[], number[], number[]] = [
  [1.02, 0.0, 0.0],
  [0.0, 1.04, 0.0],
  [0.0, 0.0, 1.02],
];

export const CFL_CALIBRATION: ColorCalibration = {
  offset: [0.012, 0.02, 0.012],
  gain: [1.12, 0.98, 1.86],
  rows: [
    [1.06, -0.02, -0.01],
    [-0.015, 1.05, -0.02],
    [0.05, -0.07, 1.06],
  ],
  exposure: 1.34,
  gamma: 0.8,
  irPseudo: 0,
  flatRef: 0.76,
  sigma: 0.17,
};

export const IR_CALIBRATION: ColorCalibration = {
  offset: [0.018, 0.01, 0.024],
  gain: [0.94, 1.18, 0.98],
  rows: IR_ROWS,
  exposure: 1.2,
  gamma: 0.72,
  irPseudo: 0.9,
  flatRef: 0.74,
  sigma: 0.18,
};

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function mixRows(
  a: [number[], number[], number[]],
  b: [number[], number[], number[]],
  t: number,
): [number[], number[], number[]] {
  return [
    a[0].map((v, i) => v + (b[0][i] - v) * t),
    a[1].map((v, i) => v + (b[1][i] - v) * t),
    a[2].map((v, i) => v + (b[2][i] - v) * t),
  ];
}

/**
 * The synthetic camera exposes lightMix. Real installs would estimate these
 * profiles from a calibration card / camera ISP metadata; the same uniforms
 * are used by WebGL2 in either case.
 */
export function calibrationForLightMix(lightMix: number): ColorCalibration {
  const t = Math.max(0, Math.min(1, lightMix));
  if (t <= 0.001) return CFL_CALIBRATION;
  if (t >= 0.999) return IR_CALIBRATION;
  return {
    offset: mix3(CFL_CALIBRATION.offset, IR_CALIBRATION.offset, t),
    gain: mix3(CFL_CALIBRATION.gain, IR_CALIBRATION.gain, t),
    rows: mixRows(CFL_CALIBRATION.rows, IR_CALIBRATION.rows, t),
    exposure: CFL_CALIBRATION.exposure + (IR_CALIBRATION.exposure - CFL_CALIBRATION.exposure) * t,
    gamma: CFL_CALIBRATION.gamma + (IR_CALIBRATION.gamma - CFL_CALIBRATION.gamma) * t,
    irPseudo: IR_CALIBRATION.irPseudo * t,
    flatRef: CFL_CALIBRATION.flatRef + (IR_CALIBRATION.flatRef - CFL_CALIBRATION.flatRef) * t,
    sigma: CFL_CALIBRATION.sigma + (IR_CALIBRATION.sigma - CFL_CALIBRATION.sigma) * t,
  };
}

export function lampUniforms(config: ChannelConfig) {
  return {
    lampX: config.lamp.x,
    lampY: config.lamp.y,
    radius: config.lamp.radius,
    ambient: config.lamp.ambient,
    peak: config.lamp.peak,
  };
}
