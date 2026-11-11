import {
  BEACH_ASSETS,
  BEACH_SIZE,
  BEACH_BACK,
  BEACH_GUIDE,
  CAT_GUIDE,
  CAT_POS,
  CAT_BOX,
  WAVE_VIDEO,
  CAT_VIDEO,
  FOCUS,
  FOCUS_SCALE
} from '../data/beach.js'
import { createDotReveal } from '../core/reveal.js'

/**
 * 开发者沙滩
 *
 * 一幅画 + 一片真的海 + 一只睡着的猫。
 *
 * 海不是模拟出来的，是视频：wave.mp4 是原始 image-to-video 的循环版，
 * 猫那块用底图贴死，所以海浪、水光、风全是真的，猫保持睡觉。
 * 小猫是第二条视频（cat-awake.mp4，从同一条片子里裁出的猫区、2 倍超采样），
 * 点灯点才淡入播放，播完停在睁眼帧停一会儿，再慢慢回到睡姿。
 *
 * 播放时整个动作层一起推近 2 倍（原点钉在猫头），
 * 否则猫在屏幕上只有 90 多像素宽，睁眼等于没睁。
 *
 * 结构刻意做薄：一个房间就三样东西（画、海、猫），
 * 不复用 imageScene（那套没有视频层），也不复用 room 的多视图逻辑。
 */
