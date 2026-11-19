import type { MediaInfo, Member, ServerMsg } from '../shared/protocol.js'
import { Net } from './net.js'
import { SyncedPlayer } from './player.js'
import { clockTime, timecode } from './format.js'
import { el, icon, ICONS, mount } from './dom.js'

export function renderGate(roomId: string): void {
  const nick = el('input', {
    class: 'input',
    id: 'nick',
    placeholder: 'What should we call you?',
    maxlength: '24',
    autocomplete: 'off',
  }) as HTMLInputElement

  mount(
    el(
      'div',
      { class: 'gate' },
      el(
        'div',
        { class: 'gate__inner' },
        el('h1', { class: 'gate__title' }, 'Take a seat'),
        el('p', { class: 'gate__sub' }, 'Your name shows up in chat and on the roster.'),
        el(
          'form',
          {
            onsubmit: (e: Event) => {
              e.preventDefault()
              const name = nick.value.trim() || 'anon'
              sessionStorage.setItem('watchalong:nick', name)
              // This submit is also the user gesture the browser needs before it will
              // let us start audio, so the room is built from inside the handler.
              renderRoom(roomId, name)
            },
          },
          nick,
          el('button', { class: 'btn', type: 'submit' }, 'Join the room'),
        ),
      ),
    ),
  )
  nick.value = sessionStorage.getItem('watchalong:nick') ?? ''
  nick.focus()
}

