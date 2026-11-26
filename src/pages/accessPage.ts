import { AGE_LABELS, LIGHT_LABELS, MIN_REQUIRED_FPS } from '../config';
import { monitor, type ChannelRuntime } from '../runtime/monitorRuntime';
import { alertStore } from '../state/store';
import { ensureAudio, requestNotificationPermission } from '../state/notify';
import { formatClock, pct } from '../lib/math';
import { fpsTone } from '../ui/render';
import { h } from '../ui/dom';

export function renderAccessPage(root: HTMLElement): () => void {
  root.replaceChildren();
  const timers: number[] = [];

  const minFpsValue = h('div', { class: 'value mono', text: '—' });
  const throughputValue = h('div', { class: 'value mono', text: '—' });
  const activeAlertValue = h('div', { class: 'value bad mono', text: '0' });
  const lightValue = h('div', { class: 'value', style: { fontSize: '20px' }, text: 'CFL/IR' });
  const fpsHint = h('div', { class: 'hint', text: '正在启动 WebGL2 流水线…' });

  const kpis = h(
    'div',
    { class: 'kpi-grid' },
    kpi('最低单路处理帧率', minFpsValue, fpsHint),
    kpi('八路总吞吐', throughputValue, 'WebGL2 对齐校色 + Worker 识别'),
    kpi('未确认提醒', activeAlertValue, '比例越限后本地/浏览器/声音提醒'),
    kpi('合成灯光', lightValue, '节能灯绿黄 / 红外伪彩 / 切换过渡'),
  );

  const grid = h('div', { class: 'grid channel-grid' });
  const cards = monitor.channels.map((channel) => createChannelCard(channel));
  cards.forEach((card) => grid.append(card.root));

  const notice = monitor.webglError
    ? h('div', { class: 'notice error', html: `<strong>WebGL2 不可用：</strong>${monitor.webglError}。请使用最新版 Chrome/Edge，并开启硬件加速。` })
    : h('div', {
        class: 'notice ok',
        html: '<strong>八路合成夜间蚕室信号已接入。</strong> 每路包含独立蚕体运动、蚕龄/熟蚕真值、灯位衰减、节能灯绿黄噪声与红外补光响应；也可在单路中切换为本机摄像头或视频网关 URL。',
      });

  const protocolCard = h(
    'div',
    { class: 'card card-pad' },
    h('h2', { class: 'card-title', text: '接入说明' }),
    h(
      'div',
      { class: 'small-text muted' },
      h('p', { text: '1. 默认信号由前端按灯光、蚕龄和真值框实时合成，无需后端或视频文件。' }),
      h('p', { text: '2. USB/本机摄像头通过 getUserMedia 接入；首次使用需授权。' }),
      h('p', { text: '3. 浏览器不能直接播放 RTSP。真实蚕室 NVR/摄像头请通过 WebRTC、HLS 或 MJPEG 网关转成浏览器可访问的 URL。' }),
      h('p', { text: '4. 监控画面只在本机处理；提醒 Webhook 可在“提醒设置”中配置。' }),
    ),
    h('div', { class: 'toolbar', style: { marginTop: '14px' } },
      h('button', {
        class: 'btn primary',
        onClick: async () => {
          await ensureAudio();
          const permission = await requestNotificationPermission();
          alert(`通知权限：${permission}`);
        },
        text: '启用系统通知',
      }),
      h('button', {
        class: 'btn',
        onClick: () => monitor.triggerAllSwitch(),
        text: '💡 全部模拟 CFL→IR',
      }),
    ),
  );

  root.append(
    pageHeader(
      '监控接入',
      '八路蚕匾监控同时接入；默认使用带人工盘检真值的合成夜间画面，可替换为 USB 摄像头或流媒体网关。',
      h('button', { class: 'btn primary', onClick: () => monitor.triggerAllSwitch(), text: '触发八路灯光切换' }),
      h('button', {
        class: 'btn',
        onClick: () => {
          monitor.channels.forEach((c) => (c.stats.maxCorrectedJump = 0));
        },
        text: '清零跳变记录',
      }),
    ),
    notice,
    kpis,
    h('div', { class: 'grid two-col' }, grid, protocolCard),
  );

  const update = () => {
    const fps = monitor.channels.map((c) => c.stats.processFps).filter((f) => f > 0);
    const minFps = fps.length ? Math.min(...fps) : 0;
    const totalFps = fps.reduce((a, b) => a + b, 0);
    minFpsValue.textContent = minFps ? minFps.toFixed(1) : '—';
    minFpsValue.className = `value mono ${minFps >= MIN_REQUIRED_FPS ? 'check-pass' : 'check-warn'}`;
    throughputValue.textContent = totalFps ? `${totalFps.toFixed(0)} 帧/秒` : '—';
    fpsHint.textContent = minFps >= MIN_REQUIRED_FPS
      ? `全部通道不低于 ${MIN_REQUIRED_FPS} FPS`
      : '预热中；若持续偏低请降低对齐帧数或分辨率';
    activeAlertValue.textContent = String(alertStore.get().filter((a) => !a.acknowledged).length);
    cards.forEach((c) => c.update());
  };
  const timer = window.setInterval(update, 500);
  timers.push(timer);
  update();

  const unsubAlerts = alertStore.subscribe(() => update(), false);
  return () => {
    window.clearInterval(timer);
    unsubAlerts();
  };
}

