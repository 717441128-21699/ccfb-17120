import { clamp } from '../lib/math';
import type { DetectionBox, DetectionResult } from '../types';

export interface PixelLike {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

interface ComponentStats {
  id: number;
  area: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  scoreSum: number;
  highlight: number;
  warmCount: number;
  brightCount: number;
}

export interface RawDetection {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  area: number;
  length: number;
  elongation: number;
  matureScore: number;
  mature: boolean;
  confidence: number;
  warmFraction?: number;
  highlightFraction?: number;
  meanScore?: number;
}

/**
 * Image-based silkworm segmentation. It intentionally uses only corrected
 * RGBA pixels: adaptive luminance/color threshold, connected components and
 * shape/maturity features. The synthetic ground truth never enters this path.
 */
export function detectSilkworms(
  frame: PixelLike,
  rejectLog?: Array<Record<string, unknown>>,
  debugInfo?: Record<string, number>,
): RawDetection[] {
  const { data, width, height } = frame;
  const sw = Math.floor(width / 2);
  const sh = Math.floor(height / 2);
  if (sw < 20 || sh < 20) return [];

  const count = sw * sh;
  const lum = new Float32Array(count);
  const blueRatio = new Float32Array(count);
  const score = new Float32Array(count);
  const warmMask = new Uint8Array(count);
  const mask = new Uint8Array(count);
  const histogram = new Uint32Array(256);

  // Integral luminance gives a cheap local tray/background estimate.
  const integral = new Float64Array((sw + 1) * (sh + 1));
  for (let y = 0; y < sh; y++) {
    let rowSum = 0;
    for (let x = 0; x < sw; x++) {
      const sx = x * 2;
      const sy = y * 2;
      let r = 0;
      let g = 0;
      let b = 0;
      let samples = 0;
      for (let oy = 0; oy < 2; oy++) {
        const py = Math.min(height - 1, sy + oy);
        for (let ox = 0; ox < 2; ox++) {
          const px = Math.min(width - 1, sx + ox);
          const si = (py * width + px) * 4;
          r += data[si];
          g += data[si + 1];
          b += data[si + 2];
          samples++;
        }
      }
      r /= samples;
      g /= samples;
      b /= samples;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const idx = y * sw + x;
      lum[idx] = l;
      blueRatio[idx] = b / Math.max(1, r);
      rowSum += l;
      integral[(y + 1) * (sw + 1) + x + 1] =
        integral[y * (sw + 1) + x + 1] + rowSum;

      const warmth = clamp((r - b - 24) / 42, 0, 1);
      const brightness = clamp((l - 168) / 66, 0, 1);
      const shine = l > 226 ? clamp((l - 226) / 29, 0, 1) : 0;
      score[idx] = clamp(0.34 * brightness + 0.3 * warmth + 0.36 * shine, 0, 1.1);
      warmMask[idx] = warmth > 0.52 && l > 158 ? 1 : 0;
      histogram[Math.min(255, Math.max(0, Math.round(l)))]++;
    }
  }

  // Adaptive upper-tail threshold. Larvae occupy roughly 15-25% of a tray.
  let cumulative = 0;
  let adaptiveLuma = 154;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value];
    if (cumulative >= count * 0.7) {
      adaptiveLuma = value + 5;
      break;
    }
  }
  adaptiveLuma = clamp(adaptiveLuma, 136, 205);

  const radius = 5;
  for (let y = 0; y < sh; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(sh, y + radius + 1);
    for (let x = 0; x < sw; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(sw, x + radius + 1);
      const area = (x1 - x0) * (y1 - y0);
      const sum =
        integral[y1 * (sw + 1) + x1] -
        integral[y0 * (sw + 1) + x1] -
        integral[y1 * (sw + 1) + x0] +
        integral[y0 * (sw + 1) + x0];
      const local = sum / area;
      const idx = y * sw + x;
      const l = lum[idx];

      const brightEnough = l > adaptiveLuma && blueRatio[idx] > 0.58;
      const aboveLocal = l > local + 6 || (l > adaptiveLuma + 22 && blueRatio[idx] > 0.78);
      if (brightEnough && aboveLocal) mask[idx] = 1;
    }
  }

  // Close ring gaps, then open to break sparse IR/read-noise bridges.
  morphDilate(mask, sw, sh);
  morphErode(mask, sw, sh);
  morphErode(mask, sw, sh);
  morphDilate(mask, sw, sh);
  if (debugInfo) {
    debugInfo.threshold = adaptiveLuma;
    debugInfo.maskCount = mask.reduce((sum, v) => sum + v, 0);
    debugInfo.pixelCount = count;
    let maturePixels = 0;
    let scoreSumMask = 0;
    for (let p = 0; p < count; p++) {
      if (mask[p]) {
        scoreSumMask += score[p];
        if (score[p] > 0.5) maturePixels++;
      }
    }
    debugInfo.maturePixels = maturePixels;
    debugInfo.meanMaskScore = scoreSumMask / Math.max(1, debugInfo.maskCount);
  }

  const labels = new Int32Array(count);
  const components: ComponentStats[] = [];
  const stack: number[] = [];

  for (let start = 0; start < count; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = components.length + 1;
    const comp: ComponentStats = {
      id,
      area: 0,
      sumX: 0,
      sumY: 0,
      sumXX: 0,
      sumYY: 0,
      sumXY: 0,
      minX: sw,
      maxX: 0,
      minY: sh,
      maxY: 0,
      scoreSum: 0,
      highlight: 0,
      warmCount: 0,
      brightCount: 0,
    };
    labels[start] = id;
    stack.push(start);

    while (stack.length) {
      const p = stack.pop()!;
      const x = p % sw;
      const y = (p / sw) | 0;
      comp.area++;
      comp.sumX += x;
      comp.sumY += y;
      comp.sumXX += x * x;
      comp.sumYY += y * y;
      comp.sumXY += x * y;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      comp.scoreSum += score[p];
      if (lum[p] > 214) comp.highlight++;
      if (lum[p] > 196) comp.brightCount++;
      comp.warmCount += warmMask[p];

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= sh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= sw) continue;
          const np = ny * sw + nx;
          if (mask[np] && !labels[np]) {
            labels[np] = id;
            stack.push(np);
          }
        }
      }
    }
    components.push(comp);
  }

  const sx = width / sw;
  const sy = height / sh;
  if (debugInfo) debugInfo.componentCount = components.length;
  const detections: RawDetection[] = [];
  let boxId = 1;

  for (const c of components) {
    if (c.area < 22) continue;
    if (c.area > 760) {
      rejectLog?.push({ reason: 'area', area: c.area, bw: c.maxX - c.minX + 1, bh: c.maxY - c.minY + 1 });
      continue;
    }
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const bboxArea = Math.max(1, bw * bh);
    const fill = c.area / bboxArea;
    if (fill < 0.16 || fill > 0.95) {
      if (c.area >= 24) rejectLog?.push({ reason: 'fill', area: c.area, bw, bh, fill });
      continue;
    }
    if (bw < 6 || bh < 2) {
      if (c.area >= 24) rejectLog?.push({ reason: 'bbox', area: c.area, bw, bh, fill });
      continue;
    }

    const n = c.area;
    const mx = c.sumX / n;
    const my = c.sumY / n;
    const covXX = Math.max(0, c.sumXX / n - mx * mx);
    const covYY = Math.max(0, c.sumYY / n - my * my);
    const covXY = c.sumXY / n - mx * my;
    const trace = covXX + covYY;
    const disc = Math.sqrt(Math.max(0, (covXX - covYY) ** 2 + 4 * covXY * covXY));
    const lambda1 = Math.max(0.05, (trace + disc) / 2);
    const lambda2 = Math.max(0.01, (trace - disc) / 2);
    const elongation = Math.sqrt(lambda1 / lambda2);
    const bboxElongation = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));

    // Curved worms can have a modest PCA ratio; bbox and area help.
    const elongatedEnough = elongation > 1.55 || bboxElongation > 1.8;
    if (!elongatedEnough) {
      if (c.area >= 24) rejectLog?.push({ reason: 'elongation', area: c.area, bw, bh, elongation, bboxElongation });
      continue;
    }
    if (Math.max(bw, bh) < 9) {
      if (c.area >= 24) rejectLog?.push({ reason: 'shortBBox', area: c.area, bw, bh, elongation });
      continue;
    }

    const length = Math.sqrt(12 * lambda1) * sx;
    if (length < 18 || length > 92) {
      rejectLog?.push({ reason: 'length', area: c.area, bw, bh, elongation, length });
      continue;
    }

    const meanScore = c.scoreSum / n;
    const highlightFraction = c.highlight / n;
    const brightFraction = c.brightCount / n;
    const warmFraction = c.warmCount / n;
    const matureScore = clamp(
      meanScore * 0.3 +
        Math.min(1, warmFraction / 0.42) * 0.38 +
        Math.min(1, brightFraction / 0.5) * 0.1 +
        Math.min(1, highlightFraction / 0.2) * 0.22,
      0,
      1.15,
    );
    const mature = matureScore >= 0.55;
    const shapeConfidence = clamp((elongation - 1.6) / 2.2, 0.35, 1);
    const areaConfidence = clamp((c.area - 30) / 70, 0.45, 1);
    const confidence = clamp(0.55 * shapeConfidence + 0.45 * areaConfidence, 0, 0.99);

    detections.push({
      id: boxId++,
      x: c.minX * sx - 2,
      y: c.minY * sy - 2,
      width: bw * sx + 4,
      height: bh * sy + 4,
      cx: mx * sx,
      cy: my * sy,
      area: c.area * sx * sy,
      length,
      elongation,
      matureScore,
      mature,
      confidence,
      warmFraction,
      highlightFraction,
      meanScore,
    });
  }

  return mergeNearbyFragments(detections);
}

