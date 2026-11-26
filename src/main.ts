import './styles.css';
import { h } from './ui/dom';
import { monitor } from './runtime/monitorRuntime';
import { alertStore } from './state/store';
import { mountToasts } from './ui/toast';
import { renderAccessPage } from './pages/accessPage';
import { renderEnhancePage } from './pages/enhancePage';
import { renderRatioPage } from './pages/ratioPage';
import { renderAlertsPage } from './pages/alertsPage';
import { detectSilkworms } from './workers/detect';
import type { PageId } from './types';

declare global {
  interface Window {
    __silkwormMonitor?: typeof monitor;
    __detectSilkworms?: typeof detectSilkworms;
  }
}

if (typeof window !== 'undefined') {
  window.__silkwormMonitor = monitor;
  window.__detectSilkworms = detectSilkworms;
}

const navItems: Array<{ id: PageId; label: string; icon: string; hash: string }> = [
  { id: 'access', label: '监控接入', icon: '📡', hash: '#/access' },
  { id: 'enhance', label: '降噪校色', icon: '✨', hash: '#/enhance' },
  { id: 'ratio', label: '熟蚕比例', icon: '🐛', hash: '#/ratio' },
  { id: 'alerts', label: '提醒设置', icon: '🔔', hash: '#/alerts' },
];

function currentPage(): PageId {
  const hash = window.location.hash;
  if (hash.startsWith('#/enhance')) return 'enhance';
  if (hash.startsWith('#/ratio')) return 'ratio';
  if (hash.startsWith('#/alerts')) return 'alerts';
  return 'access';
}

function bootstrap(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('缺少 #app 根节点');

  const alertBadge = h('span', { class: 'pill bad', text: '0' });
  const webglPill = h('span', {
    class: `pill ${monitor.webglError ? 'bad' : 'good'}`,
    text: monitor.webglError ? 'WebGL2 不可用' : 'WebGL2 就绪',
  });
  const workerPill = h('span', { class: 'pill good', text: '8 Workers' });
  const fpsPill = h('span', { class: 'pill info mono', text: '总 FPS —' });

  const navButtons = navItems.map((item) => {
    const button = h('button', {
      class: 'nav-button',
      dataset: { page: item.id },
      onClick: () => { window.location.hash = item.hash; },
    }, h('span', { class: 'icon', text: item.icon }), h('span', { text: item.label }));
    return button;
  });

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark', text: '蚕' }),
      h('div', {}, h('h1', { text: '蚕室夜视巡检' }), h('p', { text: '熟蚕识别 · 上蔟提醒' })),
    ),
    h('nav', { class: 'nav', 'aria-label': '主导航' }, ...navButtons),
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'status-row' }, h('span', { text: '渲染' }), webglPill),
      h('div', { class: 'status-row' }, h('span', { text: '识别' }), workerPill),
      h('div', { class: 'status-row' }, h('span', { text: '吞吐' }), fpsPill),
      h('div', { class: 'status-row' }, h('span', { text: '未确认' }), alertBadge),
    ),
  );

  const content = h('main', { class: 'main' });
  const shell = h('div', { class: 'app-shell' }, sidebar, content);
  app.replaceChildren(shell);

  let cleanupPage: (() => void) | undefined;
  const route = () => {
    const page = currentPage();
    navButtons.forEach((button) => button.classList.toggle('active', button.dataset.page === page));
    cleanupPage?.();
    if (page === 'access') cleanupPage = renderAccessPage(content);
    else if (page === 'enhance') cleanupPage = renderEnhancePage(content);
    else if (page === 'ratio') cleanupPage = renderRatioPage(content);
    else cleanupPage = renderAlertsPage(content);
    window.scrollTo({ top: 0 });
  };

  window.addEventListener('hashchange', route);
  if (!window.location.hash) window.location.hash = '#/access';

  monitor.start();
  const unmountToasts = mountToasts();
  route();

  const statusTimer = window.setInterval(() => {
    const total = monitor.channels.reduce((sum, c) => sum + c.stats.processFps, 0);
    fpsPill.textContent = total ? `总 FPS ${total.toFixed(0)}` : '启动中';
    const unack = alertStore.get().filter((a) => !a.acknowledged).length;
    alertBadge.textContent = String(unack);
    alertBadge.className = `pill ${unack ? 'bad' : 'good'}`;
  }, 700);

  window.addEventListener('beforeunload', () => {
    window.clearInterval(statusTimer);
    cleanupPage?.();
    unmountToasts();
    monitor.stop();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
