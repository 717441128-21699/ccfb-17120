import { DEFAULT_ENHANCE } from '../config';
import { monitor } from '../runtime/monitorRuntime';
import { enhanceStore } from '../state/store';
import { fpsTone, jumpTone } from '../ui/render';
import { h } from '../ui/dom';
import { pct } from '../lib/math';
import { pageHeader } from './accessPage';

export function renderEnhancePage(root: HTMLElement): () => void {
  root.replaceChildren();
  let selectedId = monitor.channels[0].config.id;
  const timers: number[] = [];
  const unsubs: Array<() => void> = [];

  const select = h(
    'select',
    { class: 'text-input', 'aria-label': '选择匾号' },
    ...monitor.channels.map((c) => h('option', { value: c.config.id, text: `${c.config.name} · ${c.config.tray}` })),
  ) as HTMLSelectElement;
  select.value = selectedId;

  const rawPane = h('div', { class: 'compare-pane' });
  const processedPane = h('div', { class: 'compare-pane' });
  const metricGrid = h('div', { class: 'validation-grid' });

  function selected() {
    return monitor.channels.find((c) => c.config.id === selectedId) ?? monitor.channels[0];
  }

  function mountCanvases() {
    const channel = selected();
    rawPane.replaceChildren(
      h('h3', {}, h('span', { text: '处理前 · 原始夜拍' }), h('span', { class: 'pill warn', text: '高噪点 / 偏色' })),
      channel.rawCanvas,
    );
    channel.rawCanvas.style.width = '100%';
    channel.rawCanvas.style.aspectRatio = '4 / 3';
    channel.rawCanvas.style.borderRadius = '14px';
    channel.rawCanvas.style.border = '1px solid var(--line)';

    processedPane.replaceChildren(
      h('h3', {}, h('span', { text: '处理后 · 对齐叠加 + 校色' }), h('span', { class: 'pill good', text: 'WebGL2' })),
      channel.processedCanvas,
    );
    channel.processedCanvas.style.width = '100%';
    channel.processedCanvas.style.aspectRatio = '4 / 3';
    channel.processedCanvas.style.borderRadius = '14px';
    channel.processedCanvas.style.border = '1px solid rgba(85,224,138,.35)';
  }

  select.addEventListener('change', () => {
    selectedId = select.value;
    mountCanvases();
    updateMetrics();
  });

  const controlsCard = h('div', { class: 'card card-pad' }, h('h2', { class: 'card-title', text: '降噪与校色参数' }));
  const controlsHost = h('div');
  controlsCard.append(controlsHost);

  function renderControls() {
    const settings = enhanceStore.get();
    controlsHost.replaceChildren(
      rangeRow('参与叠加帧数', settings.temporalFrames, 1, 4, 1, (v) => enhanceStore.update({ temporalFrames: v }), `${settings.temporalFrames} 帧`),
      rangeRow('局部搜索半径', settings.motionRange, 1, 6, 1, (v) => enhanceStore.update({ motionRange: v }), `${settings.motionRange} px`),
      rangeRow('运动补偿强度', settings.denoiseStrength, 0, 1, 0.01, (v) => enhanceStore.update({ denoiseStrength: v }), pct(settings.denoiseStrength, 0)),
      rangeRow('平场亮度拉平', settings.flatField, 0, 1, 0.01, (v) => enhanceStore.update({ flatField: v }), pct(settings.flatField, 0)),
      rangeRow('环纹锐化', settings.sharpen, 0, 1.2, 0.01, (v) => enhanceStore.update({ sharpen: v }), settings.sharpen.toFixed(2)),
      toggle('自动白平衡 / 色彩矩阵', '节能灯绿黄与红外伪彩统一到日间基准', settings.colorCorrection, (v) => enhanceStore.update({ colorCorrection: v })),
      toggle('显示运动矢量与 8×8 对齐块', '检查每条蚕的局部位移；红色为估计向量', settings.showMotionVectors, (v) => enhanceStore.update({ showMotionVectors: v })),
      h('div', { class: 'toolbar', style: { marginTop: '14px' } },
        h('button', { class: 'btn', text: '恢复推荐参数', onClick: () => enhanceStore.set({ ...DEFAULT_ENHANCE }) }),
        h('button', { class: 'btn amber', text: '模拟此路 CFL↔IR', onClick: () => selected().triggerLightSwitch() }),
      ),
    );
  }
  unsubs.push(enhanceStore.subscribe(renderControls, false));
  renderControls();

  function metricCard(name: string, valueId: string, sub: string, tone = '') {
    const value = h('div', { class: `big mono ${tone}`, dataset: { metric: valueId }, text: '—' });
    return h('div', { class: 'validation' }, h('div', { class: 'name', text: name }), value, h('div', { class: 'sub', text: sub }));
  }

  metricGrid.append(
    metricCard('处理帧率', 'fps', '八路调度目标 6 FPS，验收下限 5 FPS'),
    metricCard('GPU 耗时', 'gl', '校色、运动估计、补偿叠加与锐化'),
    metricCard('噪声指数', 'noise', '原始 → 降噪后相邻像素残差'),
    metricCard('环纹能量', 'ring', '高频梯度保留度，越高越容易看清体节'),
    metricCard('切换瞬时色差', 'jump', '校正后相邻帧加权 RGB 跳变'),
    metricCard('累计最大跳变', 'maxjump', 'CFL 切 IR 前后的最差一帧'),
  );

  const pipelineCard = h(
    'div',
    { class: 'card card-pad' },
    h('h2', { class: 'card-title', text: 'WebGL2 流水线' }),
    h('div', { class: 'small-text muted' },
      h('p', { html: '① 每帧先做 <strong>白平衡、3×3 色彩矩阵、IR 伪彩映射和平场除衰减</strong>，历史帧以校正后的统一色彩进入环形纹理。' }),
      h('p', { html: '② 在 40×30 个 8×8 块上用 SAD 搜索前后帧位移，环纹提供匹配纹理；不是整幅画面平均。' }),
      h('p', { html: '③ 按局部运动矢量把每帧反向对齐到当前蚕体位置，再做带色差拒绝的稳健加权叠加，错位历史帧会自动降权，避免拖影重影。' }),
      h('p', { html: '④ 最后进行 Unsharp Mask 锐化，把蚕身一节节环纹提出来。' }),
    ),
  );

  root.append(
    pageHeader('降噪校色', '按蚕体局部运动对齐多帧后叠加，并把节能灯、红外和灯位远近造成的颜色/亮度差异校正到同一画面。', select),
    h('div', { class: 'compare-grid card card-pad', style: { marginBottom: '16px' } }, rawPane, processedPane),
    h('div', { class: 'grid two-col' },
      h('div', { class: 'grid' }, controlsCard, pipelineCard),
      h('div', { class: 'grid' }, h('div', { class: 'card card-pad' }, h('h2', { class: 'card-title', text: '客观画面指标' }), metricGrid)),
    ),
  );

  mountCanvases();

  function updateMetrics() {
    const c = selected();
    const rootEl = metricGrid;
    const setMetric = (name: string, text: string, tone?: string) => {
      const el = rootEl.querySelector(`[data-metric="${name}"]`) as HTMLElement | null;
      if (!el) return;
      el.textContent = text;
      el.className = `big mono ${tone ?? ''}`;
    };
    setMetric('fps', c.stats.processFps ? `${c.stats.processFps.toFixed(1)}` : '预热', fpsTone(c.stats.processFps) === 'good' ? 'check-pass' : fpsTone(c.stats.processFps) === 'warn' ? 'check-warn' : 'check-fail');
    setMetric('gl', `${c.stats.glMs.toFixed(1)} ms`);
    const reduction = c.stats.rawNoise > 0 ? `↓ ${pct(1 - c.stats.correctedNoise / c.stats.rawNoise, 0)}` : '';
    setMetric('noise', c.stats.rawNoise ? `${c.stats.rawNoise.toFixed(1)}→${c.stats.correctedNoise.toFixed(1)} ${reduction}` : '—', 'check-pass');
    setMetric('ring', c.stats.ringScore ? c.stats.ringScore.toFixed(3) : '—');
    setMetric('jump', c.stats.lastJump ? c.stats.lastJump.toFixed(1) : '0.0', jumpTone(c.stats.lastJump) === 'good' ? 'check-pass' : 'check-warn');
    setMetric('maxjump', c.stats.maxCorrectedJump ? c.stats.maxCorrectedJump.toFixed(1) : '0.0', jumpTone(c.stats.maxCorrectedJump) === 'good' ? 'check-pass' : 'check-fail');
  }
  const timer = window.setInterval(updateMetrics, 400);
  timers.push(timer);
  updateMetrics();

  return () => {
    window.clearInterval(timer);
    unsubs.forEach((u) => u());
  };
}

function rangeRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
  valueText: string,
): HTMLElement {
  const output = h('output', { text: valueText });
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = step < 1 ? next.toFixed(2) : String(next);
    onInput(next);
  });
  return h('div', { class: 'form-row' }, h('label', {}, h('span', { text: label }), output), input);
}

function toggle(title: string, description: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'switch-row' },
    h('div', { class: 'switch-copy' }, h('strong', { text: title }), h('span', { text: description })),
    h('label', { class: 'switch' }, input, h('span', { class: 'track' })),
  );
}
