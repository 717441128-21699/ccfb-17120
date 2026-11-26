export type HtmlChild = Node | string | number | false | null | undefined;

export interface HtmlProps {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string | number | boolean>;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  dataset?: Record<string, string | number | boolean>;
  on?: Record<string, EventListenerOrEventListenerObject>;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HtmlProps = {},
  ...children: HtmlChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  for (const [key, rawValue] of Object.entries(props)) {
    if (rawValue === undefined || rawValue === null || rawValue === false) continue;

    if (key === 'class') {
      el.className = String(rawValue);
    } else if (key === 'text') {
      el.textContent = String(rawValue);
    } else if (key === 'html') {
      el.innerHTML = String(rawValue);
    } else if (key === 'style' && typeof rawValue === 'object') {
      Object.assign(el.style, rawValue);
    } else if (key === 'dataset' && typeof rawValue === 'object') {
      for (const [dataKey, value] of Object.entries(rawValue as Record<string, string | number | boolean>)) {
        el.dataset[dataKey] = String(value);
      }
    } else if (key === 'on' && typeof rawValue === 'object') {
      for (const [event, handler] of Object.entries(rawValue as Record<string, EventListenerOrEventListenerObject>)) {
        el.addEventListener(event, handler);
      }
    } else if (key === 'attrs' && typeof rawValue === 'object') {
      for (const [attr, value] of Object.entries(rawValue as Record<string, string | number | boolean>)) {
        if (value === false) el.removeAttribute(attr);
        else el.setAttribute(attr, String(value));
      }
    } else if (key.startsWith('on') && typeof rawValue === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), rawValue as EventListener);
    } else if (key in el && key !== 'list') {
      try {
        (el as unknown as Record<string, unknown>)[key] = rawValue;
      } catch {
        el.setAttribute(key, String(rawValue));
      }
    } else {
      el.setAttribute(key, String(rawValue));
    }
  }

  for (const child of children.flat()) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(container: HTMLElement, node: Node): () => void {
  container.replaceChildren(node);
  return () => {
    if (node.parentElement === container) container.replaceChildren();
  };
}

export function canvas(width: number, height: number, className = ''): HTMLCanvasElement {
  const c = h('canvas', { class: className }) as HTMLCanvasElement;
  c.width = width;
  c.height = height;
  return c;
}

export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (dw - w) / 2, (dh - h) / 2, w, h);
}
