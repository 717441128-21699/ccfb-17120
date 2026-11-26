import { FRAME_HEIGHT, FRAME_WIDTH } from '../config';
import type { ChannelRuntime } from '../runtime/monitorRuntime';
import { pct } from '../lib/math';

export function drawFrameToCanvas(target: HTMLCanvasElement, source: CanvasImageSource): void {
  if (target.width !== FRAME_WIDTH) target.width = FRAME_WIDTH;
  if (target.height !== FRAME_HEIGHT) target.height = FRAME_HEIGHT;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0, target.width, target.height);
}

export function drawDetectionOverlay(
  overlay: HTMLCanvasElement,
  channel: ChannelRuntime,
  showTruth = false,
): void {
  if (overlay.width !== FRAME_WIDTH) overlay.width = FRAME_WIDTH;
  if (overlay.height !== FRAME_HEIGHT) overlay.height = FRAME_HEIGHT;
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const result = channel.result;
  if (result) {
    ctx.lineWidth = 1.4;
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (const box of result.boxes) {
      const color = box.stale ? '#9fb3a7' : box.mature ? '#ff6868' : '#55e08a';
      ctx.strokeStyle = color;
      ctx.globalAlpha = box.stale ? 0.55 : 1;
      ctx.lineWidth = box.stale ? 1 : 1.4;
      ctx.setLineDash(box.stale ? [3, 3] : []);
      ctx.shadowColor = box.stale ? 'transparent' : color;
      ctx.shadowBlur = box.stale ? 0 : 5;
      roundedRectPath(ctx, box.x, box.y, box.width, box.height, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      const label = box.mature ? `熟 ${Math.round(box.matureScore * 100)}` : `蚕 ${box.id}`;
      const tw = ctx.measureText(label).width + 7;
      const ly = Math.max(0, box.y - 13);
      ctx.fillStyle = box.mature ? 'rgba(120,20,20,.82)' : 'rgba(8,70,38,.82)';
      ctx.fillRect(box.x, ly, tw, 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, box.x + 3.5, ly + 2);
    }
  }

  if (showTruth && channel.groundTruth) {
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    for (const w of channel.groundTruth.worms) {
      ctx.strokeStyle = w.mature ? 'rgba(255,210,80,.9)' : 'rgba(103,232,249,.75)';
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, w.length / 2, w.thickness * 0.75, w.angle, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawSparkline(
  canvas: HTMLCanvasElement,
  points: number[],
  threshold?: number,
  truthPoints?: number[],
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(120, rect.width);
  const h = Math.max(60, rect.height);
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.025)';
  ctx.fillRect(0, 0, w, h);

  const yFor = (v: number) => h - 8 - Math.max(0, Math.min(1, v)) * (h - 18);
  if (threshold !== undefined) {
    const y = yFor(threshold);
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const drawSeries = (values: number[], color: string, fill: boolean) => {
    if (values.length < 2) return;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = yFor(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (fill) {
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(85,224,138,.32)');
      grad.addColorStop(1, 'rgba(85,224,138,0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / Math.max(1, values.length - 1)) * w;
        const y = yFor(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  if (truthPoints?.length) drawSeries(truthPoints, 'rgba(103,232,249,.55)', false);
  drawSeries(points, '#55e08a', true);
}

export function fpsTone(fps: number): 'good' | 'warn' | 'bad' {
  if (fps >= 5.8) return 'good';
  if (fps >= 5) return 'warn';
  return 'bad';
}

export function jumpTone(jump: number): 'good' | 'warn' | 'bad' {
  if (jump <= 6) return 'good';
  if (jump <= 12) return 'warn';
  return 'bad';
}

export function ratioErrorText(channel: ChannelRuntime): string {
  const r = channel.result?.ratio;
  const t = channel.groundTruth?.ratio;
  if (r === undefined || t === undefined) return '—';
  return pct(Math.abs(r - t), 1);
}