function morphDilate(mask: Uint8Array, w: number, h: number): void {
  const src = Uint8Array.from(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      mask[i] =
        src[i] ||
        src[i - 1] ||
        src[i + 1] ||
        src[i - w] ||
        src[i + w] ||
        src[i - w - 1] ||
        src[i - w + 1] ||
        src[i + w - 1] ||
        src[i + w + 1]
          ? 1
          : 0;
    }
  }
}

function morphErode(mask: Uint8Array, w: number, h: number): void {
  const src = Uint8Array.from(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      mask[i] =
        src[i] &&
        src[i - 1] &&
        src[i + 1] &&
        src[i - w] &&
        src[i + w] &&
        src[i - w - 1] &&
        src[i - w + 1] &&
        src[i + w - 1] &&
        src[i + w + 1]
          ? 1
          : 0;
    }
  }
}

/**
 * Ring contrast or thresholding can occasionally split one larva into two
 * nearby elongated fragments. Merge only close, collinear pieces.
 */
function mergeNearbyFragments(detections: RawDetection[]): RawDetection[] {
  const merged: RawDetection[] = [];
  const used = new Set<number>();

  for (let i = 0; i < detections.length; i++) {
    if (used.has(i)) continue;
    const a = detections[i];
    used.add(i);
    let cur = { ...a };

    for (let j = i + 1; j < detections.length; j++) {
      if (used.has(j)) continue;
      const b = detections[j];
      const dist = Math.hypot(cur.cx - b.cx, cur.cy - b.cy);
      const combinedLength = cur.length + b.length;
      if (dist > 13 || dist > combinedLength * 0.42) continue;
      const sameGeneralShape = Math.abs(cur.elongation - b.elongation) < 2.4;
      if (!sameGeneralShape && dist > 8) continue;

      const x1 = Math.min(cur.x, b.x);
      const y1 = Math.min(cur.y, b.y);
      const x2 = Math.max(cur.x + cur.width, b.x + b.width);
      const y2 = Math.max(cur.y + cur.height, b.y + b.height);
      const area = cur.area + b.area;
      const matureScore =
        (cur.matureScore * cur.area + b.matureScore * b.area) / area;
      cur = {
        ...cur,
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        cx: (cur.cx * cur.area + b.cx * b.area) / area,
        cy: (cur.cy * cur.area + b.cy * b.area) / area,
        area,
        length: cur.length + b.length * 0.72,
        matureScore,
        mature: matureScore >= 0.55,
        confidence: Math.max(cur.confidence, b.confidence),
      };
      used.add(j);
    }
    merged.push(cur);
  }
  return merged;
}

