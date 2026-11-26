import { AGE_LABELS, thresholdForChannel } from '../config';
import { monitor, type ChannelRuntime } from '../runtime/monitorRuntime';
import { alertSettingsStore } from '../state/store';
import { pct } from '../lib/math';
import { drawDetectionOverlay, drawSparkline } from '../ui/render';
import { h } from '../ui/dom';
import { pageHeader } from './accessPage';
import { createDatasetMatrix } from '../sim/datasetMatrix';

interface RatioCard {
  root: HTMLElement;
  update: () => void;
  overlay: HTMLCanvasElement;
  spark: HTMLCanvasElement;
}

export function renderRatioPage(root: HTMLElement): () => void {
  root.replaceChildren();
  const cards: RatioCard[] = monitor.channels.map(createRatioCard);
  const grid = h('div', { class: 'grid channel-grid' }, ...cards.map((c) => c.root));

  const avgRatio = h('div', { class: 'value mono', text: '—' });
  const overThreshold = h('div', { class: 'value warn mono', text: '—' });
  const meanError = h('div', { class: 'value good mono', text: '—' });
  const countError = h('div', { class: 'value good mono', text: '—' });
  const accuracyHint = h('div', { class: 'hint', text: '等待 Worker 积累稳定跟踪…' });

  const kpis = h('div', { class: 'kpi-grid' },
    h('div', { class: 'card kpi' }, h('div', { class: 'label', text: '八路平均熟蚕比例' }), avgRatio, h('div', { class: 'hint', text: '按当前跟踪蚕体计数' })),
    h('div', { class: 'card kpi warn' }, h('div', { class: 'label', text: '超过阈值蚕匾' }), overThreshold, h('div', { class: 'hint', text: '阈值可在提醒设置中逐匾调整' })),
    h('div', { class: 'card kpi good' }, h('div', { class: 'label', text: '比例平均误差' }), meanError, accuracyHint),
    h('div', { class: 'card kpi good' }, h('div', { class: 'label', text: '熟蚕数量相对误差' }), countError, h('div', { class: 'hint', text: '对照合成人工盘检真值' })),
  );

  const tableBody = h('tbody');
  const table = h(
    'div',
    { class: 'card card-pad' },
    h('h2', { class: 'card-title', text: '逐匾统计与人工真值对照' }),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: '蚕匾' }), h('th', { text: '灯光/蚕龄' }), h('th', { text: '估计熟/总' }),
          h('th', { text: '估计比例' }), h('th', { text: '人工真值' }), h('th', { text: '比例误差' }),
          h('th', { text: '阈值状态' }), h('th', { text: 'FPS' }),
        )),
        tableBody,
      ),
    ),
  );

  const datasetCard = h('div', { class: 'card card-pad' },
    h('h2', { class: 'card-title' }, h('span', { text: '合成夜间真值数据集' }), h('button', { class: 'btn small', text: '重新合成样本', onClick: () => matrix.refresh() })),
    h('p', { class: 'small-text muted', text: '按节能灯、红外补光和五龄初/中/末蚕龄组合生成；每帧附带蚕体框、熟蚕标签、数量和灯光参数。' }),
  );
  const matrix = createDatasetMatrix();
  datasetCard.append(matrix.element);

  root.append(
    pageHeader('熟蚕比例', 'Web Worker 负责蚕体分割、跟踪、熟蚕分类和比例统计；红框为熟蚕，绿框为未熟蚕，青色虚线为合成真值。',
      h('button', { class: 'btn primary', text: '运行精度自检', onClick: () => runAccuracyCheck() }),
    ),
    kpis,
    grid,
    h('div', { style: { height: '16px' } }),
    table,
    h('div', { style: { height: '16px' } }),
    datasetCard,
  );

  function runAccuracyCheck() {
    const errors = currentErrors();
    if (!errors.ratio.length) {
      alert('Worker 仍在预热，请几秒后再试。');
      return;
    }
    const mae = average(errors.ratio);
    const countMae = average(errors.count);
    alert(`精度自检\n比例平均绝对误差：${(mae * 100).toFixed(1)} 个百分点\n熟蚕数量平均相对误差：${(countMae * 100).toFixed(1)}%\n样本通道：${errors.ratio.length}/8\n结论：${mae <= 0.1 ? '满足“相差不超过一成”目标' : '需要继续校准阈值'}`);
  }

  function currentErrors() {
    const ratio: number[] = [];
    const count: number[] = [];
    for (const c of monitor.channels) {
      if (!c.result || !c.groundTruth) continue;
      const hist = c.ratioHistory.slice(-40);
      const errs = hist.filter((p) => p.truth !== undefined).map((p) => Math.abs(p.ratio - (p.truth as number)));
      if (errs.length) ratio.push(average(errs));
      if (c.groundTruth.mature > 0) {
        count.push(Math.abs(c.result.mature - c.groundTruth.mature) / c.groundTruth.mature);
      }
    }
    return { ratio, count };
  }

  function updateKpis() {
    const settings = alertSettingsStore.get();
    const ratios = monitor.channels.map((c) => c.result?.ratio).filter((v): v is number => typeof v === 'number');
    avgRatio.textContent = ratios.length ? pct(average(ratios)) : '—';
    const over = monitor.channels.filter((c) => c.result && c.result.ratio >= thresholdForChannel(settings, c.config.id)).length;
    overThreshold.textContent = `${over} / 8`;

    const errors = currentErrors();
    if (errors.ratio.length) {
      const mae = average(errors.ratio);
      meanError.textContent = `${(mae * 100).toFixed(1)} pp`;
      meanError.className = `value mono ${mae <= 0.1 ? 'check-pass' : 'check-warn'}`;
      accuracyHint.textContent = mae <= 0.1 ? '近 40 帧平均误差 ≤ 10 个百分点' : '误差偏高，正在依靠跟踪投票收敛';
    }
    if (errors.count.length) {
      const ce = average(errors.count);
      countError.textContent = pct(ce, 1);
      countError.className = `value mono ${ce <= 0.1 ? 'check-pass' : 'check-warn'}`;
    }

    tableBody.replaceChildren(...monitor.channels.map((c) => {
      const threshold = thresholdForChannel(settings, c.config.id);
      const r = c.result?.ratio;
      const gt = c.groundTruth;
      const err = r !== undefined && gt ? Math.abs(r - gt.ratio) : null;
      const status = !c.result
        ? pill('等待', '')
        : r! >= threshold
          ? pill('已越限', 'bad')
          : pill('未越限', 'good');
      return h('tr', {},
        h('td', {}, h('div', { class: 'channel-name', text: c.config.name }), h('div', { class: 'channel-meta', text: c.config.id })),
        h('td', { text: `${AGE_LABELS[c.config.age].split(' · ')[0]} / ${gt?.light ?? c.config.lightPreset}` }),
        h('td', { class: 'mono', text: c.result ? `${c.result.mature} / ${c.result.total}` : '—' }),
        h('td', { class: 'mono', text: r === undefined ? '—' : pct(r) }),
        h('td', { class: 'mono', text: gt ? `${gt.mature} / ${gt.total} (${pct(gt.ratio, 0)})` : '外部信号无真值' }),
        h('td', { class: `mono ${err !== null && err <= 0.1 ? 'check-pass' : 'check-warn'}`, text: err === null ? '—' : `${(err * 100).toFixed(1)} pp` }),
        h('td', {}, status),
        h('td', { class: 'mono', text: c.stats.processFps ? c.stats.processFps.toFixed(1) : '—' }),
      );
    }));
  }

  const domTimer = window.setInterval(() => {
    cards.forEach((c) => c.update());
    updateKpis();
  }, 450);

  let raf = 0;
  let lastDraw = 0;
  const drawLoop = (now: number) => {
    if (now - lastDraw > 140) {
      lastDraw = now;
      cards.forEach((card) => {
        const channel = monitor.channels.find((c) => c.config.id === card.root.dataset.channelId)!;
        drawDetectionOverlay(card.overlay, channel, true);
        const values = channel.ratioHistory.slice(-90).map((p) => p.ratio);
        const truths = channel.ratioHistory.slice(-90).map((p) => p.truth).filter((v): v is number => v !== undefined);
        drawSparkline(card.spark, values, thresholdForChannel(alertSettingsStore.get(), channel.config.id), truths);
      });
    }
    raf = requestAnimationFrame(drawLoop);
  };
  raf = requestAnimationFrame(drawLoop);

  updateKpis();
  return () => {
    window.clearInterval(domTimer);
    cancelAnimationFrame(raf);
    matrix.destroy();
  };
}

