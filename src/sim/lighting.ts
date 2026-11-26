import type { LampConfig } from '../types';
import { clamp } from '../lib/math';

/**
 * Low-frequency lamp falloff shared by the synthetic camera and the
 * WebGL flat-field correction uniforms.
 */
export function illuminationAt(nx: number, ny: number, lamp: LampConfig): number {
  const dx = nx - lamp.x;
  const dy = ny - lamp.y;
  const d2 = dx * dx + dy * dy * 1.15;
  const beam = Math.exp(-d2 / (lamp.radius * lamp.radius * 0.72));
  const edge = 0.92 + 0.08 * Math.cos((nx - 0.5) * Math.PI);
  return clamp(lamp.ambient + (lamp.peak - lamp.ambient) * beam * edge, 0.08, 1.45);
}

export function gaussianRandom(seedState: { value: number }): number {
  // Deterministic-ish Box-Muller using two LCG samples. Not cryptographic.
  seedState.value = (Math.imul(seedState.value, 1664525) + 1013904223) >>> 0;
  const u1 = seedState.value / 4294967296 + 1e-9;
  seedState.value = (Math.imul(seedState.value, 1664525) + 1013904223) >>> 0;
  const u2 = seedState.value / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
