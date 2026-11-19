/** When a Drive file is big enough, Google answers a download request with an HTML
 *  "we couldn't scan this for viruses" page instead of bytes. The page carries a form
 *  whose parameters (notably `confirm` and a per-request `uuid`) are what actually
 *  unlock the download. This module is the only place that knows that. */

export type ConfirmForm = { action: string; params: Record<string, string> }

const FORM = /<form[^>]*\bid=["']download-form["'][^>]*>([\s\S]*?)<\/form>/i
const ACTION = /\baction=["']([^"']+)["']/i
const INPUT = /<input\b[^>]*>/gi
const ATTR = (name: string) => new RegExp(`\\b${name}=["']([^"']*)["']`, 'i')

export function parseConfirmForm(html: string): ConfirmForm | null {
  const form = FORM.exec(html)
  if (!form?.[1]) return null

  const action = ACTION.exec(form[0])?.[1]
  if (!action) return null

  const params: Record<string, string> = {}
  for (const tag of form[1].match(INPUT) ?? []) {
    const type = ATTR('type').exec(tag)?.[1]?.toLowerCase()
    if (type === 'submit' || type === 'button') continue

    const name = ATTR('name').exec(tag)?.[1]
    if (!name) continue
    params[decodeEntities(name)] = decodeEntities(ATTR('value').exec(tag)?.[1] ?? '')
  }

  return { action: decodeEntities(action), params }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