function createRatioCard(channel: ChannelRuntime): RatioCard {
  const overlay = document.createElement('canvas');
  overlay.className = 'overlay-canvas';
  const spark = document.createElement('canvas');
  spark.className = 'spark';

  const ratioBig = h('div', { class: 'value mono', style: { fontSize: '25px' }, text: '—' });
  const countPill = h('span', { class: 'pill', text: '识别 —' });
  const errorPill = h('span', { class: 'pill', text: '误差 —' });
  const statusPill = h('span', { class: 'pill', text: '监测中' });
  const fill = h('i') as HTMLElement;
  const bar = h('div', { class: 'ratio-line' }, fill, h('span', { class: 'threshold-tick' }));

  const frame = h('div', { class: 'video-frame' }, channel.processedCanvas, overlay,
    h('span', { class: 'frame-badge' }, h('i', { class: 'dot' }), h('span', { text: '校正后 + Worker 框' })),
  );
  channel.processedCanvas.style.width = '100%';
  channel.processedCanvas.style.height = '100%';

  const root = h('div', { class: 'card channel-card', dataset: { channelId: channel.config.id } },
    h('div', { class: 'channel-head' },
      h('div', {}, h('div', { class: 'channel-name', text: channel.config.name }), h('div', { class: 'channel-meta', text: AGE_LABELS[channel.config.age] })),
      statusPill,
    ),
    frame,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px', alignItems: 'center' } },
      ratioBig,
      h('div', {}, bar, h('div', { class: 'metric-row', style: { marginTop: '7px' } }, countPill, errorPill)),
    ),
    spark,
  );

  const update = () => {
    const settings = alertSettingsStore.get();
    const threshold = thresholdForChannel(settings, channel.config.id);
    const r = channel.result?.ratio;
    ratioBig.textContent = r === undefined ? '—' : pct(r, 0);
    fill.style.width = `${Math.min(100, (r ?? 0) * 100)}%`;
    fill.className = r !== undefined && r >= threshold ? 'hot' : '';
    const tick = bar.querySelector('.threshold-tick') as HTMLElement;
    tick.style.left = `calc(${threshold * 100}% - 1px)`;

    countPill.textContent = channel.result ? `熟 ${channel.result.mature} / ${channel.result.total}` : 'Worker 启动中';
    countPill.className = 'pill info';
    if (channel.groundTruth && r !== undefined) {
      const err = Math.abs(r - channel.groundTruth.ratio);
      errorPill.textContent = `真值 ${channel.groundTruth.mature}/${channel.groundTruth.total} · 差 ${(err * 100).toFixed(1)}pp`;
      errorPill.className = `pill ${err <= 0.1 ? 'good' : 'warn'}`;
    }
    if (channel.result) {
      const hot = channel.result.ratio >= threshold;
      statusPill.textContent = hot ? '比例越限' : '比例正常';
      statusPill.className = `pill ${hot ? 'bad' : 'good'}`;
      ratioBig.className = `value mono ${hot ? 'check-fail' : 'check-pass'}`;
      ratioBig.style.fontSize = '25px';
    }
  };

  return { root, update, overlay, spark };
}

function pill(text: string, tone: '' | 'good' | 'warn' | 'bad' | 'info'): HTMLElement {
  return h('span', { class: `pill ${tone}`, text });
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}
