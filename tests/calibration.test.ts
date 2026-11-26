import { describe, expect, it } from 'vitest';
import { calibrateMatureRatio } from '../src/workers/ratioCalibration';

describe('mature ratio calibration', () => {
  it('keeps early-tray ratios conservative', () => {
    expect(calibrateMatureRatio(0.1, 'early', 0)).toBeCloseTo(0.092, 5);
  });

  it('applies the IR modality correction for middle trays', () => {
    const cfl = calibrateMatureRatio(0.25, 'middle', 0);
    const ir = calibrateMatureRatio(0.25, 'middle', 1);
    expect(ir).toBeGreaterThan(cfl);
    expect(ir).toBeLessThanOrEqual(0.96);
  });

  it('never returns an invalid ratio', () => {
    for (const age of ['early', 'middle', 'late'] as const) {
      for (const mix of [0, 0.5, 1]) {
        const value = calibrateMatureRatio(2, age, mix);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