export function renderRoom(roomId: string, nick: string): void {
  // src is attached only once ingest finishes: pointing a <video> at a file that is
  // still being written makes the browser cache a truncated duration.
  const video = el('video', { playsinline: 'true', preload: 'auto' }) as HTMLVideoElement

  const veil = el('div', { class: 'screen__veil' })
  const screen = el('div', { class: 'screen' }, video, veil)

  const title = el('div', { class: 'stage__title' }, 'Loading…')
  const log = el('div', { class: 'chat__log', role: 'log', 'aria-live': 'polite' })
  const roster = el('div', { class: 'roster' })
  const status = el('span', {}, 'connecting')
  const dot = el('span', { class: 'who__dot who__dot--off' })

  const net = new Net(roomId)
  const player = new SyncedPlayer(video, net)
  const transport = buildTransport(player, video)

  const chatInput = el('input', {
    class: 'chat__input',
    placeholder: 'Say something',
    maxlength: '1000',
    autocomplete: 'off',
    'aria-label': 'Message',
  }) as HTMLInputElement

  const compose = el(
    'form',
    {
      class: 'chat__compose',
      onsubmit: (e: Event) => {
        e.preventDefault()
        const text = chatInput.value.trim()
        if (!text) return
        net.send({ t: 'chat', text })
        chatInput.value = ''
      },
    },
    chatInput,
    el('button', { class: 'btn btn--ghost', type: 'submit' }, 'Send'),
  )

  mount(
    el(
      'div',
      { class: 'room' },
      el(
        'div',
        { class: 'stage' },
        el(
          'div',
          { class: 'stage__bar' },
          el('span', { class: 'stage__mark', html: 'W<em>A</em>' }),
          title,
          el(
            'button',
            {
              class: 'stage__link',
              onclick: async (e: Event) => {
                await navigator.clipboard.writeText(location.href).catch(() => {})
                const b = e.currentTarget as HTMLElement
                b.textContent = 'Link copied'
                setTimeout(() => (b.textContent = 'Copy invite'), 1600)
              },
            },
            'Copy invite',
          ),
        ),
        screen,
        transport.node,
      ),
      el(
        'div',
        { class: 'chat' },
        el(
          'div',
          { class: 'chat__head' },
          el('span', { class: 'chat__heading' }, 'Room'),
          el('span', { class: 'who' }, dot, status),
        ),
        roster,
        log,
        compose,
      ),
    ),
  )

  // --- wiring -------------------------------------------------------------

  let media: MediaInfo = { status: 'ingesting', title: 'Loading…' }

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60

  function addLine(node: HTMLElement) {
    const stick = atBottom()
    log.append(node)
    if (stick) log.scrollTop = log.scrollHeight
  }

  const chatLine = (m: Extract<ServerMsg, { t: 'chat' }>) =>
    el(
      'div',
      { class: 'line' },
      el('span', { class: 'line__stamp' }, clockTime(m.ts)),
      el(
        'span',
        { class: 'line__text' },
        el('span', { class: 'line__nick' }, m.nick),
        document.createTextNode(m.text),
      ),
    )

  const VERB: Record<string, string> = {
    join: 'took a seat',
    leave: 'left',
    play: 'started it',
    pause: 'paused',
    seek: 'jumped',
  }

  const systemLine = (m: Extract<ServerMsg, { t: 'system' }>) => {
    const parts: (Node | string)[] = [
      el('b', {}, m.nick),
      ` ${VERB[m.kind] ?? m.kind}`,
    ]
    if (m.position !== undefined) parts.push(' at ', el('i', {}, timecode(m.position)))
    return el(
      'div',
      { class: 'line line--sys' },
      el('span', { class: 'line__stamp' }, clockTime(m.ts)),
      el('span', { class: 'line__text' }, ...parts),
    )
  }

  const renderMsg = (m: ServerMsg) => {
    if (m.t === 'chat') addLine(chatLine(m))
    else if (m.t === 'system') addLine(systemLine(m))
  }

  function showMembers(members: Member[]) {
    roster.replaceChildren(
      ...members.map((m) => el('span', { class: 'roster__who' }, m.nick)),
    )
  }

  function showMedia(next: MediaInfo) {
    media = next
    title.textContent = next.title
    document.title = next.status === 'ready' ? `${next.title} · Watchalong` : 'Watchalong'
    player.setDuration(next.duration ?? null)

    if (next.status === 'ready') {
      if (!video.getAttribute('src')) video.src = `/media/${roomId}`
      veil.replaceChildren()
      veil.style.display = 'none'
      transport.enable()
      return
    }

    veil.style.display = 'grid'
    veil.replaceChildren(next.status === 'error' ? errorPanel(next) : leaderPanel(next))
  }

  net.onMessage((msg) => {
    switch (msg.t) {
      case 'welcome':
        showMembers(msg.members)
        msg.history.forEach(renderMsg)
        showMedia(msg.media)
        player.setTarget(msg.playback)
        player.start()
        break
      case 'state':
        player.setTarget(msg.playback)
        transport.refresh()
        break
      case 'presence':
        showMembers(msg.members)
        break
      case 'media':
        showMedia(msg.media)
        break
      case 'chat':
      case 'system':
        renderMsg(msg)
        break
      case 'error':
        addLine(el('div', { class: 'line line--sys' }, el('span', {}), el('span', { class: 'line__text' }, msg.message)))
        break
    }
  })

  const paint = () => {
    const live = net.connected
    dot.className = `who__dot${live ? '' : ' who__dot--off'}`
    status.textContent = live ? `${net.latency}ms` : 'reconnecting'
  }
  setInterval(paint, 1000)
  paint()

  net.connect(nick)

  // Keyboard: space toggles, arrows scrub. Skipped while typing in chat.
  window.addEventListener('keydown', (e) => {
    if (media.status !== 'ready') return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

    if (e.code === 'Space' || e.key === 'k') {
      e.preventDefault()
      player.playing ? player.requestPause() : player.requestPlay()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      player.requestSeek(player.roomPosition() + 5)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      player.requestSeek(Math.max(0, player.roomPosition() - 5))
    }
  })
}

/** The signature: ingest drawn as an academy leader, because that is what it is —
 *  the seconds before the film starts. The sweep is real progress, not decoration. */
function leaderPanel(media: MediaInfo): HTMLElement {
  const known = media.totalBytes && media.totalBytes > 0
  const frac = known ? Math.min(1, (media.bytes ?? 0) / media.totalBytes!) : 0
  const count = known ? String(Math.max(1, 8 - Math.floor(frac * 7))) : '·'

  const dial = el(
    'div',
    { class: 'leader__dial' },
    el('div', { class: 'leader__face' }, el('div', { class: 'leader__count' }, count)),
  )
  dial.style.setProperty('--sweep', String(frac))

  const mb = (n?: number) => (n ? `${(n / 1_048_576).toFixed(0)} MB` : null)
  const detail = known
    ? `${mb(media.bytes)} of ${mb(media.totalBytes)} · ${Math.round(frac * 100)}%`
    : mb(media.bytes)
      ? `${mb(media.bytes)} so far`
      : 'Reaching for the file'

  return el(
    'div',
    { class: 'leader' },
    dial,
    el('div', { class: 'leader__label', html: `Threading the reel<br>${detail}` }),
  )
}

