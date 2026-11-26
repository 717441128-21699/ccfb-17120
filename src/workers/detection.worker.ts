import { buildDetectionResult, detectSilkworms, SilkwormTracker } from './detect';
import { calibrateMatureRatio } from './ratioCalibration';
import type { WorkerRequest, WorkerResponse } from '../types';

const tracker = new SilkwormTracker();
let ratioEma: number | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message?.type !== 'frame') return;

  const started = performance.now();
  const pixels = new Uint8ClampedArray(message.buffer);
  const raw = detectSilkworms({ data: pixels, width: message.width, height: message.height });
  const boxes = tracker.update(raw);
  const workerMs = performance.now() - started;
  const stable = tracker.stableCount();

  const rawMature = boxes.filter((b) => b.mature).length;
  const rawRatio = boxes.length ? rawMature / boxes.length : 0;
  const calibrated = calibrateMatureRatio(rawRatio, message.settings.age, message.settings.lightMix ?? 0);
  ratioEma = ratioEma === null ? calibrated : ratioEma * 0.62 + calibrated * 0.38;
  const ratio = ratioEma;
  const mature = Math.round(ratio * boxes.length);

  const result = buildDetectionResult(
    message.channelId,
    message.frame,
    message.timestamp,
    message.width,
    message.height,
    boxes,
    workerMs,
    stable,
  );
  result.rawRatio = rawRatio;
  result.ratio = ratio;
  result.mature = mature;

  const response: WorkerResponse = { type: 'result', result };
  self.postMessage(response);
};

self.postMessage({ type: 'ready', channelId: 'worker' } satisfies WorkerResponse);
