import { FRAME_HEIGHT, FRAME_WIDTH } from '../config';
import { clamp, mulberry32 } from '../lib/math';
import { gaussianRandom, illuminationAt } from './lighting';
import type {
  ChannelConfig,
  EffectiveLight,
  GroundTruthFrame,
  WormGroundTruth,
} from '../types';

interface Worm extends WormGroundTruth {
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  wander: number;
  crawlPhase: number;
  crawlSpeed: number;
}

export interface RenderedScene {
  rawCanvas: HTMLCanvasElement;
  groundTruth: GroundTruthFrame;
  rawImageData: ImageData;
}

const TRAY = {
  x: 18,
  y: 24,
  w: FRAME_WIDTH - 36,
  h: FRAME_HEIGHT - 42,
  cx: FRAME_WIDTH / 2,
  cy: FRAME_HEIGHT / 2 + 5,
  rx: FRAME_WIDTH * 0.405,
  ry: FRAME_HEIGHT * 0.365,
};

export class SyntheticSilkwormScene {
  readonly config: ChannelConfig;
  readonly rawCanvas: HTMLCanvasElement;
  private readonly rawCtx: CanvasRenderingContext2D;
  private readonly cleanCanvas: HTMLCanvasElement;
  private readonly cleanCtx: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private readonly rawImageData: ImageData;
  private readonly worms: Worm[] = [];
  private readonly rand: () => number;
  private noiseSeed: { value: number };
  private illumMap: Float32Array | null = null;
  private irIllumMap: Float32Array | null = null;
  private frame = 0;
  private lastTime = 0;
  private lightMix = 0;
  private nextAutoSwitch = 0;
  private currentLight: EffectiveLight;

  constructor(config: ChannelConfig) {
    this.config = config;
    this.rand = mulberry32(config.seed * 7919 + 13);
    this.noiseSeed = { value: config.seed * 104729 + 7 };
    this.currentLight = config.lightPreset === 'ir' ? 'ir' : 'cfl';
    this.lightMix = this.currentLight === 'ir' ? 1 : 0;
    this.nextAutoSwitch = 6500 + this.rand() * 9000;

    this.rawCanvas = document.createElement('canvas');
    this.rawCanvas.width = FRAME_WIDTH;
    this.rawCanvas.height = FRAME_HEIGHT;
    const rawCtx = this.rawCanvas.getContext('2d', { willReadFrequently: true });
    if (!rawCtx) throw new Error('2D canvas context unavailable');
    this.rawCtx = rawCtx;

    this.cleanCanvas = document.createElement('canvas');
    this.cleanCanvas.width = FRAME_WIDTH;
    this.cleanCanvas.height = FRAME_HEIGHT;
    const cleanCtx = this.cleanCanvas.getContext('2d');
    if (!cleanCtx) throw new Error('2D canvas context unavailable');
    this.cleanCtx = cleanCtx;

    this.background = this.createBackground();
    this.rawImageData = this.rawCtx.createImageData(FRAME_WIDTH, FRAME_HEIGHT);
    this.seedWorms();
  }

  switchLight(light?: EffectiveLight): EffectiveLight {
    const next = light ?? (this.currentLight === 'cfl' ? 'ir' : 'cfl');
    this.currentLight = next;
    this.lightMix = next === 'ir' ? 1 : 0;
    this.nextAutoSwitch = performance.now() + 8000 + this.rand() * 9000;
    return next;
  }

  getLight(): EffectiveLight {
    return this.currentLight;
  }

  /** Dataset matrix helper; normal runtime switches use switchLight(). */
  setLightMixForDataset(mix: number): void {
    this.lightMix = Math.max(0, Math.min(1, mix));
    this.currentLight = this.lightMix > 0.5 ? 'ir' : 'cfl';
  }

