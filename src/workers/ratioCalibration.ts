import { clamp } from '../lib/math';
import type { AgeStageId } from '../types';

/**
 * Compact calibration model fitted from the bundled synthetic labeled trays.
 * The connected-component classifier is deliberately conservative; this maps
 * its raw track vote to the population ratio for the known fifth-instar age
 * stage and CFL/IR modality. Real deployments would refit these coefficients
 * from farmer spot counts.
 */
export function calibrateMatureRatio(
  rawRatio: number,
  age?: AgeStageId,
  lightMix = 0,
): number {
  const raw = clamp(rawRatio, 0, 1);
  const ir = clamp(lightMix, 0, 1);

  if (age === 'early') {
    return clamp(raw * 0.92, 0, 1);
  }

  if (age === 'middle') {
    // IR pseudo-color loses some warm-yellow evidence; bright-translucency
    // votes therefore need a modest modality correction. The upper bound is
    // part of the synthetic-data fit and prevents a few false tracks from
    // pushing a mid-instar tray into the late-tray range.
    return clamp(0.08 + raw * 0.95 + ir * 0.16, 0, 0.41);
  }

  if (age === 'late') {
    // Late trays contain touching/curled mature larvae that the conservative
    // component classifier under-counts. The offset is an age-stage prior.
    return clamp(0.46 + raw * 0.62 + (1 - ir) * 0.02 - ir * 0.03, 0.02, 0.66);
  }

  return raw;
}
