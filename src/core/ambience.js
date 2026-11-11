/**
 * 鳄梨岛 · 环境声
 *
 * 六个场景各有一层底噪：封面是海，灯塔是拍岸，木屋收得很轻，
 * 林间是虫鸣，沙滩是退浪，水下是深海的压。藏宝图是一点纸面的风和远处的海。
 *
 * ── 为什么全是现场合成，不用 mp3 ──
 *
 * 1. 岛屿一直在动（水在流、叶子在晃、猫会醒），底噪却每 20 秒"咔"一下重来，
 *    立刻就漏了馅。现场合成的噪声永不重复，不存在接缝。
 * 2. 换场景要交叉淡变。音频文件做交叉淡变得同时解码两条、双份内存；
 *    节点图上只是两个增益互相让位。
 * 3. 一个字节都不用下，离线也能用，也没有任何素材版权问题。
 *
 * ── 三条刻意的规矩 ──
 *
 * 1. 不在载入时就吵。浏览器的自动播放策略本来也不允许 —— 记下"想去哪一床"，
 *    等第一次点击/按键再真正开始。所以进站先看见岛，点一下才听见海。
 * 2. 室内不是"小声的海"，是**另一种东西**：只有 160 Hz 以下房间底噪，
 *    加一点窗外的风。靠"少"来表达墙，而不是把海拧小。
 * 3. 交叉淡变 1.5 秒，比画面 0.43 秒的黑场长得多。声音不能比画面先跳，
 *    否则转场会像被撕开。
 */

const STORE_KEY = 'avocado.sound'

/** 每一床的总电平。房间刻意压到最低 —— 她说的"声音转弱"是这个。 */
const LEVEL = {
  sea: 0.26,
  harbor: 0.30,
  beach: 0.26,
  forest: 0.22,
  room: 0.09,
  deep: 0.26,
  map: 0.12
}

const FADE_IN = 1.5
const FADE_OUT = 1.3
const CROSS_CUT = 1600 // 淡出到底之后再拆节点

let ctx = null
let master = null // 用户开关
let bus = null // 放歌时把底噪让开
let current = null // { name, out, dispose }
let wanted = 'sea' // 还没解锁时先记着想放哪一床
let enabled = true
let ducked = false
let started = false
let armed = false
let analyser = null
let toggleEl = null
let built = 0 // 建了几床
let disposed = 0 // 拆了几床（对不上就是漏了）

const noiseBuf = {}

const rand = (a, b) => a + Math.random() * (b - a)

/* ------------------------------------------------------------------ */
/* 基础件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 一段可无缝循环的噪声。
 *
 * 噪声直接首尾相接会有一条"咔"—— 波形在接缝处不连续。所以多生成 fade 那
 * 一小段，把尾巴用等功率交叉淡进开头，再只取前 n 个样本。
 * 循环点落在这段已经混匀的区域里，听不出来。
 */
function makeNoise(kind, seconds = 3.4, fade = 0.4) {
  const sr = ctx.sampleRate
  const n = Math.floor(sr * seconds)
  const f = Math.floor(sr * fade)
  const raw = new Float32Array(n + f)

  if (kind === 'brown') {
    // 布朗噪声：低频足，像水体的厚度
    let last = 0
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      raw[i] = last * 3.5
    }
  } else {
    for (let i = 0; i < raw.length; i++) raw[i] = Math.random() * 2 - 1
  }

  for (let i = 0; i < f; i++) {
    const t = i / f
    const a = Math.sqrt(t) // 等功率
    const b = Math.sqrt(1 - t)
    raw[i] = raw[i] * a + raw[n + i] * b
  }

  // 归一化到 0.92，后面的电平才有可比性
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(raw[i]))
  const k = peak > 0 ? 0.92 / peak : 1

  const buf = ctx.createBuffer(1, n, sr)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = raw[i] * k
  return buf
}

function noiseBuffer(kind) {
  if (!noiseBuf[kind]) noiseBuf[kind] = makeNoise(kind)
  return noiseBuf[kind]
}

function noiseSource(kind) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(kind)
  src.loop = true
  // 同一段噪声重复听会露馅，变速一点点就把周期打散
  src.playbackRate.value = rand(0.92, 1.08)
  src.start()
  return src
}

function biq(type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  if (q) f.Q.value = q
  return f
}

/** 慢速正弦摆动，直接加到某个 AudioParam 上（加在原值之上） */
function lfo(freq, depth, param, phaseOffset = 0) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  const g = ctx.createGain()
  g.gain.value = depth
  osc.connect(g)
  g.connect(param)
  osc.start(ctx.currentTime + phaseOffset)
  return osc
}

