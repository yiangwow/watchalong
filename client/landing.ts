import { el, mount } from './dom.js'

export function renderLanding(): void {
  const input = el('input', {
    class: 'input',
    id: 'source',
    placeholder: 'https://drive.google.com/file/d/…/view',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement

  const button = el('button', { class: 'btn', type: 'submit' }, 'Open the room')
  const problem = el('div')

  const form = el(
    'form',
    {
      class: 'field',
      onsubmit: async (e: Event) => {
        e.preventDefault()
        problem.replaceChildren()
        button.setAttribute('disabled', 'true')
        button.textContent = 'Opening…'

        try {
          const res = await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: input.value }),
          })
          const body = (await res.json()) as { roomId?: string; error?: string }
          if (!res.ok || !body.roomId) throw new Error(body.error ?? 'The room could not be opened.')
          location.href = `/r/${body.roomId}`
        } catch (err) {
          problem.replaceChildren(el('div', { class: 'notice' }, String((err as Error).message)))
          button.removeAttribute('disabled')
          button.textContent = 'Open the room'
        }
      },
    },
    el('label', { for: 'source' }, 'Google Drive link'),
    input,
    button,
  )

  mount(
    el(
      'div',
      { class: 'landing' },
      el(
        'div',
        { class: 'landing__inner' },
        el('h1', { class: 'mark', html: 'Watch<em>along</em>' }),
        el('p', { class: 'tagline' }, 'One file · one room · everyone at the same frame'),
        form,
        problem,
        el(
          'p',
          { class: 'hint', html:
            'The file has to be shared as <code>Anyone with the link</code>. ' +
            'A direct video URL or a path on this machine works too.' },
        ),
      ),
    ),
  )
}