interface Track {
  id: number;
  cx: number;
  cy: number;
  matureScore: number;
  matureVotes: number;
  mature: boolean;
  age: number;
  missed: number;
  lastBox: RawDetection;
}

export class SilkwormTracker {
  private tracks = new Map<number, Track>();
  private nextId = 1;

  update(raw: RawDetection[]): DetectionBox[] {
    const unmatchedTracks = new Set(this.tracks.keys());
    const matchedDetections = new Set<number>();

    // Greedy nearest-centroid matching; larvae move slowly relative to spacing.
    const pairs: Array<{ trackId: number; detIndex: number; dist: number }> = [];
    for (const [id, track] of this.tracks) {
      raw.forEach((d, di) => {
        const dist = Math.hypot(track.cx - d.cx, track.cy - d.cy);
        if (dist < 34) pairs.push({ trackId: id, detIndex: di, dist });
      });
    }
    pairs.sort((a, b) => a.dist - b.dist);

    for (const pair of pairs) {
      if (!unmatchedTracks.has(pair.trackId) || matchedDetections.has(pair.detIndex)) continue;
      unmatchedTracks.delete(pair.trackId);
      matchedDetections.add(pair.detIndex);
      const d = raw[pair.detIndex];
      const t = this.tracks.get(pair.trackId)!;
      t.cx = d.cx;
      t.cy = d.cy;
      t.matureScore = t.matureScore * 0.68 + d.matureScore * 0.32;
      if (d.matureScore >= 0.58) t.matureVotes = Math.min(30, t.matureVotes + 2);
      else t.matureVotes = Math.max(0, t.matureVotes - 1);
      // A larva is mature if the smoothed score passes or it has repeatedly
      // shown the strong translucent/gold feature across crawl poses.
      t.mature = t.matureScore >= 0.55 || t.matureVotes >= 4;
      t.age++;
      t.missed = 0;
      t.lastBox = d;
    }

    for (const id of unmatchedTracks) {
      const t = this.tracks.get(id)!;
      t.missed++;
      t.age++;
      if (t.missed > 90) this.tracks.delete(id);
    }

    raw.forEach((d, di) => {
      if (matchedDetections.has(di)) return;
      const id = this.nextId++;
      this.tracks.set(id, {
        id,
        cx: d.cx,
        cy: d.cy,
        matureScore: d.matureScore,
        matureVotes: d.mature ? 2 : 0,
        mature: d.mature,
        age: 1,
        missed: 0,
        lastBox: d,
      });
    });

    const boxes: DetectionBox[] = [];
    for (const t of this.tracks.values()) {
      if (t.age < 1 || t.missed > 28) continue;
      const d = t.lastBox;
      boxes.push({
        id: t.id,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        cx: t.cx,
        cy: t.cy,
        mature: t.mature,
        confidence: d.confidence,
        matureScore: t.matureScore,
        area: d.area,
        length: d.length,
        stale: t.missed > 4,
      });
    }
    return boxes;
  }

  stableCount(): number {
    let n = 0;
    for (const t of this.tracks.values()) if (t.age >= 3 && t.missed === 0) n++;
    return n;
  }

  reset(): void {
    this.tracks.clear();
    this.nextId = 1;
  }
}

export function buildDetectionResult(
  channelId: string,
  frame: number,
  timestamp: number,
  width: number,
  height: number,
  boxes: DetectionBox[],
  workerMs: number,
  stable: number,
): DetectionResult {
  const total = boxes.length;
  const mature = boxes.filter((b) => b.mature).length;
  return {
    channelId,
    frame,
    timestamp,
    total,
    mature,
    ratio: total ? mature / total : 0,
    boxes,
    workerMs,
    width,
    height,
    trackerStable: stable,
  };
}
