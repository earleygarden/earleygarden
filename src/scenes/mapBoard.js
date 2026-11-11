import {
  MAPBOARD_ASSETS,
  MAPBOARD_SIZE,
  MAPBOARD_IMAGE,
  MAPBOARD_BACK,
  MAPBOARD_GUIDE,
  PLACES
} from '../data/mapboard.js'

/**
 * 第二幕 · 鳄梨岛地图
 *
 * 一张手绘藏宝图铺满屏幕，画上五个标了地名的地方可以点。
 * 每个地方对应一处真正的展厅（works.js 的 ROOMS）。
 *
 * 交互：
 *   · 一进来没有多余的东西，就是一张图
 *   · 指到某块卷轴上 → 那里被灯照亮（暖光从卷轴底下漫到四周的水面林地）+ 底部报出名字
 *   · 点一下就进去
 *   · 左上角 / Esc 回序章封面
 *
 * 这里刻意不用通用图片场景工厂 createImageScene：
 * 那套的逻辑是"灯点即提示"，而这张图上提示长在画里（卷轴标签），
 * 强塞白灯点反而看不清。两套交互各自成立，所以分开写。
 */

export function createMapBoard({ onSelect, onExit }) {
  const root = document.createElement('div')
  root.className = 'cabin-stage map-stage'

  const frame = document.createElement('div')
  frame.className = 'cabin-frame'
  root.appendChild(frame)

  // ---------- 地图本体 ----------
  const layer = document.createElement('div')
  layer.className = 'cabin-layer'
  const img = document.createElement('img')
  img.src = MAPBOARD_ASSETS + MAPBOARD_IMAGE
  img.alt = '鳄梨岛地图'
  img.decoding = 'async'
  img.addEventListener('load', () => layer.classList.add('on'))
  if (img.complete) layer.classList.add('on')
  layer.appendChild(img)
  frame.appendChild(layer)

  // ---------- 每个地方盖一层"灯" ----------
  // 只有一层：贴着卷轴散出去的暖光。
  // 卷轴本身够亮，往上再加亮只会把它冲成奶白，把画原来的颜色洗掉 ——
  // 所以这盏灯的可见度全部来自它照亮的那圈暗水暗林。
  // 用多层 box-shadow 而不是画一个椭圆：shadow 的衰减本来就是软的，
  // 不会有"贴了一个半透明椭圆"的边。平时完全透明，指上去才亮。
  const hotspots = []
  for (const p of PLACES) {
    const el = document.createElement('div')
    el.className = 'map-hot'
    el.dataset.id = p.id
    el.style.left = `${p.box.x0 * 100}%`
    el.style.top = `${p.box.y0 * 100}%`
    el.style.width = `${(p.box.x1 - p.box.x0) * 100}%`
    el.style.height = `${(p.box.y1 - p.box.y0) * 100}%`
    const halo = document.createElement('i')
    halo.className = 'halo'
    el.appendChild(halo)
    frame.appendChild(el)
    hotspots.push(el)
  }

  // ---------- 返回 ----------
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'cabin-back'
  const backArrow = document.createElement('span')
  backArrow.className = 'arrow'
  backArrow.textContent = '‹'
  const backLabel = document.createElement('span')
  backLabel.className = 'label'
  backLabel.textContent = MAPBOARD_BACK
  back.appendChild(backArrow)
  back.appendChild(backLabel)
  root.appendChild(back)

  // ---------- 底部提示 ----------
  const guide = document.createElement('div')
  guide.className = 'intro-guide'
  guide.textContent = MAPBOARD_GUIDE
  root.appendChild(guide)

  // ---------- 布局 ----------
  let LAYOUT = { x: 0, y: 0, w: 1, h: 1 }

  function measure() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const ar = MAPBOARD_SIZE.w / MAPBOARD_SIZE.h

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
  }

  // ---------- 命中 ----------
  function hitTest(clientX, clientY) {
    const r = frame.getBoundingClientRect()
    const nx = (clientX - r.left) / r.width
    const ny = (clientY - r.top) / r.height
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
    for (const p of PLACES) {
      const b = p.box
      if (nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1) return p
    }
    return null
  }

  // ---------- 文字：淡出 → 换字 → 淡入，不"啪"地跳 ----------
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

  let hoverId = null
  function setHover(p) {
    const id = p ? p.id : null
    if (id === hoverId) return
    hoverId = id
    setGuide(p ? `${p.name} · ${p.hint}` : MAPBOARD_GUIDE, !!p)
    for (const el of hotspots) el.classList.toggle('on', !!p && el.dataset.id === id)
  }

  // ---------- 事件 ----------
  const ac = new AbortController()

  window.addEventListener('pointermove', (e) => {
    const p = hitTest(e.clientX, e.clientY)
    root.style.cursor = p ? 'pointer' : 'default'
    setHover(p)
  }, { signal: ac.signal, passive: true })

  window.addEventListener('click', (e) => {
    const p = hitTest(e.clientX, e.clientY)
    if (p) onSelect?.(p.to)
  }, { signal: ac.signal })

  back.addEventListener('click', (e) => {
    e.stopPropagation()
    onExit?.()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onExit?.()
  }, { signal: ac.signal, passive: true })

  window.addEventListener('resize', measure, { signal: ac.signal })

  measure()

  return {
    scene: null,
    camera: null,
    update: null,
    resize: measure,
    dispose: () => {
      ac.abort()
      window.clearTimeout(guideTimer)
    },
    ui: [root],
    labels: null
  }
}
