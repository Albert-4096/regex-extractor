// Tiny DOM builder. Never uses innerHTML: all text goes through textContent / text nodes.

type Child = Node | string | number | null | undefined | false;
type Handler = (ev: Event) => void;

export interface Props {
  class?: string;
  text?: string;
  on?: Record<string, Handler>;
  [attr: string]: string | number | boolean | Record<string, Handler> | undefined;
}

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'hidden', 'indeterminate']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'on') {
      for (const [ev, fn] of Object.entries(v as Record<string, Handler>)) el.addEventListener(ev, fn);
    } else if (PROPS.has(k)) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

let idCounter = 0;
export const uid = (p = 'id'): string => `${p}-${++idCounter}`;
