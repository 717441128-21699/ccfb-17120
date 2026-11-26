import { alertStore } from '../state/store';
import { pct } from '../lib/math';
import { h } from './dom';

export function mountToasts(): () => void {
  const stack = h('div', { class: 'toast-stack', attrs: { 'aria-live': 'polite' } });
  document.body.append(stack);
  const known = new Set<string>();

  const render = () => {
    const alerts = alertStore.get();
    for (const alert of alerts) {
      if (known.has(alert.id)) continue;
      known.add(alert.id);
      const toast = h(
        'div',
        { class: 'toast', role: 'alert' },
        h('div', { class: 'toast-head' }, h('span', { text: `⚠️ ${alert.channelName} 熟蚕比例超阈值` })),
        h('p', {
          text: `估计 ${pct(alert.ratio)}，设定阈值 ${pct(alert.threshold, 0)}。请尽快打着手电逐匾复查并捡熟蚕上蔟。`,
        }),
      );
      stack.append(toast);
      window.setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        toast.style.transition = '.25s ease';
        window.setTimeout(() => toast.remove(), 260);
      }, 6500);
    }
  };

  render();
  const unsubscribe = alertStore.subscribe(render, false);
  return () => {
    unsubscribe();
    stack.remove();
  };
}
