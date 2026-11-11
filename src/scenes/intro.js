import { INTRO_ASSETS, HOTSPOTS, COVER_SIZE, WATER, LIGHTHOUSE_WATER } from '../data/intro.js'
import { createWater } from '../core/water.js'
import { createDotReveal } from '../core/reveal.js'

/**
 * 第一幕 · 序章（图片驱动）
 *
 * 交互模型：
 *   鼠标在画面上移动 → 主图有轻微视差（镜头感）
 *   鼠标停在某个热区 → 停留 240ms 后，主图缓缓推近，对应细节图交叉淡入
 *   移开 → 缓缓退回全景
 *   此时点击 → 触发该热区的动作
 *
 * 两个关键设计：
 * 1. 主图层尺寸由 JS 按图片原始比例算出（不靠 object-fit: cover 裁切），
 *    这样「图片坐标」和「层坐标」是 1:1 的，热区在任何窗口比例下都不会偏。
 * 2. 热区判定只认「未推近时」的布局，推近过程中不重算，
 *    否则图片一放大热区就跟着跑，会来回抖。
 */
export function createIntro({ onEnter, onCabin, onGrove, onUndersea, onBeach, initialDetail }) {
  const root = document.createElement('div')
  root.className = 'intro-stage'

  // ---------- 主图 ----------
  const cover = document.createElement('div')
  cover.className = 'intro-layer is-cover'
  const coverImg = document.createElement('img')
  const showCover = () => cover.classList.add('loaded')
  coverImg.addEventListener('load', showCover)
  coverImg.addEventListener('error', showCover)
  coverImg.alt = '夜色中的小岛'
  coverImg.decoding = 'async'
  coverImg.src = INTRO_ASSETS + 'cover.jpg'
  if (coverImg.complete) showCover()
  cover.appendChild(coverImg)
  root.appendChild(cover)

  // ---------- 水面（WebGL 版主图；失败则回退到上面的静态 img） ----------
  // 第二个参数是陆地遮罩：由 tools/make_land_mask.py 跑出来的同尺寸灰度图，
  // 告诉着色器哪些像素绝对不许动。换主图后要重跑一次那个脚本。
  const water = createWater(INTRO_ASSETS + 'cover.jpg', INTRO_ASSETS + 'land-mask.png')
  if (water) {
    root.classList.add('has-water')
    root.appendChild(water.canvas)
    water.setWater(WATER)
  }

  // 这里原本有一层「细节场景图」，鼠标停在热区 240ms 就自动淡入、同时推近。
  // 已按要求去掉：鼠标移动只负责提示（灯点亮起、文案变成），
  // 真正切换场景一律靠点击，避免鼠标路过就跳走。
  //
  // 现在细节图回来了，但只服务于「就地看特写」这一类热区（目前是灯塔）：
  // 点击才进，进了就铺满整个画面，再点一下回岛上。
  // 它不进路由 —— 灯塔不是一个房间，是这座岛的一部分，
  // 要是为它单开一条路由，退出时就得做一次全屏黑场，反而把人从岛上拽出来。
  const detail = document.createElement('div')
  detail.className = 'intro-layer is-detail'
  const detailImg = document.createElement('img')
  detailImg.alt = ''
  detailImg.decoding = 'async'
  detail.appendChild(detailImg)
  root.appendChild(detail)

  // ---------- 灯塔特写的水面 ----------
  // 灯塔那张图有自己的海：同一条 createWater 流水线，换一组参数、
  // 换一张陆地遮罩（手标多边形，塔身/礁石/棕榈全冻住）。
  // 月光倒影不用额外做 —— 着色器的灯影层认「暖而亮、在水线以下」，
  // 金色月影正好落进这个判据，会被浪揉成一段一段地闪。
  // 画布挂在 detail 层里面：特写淡入淡出时水面跟着一起淡，
  // 特写关了就不渲染，不白烧 GPU。
  const lhWater = createWater(
    INTRO_ASSETS + 'scene-lighthouse.jpg',
    INTRO_ASSETS + 'lighthouse-mask.png'
  )
  if (lhWater) {
    lhWater.canvas.className = 'intro-water intro-water--detail'
    detail.appendChild(lhWater.canvas)
    lhWater.setWater(LIGHTHOUSE_WATER)
  }

  // ---------- 灯塔特写 · 可点光标 + 牛皮纸信纸 ----------
  // 光标是一盏长在灯塔旁边的灯，点它展开右边的牛皮纸信纸。
  // 信纸是写给访客的一封信（文案见下），不是占位 —— 岛上「允许幻想」的宣言。
  const lhCursor = document.createElement('button')
  lhCursor.type = 'button'
  lhCursor.className = 'lighthouse-cursor'
  lhCursor.setAttribute('aria-label', '打开灯塔的信')
  lhCursor.appendChild(document.createElement('span'))
  root.appendChild(lhCursor)

  const lhNote = document.createElement('div')
  lhNote.className = 'lighthouse-note'
  const paper = document.createElement('div')
  paper.className = 'paper'
  const noteTitle = document.createElement('h3')
  noteTitle.textContent = '致来到岛上的你'
  paper.appendChild(noteTitle)
  const para1 = document.createElement('p')
  para1.textContent = '鳄梨岛是一个允许幻想、并且能帮你把幻想变成现实的岛屿。'
  const para2 = document.createElement('p')
  para2.innerHTML = '如果你有任何的想法，先不用管它能否实现，都可以先来鳄梨岛<em>找找答案</em>。'
  /**
   * 这里原先有一行联系方式。
   *
   * 上线到公开站点后撤下来了：私人社交账号挂在页面上会被爬虫和搜索引擎
   * 批量采集。等确定了对外的商务渠道再放一行回来。
   */
  const sign = document.createElement('div')
  sign.className = 'sign'
  sign.textContent = '—— 鳄梨岛'
  paper.appendChild(para1)
  paper.appendChild(para2)
  paper.appendChild(sign)
  lhNote.appendChild(paper)
  root.appendChild(lhNote)

  // 光标和信纸的位置（图片坐标），只在灯塔特写打开时摆放。
  // 光标必须压在灯芯上：scene-lighthouse.jpg 里亮度前 0.02% 的 375 个像素
  // 质心在 (0.4327, 0.2035)，收紧到 lum≥252 的 54 个像素后是 (0.4299, 0.1955)，
  // 取两者之间 (0.432, 0.194)。原来写 0.545/0.320，落点周围 RGB 是 [81,131,181]
  // —— b-r 差 100，那是夜空，所以看着像悬在空气里。
  // 信纸落在灯塔右边的海面上（塔身右缘 x≈0.66 起，避开右下月影带核心）
  const LIGHT_CURSOR_POS = { x: 0.432, y: 0.194 }
  const LIGHT_NOTE_POS = { x: 0.682, y: 0.205 }
  let noteOpen = false

  function placeLighthouseUI() {
    lhCursor.style.left = `${LAYOUT.x + LIGHT_CURSOR_POS.x * LAYOUT.w}px`
    lhCursor.style.top = `${LAYOUT.y + LIGHT_CURSOR_POS.y * LAYOUT.h}px`
    lhNote.style.left = `${LAYOUT.x + LIGHT_NOTE_POS.x * LAYOUT.w}px`
    lhNote.style.top = `${LAYOUT.y + LIGHT_NOTE_POS.y * LAYOUT.h}px`
    // 信纸以左上角为锚，右缘可能超出画面；留 3% 安全边距
    const noteW = lhNote.offsetWidth || 0
    if (noteW && LAYOUT.x + LIGHT_NOTE_POS.x * LAYOUT.w + noteW > LAYOUT.x + LAYOUT.w * 0.97) {
      lhNote.style.left = `${LAYOUT.x + LAYOUT.w * 0.97 - noteW}px`
    }
  }

  function openNote() {
    noteOpen = true
    lhNote.classList.add('on')
    setGuide('点信纸以外 · 收起这封信', false)
  }
  function closeNote() {
    if (!noteOpen) return
    noteOpen = false
    lhNote.classList.remove('on')
    setGuide(DETAIL_GUIDE, false)
  }
  lhCursor.addEventListener('click', (e) => {
    e.stopPropagation()
    openNote()
  })
  // 悬停提示与首页一致：指到灯点上文案换成它的，移开换回来
  lhCursor.addEventListener('mouseenter', () => {
    if (!noteOpen) setGuide('点一下 · 读这封信', true)
  })
  lhCursor.addEventListener('mouseleave', () => {
    if (!noteOpen) setGuide(DETAIL_GUIDE, false)
  })

  // 返回按钮：只在细节图上出现。左上角，和木屋/林间那套位置、手感一致
  const backBtn = document.createElement('button')
  backBtn.type = 'button'
  backBtn.className = 'intro-back'
  const backArrow = document.createElement('i')
  backArrow.textContent = '‹'
  const backLabel = document.createElement('span')
  backLabel.textContent = '回到岛上'
  backBtn.appendChild(backArrow)
  backBtn.appendChild(backLabel)
  root.appendChild(backBtn)

  // ---------- 左上角的两行字 ----------
  // 压在画面上，不是页面的标题栏：没有底板、没有描边，只有字。
  // 主标题「鳄梨岛」放大在上，副行「乘AI，去破浪」缩小在下，
  // 两行左对齐。靠字号 + 字重 + 字距的落差做层次，不靠改颜色。
  // 外面那层负责"进场"（浮上来），里面那层负责"悬浮"（12 秒一个来回），
  // 分成两层是因为两者都在动 transform，写在一个元素上会互相盖掉。
  const hero = document.createElement('div')
  hero.className = 'intro-hero'
  const heroIn = document.createElement('div')
  heroIn.className = 'hero-in'
  const heroRule = document.createElement('span')
  heroRule.className = 'hero-rule'
  // 主标题（大字）
  const heroLine = document.createElement('h1')
  heroLine.className = 'hero-line'
  heroLine.textContent = '鳄梨岛'
  // 副行（小字）。AI 拆出来单独一个 span，只为把这两个字母的字距放松一点，
  // 让它们从中文的方块节奏里透一口气（样式见 index.html 的 .hero-ai）。
  // 逗号也单独包一层：全角逗号的字形只占左下四分之一格，右边半格是空的，
  // 再叠上字距，就在"AI"和"去"之间裂开一个洞（样式见 .hero-comma）
  const heroKicker = document.createElement('p')
  heroKicker.className = 'hero-kicker'
  heroKicker.innerHTML = '乘<span class="hero-ai">AI</span><span class="hero-comma">，</span>去破浪'
  heroIn.appendChild(heroRule)
  heroIn.appendChild(heroLine)
  heroIn.appendChild(heroKicker)
  hero.appendChild(heroIn)
  root.appendChild(hero)

  // 下一帧再加类，transition 才有起点；
  // 少一帧的话浏览器会把两个状态合到一起算，字是"啪"地出现的
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('hero-show')))

  // ---------- 热区微光点 ----------
  const dots = []
  for (const h of HOTSPOTS) {
    const dot = document.createElement('div')
    dot.className = 'intro-dot'
    dot.dataset.id = h.id
    dot.appendChild(document.createElement('span'))
    root.appendChild(dot)
    dots.push(dot)
  }

  if (new URLSearchParams(location.search).has('dots')) {
    root.classList.add('debug-dots')
  }

  // 灯点的出现与退场：鼠标一动就亮，停两秒自己收回去（见 core/reveal.js）
  const reveal = createDotReveal(root)

  // ---------- 布局：把图片坐标映射到屏幕 ----------
  let LAYOUT = { x: 0, y: 0, w: 1, h: 1 }

  /**
   * 把热区包围盒换算成屏幕上的实际命中范围。
   *
   * 场景里有个 30×16 像素的远景（帆船），严格贴合的话根本点不中。
   * 所以给一个最小可点面积：物体比它小就按中心撑开，物体比它大就原样用。
   * 木屋、灯牌都远大于这个下限，不受影响。
   */
  const MIN_HIT_W = 44
  const MIN_HIT_H = 40

  function hitRect(h) {
    const b = h.box
    return {
      cx: (b.x0 + b.x1) / 2,
      cy: (b.y0 + b.y1) / 2,
      hw: Math.max((b.x1 - b.x0) / 2, MIN_HIT_W / 2 / LAYOUT.w),
      hh: Math.max((b.y1 - b.y0) / 2, MIN_HIT_H / 2 / LAYOUT.h)
    }
  }

  function placeDots() {
    for (let i = 0; i < dots.length; i++) {
      const r = hitRect(HOTSPOTS[i])
      dots[i].style.left = `${LAYOUT.x + (r.cx - r.hw) * LAYOUT.w}px`
      dots[i].style.top = `${LAYOUT.y + (r.cy - r.hh) * LAYOUT.h}px`
      dots[i].style.width = `${r.hw * 2 * LAYOUT.w}px`
      dots[i].style.height = `${r.hh * 2 * LAYOUT.h}px`
    }
  }

  function measure() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const ar = COVER_SIZE.w / COVER_SIZE.h

    let w
    let h
    if (vw / vh > ar) {
      w = vw
      h = vw / ar
    } else {
      h = vh
      w = vh * ar
    }

    LAYOUT = { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
    cover.style.width = `${w}px`
    cover.style.height = `${h}px`
    cover.style.left = `${LAYOUT.x}px`
    cover.style.top = `${LAYOUT.y}px`
    // 细节图和主图用同一个矩形 —— 两者本来同比例，
    // 这样切换时黑边位置也一致，画面不会突然"跳"一下
    detail.style.width = `${w}px`
    detail.style.height = `${h}px`
    detail.style.left = `${LAYOUT.x}px`
    detail.style.top = `${LAYOUT.y}px`
    placeDots()

    if (water) {
      water.resize(vw, vh)
      water.setLayout(LAYOUT)
    }
    // 灯塔水面画布就在 detail 层里面，跟着 detail 的矩形走：
    // uRect 从原点起算（画布和图片完全重合，不需要屏幕偏移）
    if (lhWater) {
      lhWater.resize(LAYOUT.w, LAYOUT.h)
      lhWater.setLayout({ x: 0, y: 0, w: LAYOUT.w, h: LAYOUT.h })
    }
    placeLighthouseUI()
  }

  // ---------- 底部提示 ----------
  const IDLE_GUIDE = '移动鼠标，找到灯点，点一下进去'
  const guide = document.createElement('div')
  guide.className = 'intro-guide'
  guide.textContent = IDLE_GUIDE
  root.appendChild(guide)

  // ---------- 窄屏 / 触屏的入口按钮 ----------
  const entries = document.createElement('div')
  entries.className = 'intro-entries'
  for (const h of HOTSPOTS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = h.name
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      run(h.id)
    })
    entries.appendChild(b)
  }
  root.appendChild(entries)

  // ---------- 占位反馈 ----------
  // 目前没有调用方。灯塔原来是「点一下弹一句话」的占位，现在换成了真的打开特写，
  // 它就没活儿了。留着是因为"这个热区还没做完"这种提示以后还会用到
  const toastEl = document.createElement('div')
  toastEl.className = 'intro-toast'
  root.appendChild(toastEl)

  let toastTimer = 0
  function toast(msg) {
    toastEl.textContent = msg
    toastEl.classList.add('on')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 2400)
  }

  function run(id) {
    if (id === 'sign') return onEnter()
    if (id === 'cabin') return onCabin?.()
    if (id === 'grove') return onGrove?.()
    if (id === 'undersea') return onUndersea?.()
    if (id === 'beach') return onBeach?.()
    // 灯塔没有独立的房间，它自己的特写就是目的地。
    // 以前这里只弹一句「那句文案等你定」—— 点了像没反应，现在真的把画打开
    if (id === 'lighthouse') return openDetail(id)
  }

  // ---------- 细节图 ----------
  const DETAIL_GUIDE = '点任意处 · 回到岛上'
  let detailId = null

  function openDetail(id) {
    const h = HOTSPOTS.find((x) => x.id === id)
    if (!h?.image) return
    detailId = id
    // 先换图再淡入：反过来的话会先看到上一张（或者一块空底）闪一下
    const src = INTRO_ASSETS + h.image
    if (detailImg.getAttribute('src') !== src) detailImg.src = src
    detail.classList.add('on')
    root.classList.add('has-detail')
    root.style.cursor = 'default'
    setGuide(DETAIL_GUIDE, false)
    for (const d of dots) d.classList.remove('hot')
    hoverId = null
    // 每次进灯塔特写，信纸从收起状态开始（不残留上一轮的展开态）
    if (id === 'lighthouse') {
      noteOpen = false
      lhNote.classList.remove('on')
    }
  }

  function closeDetail() {
    if (!detailId) return
    detailId = null
    detail.classList.remove('on')
    root.classList.remove('has-detail')
    // 关特写时信纸一起收掉
    noteOpen = false
    lhNote.classList.remove('on')
    // 关掉之后鼠标多半还停在灯塔上，得把它重新点亮 ——
    // 否则那盏灯会一直黑着，看起来像坏了。
    // 注意不能只写 setHover：指针已经不在任何热区时它会被"值没变"提前 return，
    // 文案就永远停在「点任意处 · 回到岛上」了
    hoverId = null
    const back = compact ? null : hitTest(lastCX, lastCY)
    if (back) setHover(back)
    else setGuide(IDLE_GUIDE, false)
  }

  backBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    closeDetail()
  })

  // ---------- 状态 ----------
  // 只保留视差用的平滑坐标。鼠标移动不改变场景，所以这里没有"当前激活热区"
  let mx = 0.5
  let my = 0.5
  let cx = 0.5
  let cy = 0.5
  let hoverId = null
  let lastCX = 0
  let lastCY = 0

  // 调试用：?wt=8 把水面时间钉在 8 秒，方便逐帧核对
  const wtParam = new URLSearchParams(location.search).get('wt')
  const fixedTime = wtParam !== null ? parseFloat(wtParam) : null
  const startAt = performance.now()

  /**
   * 命中判定：矩形，严格贴住物体本体。
   * 用矩形不用椭圆，是因为屋子和牌子本来就是方的 ——
   * 椭圆的四个角会把旁边水面也算进去，那就做不到"必须精确指到物体"。
   */
  function hitTest(clientX, clientY) {
    const nx = (clientX - LAYOUT.x) / LAYOUT.w
    const ny = (clientY - LAYOUT.y) / LAYOUT.h
    for (const h of HOTSPOTS) {
      const r = hitRect(h)
      if (Math.abs(nx - r.cx) <= r.hw && Math.abs(ny - r.cy) <= r.hh) return h.id
    }
    return null
  }

  /** 鼠标移到热区上只做一件事：让那盏灯亮起来，并把提示换成它的文案 */
  // 文案直接换字会跳一下，所以淡出 → 换字 → 淡入
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

  function setHover(id) {
    if (id === hoverId) return
    hoverId = id
    const h = id ? HOTSPOTS.find((x) => x.id === id) : null
    setGuide(h ? h.hint : IDLE_GUIDE, !!h)
    for (const d of dots) d.classList.toggle('hot', d.dataset.id === id)
  }

  // ---------- 设备模式 ----------
  const hoverQuery = window.matchMedia('(hover: hover)')
  let compact = !hoverQuery.matches
  const applyMode = () => root.classList.toggle('is-compact', compact)
  applyMode()

  const ac = new AbortController()

  hoverQuery.addEventListener('change', (e) => {
    compact = !e.matches
    applyMode()
  }, { signal: ac.signal })

  window.addEventListener('pointermove', (e) => {
    // 首次鼠标动作才把灯点放出来（初始是一幅干净的画）；
    // 之后每动一下都续期，停住两秒它自己退回去
    reveal.wake()
    // 指针位置无论什么状态都记下来：关掉细节图后要靠它重新点亮灯塔
    lastCX = e.clientX
    lastCY = e.clientY
    if (compact) return
    // 细节图上不做视差、不认热区 —— 这一屏就是那张画
    if (detailId) return
    mx = e.clientX / window.innerWidth
    my = e.clientY / window.innerHeight
    const id = hitTest(e.clientX, e.clientY)
    // 精确热区之后，必须让用户看得出"指到了没有"，否则会以为坏了
    root.style.cursor = id ? 'pointer' : 'default'
    setHover(id)
  }, { signal: ac.signal, passive: true })

  // 触屏没有 pointermove，落指也要让灯点亮一下，否则手指下面永远是空的
  window.addEventListener('pointerdown', () => reveal.wake(), {
    signal: ac.signal,
    passive: true
  })

  // 切到别的窗口就别亮着了 —— 人会以为灯点还在等他，其实他根本不在
  window.addEventListener('blur', () => reveal.sleep(), { signal: ac.signal })

  // 只有点击才换场景。鼠标路过一律不动画面
  window.addEventListener('click', (e) => {
    // 信纸开着时：点信纸本身不动作（它自己处理），点信纸以外先收起信纸
    if (noteOpen) {
      if (e.target.closest('.lighthouse-note')) return
      closeNote()
      return
    }
    // 细节图上点任意处都退回全景（返回按钮自己已 stopPropagation）
    if (detailId) {
      closeDetail()
      return
    }
    if (compact) return
    const id = hitTest(e.clientX, e.clientY) || hitTest(lastCX, lastCY)
    if (id) run(id)
  }, { signal: ac.signal })

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    // 信纸开着时，Esc 先收信纸，再收特写
    if (noteOpen) {
      closeNote()
      return
    }
    if (detailId) {
      closeDetail()
      return
    }
    // 全景上按 Esc 没有上级可回 —— 这里是序章，本来就是最初那一屏
  }, { signal: ac.signal })

  window.addEventListener('resize', measure, { signal: ac.signal })

  // ---------- 每帧：只剩视差和呼吸，不再推近 ----------
  const update = (dt) => {
    const kp = Math.min(1, dt * 3.0)
    cx += (mx - cx) * kp
    cy += (my - cy) * kp

    const sx = (cx - 0.5) * 0.005 * LAYOUT.w
    const sy = (cy - 0.5) * 0.005 * LAYOUT.h

    if (water) {
      water.setPose(1, 0.5, 0.5, sx, sy)
      water.render(fixedTime !== null ? fixedTime : (performance.now() - startAt) / 1000)
    } else {
      // 没有 WebGL 时的降级：只做极轻微的位移，cover 那边自带呼吸动画
      cover.style.transform =
        `translate(${(cx - 0.5) * 0.5}%, ${(cy - 0.5) * 0.5}%)`
    }

    // 灯塔水面：特写开着才渲染。淡出那 680ms 里 detailId 已经是 null，
    // 画面会停在最后一帧 —— 它正在变透明，停住没人看得出来
    if (lhWater && detailId) {
      lhWater.setPose(1, 0.5, 0.5, 0, 0)
      lhWater.render(fixedTime !== null ? fixedTime : (performance.now() - startAt) / 1000)
    }
  }

  measure()

  // 从地图点「幻想灯塔」进来：一挂载就直接打开灯塔特写。
  // 放在 measure() 之后 —— openDetail 只依赖 detail 元素和 HOTSPOTS，
  // 不依赖布局，但标题/灯点要等下一帧才有 transition 起点，这里顺势排后。
  // 下一帧再开，让 cover 先完成一次渲染，特写淡入才不跟封面抢第一帧。
  if (initialDetail) {
    requestAnimationFrame(() => openDetail(initialDetail))
  }

  const dispose = () => {
    ac.abort()
    window.clearTimeout(toastTimer)
    window.clearTimeout(guideTimer)
    reveal.dispose()
    water?.dispose()
    lhWater?.dispose()
  }

  return {
    scene: null,
    camera: null,
    update,
    resize: measure,
    dispose,
    ui: [root],
    labels: null
  }
}
