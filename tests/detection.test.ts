import { describe, expect, it } from 'vitest';
import { detectSilkworms, SilkwormTracker } from '../src/workers/detect';
import { thresholdForChannel } from '../src/config';
import { DEFAULT_ALERTS } from '../src/config';

interface TestWorm {
  x: number;
  y: number;
  angle: number;
  length: number;
  thickness: number;
  mature: boolean;
}

function makeWormFrame(worms: TestWorm[], noise = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 320;
  const height = 240;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 1234567;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const weave = Math.sin(y * 0.35) * 7 + Math.sin(x * 0.28) * 5;
      const n = (rand() - 0.5) * noise * 2;
      data[i] = 151 + weave + n;
      data[i + 1] = 112 + weave * 0.65 + n;
      data[i + 2] = 72 + weave * 0.35 + n * 0.6;
      data[i + 3] = 255;
    }
  }

  for (const w of worms) {
    const cos = Math.cos(w.angle);
    const sin = Math.sin(w.angle);
    const rx = w.length / 2;
    const ry = w.thickness / 2;
    for (let y = Math.max(0, Math.floor(w.y - rx)); y < Math.min(height, w.y + rx); y++) {
      for (let x = Math.max(0, Math.floor(w.x - rx)); x < Math.min(width, w.x + rx); x++) {
        const dx = x - w.x;
        const dy = y - w.y;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const e = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
        if (e > 1) continue;
        const i = (y * width + x) * 4;
        const edge = Math.sqrt(e);
        const ring = Math.abs(Math.sin(lx * 0.72)) > 0.82 ? 24 : 0;
        const mature = w.mature;
        const shade = (1 - edge) * 18 - ring;
        data[i] = mature ? 246 + shade * 0.5 : 211 + shade;
        data[i + 1] = mature ? 236 + shade * 0.5 : 215 + shade;
        data[i + 2] = mature ? 150 + shade * 0.4 : 204 + shade;
        if (Math.abs(ly + ry * 0.25) < 1.3 && Math.abs(lx) < rx * 0.72) {
          data[i] = Math.min(255, data[i] + 28);
          data[i + 1] = Math.min(255, data[i + 1] + 28);
          data[i + 2] = Math.min(255, data[i + 2] + 20);
        }
      }
    }
  }
  return { data, width, height };
}

function gridWorms(matureIndexes: number[]): TestWorm[] {
  const worms: TestWorm[] = [];
  let id = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      worms.push({
        x: 43 + col * 78 + (row % 2) * 8,
        y: 38 + row * 53,
        angle: (row % 2 ? -0.18 : 0.12) + col * 0.025,
        length: 43 + ((row + col) % 3) * 3,
        thickness: 9,
        mature: matureIndexes.includes(id++),
      });
    }
  }
  return worms;
}

describe('silkworm detection statistics', () => {
  it('counts separated larvae and estimates mature ratio within 10 percentage points', () => {
    const matureIndexes = [0, 2, 5, 7, 9, 12, 15];
    const truth = matureIndexes.length / 16;
    const frame = makeWormFrame(gridWorms(matureIndexes));
    const detections = detectSilkworms(frame);
    const mature = detections.filter((d) => d.mature).length;
    const ratio = detections.length ? mature / detections.length : 0;

    expect(detections.length).toBeGreaterThanOrEqual(9);
    expect(detections.length).toBeLessThanOrEqual(18);
    expect(Math.abs(ratio - truth)).toBeLessThanOrEqual(0.1);
  });

  it('tracks the same larvae across small movements without duplicating counts', () => {
    const worms = gridWorms([1, 4, 8, 11, 14]);
    const tracker = new SilkwormTracker();
    let boxes = tracker.update(detectSilkworms(makeWormFrame(worms)));
    expect(boxes.length).toBeGreaterThanOrEqual(9);

    for (const w of worms) {
      w.x += 1.2;
      w.y += 0.4;
    }
    boxes = tracker.update(detectSilkworms(makeWormFrame(worms)));
    const ids = new Set(boxes.map((b) => b.id));
    expect(ids.size).toBe(boxes.length);
    expect(boxes.length).toBeGreaterThanOrEqual(9);
  });

  it('uses global threshold unless a channel override exists', () => {
    const settings = { ...DEFAULT_ALERTS, globalThreshold: 0.4 };
    expect(thresholdForChannel(settings, 'tray-a1')).toBe(0.4);
    settings.channelThresholds = { 'tray-a1': 0.62 };
    expect(thresholdForChannel(settings, 'tray-a1')).toBe(0.62);
  });
});