function kpi(label: string, value: HTMLElement, hint: HTMLElement | string): HTMLElement {
  const hintNode = typeof hint === 'string' ? h('div', { class: 'hint', text: hint }) : hint;
  return h('div', { class: 'card kpi' }, h('div', { class: 'label', text: label }), value, hintNode);
}

export function pageHeader(title: string, subtitle: string, ...actions: HTMLElement[]): HTMLElement {
  return h(
    'div',
    { class: 'topbar' },
    h('div', {}, h('div', { class: 'eyebrow', text: 'Silkworm Night Vision' }), h('h1', { class: 'page-title', text: title }), h('p', { class: 'page-subtitle', text: subtitle })),
    h('div', { class: 'top-actions' }, ...actions),
  );
}

function createChannelCard(channel: ChannelRuntime): { root: HTMLElement; update: () => void } {
  const fpsPill = h('span', { class: 'pill', text: 'FPS —' });
  const detectPill = h('span', { class: 'pill', text: '识别 —' });
  const lightPill = h('span', { class: 'pill info', text: LIGHT_LABELS[channel.config.lightPreset] });
  const truthPill = h('span', { class: 'pill', text: '真值 —' });
  const timeBadge = h('span', { class: 'frame-badge right', text: formatClock(Date.now()) });

  const frame = h(
    'div',
    { class: 'video-frame' },
    channel.rawCanvas,
    h('span', { class: 'frame-badge' }, h('i', { class: 'dot' }), h('span', { text: 'RAW 夜拍' })),
    timeBadge,
  );
  channel.rawCanvas.style.width = '100%';
  channel.rawCanvas.style.height = '100%';

  const sourceSelect = h(
    'select',
    { class: 'text-input', 'aria-label': '选择信号源' },
    h('option', { value: 'synthetic', text: '合成真值夜拍' }),
    h('option', { value: 'webcam', text: 'USB/本机摄像头' }),
    h('option', { value: 'url', text: '视频网关 URL' }),
  ) as HTMLSelectElement;
  sourceSelect.value = channel.config.sourceKind === 'webcam' ? 'webcam' : channel.config.sourceKind === 'url' ? 'url' : 'synthetic';

  const urlInput = h('input', {
    class: 'text-input hidden',
    type: 'url',
    placeholder: 'https://camera-gateway/stream.m3u8 或 .mp4',
    value: channel.config.url ?? '',
  }) as HTMLInputElement;

  const connectButton = h('button', { class: 'btn small primary', text: '接入信号' });
  const switchButton = h('button', { class: 'btn small', text: '切灯光' });

  connectButton.addEventListener('click', async () => {
    try {
      connectButton.disabled = true;
      if (sourceSelect.value === 'synthetic') {
        channel.useSynthetic();
      } else if (sourceSelect.value === 'webcam') {
        await channel.connectWebcam();
      } else {
        const url = urlInput.value.trim();
        if (!url) {
          urlInput.classList.remove('hidden');
          urlInput.focus();
          return;
        }
        await channel.connectUrl(url);
      }
    } catch (error) {
      alert(`接入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      connectButton.disabled = false;
    }
  });

  sourceSelect.addEventListener('change', () => {
    urlInput.classList.toggle('hidden', sourceSelect.value !== 'url');
  });

  switchButton.addEventListener('click', () => channel.triggerLightSwitch());

  const root = h(
    'div',
    { class: 'card channel-card' },
    h('div', { class: 'channel-head' },
      h('div', {}, h('div', { class: 'channel-name', text: channel.config.name }), h('div', { class: 'channel-meta', text: `${channel.config.tray} · ${AGE_LABELS[channel.config.age]}` })),
      h('span', { class: 'pill good', text: channel.config.id }),
    ),
    frame,
    h('div', { class: 'metric-row' }, fpsPill, detectPill, lightPill, truthPill),
    h('div', { class: 'toolbar' }, sourceSelect, connectButton, switchButton),
    urlInput,
  );
  sourceSelect.style.flex = '1 1 180px';

  const update = () => {
    const fps = channel.stats.processFps;
    fpsPill.textContent = fps ? `${fps.toFixed(1)} FPS` : '启动中';
    fpsPill.className = `pill ${fpsTone(fps)}`;
    detectPill.textContent = channel.stats.detectFps ? `Worker ${channel.stats.detectFps.toFixed(1)} FPS` : 'Worker 启动中';
    detectPill.className = `pill ${fpsTone(channel.stats.detectFps)}`;
    const light = channel.groundTruth?.light ?? (channel.config.lightPreset === 'ir' ? 'ir' : 'cfl');
    lightPill.textContent = LIGHT_LABELS[light] + (channel.config.lightPreset === 'switch' ? ' · 自动' : '');
    const gt = channel.groundTruth;
    truthPill.textContent = gt ? `人工真值 ${gt.mature}/${gt.total} · ${pct(gt.ratio, 0)}` : channel.config.sourceLabel;
    truthPill.className = gt ? 'pill info' : 'pill';
    timeBadge.textContent = formatClock(Date.now());
  };

  return { root, update };
}