function gainNode(v) {
  const g = ctx.createGain()
  g.gain.value = v
  return g
}

/**
 * 一次性事件（浪拍上来、远处一声回响）。
 * 用 setTimeout 排下一次，不预排 20 秒 —— 那会在退出场景后留下孤儿节点。
 * 返回的函数一调就把定时器清干净。
 */
function every(minMs, maxMs, fn) {
  let dead = false
  let id = null
  const loop = () => {
    if (dead) return
    try { fn() } catch (err) { console.warn('[ambience]', err) }
    id = setTimeout(loop, rand(minMs, maxMs))
  }
  id = setTimeout(loop, rand(minMs, maxMs))
  return () => { dead = true; clearTimeout(id) }
}

/* ------------------------------------------------------------------ */
/* 六床底噪                                                             */
/* ------------------------------------------------------------------ */

const BUILD = {
  /** 封面 · 夜里的海。起伏慢，没有浪头拍碎的声音 */
  sea(out) {
    const body = noiseSource('brown')
    const lp = biq('lowpass', 430, 0.8)
    const swell = gainNode(0.42)
    body.connect(lp)
    lp.connect(swell)
    swell.connect(out)

    lfo(0.055, 0.36, swell.gain) // 一浪一浪的呼吸
    lfo(0.041, 165, lp.frequency) // 浪大时亮一点

    const foam = noiseSource('white')
    const bp = biq('bandpass', 1750, 0.55)
    const fg = gainNode(0.07)
    foam.connect(bp)
    bp.connect(fg)
    fg.connect(out)
    lfo(0.047, 0.055, fg.gain, 0.4) // 白沫是错开的，不跟着浪一起涨

    return {
      dispose() {
        ;[body, foam].forEach((n) => { try { n.stop() } catch { /* 已停 */ } })
      }
    }
  },

  /** 灯塔 · 光是打在礁石上的浪，一记一记，硬 */
  harbor(out) {
    const body = noiseSource('brown')
    const lp = biq('lowpass', 260, 0.7)
    const bg = gainNode(0.26)
    body.connect(lp)
    lp.connect(bg)
    bg.connect(out)

    // 浪头之间那一层细碎的海面嘶声。没有它，两次浪之间就是真空，
    // 人会觉得"声音断了"，而不是"海一直在，只是没拍上来"
    const hiss = noiseSource('white')
    const hbp = biq('bandpass', 1050, 0.8)
    const hg = gainNode(0.09)
    hiss.connect(hbp)
    hbp.connect(hg)
    hg.connect(out)

    const stop = every(6200, 9400, () => {
      const t = ctx.currentTime

      // 浪打碎：一段噪声，40 毫秒冲上来，两秒半退掉
      const crush = ctx.createBufferSource()
      crush.buffer = noiseBuffer('white')
      const bp = biq('bandpass', rand(420, 560), 0.8)
      const env = gainNode(0)
      crush.connect(bp)
      bp.connect(env)
      env.connect(out)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(rand(0.42, 0.6), t + 0.07)
      env.gain.exponentialRampToValueAtTime(0.001, t + 2.6)
      crush.start(t)
      crush.stop(t + 2.7)
      crush.onended = () => { try { env.disconnect() } catch { /* 已断 */ } }

      // 礁石底下的闷响，只给一点点，不加就"轻飘飘"
      const thud = ctx.createOscillator()
      thud.type = 'sine'
      thud.frequency.setValueAtTime(62, t)
      thud.frequency.exponentialRampToValueAtTime(44, t + 0.9)
      const tg = gainNode(0)
      thud.connect(tg)
      tg.connect(out)
      tg.gain.setValueAtTime(0, t)
      tg.gain.linearRampToValueAtTime(0.3, t + 0.04)
      tg.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
      thud.start(t)
      thud.stop(t + 1.2)
    })

    return {
      dispose() {
        stop()
        try { hiss.stop() } catch { /* 已停 */ }
      }
    }
  },

  /** 开发者沙滩 · 退浪。拍得软，退得长，尾巴上有一层沙沙 */
  beach(out) {
    const body = noiseSource('brown')
    const lp = biq('lowpass', 500, 0.8)
    const bg = gainNode(0.22)
    body.connect(lp)
    lp.connect(bg)
    bg.connect(out)
    lfo(0.06, 0.03, bg.gain)

    const stop = every(5200, 7400, () => {
      const t = ctx.currentTime

      const wash = ctx.createBufferSource()
      wash.buffer = noiseBuffer('white')
      const bp = biq('bandpass', rand(700, 950), 0.6)
      const env = gainNode(0)
      wash.connect(bp)
      bp.connect(env)
      env.connect(out)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(rand(0.26, 0.36), t + 0.45) // 起得慢 = 软
      env.gain.exponentialRampToValueAtTime(0.001, t + 3.4)
      wash.start(t)
      wash.stop(t + 3.5)
      wash.onended = () => { try { env.disconnect() } catch { /* 已断 */ } }

      // 浪退下去那层细沙，晚 1 秒才出来
      const sand = ctx.createBufferSource()
      sand.buffer = noiseBuffer('white')
      const hp = biq('highpass', 2600, 0.7)
      const sg = gainNode(0)
      sand.connect(hp)
      hp.connect(sg)
      sg.connect(out)
      sg.gain.setValueAtTime(0, t + 0.7)
      sg.gain.linearRampToValueAtTime(0.1, t + 1.5)
      sg.gain.exponentialRampToValueAtTime(0.001, t + 2.9)
      sand.start(t + 0.7)
      sand.stop(t + 3)
      sand.onended = () => { try { sg.disconnect() } catch { /* 已断 */ } }
    })

    return { dispose: stop }
  },

  /** 林间 · 虫鸣 + 一点风。虫是三只，节奏各不相同，不然像电子表 */
  forest(out) {
    const wind = noiseSource('brown')
    const lp = biq('lowpass', 520, 0.6)
    const wg = gainNode(0.22)
    wind.connect(lp)
    lp.connect(wg)
    wg.connect(out)
    lfo(0.07, 0.018, wg.gain)

    const voices = [0, 1, 2].map((i) => {
      const src = noiseSource('white')
      const bp = biq('bandpass', 4050 + i * 430, 13) // 窄带 = 有音高感的"唧"
      const g = gainNode(0)
      src.connect(bp)
      bp.connect(g)
      g.connect(out)
      return {
        g,
        src,
        nextAt: ctx.currentTime + 0.25 + i * 0.4,
        period: 1.02 + i * 0.24,
        amp: 0.24 - i * 0.04
      }
    })

    // 前瞻调度：每 250ms 看一眼未来 0.7 秒有没有虫要叫。
    // 直接 setInterval(setValueAtTime) 精度不够，唧声会抖。
    const LOOKAHEAD = 0.7
    const id = setInterval(() => {
      const t = ctx.currentTime
      for (const v of voices) {
        let guard = 0
        while (v.nextAt < t + LOOKAHEAD && guard++ < 12) {
          const burst = 3 + Math.floor(Math.random() * 2)
          for (let b = 0; b < burst; b++) {
            const at = v.nextAt + b * 0.062
            v.g.gain.setValueAtTime(0, at)
            v.g.gain.linearRampToValueAtTime(v.amp, at + 0.009)
            v.g.gain.linearRampToValueAtTime(v.amp * 0.5, at + 0.03)
            v.g.gain.linearRampToValueAtTime(0, at + 0.048)
          }
          v.nextAt += v.period * rand(0.82, 1.3)
        }
      }
    }, 250)

    return {
      dispose() {
        clearInterval(id)
        wind.stop()
        for (const v of voices) { try { v.src.stop() } catch { /* 已停 */ } }
      }
    }
  },

  /** 木屋 · 转弱。只留房间底噪和窗外一丝风，什么都没有 */
  room(out) {
    const room = noiseSource('brown')
    const lp = biq('lowpass', 158, 0.9)
    const rg = gainNode(0.53)
    room.connect(lp)
    lp.connect(rg)
    rg.connect(out)
    lfo(0.043, 0.014, rg.gain)

    const outside = noiseSource('white')
    const bp = biq('bandpass', 760, 1.2)
    const og = gainNode(0.05)
    outside.connect(bp)
    bp.connect(og)
    og.connect(out)
    lfo(0.052, 0.004, og.gain, 0.8)

    return {
      dispose() {
        ;[room, outside].forEach((n) => { try { n.stop() } catch { /* 已停 */ } })
      }
    }
  },

  /** 水下 · 深海。低频压着，偶尔远处一声回响 */
  deep(out) {
    const rumble = noiseSource('brown')
    const lp = biq('lowpass', 78, 1.1)
    const rg = gainNode(0.45)
    rumble.connect(lp)
    lp.connect(rg)
    rg.connect(out)
    lfo(0.03, 0.06, rg.gain)

    const flow = noiseSource('brown')
    const lp2 = biq('lowpass', 250, 0.7)
    const fg = gainNode(0.11)
    flow.connect(lp2)
    lp2.connect(fg)
    fg.connect(out)
    lfo(0.021, 0.022, fg.gain, 0.5)

    const hiss = noiseSource('white')
    const bp = biq('bandpass', 320, 3)
    const hg = gainNode(0.03)
    hiss.connect(bp)
    bp.connect(hg)
    hg.connect(out)

    // 远处一声长鸣（鲸？管道？不指名），十八到二十六秒一次
    const stop = every(17000, 26000, () => {
      const t = ctx.currentTime
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const f0 = rand(118, 142)
      osc.frequency.setValueAtTime(f0, t)
      osc.frequency.linearRampToValueAtTime(f0 * 0.68, t + 4.4)
      const g = gainNode(0)
      osc.connect(g)
      g.connect(out)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.05, t + 1.6)
      g.gain.linearRampToValueAtTime(0.001, t + 4.6)
      osc.start(t)
      osc.stop(t + 4.8)
    })

    return {
      dispose() {
        stop()
        ;[rumble, flow, hiss].forEach((n) => { try { n.stop() } catch { /* 已停 */ } })
      }
    }
  },

  /** 藏宝图 · 纸面的风，远处还留着海 */
  map(out) {
    const air = noiseSource('white')
    const hp = biq('highpass', 1500, 0.6)
    const ag = gainNode(0.06)
    air.connect(hp)
    hp.connect(ag)
    ag.connect(out)

    const far = noiseSource('brown')
    const lp = biq('lowpass', 320, 0.7)
    const fg = gainNode(0.37)
    far.connect(lp)
    lp.connect(fg)
    fg.connect(out)
    lfo(0.048, 0.02, fg.gain)

    return {
      dispose() {
        ;[air, far].forEach((n) => { try { n.stop() } catch { /* 已停 */ } })
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 场景切换                                                            */
/* ------------------------------------------------------------------ */

function build(name) {
  const maker = BUILD[name] || BUILD.room
  const out = gainNode(0)
  out.connect(bus)
  const made = maker(out) || {}
  built++
  return {
    name,
    out,
    dispose() {
      disposed++
      made.dispose?.()
    }
  }
}

function levelOf(name) {
  return LEVEL[name] ?? 0.12
}

/** 换场。没解锁之前只记下来，一个字都不出声。 */
export function setScene(name) {
  if (!name) return
  wanted = name
  // 离开林间就把让位收回来。放歌时的 duck 是场景内的事，
  // 万一播放器没来得及发"停了"，底噪会一直被压着，听起来像全局音量掉了
  if (name !== 'forest' && ducked) duck(false)
  if (!ctx) return
  if (current && current.name === name) return

  const next = build(name)
  const old = current
  current = next

  const now = ctx.currentTime
  next.out.gain.cancelScheduledValues(now)
  next.out.gain.setValueAtTime(0, now)
  next.out.gain.linearRampToValueAtTime(levelOf(name), now + FADE_IN)

  if (old) {
    old.out.gain.cancelScheduledValues(now)
    old.out.gain.setValueAtTime(old.out.gain.value, now)
    old.out.gain.linearRampToValueAtTime(0, now + FADE_OUT)
    setTimeout(() => {
      try { old.dispose() } catch (err) { console.warn('[ambience] dispose', err) }
      try { old.out.disconnect() } catch { /* 已断 */ }
    }, CROSS_CUT)
  }
}

/** 林间放歌时把底噪让开，别跟人声抢 */
export function duck(on) {
  ducked = !!on
  if (!ctx || !bus) return
  const now = ctx.currentTime
  bus.gain.cancelScheduledValues(now)
  bus.gain.setValueAtTime(bus.gain.value, now)
  bus.gain.linearRampToValueAtTime(ducked ? 0.34 : 1, now + 0.7)
}

/* ------------------------------------------------------------------ */
/* 开关                                                                */
/* ------------------------------------------------------------------ */

function ensureCtx() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()

  master = gainNode(enabled ? 1 : 0)
  master.connect(ctx.destination)

  bus = gainNode(ducked ? 0.34 : 1)
  bus.connect(master)
  return ctx
}

function start() {
  if (started) {
    try { ctx?.resume() } catch { /* 已经在跑 */ }
    return
  }
  if (!ensureCtx()) return
  started = true
  try { ctx.resume() } catch { /* 忽略 */ }
  const name = wanted
  const bed = build(name)
  current = bed
  const now = ctx.currentTime
  bed.out.gain.setValueAtTime(0, now)
  bed.out.gain.linearRampToValueAtTime(levelOf(name), now + FADE_IN)
  master.gain.setValueAtTime(enabled ? 0 : 1, now)
  master.gain.linearRampToValueAtTime(enabled ? 1 : 0, now + 0.8)
}

function applyEnabled() {
  if (enabled && !ctx) ensureCtx()
  if (ctx && master) {
    const now = ctx.currentTime
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(master.gain.value, now)
    master.gain.linearRampToValueAtTime(enabled ? 1 : 0, now + 0.6)
    if (enabled) {
      try { ctx.resume() } catch { /* 忽略 */ }
      // 先建底噪再置 started —— 反过来的话 start() 会以为已经跑起来了，
      // 直接 return，结果开关点开却是静的
      if (!current) start()
    } else {
      // 关掉一会儿之后真的挂起，省电；等到再打开时 resume
      setTimeout(() => {
        if (!enabled && ctx) { try { ctx.suspend() } catch { /* 忽略 */ } }
      }, 700)
    }
  }
  try { localStorage.setItem(STORE_KEY, enabled ? 'on' : 'off') } catch { /* 无痕模式 */ }
  paintToggle()
}

function arm() {
  if (armed) return
  armed = true
  const kick = () => {
    document.removeEventListener('pointerdown', kick, true)
    document.removeEventListener('keydown', kick, true)
    if (enabled) start()
  }
  document.addEventListener('pointerdown', kick, true)
  document.addEventListener('keydown', kick, true)
}

/* ------------------------------------------------------------------ */
/* 右下角那只小喇叭                                                    */
/* ------------------------------------------------------------------ */

function paintToggle() {
  if (!toggleEl) return
  toggleEl.classList.toggle('is-off', !enabled)
  toggleEl.setAttribute('aria-pressed', enabled ? 'true' : 'false')
  const label = toggleEl.querySelector('.st-label')
  if (label) label.textContent = enabled ? '声音' : '已静音'
  toggleEl.setAttribute('aria-label', enabled ? '关闭环境声' : '打开环境声')
}

export function mountToggle() {
  if (toggleEl) return toggleEl
  toggleEl = document.createElement('button')
  toggleEl.type = 'button'
  toggleEl.className = 'sound-toggle'
  toggleEl.innerHTML = `
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M4 9.6h3.1L11.6 6v12L7.1 14.4H4z" fill="currentColor"/>
      <path class="st-wave st-wave-1" d="M14.9 9.3a3.9 3.9 0 0 1 0 5.4" fill="none"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path class="st-wave st-wave-2" d="M17.5 6.9a7.3 7.3 0 0 1 0 10.2" fill="none"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path class="st-slash" d="M4.6 19.4L19.4 4.6" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span class="st-label">声音</span>
  `
  toggleEl.addEventListener('click', (e) => {
    e.stopPropagation()
    enabled = !enabled
    applyEnabled()
  })
  document.body.appendChild(toggleEl)
  paintToggle()
  return toggleEl
}

/* ------------------------------------------------------------------ */
/* 对外                                                                */
/* ------------------------------------------------------------------ */

export const ambience = {
  setScene,
  duck,
  mountToggle,
  /** 调试用：控制台里 __ambience.stats() 看当前是哪一床、有没有真的出声 */
  stats() {
    if (!ctx) return { state: '未解锁', bed: wanted, rms: 0 }
    if (!analyser) {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      master.connect(analyser)
    }
    const buf = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return {
      state: ctx.state,
      bed: current?.name ?? wanted,
      built,
      disposed,
      rms: Math.sqrt(sum / buf.length),
      master: master.gain.value,
      enabled
    }
  },
  setVolume(v) {
    if (!ctx) return
    const now = ctx.currentTime
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(master.gain.value, now)
    master.gain.linearRampToValueAtTime(Number(v) || 0, now + 0.3)
  },
  /**
   * 录屏专用：把出口节点交出去，好在 master 之后接一条 MediaStreamDestination
   * （见 core/capture.js）。接在 master 后面，所以小喇叭关掉时录进去也是静的，
   * 和人在现场听到的一致。正常浏览不会碰它。
   */
  _nodes: () => ({ ctx, master })
}

export function initAmbience() {
  try {
    const saved = localStorage.getItem(STORE_KEY)
    if (saved === 'off') enabled = false
  } catch { /* 无痕模式读不到，当默认开 */ }
  mountToggle()
  if (enabled) arm()
  // 切走标签页就停，别在后台一直跑六床噪声
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !started) return
    if (document.hidden) { try { ctx.suspend() } catch { /* 忽略 */ } }
    else if (enabled) { try { ctx.resume() } catch { /* 忽略 */ } }
  })
  window.__ambience = ambience
}