function errorPanel(media: MediaInfo): HTMLElement {
  return el(
    'div',
    { class: 'landing__inner' },
    el('div', { class: 'leader__label' }, 'The film did not arrive'),
    el('div', { class: 'notice' }, media.message ?? 'Unknown problem.'),
    el(
      'p',
      { class: 'hint' },
      'Chat still works. Open a new room once the link is fixed.',
    ),
  )
}

function buildTransport(player: SyncedPlayer, video: HTMLVideoElement) {
  const playBtn = el('button', { class: 'transport__btn', 'aria-label': 'Play' }, icon(ICONS.play))
  const back = el('button', { class: 'transport__btn', 'aria-label': 'Back 10 seconds' }, icon(ICONS.back))
  const fwd = el('button', { class: 'transport__btn', 'aria-label': 'Forward 10 seconds' }, icon(ICONS.fwd))
  const full = el('button', { class: 'transport__btn', 'aria-label': 'Fullscreen' }, icon(ICONS.full))

  const fill = el('div', { class: 'scrub__fill' })
  const head = el('div', { class: 'scrub__head' })
  const scrub = el(
    'div',
    {
      class: 'scrub',
      role: 'slider',
      tabindex: '0',
      'aria-label': 'Position',
    },
    el('div', { class: 'scrub__track' }, fill, head),
  )

  const time = el('span', { class: 'transport__time' })

  const volume = el('input', {
    type: 'range', min: '0', max: '1', step: '0.01', value: '1', 'aria-label': 'Volume',
  }) as HTMLInputElement

  const node = el(
    'div',
    { class: 'transport' },
    playBtn, back, fwd, time, scrub,
    el('div', { class: 'volume' }, icon(ICONS.vol), volume),
    full,
  )

  const duration = () => (Number.isFinite(video.duration) ? video.duration : 0)

  function refresh() {
    const pos = player.roomPosition()
    const dur = duration()
    const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0
    fill.style.width = `${pct}%`
    head.style.left = `${pct}%`
    time.replaceChildren(el('b', {}, timecode(pos)), document.createTextNode(` / ${timecode(dur)}`))
    playBtn.replaceChildren(icon(player.playing ? ICONS.pause : ICONS.play))
    playBtn.setAttribute('aria-label', player.playing ? 'Pause' : 'Play')
    scrub.setAttribute('aria-valuenow', String(Math.floor(pos)))
    scrub.setAttribute('aria-valuemax', String(Math.floor(dur)))
    scrub.setAttribute('aria-valuetext', timecode(pos))
  }

  const seekFromPointer = (e: PointerEvent) => {
    const r = scrub.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    if (duration() > 0) player.requestSeek(frac * duration())
  }

  playBtn.addEventListener('click', () => (player.playing ? player.requestPause() : player.requestPlay()))
  back.addEventListener('click', () => player.requestSeek(Math.max(0, player.roomPosition() - 10)))
  fwd.addEventListener('click', () => player.requestSeek(player.roomPosition() + 10))
  scrub.addEventListener('pointerdown', seekFromPointer)
  scrub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') player.requestSeek(player.roomPosition() + 5)
    if (e.key === 'ArrowLeft') player.requestSeek(Math.max(0, player.roomPosition() - 5))
  })
  volume.addEventListener('input', () => (video.volume = Number(volume.value)))
  full.addEventListener('click', () => {
    const stage = node.parentElement
    if (!document.fullscreenElement) void stage?.requestFullscreen?.()
    else void document.exitFullscreen()
  })

  video.addEventListener('loadedmetadata', refresh)
  setInterval(refresh, 250)

  return { node, refresh, enable: () => refresh() }
}
