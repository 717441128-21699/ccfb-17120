import { clamp } from '../lib/math';

export function meanLuma(rgba: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 16) {
    sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    n++;
  }
  return n ? sum / n : 0;
}

export function meanRGB(rgba: ArrayLike<number>): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 16) {
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

export function colorJump(
  prevRGB: [number, number, number] | null,
  nextRGB: [number, number, number],
): number {
  if (!prevRGB) return 0;
  // Weighted RGB distance, roughly ΔE-like for a dashboard metric.
  const dr = nextRGB[0] - prevRGB[0];
  const dg = nextRGB[1] - prevRGB[1];
  const db = nextRGB[2] - prevRGB[2];
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

/** Median adjacent-pixel residual; useful as a relative noise gauge. */
export function estimateNoise(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): number {
  const residuals: number[] = [];
  for (let y = 4; y < height - 4; y += 2) {
    for (let x = 4; x < width - 5; x += 2) {
      const i = (y * width + x) * 4;
      const right = i + 8;
      const down = i + width * 8;
      const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      const lr = 0.2126 * rgba[right] + 0.7152 * rgba[right + 1] + 0.0722 * rgba[right + 2];
      const ld = 0.2126 * rgba[down] + 0.7152 * rgba[down + 1] + 0.0722 * rgba[down + 2];
      residuals.push(Math.abs(l - lr) * 0.7 + Math.abs(l - ld) * 0.3);
    }
  }
  residuals.sort((a, b) => a - b);
  return residuals.length ? residuals[Math.floor(residuals.length * 0.35)] : 0;
}

/** High-frequency gradient energy. Temporal stacking should lower noise while retaining this. */
export function sharpnessScore(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): number {
  let energy = 0;
  let n = 0;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = (y * width + x) * 4;
      const l =
        0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      const ix = i + 8;
      const iy = i + width * 8;
      const lx = 0.2126 * rgba[ix] + 0.7152 * rgba[ix + 1] + 0.0722 * rgba[ix + 2];
      const ly = 0.2126 * rgba[iy] + 0.7152 * rgba[iy + 1] + 0.0722 * rgba[iy + 2];
      energy += Math.abs(l - lx) + Math.abs(l - ly);
      n++;
    }
  }
  return clamp(energy / Math.max(1, n) / 255, 0, 1);
}