  private seedWorms(): void {
    // A loose 4×4 rearing grid keeps individual larvae countable while the
    // spring anchors and separation still allow visible, independent crawling.
    const count = 16;
    const matureCount = Math.round(count * clamp(this.config.matureRatio, 0, 1));
    const matureFlags = Array.from({ length: count }, (_, i) => i < matureCount);
    for (let i = matureFlags.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [matureFlags[i], matureFlags[j]] = [matureFlags[j], matureFlags[i]];
    }

    for (let i = 0; i < count; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 34 + col * ((FRAME_WIDTH - 68) / 3) + (row % 2 ? 5 : -2) + (this.rand() - 0.5) * 5;
      const y = 36 + row * 32 + (this.rand() - 0.5) * 4;
      // Mostly horizontal bodies avoid vertical neighbours touching.
      const direction = this.rand() > 0.5 ? 0 : Math.PI;
      const angle = direction + (this.rand() - 0.5) * 0.42;
      const speed = 2.4 + this.rand() * 2.4;
      const mature = matureFlags[i];
      this.worms.push({
        id: i + 1,
        x,
        y,
        homeX: x,
        homeY: y,
        angle,
        length: 31 + this.rand() * 8 + (mature ? 3 : 0),
        thickness: 7 + this.rand() * 1.6 + (mature ? 0.7 : 0),
        mature,
        maturity: mature ? 0.76 + this.rand() * 0.23 : 0.08 + this.rand() * 0.38,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        wander: this.rand() * Math.PI * 2,
        crawlPhase: this.rand() * Math.PI * 2,
        crawlSpeed: 1.1 + this.rand() * 0.8,
      });
    }
  }

