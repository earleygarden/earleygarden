/**
 * 林间的耳机 · 播放器
 *
 * 点了耳机上那盏灯，右下角浮出这一块。几首本地 mp3，不依赖任何外链。
 *
 * 几件刻意的事：
 *
 * 1. 不用原生 <audio controls>。
 *    那是浏览器贴上来的一小块 UI，字体、配色、圆角都不归我管，
 *    放进这幅夜景里立刻出戏。所以解码用 <audio>，界面全部自己画。
 *
 * 2. 打开就出声，但音量从 0 淡上来。
 *    点灯本身就是一次手势，浏览器允许自动播放；可森林里不该"啪"地一嗓门，
 *    0.85 秒淡入，听起来像是声音本来就在那儿，只是你走近了。
 *
 * 3. 关掉是淡出再暂停，不是硬切。
 *    硬切会留下一个"咔嚓"，把画面里的安静戳破。
 *
 * 4. 音量与进度都靠场景每帧的 tick 推，不开定时器。
 *    定时器和 rAF 各跑各的，换场景时容易留下一个还在改 DOM 的孤儿。
 *    场景一 dispose，tick 就停了，不会再碰这个播放器。
 */

const FADE_IN = 0.85 // 秒
const FADE_OUT = 0.30 // 秒

/** 秒 → 1:26 */
function fmt(sec) {
  if (!isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 曲名是我们自己的数据，还是转义一下，免得以后从别处读 */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ))
}

