import { CHANNELS, thresholdForChannel } from '../config';
import type { AlertSettings } from '../types';
import { acknowledgeAlert, alertSettingsStore, alertStore, clearAlerts, pushAlert } from '../state/store';
import { ensureAudio, playAlertTone, requestNotificationPermission } from '../state/notify';
import { formatTime, pct } from '../lib/math';
import { h } from '../ui/dom';
import { pageHeader } from './accessPage';

export function renderAlertsPage(root: HTMLElement): () => void {
  root.replaceChildren();
  const unsubs: Array<() => void> = [];

  const settingsCard = h('div', { class: 'card card-pad' }, h('h2', { class: 'card-title', text: '提醒规则' }));
  const perChannelCard = h('div', { class: 'card card-pad' },
    h('h2', { class: 'card-title', text: '逐匾阈值' }),
    h('p', { class: 'small-text muted', text: '未单独设置的蚕匾跟随全局阈值。熟蚕成批在夜间出现时，建议先设 35%，再按品种和上蔟劳力调整。' }),
  );
  const alertListHost = h('div', { class: 'alert-list' });
  const historyCard = h('div', { class: 'card card-pad' },
    h('h2', { class: 'card-title' },
      h('span', { text: '提醒记录' }),
      h('button', { class: 'btn small danger', text: '清空记录', onClick: () => clearAlerts() }),
    ),
    alertListHost,
  );

  function renderSettings() {
    const s = alertSettingsStore.get();
    settingsCard.replaceChildren(
      h('h2', { class: 'card-title', text: '提醒规则' }),
      sliderRow('启用越限提醒', '', s.enabled ? 1 : 0, 0, 1, 1, () => {}, true, (checked) => update({ enabled: checked })),
      h('div', { class: 'form-row' },
        h('label', {}, h('span', { text: '全局熟蚕比例阈值' }), h('output', { text: pct(s.globalThreshold, 0) })),
        h('input', {
          type: 'range', min: '0.05', max: '0.9', step: '0.01', value: String(s.globalThreshold),
          onInput: (e: Event) => update({ globalThreshold: Number((e.target as HTMLInputElement).value) }),
        }),
      ),
      h('div', { class: 'form-row' },
        h('label', {}, h('span', { text: '重复提醒冷却时间' }), h('output', { text: `${s.cooldownSec} 秒` })),
        h('input', {
          type: 'range', min: '10', max: '600', step: '10', value: String(s.cooldownSec),
          onInput: (e: Event) => update({ cooldownSec: Number((e.target as HTMLInputElement).value) }),
        }),
      ),
      toggleRow('声音提醒', '在蚕房值班室浏览器播放两声提示音', s.sound, async (v) => {
        if (v) await ensureAudio();
        update({ sound: v });
      }),
      toggleRow('浏览器系统通知', '页面在后台时也可收到系统级通知；需授权', s.browserNotification, async (v) => {
        if (v) {
          await ensureAudio();
          const permission = await requestNotificationPermission();
          update({ browserNotification: permission === 'granted' });
          if (permission !== 'granted') alert('浏览器未授予通知权限，将仅显示页内提醒和声音。');
        } else {
          update({ browserNotification: false });
        }
      }),
      h('div', { class: 'form-row' },
        h('label', { text: 'Webhook / 短信网关地址（可选）' }),
        h('input', {
          class: 'text-input', type: 'url', placeholder: 'https://farm.example/api/silkworm-alert', value: s.webhookUrl,
          onChange: (e: Event) => update({ webhookUrl: (e.target as HTMLInputElement).value.trim() }),
        }),
      ),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', text: '发送测试提醒', onClick: sendTest }),
        h('button', { class: 'btn', text: '播放提示音', onClick: async () => { await ensureAudio(); playAlertTone(); } }),
        h('button', { class: 'btn', text: '测试 Webhook', onClick: testWebhook }),
      ),
    );
  }

  function update(patch: Partial<AlertSettings>) {
    alertSettingsStore.update(patch);
  }

  function sendTest() {
    const s = alertSettingsStore.get();
    const channel = CHANNELS[0];
    const event = {
      id: `test-${Date.now()}`,
      channelId: channel.id,
      channelName: `${channel.name}（测试）`,
      ratio: Math.max(s.globalThreshold + 0.08, 0.5),
      threshold: s.globalThreshold,
      timestamp: Date.now(),
      acknowledged: false,
    };
    pushAlert(event);
    if (s.sound) void ensureAudio().then(playAlertTone);
    if (s.browserNotification && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('熟蚕提醒测试', { body: '通知通道正常。实际越限时会显示蚕匾和比例。' });
    }
  }

  async function testWebhook() {
    const url = alertSettingsStore.get().webhookUrl;
    if (!url) {
      alert('请先填写 Webhook 地址。');
      return;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, source: 'silkworm-monitor', timestamp: new Date().toISOString() }),
      });
      alert(res.ok ? `Webhook 测试成功：HTTP ${res.status}` : `Webhook 返回异常：HTTP ${res.status}`);
    } catch (error) {
      alert(`Webhook 请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function renderChannelThresholds() {
    const s = alertSettingsStore.get();
    perChannelCard.replaceChildren(
      h('h2', { class: 'card-title', text: '逐匾阈值' }),
      h('p', { class: 'small-text muted', text: '未单独设置的蚕匾跟随全局阈值。拖动即保存到本机。' }),
      ...CHANNELS.map((channel) => {
        const effective = thresholdForChannel(s, channel.id);
        const overridden = typeof s.channelThresholds[channel.id] === 'number';
        const valueLabel = h('output', { text: pct(effective, 0) });
        const range = h('input', {
          type: 'range', min: '0.05', max: '0.9', step: '0.01', value: String(effective),
          onInput: (e: Event) => {
            const value = Number((e.target as HTMLInputElement).value);
            valueLabel.textContent = pct(value, 0);
            alertSettingsStore.set({
              ...alertSettingsStore.get(),
              channelThresholds: { ...alertSettingsStore.get().channelThresholds, [channel.id]: value },
            });
          },
        }) as HTMLInputElement;
        const reset = h('button', {
          class: 'btn small', text: '跟随全局', disabled: !overridden,
          onClick: () => {
            const thresholds = { ...alertSettingsStore.get().channelThresholds };
            delete thresholds[channel.id];
            alertSettingsStore.update({ channelThresholds: thresholds });
          },
        });
        return h('div', { class: 'form-row', style: { marginTop: '13px' } },
          h('label', {}, h('span', { text: `${channel.name} · ${channel.tray}` }), valueLabel),
          h('div', { class: 'range-with-value' }, range, reset),
        );
      }),
    );
  }

  function renderAlerts() {
    const alerts = alertStore.get();
    if (!alerts.length) {
      alertListHost.replaceChildren(h('div', { class: 'notice', text: '暂无提醒。比例越过阈值后会出现在这里，并按设置发送声音/系统通知。' }));
      return;
    }
    alertListHost.replaceChildren(...alerts.map((a) => h('div', { class: `alert-item ${a.acknowledged ? '' : 'unack'}` },
      h('div', { class: 'alert-icon', text: a.acknowledged ? '✓' : '⚠️' }),
      h('div', {},
        h('div', { class: 'alert-title', text: `${a.channelName} · 熟蚕 ${pct(a.ratio)}` }),
        h('div', { class: 'alert-body', text: `阈值 ${pct(a.threshold, 0)}；建议立即逐匾查看，熟蚕身体透亮发亮时抓紧捡上蔟。` }),
      ),
      h('div', { style: { display: 'grid', gap: '8px', justifyItems: 'end' } },
        h('span', { class: 'alert-time mono', text: formatTime(a.timestamp) }),
        a.acknowledged
          ? h('span', { class: 'pill good', text: '已知悉' })
          : h('button', { class: 'btn small primary', text: '标记处理', onClick: () => acknowledgeAlert(a.id) }),
      ),
    )));
  }

  unsubs.push(alertSettingsStore.subscribe(() => { renderSettings(); renderChannelThresholds(); }, false));
  unsubs.push(alertStore.subscribe(renderAlerts, false));
  renderSettings();
  renderChannelThresholds();
  renderAlerts();

  root.append(
    pageHeader('提醒设置', '设定每一匾的熟蚕比例阈值；越限后在页内、声音、浏览器通知和可选 Webhook 通道提醒蚕农。'),
    h('div', { class: 'grid two-col' }, settingsCard, h('div', { class: 'grid' }, perChannelCard, historyCard)),
  );

  return () => unsubs.forEach((u) => u());
}

function toggleRow(title: string, description: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'switch-row' },
    h('div', { class: 'switch-copy' }, h('strong', { text: title }), h('span', { text: description })),
    h('label', { class: 'switch' }, input, h('span', { class: 'track' })),
  );
}

function sliderRow(_label: string, _valueText: string, value: number, min: number, max: number, step: number, _onInput: (v: number) => void, isCheckbox = false, onToggle?: (checked: boolean) => void): HTMLElement {
  if (!isCheckbox || !onToggle) return h('div');
  return toggleRow('启用越限提醒', '关闭后仅继续记录比例，不弹提醒也不发声', value > 0.5, onToggle);
}
