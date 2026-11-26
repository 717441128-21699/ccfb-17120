import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:4180/#/ratio', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const debug = await page.evaluate(() => {
  const m = window.__silkwormMonitor;
  const detect = window.__detectSilkworms;
  return m.channels.map((c) => {
    const ctx = c.processedCanvas.getContext('2d');
    const img = ctx.getImageData(0, 0, c.processedCanvas.width, c.processedCanvas.height);
    const rejectLog = [];
    const info = {};
    const raw = detect({ data: img.data, width: img.width, height: img.height }, rejectLog, info);
    const patchFor = (w) => {
      let r=0,g=0,b=0,n=0,hi=0,warm=0;
      for(let dy=-5;dy<=5;dy++) for(let dx=-5;dx<=5;dx++) {
        if(dx*dx+dy*dy>30) continue;
        const x=Math.max(0,Math.min(img.width-1,Math.round(w.x)+dx));
        const y=Math.max(0,Math.min(img.height-1,Math.round(w.y)+dy));
        const i=(y*img.width+x)*4;
        const R=img.data[i],G=img.data[i+1],B=img.data[i+2];
        r+=R;g+=G;b+=B;n++;
        const L=.2126*R+.7152*G+.0722*B;
        if(L>220)hi++;
        if(R-B>35 && L>150)warm++;
      }
      return {rgb:[Math.round(r/n),Math.round(g/n),Math.round(b/n)],hi:hi/n,warm:warm/n};
    };
    const samples = c.groundTruth.worms.map((w) => {
      const x = Math.round(w.x), y = Math.round(w.y);
      const i = (y * img.width + x) * 4;
      return { mature: w.mature, rgb: [img.data[i], img.data[i+1], img.data[i+2]], patch: patchFor(w) };
    });
    return {
      id: c.config.id,
      light: c.groundTruth.light,
      truth: [c.groundTruth.mature, c.groundTruth.total],
      gt: c.groundTruth.worms.map((w) => ({ x: Number(w.x.toFixed(1)), y: Number(w.y.toFixed(1)), mature: w.mature })),
      rawCount: raw.length,
      info,
      rejects: rejectLog.slice(0, 30),
      rawScores: raw.map(d => ({ cx: Math.round(d.cx), cy: Math.round(d.cy), mature: d.mature, score: Number(d.matureScore.toFixed(2)), warm: Number((d.warmFraction ?? 0).toFixed(2)), hi: Number((d.highlightFraction ?? 0).toFixed(2)), mean: Number((d.meanScore ?? 0).toFixed(2)), area: d.area, len: Number(d.length.toFixed(1)), elong: Number(d.elongation.toFixed(1)) })),
      samples,
    };
  });
});
console.log(JSON.stringify(debug, null, 2));
await browser.close();