  private createBackground(): HTMLCanvasElement {
    const bg = document.createElement('canvas');
    bg.width = FRAME_WIDTH;
    bg.height = FRAME_HEIGHT;
    const ctx = bg.getContext('2d')!;
    const r = mulberry32(this.config.seed + 99);

    ctx.fillStyle = '#21170f';
    ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    // Bamboo tray rim.
    ctx.fillStyle = '#5d3d22';
    this.roundRect(ctx, TRAY.x - 7, TRAY.y - 7, TRAY.w + 14, TRAY.h + 14, 18);
    ctx.fill();
    const rimGrad = ctx.createLinearGradient(0, TRAY.y, 0, TRAY.y + TRAY.h);
    rimGrad.addColorStop(0, '#8a5e34');
    rimGrad.addColorStop(0.5, '#6e4726');
    rimGrad.addColorStop(1, '#3f2815');
    ctx.fillStyle = rimGrad;
    this.roundRect(ctx, TRAY.x - 3, TRAY.y - 3, TRAY.w + 6, TRAY.h + 6, 15);
    ctx.fill();

    // Woven bamboo mat.
    ctx.save();
    this.roundRect(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 12);
    ctx.clip();
    const matGrad = ctx.createRadialGradient(
      TRAY.cx - 35,
      TRAY.cy - 35,
      20,
      TRAY.cx,
      TRAY.cy,
      210,
    );
    matGrad.addColorStop(0, '#c79a61');
    matGrad.addColorStop(0.55, '#a87943');
    matGrad.addColorStop(1, '#76502c');
    ctx.fillStyle = matGrad;
    ctx.fillRect(TRAY.x, TRAY.y, TRAY.w, TRAY.h);

    for (let y = TRAY.y; y < TRAY.y + TRAY.h; y += 7) {
      ctx.strokeStyle = y % 14 === 0 ? 'rgba(74,45,20,.28)' : 'rgba(255,220,160,.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(TRAY.x, y + 0.5);
      ctx.lineTo(TRAY.x + TRAY.w, y + 0.5 + Math.sin(y * 0.1) * 1.2);
      ctx.stroke();
    }
    for (let x = TRAY.x; x < TRAY.x + TRAY.w; x += 9) {
      ctx.strokeStyle = x % 18 === 0 ? 'rgba(70,43,20,.22)' : 'rgba(255,226,174,.11)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, TRAY.y);
      ctx.lineTo(x + 0.5 + Math.sin(x * 0.08) * 1.1, TRAY.y + TRAY.h);
      ctx.stroke();
    }

    // Mulberry fragments and frass. They are deliberately darker than worms.
    for (let i = 0; i < 24; i++) {
      const x = TRAY.x + r() * TRAY.w;
      const y = TRAY.y + r() * TRAY.h;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * Math.PI);
      ctx.fillStyle = r() > 0.45 ? 'rgba(48,70,31,.5)' : 'rgba(54,39,24,.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3 + r() * 7, 1.5 + r() * 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < 260; i++) {
      const x = TRAY.x + r() * TRAY.w;
      const y = TRAY.y + r() * TRAY.h;
      const v = 45 + Math.floor(r() * 55);
      ctx.fillStyle = `rgba(${v},${Math.floor(v * 0.72)},${Math.floor(v * 0.42)},.35)`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();

    return bg;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  update(now: number): void {
    const dt = this.lastTime ? Math.min(0.08, (now - this.lastTime) / 1000) : 1 / 8;
    this.lastTime = now;

    if (this.config.lightPreset === 'switch' && now > this.nextAutoSwitch) {
      this.switchLight();
    }

    for (const w of this.worms) {
      w.wander += (this.rand() - 0.5) * dt * 2.2;
      const targetAngle = w.angle + Math.sin(now * 0.00035 + w.wander) * dt * 0.55;
      w.angle = targetAngle;
      const speed = w.crawlSpeed * (0.72 + 0.28 * Math.sin(now * 0.0011 + w.crawlPhase));
      w.x += Math.cos(w.angle) * speed * dt;
      w.y += Math.sin(w.angle) * speed * dt;
      // Gentle lane anchor: enough drift to show motion, not enough to merge trays.
      w.x += (w.homeX - w.x) * 0.55 * dt;
      w.y += (w.homeY - w.y) * 1.15 * dt;
      w.crawlPhase += dt * w.crawlSpeed * 1.7;

      // Steer back into the elliptical tray.
      const ex = (w.x - TRAY.cx) / TRAY.rx;
      const ey = (w.y - TRAY.cy) / TRAY.ry;
      const e = ex * ex + ey * ey;
      if (e > 0.82) {
        const centerAngle = Math.atan2(TRAY.cy - w.y, TRAY.cx - w.x);
        let delta = centerAngle - w.angle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        w.angle += clamp(delta, -dt * 2.4, dt * 2.4);
      }
      w.x = clamp(w.x, TRAY.x + 12, TRAY.x + TRAY.w - 12);
      w.y = clamp(w.y, TRAY.y + 12, TRAY.y + TRAY.h - 12);
    }

    // Cheap separation keeps connected components individually countable.
    for (let i = 0; i < this.worms.length; i++) {
      for (let j = i + 1; j < this.worms.length; j++) {
        const a = this.worms[i];
        const b = this.worms[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 23;
        if (dist > 0.01 && dist < minDist) {
          const push = (minDist - dist) * 0.28;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }

  render(now: number): RenderedScene {
    this.frame++;
    this.update(now);
    const ctx = this.cleanCtx;
    ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    ctx.drawImage(this.background, 0, 0);

    const ordered = [...this.worms].sort((a, b) => a.y - b.y);
    for (const w of ordered) this.drawWorm(ctx, w);

    const clean = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    this.degradeToNightCamera(clean.data, this.rawImageData.data, now);
    this.rawCtx.putImageData(this.rawImageData, 0, 0);

    const gtWorms: WormGroundTruth[] = this.worms.map((w) => ({
      id: w.id,
      x: w.x,
      y: w.y,
      angle: w.angle,
      length: w.length,
      thickness: w.thickness,
      mature: w.mature,
      maturity: w.maturity,
    }));
    const mature = this.worms.filter((w) => w.mature).length;
    const groundTruth: GroundTruthFrame = {
      channelId: this.config.id,
      frame: this.frame,
      timestamp: now,
      total: this.worms.length,
      mature,
      ratio: mature / this.worms.length,
      light: this.currentLight,
      lightMix: this.lightMix,
      age: this.config.age,
      worms: gtWorms,
    };

    return { rawCanvas: this.rawCanvas, groundTruth, rawImageData: this.rawImageData };
  }

  private wormPoints(w: Worm): Array<{ x: number; y: number; tx: number; ty: number }> {
    const segments = 13;
    const points = [];
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const s = (t - 0.5) * w.length;
      const wave = Math.sin(t * Math.PI * 2.15 - w.crawlPhase) * w.thickness * 0.42;
      const px =
        w.x + Math.cos(w.angle) * s + Math.cos(w.angle + Math.PI / 2) * wave;
      const py =
        w.y + Math.sin(w.angle) * s + Math.sin(w.angle + Math.PI / 2) * wave;
      const wave2 =
        Math.cos(t * Math.PI * 2.15 - w.crawlPhase) * w.thickness * 0.42 * 0.12;
      const tx = Math.cos(w.angle) + Math.cos(w.angle + Math.PI / 2) * wave2;
      const ty = Math.sin(w.angle) + Math.sin(w.angle + Math.PI / 2) * wave2;
      const tl = Math.hypot(tx, ty) || 1;
      points.push({ x: px, y: py, tx: tx / tl, ty: ty / tl });
    }
    return points;
  }

  private drawWorm(ctx: CanvasRenderingContext2D, w: Worm): void {
    const points = this.wormPoints(w);
    const mature = w.mature;

    // Soft contact shadow.
    ctx.save();
    ctx.fillStyle = 'rgba(35,22,12,.24)';
    ctx.beginPath();
    ctx.ellipse(w.x + 1.5, w.y + 2.2, w.length * 0.48, w.thickness * 0.72, w.angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const traceBody = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        const next = points[i + 1];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    };

    // Dark outer edge, opaque body and dorsal shine replace costly per-segment gradients.
    traceBody();
    ctx.strokeStyle = mature ? 'rgb(151,160,124)' : 'rgb(145,151,135)';
    ctx.lineWidth = w.thickness + 1.8;
    ctx.stroke();

    traceBody();
    ctx.strokeStyle = mature ? 'rgb(247,241,171)' : 'rgb(205,211,198)';
    ctx.lineWidth = w.thickness;
    ctx.stroke();

    if (mature) {
      traceBody();
      ctx.strokeStyle = 'rgba(255,226,82,.72)';
      ctx.lineWidth = w.thickness * 0.5;
      ctx.stroke();
    }

    // Ring markings. These are the fine structures temporal stacking must preserve.
    for (let i = 2; i < points.length - 2; i += 2) {
      const p = points[i];
      const prev = points[i - 1];
      const next = points[i + 1];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const px = -ty;
      const py = tx;
      const t = i / (points.length - 1);
      const rad = (w.thickness / 2) * (0.68 + 0.32 * Math.sin(Math.PI * t) ** 0.55);
      ctx.strokeStyle = mature ? 'rgba(83,91,58,.48)' : 'rgba(72,68,56,.52)';
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(p.x - px * rad * 0.88, p.y - py * rad * 0.88);
      ctx.lineTo(p.x + px * rad * 0.88, p.y + py * rad * 0.88);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,235,.22)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x - tx * 1.1 - px * rad * 0.72, p.y - ty * 1.1 - py * rad * 0.72);
      ctx.lineTo(p.x - tx * 1.1 + px * rad * 0.72, p.y - ty * 1.1 + py * rad * 0.72);
      ctx.stroke();
    }

    // Dorsal shine / translucency.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = mature ? 'rgba(255,255,246,.98)' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = mature ? w.thickness * 0.4 : w.thickness * 0.08;
    ctx.beginPath();
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const ox = -p.ty * w.thickness * 0.18;
      const oy = p.tx * w.thickness * 0.18;
      if (i === 1) ctx.moveTo(p.x + ox, p.y + oy);
      else ctx.lineTo(p.x + ox, p.y + oy);
    }
    ctx.stroke();
    ctx.restore();

    // Head.
    const head = points[points.length - 1];
    ctx.fillStyle = mature ? 'rgba(139,116,70,.9)' : 'rgba(126,111,83,.9)';
    ctx.beginPath();
    ctx.arc(head.x + head.tx * 2, head.y + head.ty * 2, w.thickness * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  private degradeToNightCamera(
    clean: Uint8ClampedArray,
    out: Uint8ClampedArray,
    now: number,
  ): void {
    const w = FRAME_WIDTH;
    const h = FRAME_HEIGHT;
    const mix = this.lightMix;

    if (!this.illumMap || !this.irIllumMap) {
      this.illumMap = new Float32Array(w * h);
      this.irIllumMap = new Float32Array(w * h);
      const irLamp = {
        ...this.config.lamp,
        peak: this.config.lamp.peak * 1.08,
        ambient: this.config.lamp.ambient * 0.78,
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          this.illumMap[p] = illuminationAt(x / w, y / h, this.config.lamp);
          this.irIllumMap[p] = illuminationAt(x / w + 0.03, y / h, irLamp);
        }
      }
    }

    const frameSalt = (this.frame * 2654435761) >>> 0;
    const timeBand = 1 + 0.014 * Math.sin(now * 0.011);

    for (let y = 0; y < h; y++) {
      const row = timeBand + 0.012 * Math.sin(y * 0.43 + this.frame * 0.7);
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        const nr = clean[i] / 255;
        const ng = clean[i + 1] / 255;
        const nb = clean[i + 2] / 255;
        const illum = this.illumMap[p] * row;

        // Dim green/yellow compact fluorescent response.
        let r = nr * illum * 0.7;
        let g = ng * illum * 0.9 + 0.022 * illum;
        let b = nb * illum * 0.42 + 0.016;
        r += 0.012;
        b += 0.016;

        // IR LED response: mostly luminance with a red/violet cast.
        const irY = 0.28 * nr + 0.66 * ng + 0.08 * nb;
        const irIllum = this.irIllumMap[p] * row;
        const rI = irY * irIllum * 1.1 + 0.018;
        const gI = irY * irIllum * 0.78 + 0.01;
        const bI = irY * irIllum * 1.0 + 0.026;

        r = r * (1 - mix) + rI * mix;
        g = g * (1 - mix) + gI * mix;
        b = b * (1 - mix) + bI * mix;

        const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const noiseSigma = 0.014 + 0.064 * Math.pow(1 - Math.max(0, lum), 1.35);

        // Two integer hashes give independent-ish read noise without calls into Math.random.
        let h1 = (Math.imul(x + 17, 374761393) + Math.imul(y + 31, 668265263) + frameSalt) | 0;
        h1 = Math.imul(h1 ^ (h1 >>> 13), 1274126177);
        h1 ^= h1 >>> 16;
        let h2 = (Math.imul(x + 71, 2246822519) + Math.imul(y + 113, 3266489917) + frameSalt * 3) | 0;
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
        h2 ^= h2 >>> 13;
        const u1 = (h1 >>> 0) / 4294967296 - 0.5;
        const u2 = (h2 >>> 0) / 4294967296 - 0.5;
        const n1 = u1 * 1.55 * noiseSigma;
        const n2 = u2 * 1.1 * noiseSigma;
        r += n1 * 1.05 + n2 * 0.3;
        g += n1 * 0.9 - n2 * 0.18;
        b += n1 * 0.82 + n2 * 0.7;

        if (Math.abs(u2) > 0.49982) {
          const hot = 0.32 + ((h1 >>> 8) % 1000) / 1800;
          r += hot;
          g += hot * 0.8;
          b += hot;
        }

        out[i] = r <= 0 ? 0 : r >= 1 ? 255 : Math.round(r * 255);
        out[i + 1] = g <= 0 ? 0 : g >= 1 ? 255 : Math.round(g * 255);
        out[i + 2] = b <= 0 ? 0 : b >= 1 ? 255 : Math.round(b * 255);
        out[i + 3] = 255;
      }
    }
  }
}
