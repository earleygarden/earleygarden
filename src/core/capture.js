/**
 * 录屏专用：把页面里的声音收成一条 MediaStream，同时画一只看得见的鼠标。
 *
 * 为什么要这么绕：这机器上 ffmpeg 只认得到一个麦克风，没有 Stereo Mix /
 * 环回设备，系统层面抓不到"页面上正在响的声音"。所以改成在页面内部接一根线——
 * 环境声合成器和每一个 <video>/<audio> 都往一条 MediaStreamDestination 上汇，
 * 再用 MediaRecorder 录。这样录到的和耳朵听到的完全一致，也不依赖任何驱动。
 *
 * 环境声那条线接在 master 之后（见 ambience.js 的 _nodes），
 * 所以右上角小喇叭关着的时候，录进去同样是静的。
 *
 * 只有网址带 ?capture=1 才装得上（见 main.js），正常浏览一个字节都不跑。
 *
 * 另外还补了两样录屏必需的"不存在于真实页面"的东西：
 *   · 一只假鼠标 —— headless 录屏里没有系统光标，不画的话观众看不见在点哪儿
 *   · 一次闪白 + 一声短促的滴 —— 用来对齐画面和声音。两路录制是分别起跑的，
 *     靠这一帧亮和这一声响，剪辑时能把它们卡到同一个时刻（见 tools/tour_record.mjs）
 */

import { ambience } from './ambience.js'

let installed = false

export function installCapture() {
  if (installed) return
  installed = true
  installCursor()
  installTap()
}

/* ------------------------------------------------------------------ */
/* 假鼠标                                                              */
/* ------------------------------------------------------------------ */

/**
 * 跟着真实的 pointermove 走 —— Playwright 的 mouse.move 派发的就是真的
 * pointermove，所以这只假鼠标的位置和应用自己的命中判定永远是一致的，
 * 不会出现"鼠标指着猫、点亮的是灯塔"。
 */
function installCursor() {
  const el = document.createElement('div')
  el.className = 'tour-cursor'
  el.innerHTML = '<span class="tc-ring"></span><span class="tc-dot"></span>'
  document.body.appendChild(el)

  const place = (x, y) => {
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }
  place(window.innerWidth / 2, window.innerHeight / 2)

  // capture 阶段接，免得被场景自己的 stopPropagation 挡住
  window.addEventListener('pointermove', (e) => place(e.clientX, e.clientY), true)
  window.addEventListener('pointerdown', () => el.classList.add('is-down'), true)
  window.addEventListener('pointerup', () => el.classList.remove('is-down'), true)
}

/* ------------------------------------------------------------------ */
/* 声音                                                                */
/* ------------------------------------------------------------------ */

function installTap() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return

  /** 媒体元素的音频输出口 */
  const mctx = new AC()
  const mediaDest = mctx.createMediaStreamDestination()

  /** 总混音：把"媒体元素"和"环境声"两路并成一条。
   *  中间垫一只 GainNode 当汇流排 —— MediaStreamAudioDestinationNode 在
   *  这个 Chrome 上没有输出口，直接拿它往下接 analyser 会抛
   *  "output index (0) exceeds number of outputs (0)"，整根线都会断 */
  const mix = new AC()
  const hub = mix.createGain()
  const mixDest = mix.createMediaStreamDestination()
  hub.connect(mixDest)
  mix.createMediaStreamSource(mediaDest.stream).connect(hub)

  const hooked = new WeakSet()
  function hook(el) {
    if (!el || hooked.has(el)) return
    hooked.add(el)
    try {
      const src = mctx.createMediaElementSource(el)
      // 一路照常往外放（人还得听得见），一路复制给录音
      src.connect(mctx.destination)
      src.connect(mediaDest)
    } catch (err) {
      // 同一个元素只允许 createMediaElementSource 一次，重复会抛；
      // 抛了说明已经接好了，不用管
      console.warn('[capture] 该元素接不上', err)
    }
  }

  document.querySelectorAll('video, audio').forEach(hook)

  /**
   * 光靠 MutationObserver 盯 DOM 是不够的：播放器那个 <audio> 是
   * `new Audio()` 造出来的，压根没挂进文档，插节点事件永远等不到它 ——
   * 第一版就栽在这儿，画面里音乐在"放"，录下来的却是静音。
   * 所以再在 play() 上拦一道：不管这元素在不在文档里，只要它要出声，就先接上线。
   */
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function patchedPlay(...args) {
    hook(this)
    return origPlay.apply(this, args)
  }

  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.matches?.('video, audio')) hook(node)
        node.querySelectorAll?.('video, audio').forEach(hook)
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true })

  // 环境声要等第一次手势之后才有 AudioContext，所以这里轮询等它出现
  let ambTapped = false
  const ambTimer = setInterval(() => {
    if (ambTapped) return
    const nodes = ambience._nodes?.()
    if (!nodes?.ctx || !nodes.master) return
    const dest = nodes.ctx.createMediaStreamDestination()
    nodes.master.connect(dest)
    mix.createMediaStreamSource(dest.stream).connect(hub)
    ambTapped = true
    clearInterval(ambTimer)
  }, 120)

  Promise.resolve().then(() => {
    mctx.resume?.()
    mix.resume?.()
  })

  /* ---------- 录制 ---------- */
  let rec = null
  let chunks = []

  /** 录进去的到底有多大声 —— 直接在混音出口上挂一只表，
   *  省得每次都要把整条录完再拿耳朵判断 */
  const meter = mix.createAnalyser()
  meter.fftSize = 2048
  hub.connect(meter)

  window.__cap = {
    /** 环境声那头接上没有 —— 主程序据此决定什么时候开始录 */
    ready: () => ambTapped && !!ambience._nodes?.().ctx,
    /** 当前混音出口的 RMS（0~1）。0.001 以下基本等于没声 */
    level() {
      const buf = new Float32Array(meter.fftSize)
      meter.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      return Math.sqrt(sum / buf.length)
    },
    start() {
      chunks = []
      rec = new MediaRecorder(mixDest.stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      })
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.start(200)
      return true
    },
    /** 停止并回传 base64（页面里拿不到文件系统，只能把字节交给外面） */
    stop() {
      return new Promise((resolve) => {
        if (!rec) return resolve('')
        rec.onstop = async () => {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const u8 = new Uint8Array(await blob.arrayBuffer())
          let s = ''
          for (let i = 0; i < u8.length; i += 0x8000) {
            s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
          }
          resolve(btoa(s))
        }
        rec.stop()
      })
    },
    /** 对齐用的"场记板"：一帧白闪 + 一声 1kHz 短滴 */
    slate() {
      const flash = document.createElement('div')
      flash.className = 'tour-flash'
      document.body.appendChild(flash)
      requestAnimationFrame(() => flash.classList.add('on'))

      const ctx = mix
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 1000
      g.gain.setValueAtTime(0, ctx.currentTime)
      g.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.008)
      g.gain.setValueAtTime(0.28, ctx.currentTime + 0.11)
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.14)
      osc.connect(g)
      // 两路都要接：一路给扬声器，一路进录音。
      // 只接扬声器的话，剪辑时找不到那一声，画面和声音就对不上
      g.connect(ctx.destination)
      g.connect(hub)
      osc.start()
      osc.stop(ctx.currentTime + 0.16)

      setTimeout(() => flash.remove(), 170)
    }
  }
}