export function createAudioPlayer({ assets, tracks, onPlaying }) {
  const audio = new Audio()
  audio.preload = 'metadata'
  audio.volume = 0

  let cur = -1
  let vol = 0 // 当前实际音量
  let target = 0 // 目标音量（1 淡入 / 0 淡出）
  let pendingPause = false // 淡出到底之后再真的 pause
  let isOpen = false
  let seeking = false
  let lastCt = -1

  const el = document.createElement('div')
  el.className = 'lamp-player'
  el.innerHTML = `
    <div class="lp-head">
      <span class="lp-tag">林间 · 耳机</span>
      <button type="button" class="lp-x" aria-label="收起播放器">×</button>
    </div>
    <div class="lp-now">
      <button type="button" class="lp-play" aria-label="播放 / 暂停">
        <span class="tri"></span>
        <span class="pz"><i></i><i></i></span>
      </button>
      <div class="lp-meta">
        <div class="lp-title"></div>
        <div class="lp-sub"></div>
      </div>
    </div>
    <div class="lp-bar">
      <div class="lp-fill"></div>
      <span class="lp-knob"></span>
    </div>
    <div class="lp-times"><span class="lp-t0">0:00</span><span class="lp-t1">0:00</span></div>
    <ul class="lp-list">
      ${tracks.map((t, i) => `
        <li class="lp-trk" data-i="${i}">
          <span class="lp-eq"><i></i><i></i><i></i></span>
          <span class="lp-tr">${esc(t.title)}</span>
          <span class="lp-td">${fmt(t.len || 0)}</span>
        </li>`).join('')}
    </ul>
  `

  const $ = (s) => el.querySelector(s)
  const titleEl = $('.lp-title')
  const subEl = $('.lp-sub')
  const playBtn = $('.lp-play')
  const barEl = $('.lp-bar')
  const fillEl = $('.lp-fill')
  const knobEl = $('.lp-knob')
  const t0El = $('.lp-t0')
  const t1El = $('.lp-t1')
  const rows = [...el.querySelectorAll('.lp-trk')]

  // 面板里的一切都不往上冒：底层那张图有自己的命中判定，
  // 不拦的话，点一下曲名会顺手把耳机也当成被点了一次
  for (const type of ['click', 'pointerdown', 'dblclick']) {
    el.addEventListener(type, (e) => e.stopPropagation())
  }

  // ---------- 加载一首 ----------
  function load(i) {
    cur = i
    const t = tracks[i]
    audio.src = assets + t.src
    audio.load()
    // 时长先写已知的，元数据一到就用真的顶掉（缓存命中时几乎是立刻）
    titleEl.textContent = t.title
    subEl.textContent = t.sub || ''
    for (const li of rows) li.classList.toggle('on', Number(li.dataset.i) === i)
    fillEl.style.width = '0%'
    knobEl.style.left = '0%'
    t0El.textContent = '0:00'
    t1El.textContent = fmt(t.len || 0)
    lastCt = -1
  }

  audio.addEventListener('loadedmetadata', () => {
    if (cur >= 0 && isFinite(audio.duration)) {
      t1El.textContent = fmt(audio.duration)
      const row = rows[cur]?.querySelector('.lp-td')
      if (row) row.textContent = fmt(audio.duration)
    }
  })

  audio.addEventListener('play', syncPlaying)
  audio.addEventListener('pause', syncPlaying)

  function syncPlaying() {
    const on = !audio.paused
    el.classList.toggle('is-playing', on)
    // 耳机上那盏灯跟着放歌一起呼吸
    onPlaying?.(on)
  }

  // ---------- 播放 / 暂停 ----------
  function start() {
    if (cur < 0) load(0)
    target = 1
    pendingPause = false
    // 静音策略、解码失败都不该把界面卡住：照常显示，只是没声音
    audio.play().catch((err) => {
      console.warn('[player] 播不出来', err?.name || err)
    })
  }

  function stop() {
    target = 0
    pendingPause = true
  }

  function select(i) {
    if (i === cur && !audio.paused) return // 正在放这首，别从头再来
    if (i !== cur) load(i)
    start()
  }

  playBtn.addEventListener('click', () => {
    if (audio.paused) start()
    else stop()
  })

  for (const li of rows) {
    li.addEventListener('click', () => select(Number(li.dataset.i)))
  }

  // 一首放完自己接下一首；最后一首放完就停在那儿，不绕回去吵人
  audio.addEventListener('ended', () => {
    if (cur < tracks.length - 1) select(cur + 1)
    else stop()
  })

  // ---------- 拖动进度 ----------
  function seekTo(e) {
    const r = barEl.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const d = audio.duration || tracks[cur]?.len || 0
    if (!d || !isFinite(d)) return
    audio.currentTime = ratio * d
    lastCt = -1
  }

  barEl.addEventListener('pointerdown', (e) => {
    seeking = true
    barEl.setPointerCapture(e.pointerId)
    seekTo(e)
  })
  barEl.addEventListener('pointermove', (e) => {
    if (seeking) seekTo(e)
  })
  const endSeek = () => { seeking = false }
  barEl.addEventListener('pointerup', endSeek)
  barEl.addEventListener('pointercancel', endSeek)

  $('.lp-x').addEventListener('click', () => close())

  // ---------- 开 / 关 ----------
  function open() {
    if (isOpen) return
    isOpen = true
    el.classList.add('on')
    // 每次点灯都重新响起来：这个角落就是"坐下来听一会儿"的地方
    start()
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    el.classList.remove('on')
    stop()
  }

  // ---------- 每帧 ----------
  function tick(dt) {
    // 音量淡入淡出
    if (vol !== target) {
      const rate = target > vol ? 1 / FADE_IN : 1 / FADE_OUT
      const step = rate * dt
      vol = target > vol
        ? Math.min(target, vol + step)
        : Math.max(target, vol - step)
      audio.volume = vol
      if (pendingPause && vol <= 0.001) {
        audio.pause()
        pendingPause = false
      }
    }

    // 进度条：只在小数点后动过才写 DOM，别每帧都碰
    if (cur < 0) return
    const ct = audio.currentTime
    if (Math.abs(ct - lastCt) < 0.08 && lastCt >= 0) return
    lastCt = ct
    const d = audio.duration || tracks[cur]?.len || 0
    const pct = d > 0 ? Math.min(100, (ct / d) * 100) : 0
    fillEl.style.width = `${pct}%`
    knobEl.style.left = `${pct}%`
    t0El.textContent = fmt(ct)
  }

  function dispose() {
    try { audio.pause() } catch { /* 已经没了 */ }
    // 清掉 src 再 load：否则离开场景之后它还在后台慢慢下那 4 MB
    audio.removeAttribute('src')
    try { audio.load() } catch { /* 忽略 */ }
    el.remove()
  }

  return {
    el,
    open,
    close,
    tick,
    dispose,
    get isOpen() { return isOpen }
  }
}