export function createBeach({ onBack, backLabel: backText }) {
  // 从封面沙滩进来写"回到岛上"，从藏宝图「开发者沙滩」进来写"回到地图"。
  // 注意这个参数不能直接叫 backLabel —— 下面返回键那个 span 就叫 backLabel，
  // 同名会重复声明，整个模块起不来。
  const backCaption = backText || BEACH_BACK
  const root = document.createElement('div')
  root.className = 'cabin-stage beach-stage'

  const frame = document.createElement('div')
  frame.className = 'cabin-frame'
  root.appendChild(frame)

  // ---------- 画面（静态底，视频没起来时它就是全部） ----------
  const layer = document.createElement('div')
  layer.className = 'cabin-layer'
  const img = document.createElement('img')
  img.src = BEACH_ASSETS + 'beach.jpg'
  img.alt = '开发者沙滩'
  img.decoding = 'async'
  img.addEventListener('load', () => layer.classList.add('on'))
  if (img.complete) layer.classList.add('on')
  layer.appendChild(img)
  frame.appendChild(layer)

  // ---------- 动作层：海浪 + 猫，一起推近 ----------
  const motion = document.createElement('div')
  motion.className = 'beach-motion'
  motion.style.transformOrigin = `${(FOCUS.x * 100).toFixed(2)}% ${(FOCUS.y * 100).toFixed(2)}%`
  frame.appendChild(motion)

  // 海浪：静音循环自动播。与底图同构图，铺满即可帧帧对齐
  const wave = document.createElement('video')
  wave.className = 'beach-wave'
  wave.src = BEACH_ASSETS + WAVE_VIDEO
  wave.loop = true
  wave.muted = true
  wave.defaultMuted = true
  wave.autoplay = true
  wave.playsInline = true
  wave.preload = 'auto'
  wave.setAttribute('muted', '')
  wave.setAttribute('playsinline', '')
  wave.addEventListener('playing', () => wave.classList.add('on'))
  wave.addEventListener('canplay', () => wave.classList.add('on'))
  motion.appendChild(wave)
  wave.play?.().catch(() => {
    // 自动播放被拦：退回静态画，不影响点猫
  })

  // 猫：位置按归一化坐标摆，和底图的猫严丝合缝
  const catVideo = document.createElement('video')
  catVideo.className = 'beach-catvid'
  catVideo.src = BEACH_ASSETS + CAT_VIDEO
  catVideo.playsInline = true
  catVideo.preload = 'auto'
  catVideo.setAttribute('playsinline', '')
  catVideo.style.left = `${CAT_BOX.x0 * 100}%`
  catVideo.style.top = `${CAT_BOX.y0 * 100}%`
  catVideo.style.width = `${CAT_BOX.w * 100}%`
  catVideo.style.height = `${CAT_BOX.h * 100}%`
  motion.appendChild(catVideo)

  // ---------- 猫醒时递出来的那张纸 ----------
  //
  // 猫一醒，动作层整体推近 2 倍，猫几乎铺满整块画面（猫层在图上占
  // x 0.30–0.58、y 0.38–0.72，放大后左右顶到 12%–70%、上面顶到 20%），
  // 旁边根本没有地方挂一条指向猫嘴的气泡尾巴。
  // 所以它是一张牛皮纸小纸条，和灯塔那张信纸同一套语言，不是弹窗。
  //
  // 它挂在 frame 上而不是 motion 上 —— 放进动作层会被 scale(2) 一起放大，
  // 字会糊，而且位置上会跟猫一起漂。
  const bubble = document.createElement('div')
  bubble.className = 'cat-bubble'
  const bubblePaper = document.createElement('div')
  bubblePaper.className = 'cb-paper'
  const bubbleQ = document.createElement('span')
  bubbleQ.className = 'cb-q'
  bubbleQ.textContent = '?'
  const bubbleTxt = document.createElement('span')
  bubbleTxt.className = 'cb-txt'
  bubbleTxt.textContent = '更多好玩的应用正在开发中……'
  bubblePaper.appendChild(bubbleQ)
  bubblePaper.appendChild(bubbleTxt)
  bubble.appendChild(bubblePaper)
  frame.appendChild(bubble)

  // ---------- 播放状态 ----------
  let catPlaying = false
  let holdTimer = 0

  function sleepAgain() {
    catPlaying = false
    holdTimer = 0
    catVideo.classList.remove('on')
    root.classList.remove('is-awake')
    bubble.classList.remove('is-on')
    // 睡回去时重算一次"指着没有"。推近期间灯点是 pointer-events: none，
    // 浏览器不为它算 :hover，这里拿到的通常是 false —— 环和文案一起保持安静，
    // 不会出现"环还亮着、文案却没亮"的半截状态。
    setHover(catDot.matches(':hover'))
  }

  catVideo.addEventListener('ended', () => {
    // 停在睁眼那一帧，多留一会儿 —— 上一版播完立刻淡出，
    // 睁眼只存在一瞬，等于没看见
    holdTimer = window.setTimeout(sleepAgain, 4200)
  })
  catVideo.addEventListener('error', sleepAgain)

  // ---------- 小猫灯点 ----------
  //
  // 和序章、木屋用同一套「有人动了才亮」（core/reveal.js）：
  // 一进来是一幅干净的画，鼠标一动灯点才淡入，停住两秒自己退回去。
  //
  // 之前这里不走 reveal，灯点常驻，怕它看不见还在下面挂了一行「摸一摸」的
  // 小标签 —— 结果那行字正好压在猫脸上，把要指的东西挡住了。
  // 提示不该盖在被提示的东西上：去掉标签，改用和别处一样的规矩。
  // 找不到灯点时鼠标随便动一下就出来了，而且指上去有回应（见下面的 hot）。
  const catDot = document.createElement('button')
  catDot.type = 'button'
  catDot.className = 'beach-cat'
  catDot.setAttribute('aria-label', '叫醒小猫')
  catDot.appendChild(document.createElement('span'))
  frame.appendChild(catDot)

  const reveal = createDotReveal(root)

  // 指着灯点的回应只从一个地方改：亮环 .hot + 光标手型 + 底部文案变亮。
  // 之前 pointerenter / pointerleave 各写一遍、sleepAgain 又单独改文案，
  // 三处各管一半，Esc 睡回去时就会出现"环亮着、文案没亮"的半截状态。
  function setHover(on) {
    catDot.classList.toggle('hot', on)
    setGuide(on ? CAT_GUIDE : BEACH_GUIDE, on)
  }

  catDot.addEventListener('pointerenter', () => setHover(true))
  catDot.addEventListener('pointerleave', () => setHover(false))

  catDot.addEventListener('click', (e) => {
    e.stopPropagation()
    if (catPlaying) return
    catPlaying = true
    window.clearTimeout(holdTimer)
    catVideo.currentTime = 0
    // 放慢到 0.8：3 秒的抬头睁眼拉到 3.75 秒，看得清
    catVideo.playbackRate = 0.8
    catVideo.classList.add('on')
    root.classList.add('is-awake')
    bubble.classList.add('is-on')
    // 推近后灯点整块收掉（opacity 0），亮不亮环都看不见；
    // hot 状态留到 sleepAgain 里统一重算，这里不碰
    setGuide('小猫醒来了 ·', false)
    const p = catVideo.play()
    if (p) p.catch(sleepAgain)
  })

  // ---------- 返回 ----------
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'cabin-back'
  const backArrow = document.createElement('span')
  backArrow.className = 'arrow'
  backArrow.textContent = '‹'
  const backLabel = document.createElement('span')
  backLabel.className = 'label'
  backLabel.textContent = backCaption
  back.appendChild(backArrow)
  back.appendChild(backLabel)
  root.appendChild(back)
  back.addEventListener('click', (e) => {
    e.stopPropagation()
    onBack?.()
  })

  // ---------- 底部提示 ----------
  const guide = document.createElement('div')
  guide.className = 'intro-guide'
  guide.textContent = BEACH_GUIDE
  root.appendChild(guide)

  let guideTimer = 0
  function setGuide(text, on) {
    window.clearTimeout(guideTimer)
    if (guide.textContent === text) {
      guide.classList.remove('fading')
      guide.classList.toggle('on', on)
      return
    }
    guide.classList.add('fading')
    guideTimer = window.setTimeout(() => {
      guide.textContent = text
      guide.classList.remove('fading')
      guide.classList.toggle('on', on)
    }, 140)
  }

  // ---------- 布局 ----------
  let LAYOUT = { x: 0, y: 0, w: 1, h: 1 }

  function measure() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const ar = BEACH_SIZE.w / BEACH_SIZE.h

    let w
    let h
    if (vw / vh > ar) {
      h = vh
      w = vh * ar
    } else {
      w = vw
      h = vw / ar
    }

    LAYOUT = { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
    frame.style.left = `${LAYOUT.x}px`
    frame.style.top = `${LAYOUT.y}px`
    frame.style.width = `${LAYOUT.w}px`
    frame.style.height = `${LAYOUT.h}px`

    // 猫灯点：图片坐标 → 画面内坐标。
    // 注意这里不能加 LAYOUT.x / LAYOUT.y —— catDot 是 frame 的子元素，
    // 而 frame 自己的 left/top 已经写成 LAYOUT.x/y 了，再加一次就是双倍偏移。
    // 之前只在 16:9 窗口下测过（那时 LAYOUT.x=y=0），所以一直没暴露：
    // 窗口比例一变，灯点就被推离猫身 LAYOUT.x/y 那么远，看着像"没有触发点"。
    catDot.style.left = `${(CAT_POS.x - CAT_POS.r / BEACH_SIZE.w) * LAYOUT.w}px`
    catDot.style.top = `${(CAT_POS.y - CAT_POS.r / BEACH_SIZE.h) * LAYOUT.h}px`
    catDot.style.width = `${(CAT_POS.r * 2 / BEACH_SIZE.w) * LAYOUT.w}px`
    catDot.style.height = `${(CAT_POS.r * 2 / BEACH_SIZE.h) * LAYOUT.h}px`

    // 那句话：横向居中，纵向离上沿一小段。用百分比写 left，
    // 靠 CSS 里的 translate(-50%) 把中心钉在画面中线上。
    bubble.style.left = '50%'
    bubble.style.top = `${Math.max(16, LAYOUT.h * 0.052)}px`
  }

  // ---------- 灯点的出现与退场 ----------
  const ac = new AbortController()

  // 和序章同一套：认的是「有没有动作」，不是「光标在不在画面里」——
  // 人完全可以把鼠标停在画中央一动不动地看，那和离开窗口没有区别。
  window.addEventListener('pointermove', () => reveal.wake(), {
    signal: ac.signal,
    passive: true
  })
  // 触屏没有 pointermove，落指也要让灯点亮一下，否则手指下面永远是空的
  window.addEventListener('pointerdown', () => reveal.wake(), {
    signal: ac.signal,
    passive: true
  })
  // 切到别的窗口就别亮着了 —— 人会以为灯点还在等他，其实他根本不在
  window.addEventListener('blur', () => reveal.sleep(), { signal: ac.signal })

  // ---------- Esc ----------
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (catPlaying) {
        // 醒着的时候按 Esc：先让它睡回去
        catVideo.pause()
        catVideo.currentTime = 0
        sleepAgain()
        return
      }
      onBack?.()
    }
  }, { signal: ac.signal })

  window.addEventListener('resize', measure, { signal: ac.signal })

  measure()

  return {
    scene: null,
    camera: null,
    update: () => {},
    resize: measure,
    dispose: () => {
      ac.abort()
      window.clearTimeout(guideTimer)
      window.clearTimeout(holdTimer)
      reveal.dispose()
      catVideo.pause()
      wave.pause()
      catVideo.removeAttribute('src')
      wave.removeAttribute('src')
    },
    ui: [root],
    labels: null
  }
}
