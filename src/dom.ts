type Child = Node | string | number | null | undefined | false;

interface Props {
  class?: string;
  text?: string | number;
  html?: never; // deliberately absent: everything here is textContent
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

/**
 * Minimal element builder. There is no innerHTML path anywhere in this file —
 * `drawName` is upstream free text that arrives wrapped in anchor tags, and
 * textContent is the guarantee that none of it can ever be interpreted as markup.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = String(props.text);
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, fn] of Object.entries(props.on ?? {})) node.addEventListener(k, fn);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : String(child));
  }
  return node;
}

/** Label / dotted leader / value — the recurring unit of every document. */
export function field(label: string, value: string, muted = false) {
  return el(
    'div',
    { class: 'field' },
    el('span', { class: 'field__label', text: label }),
    el('span', { class: 'field__leader', attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: `field__value${muted ? ' field__value--muted' : ''}`, text: value }),
  );
}
