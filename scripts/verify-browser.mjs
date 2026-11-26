import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.env.VERIFY_URL ?? 'http://127.0.0.1:4173/';
const outDirUrl = new URL('../screenshots/', import.meta.url);
mkdirSync(outDirUrl, { recursive: true });
const shot = (name) => fileURLToPath(new URL(`./${name}`, outDirUrl));

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [
    ...(process.env.VERIFY_REAL_GPU ? [] : [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--use-gl=angle',
    ]),
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
await page.bringToFront();
const messages = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') messages.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (error) => messages.push(`[pageerror] ${error.stack || error.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(14000);

const collect = () => page.evaluate(() => {
  const m = window.__silkwormMonitor;
  if (!m) return { missing: true };
  return {
    webglError: m.webglError,
    renderer: !!m.renderer,
    channels: m.channels.map((c) => ({
      id: c.config.id,
      processFps: c.stats.processFps,
      detectFps: c.stats.detectFps,
      glMs: c.stats.glMs,
      simMs: c.stats.simMs,
      rawNoise: c.stats.rawNoise,
      correctedNoise: c.stats.correctedNoise,
      ringScore: c.stats.ringScore,
      jump: c.stats.lastJump,
      maxJump: c.stats.maxCorrectedJump,
      frames: c.stats.frames,
      detected: c.result ? { total: c.result.total, mature: c.result.mature, ratio: c.result.ratio, rawRatio: c.result.rawRatio } : null,
      truth: c.groundTruth ? { total: c.groundTruth.total, mature: c.groundTruth.mature, ratio: c.groundTruth.ratio, light: c.groundTruth.light } : null,
    })),
  };
});

const access = await collect();
await page.screenshot({ path: shot('01-access.png'), fullPage: false });

await page.evaluate(() => { window.location.hash = '#/enhance'; });
await page.waitForTimeout(5000);
const enhance = await collect();
await page.screenshot({ path: shot('02-enhance.png'), fullPage: false });

await page.evaluate(() => { window.location.hash = '#/ratio'; });
await page.waitForTimeout(7000);
const ratio = await collect();
await page.screenshot({ path: shot('03-ratio.png'), fullPage: true });

await page.evaluate(() => { window.location.hash = '#/alerts'; });
await page.waitForTimeout(1200);
await page.screenshot({ path: shot('04-alerts.png'), fullPage: true });

console.log(JSON.stringify({ access, enhance, ratio, messages }, null, 2));
await browser.close();

const finalChannels = ratio.channels ?? [];
const fps = finalChannels.map((c) => c.processFps);
const errors = finalChannels
  .filter((c) => c.detected && c.truth)
  .map((c) => Math.abs(c.detected.ratio - c.truth.ratio));
const summary = {
  minFps: fps.length ? Math.min(...fps) : 0,
  meanRatioError: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : 1,
  maxRatioError: errors.length ? Math.max(...errors) : 1,
  messages: messages.slice(0, 20),
};
console.log('\nSUMMARY', JSON.stringify(summary, null, 2));
