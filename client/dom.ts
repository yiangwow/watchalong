/** Tiny DOM helpers. Deliberately not a framework: the interesting state in this app
 *  lives on the server, and the view is small enough to write by hand. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = String(v)
    else if (k === 'html') node.innerHTML = String(v)
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, String(v))
    }
  }
  for (const c of children) node.append(c)
  return node
}

export const mount = (node: Node): void => {
  const app = document.getElementById('app')!
  app.replaceChildren(node)
}

export const icon = (path: string): SVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', path)
  svg.append(p)
  return svg
}

export const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  back: 'M11 18V6l-8.5 6zM20 18V6l-8.5 6z',
  fwd: 'M4 6v12l8.5-6zM13 6v12l8.5-6z',
  full: 'M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z',
  vol: 'M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z',
} as const
