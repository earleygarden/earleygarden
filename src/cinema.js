import { ASSETS } from './data/base.js'
import { UNDERSEA_SIZE, UNDERSEA_VIEWS, CINEMA_ASSETS } from './data/undersea.js'
import { createAqua } from './core/aqua.js'

/**
 * 鳄梨岛海浪影院 · 单独发给客户的那一页
 *
 * 一屏到底，不滚。整幅是一个"镜头"：
 *
 *   全景  ── room.jpg 按 contain 落进视口（完整，不裁），上面盖一层和站内
 *            同一套 shader 的水光（core/aqua.js）
 *   点分类 ── 镜头推到幕前：幕正好铺成视口宽度，片单就打在这块幕上
 *   「‹ 影院」── 镜头退回来，房间重新完整
 *
 * ── 推镜是怎么做的（这段不看会写错）─────────────────────────────
 *
 * 不能靠 CSS transform 放大 canvas：那等于把 780px 的渲染结果拉成 1000+，
 * 焦散那张细网先糊成一团 —— 站内第一版水光就是栽在这上面。
 * 也不能把 canvas 盒子调成长方形硬拉：uv 铺满整块，图会跟着变形。
 *
 * 所以给 shader 加了一个采样窗口（uWindow），推镜 = **换窗口**：
 *   全景  窗口 (0,0,1,1)           canvas 盒子 = 图在视口里的 contain 矩形
 *   推近  窗口 (u0,v0,uw,uh)       canvas 盒子 = 一条盖住幕的横向带子
 * 带子的比例必须等于窗口那块图的比例，否则会拉扁。这一条由
 * "幕的宽高比 = 屏幕矩形的宽高比"自动满足（见 measure()）。
 * 盒子、窗口、屏幕矩形三样都由同一个 tween 推，谁也不会跑到前面去。
 *
 * ── 2026-11-24 重建说明 ─────────────────────────────────────────
 * 工作区被系统清空过两次（C 盘满），这份是按线上构建产物 + 设计记录重写的，
 * 对外行为与线上一致。另外补上一样之前丢掉的东西：
 * 每张卡片片名下显示她写的 `sub`（一句话介绍）——
 * 站内一直有，独立页之前只在播放时的标题栏里出现，客户在片单上读不到。
 */

const IMG = UNDERSEA_SIZE
const room = UNDERSEA_VIEWS.room
const BOX = room.cinema.box
const GROUPS = room.cinema.groups
const BASE = room.cinema.base || CINEMA_ASSETS

// 幕的宽高比（图里那块幕的实际比例，约 2.20:1）
const SCREEN_AR = ((BOX.x1 - BOX.x0) * IMG.w) / ((BOX.y1 - BOX.y0) * IMG.h)

const $ = (id) => document.getElementById(id)
const catsEl = $('cats')
const screenEl = $('screen')
const stripEl = $('strip')
const sTitleEl = $('sTitle')
const sCountEl = $('sCount')
const backEl = $('back')
const titleEl = $('title')
const footEl = $('foot')
const playerEl = $('player')
const videoEl = $('video')
const ptitleEl = $('ptitle')
const pbarEl = $('pbar')
const pbackEl = $('pback')

const aqua = createAqua(`${ASSETS}undersea/${room.image}`,
  room.aqua?.mask ? `${ASSETS}undersea/${room.aqua.mask}` : null)
if (aqua) {
  aqua.canvas.id = 'aqua'
  $('aqua')?.replaceWith(aqua.canvas)
}
const canvas = $('aqua')

const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const DUR = REDUCED ? 0 : 640
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const mix = (a, b, p) => a + (b - a) * p

/* ------------------------------------------------------------------ 几何 */

let fullRect = { x: 0, y: 0, w: 1, h: 1 }      // 全景：图在视口里的 contain 矩形
let screenRect = { x: 0, y: 0, w: 1, h: 1 }    // 推近后：幕在视口里占的矩形
let bandRect = { x: 0, y: 0, w: 1, h: 1 }      // 推近后：canvas 盒子（盖住幕的横带）
let winZoom = { x: 0, y: 0, w: 1, h: 1 }       // 推近后：shader 采样窗口
const winFull = { x: 0, y: 0, w: 1, h: 1 }

const view = { rect: { ...fullRect }, win: { ...winFull } }

function measure() {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const s = Math.min(vw / IMG.w, vh / IMG.h)
  fullRect = { x: (vw - IMG.w * s) / 2, y: (vh - IMG.h * s) / 2, w: IMG.w * s, h: IMG.h * s }

  // 幕要多大：屏宽减一点边，同时给底部四个按钮和顶部返回键留够地方
  const catsTop = catsEl.getBoundingClientRect().top || vh - 96
  const top = 58
  const bottom = catsTop - 12
  const availH = Math.max(96, bottom - top)
  const w = Math.min(vw - 28, availH * SCREEN_AR * 0.94, 980)
  const h = w / SCREEN_AR
  screenRect = { x: (vw - w) / 2, y: top + Math.max(0, (availH - h) / 2), w, h }

  // 带子：把幕上下各留一点房间，做成一条横向的"取景框"
  const padY = Math.round(h * 0.62)
  const bandTop = Math.max(0, screenRect.y - padY)
  const bandBottom = Math.min(vh, screenRect.y + h + padY)
  bandRect = { x: 0, y: bandTop, w: vw, h: Math.max(24, bandBottom - bandTop) }

  // 反解窗口：让幕的四条边正好落在 screenRect 的四条边上
  const uw = ((BOX.x1 - BOX.x0) * bandRect.w) / screenRect.w
  const uh = ((BOX.y1 - BOX.y0) * bandRect.h) / screenRect.h
  winZoom = {
    x: BOX.x0 - ((screenRect.x - bandRect.x) * uw) / bandRect.w,
    y: BOX.y0 - ((screenRect.y - bandRect.y) * uh) / bandRect.h,
    w: uw,
    h: uh
  }

  // 片单壳贴在幕的矩形上
  screenEl.style.left = `${screenRect.x.toFixed(1)}px`
  screenEl.style.top = `${screenRect.y.toFixed(1)}px`
  screenEl.style.width = `${screenRect.w.toFixed(1)}px`
  screenEl.style.height = `${screenRect.h.toFixed(1)}px`

  placeCaptions(catsTop)
}

/**
 * 片名和页脚放哪儿。
 * 手机 390×844 上图只有 219 高，上下全是黑边 —— 片名要是还按"离底 96"
 * 钉在底部，跟头图之间会空出 110px，整页散掉。所以只要图下面还有余地，
 * 就把「片名 + 页脚」当成一组，居中放进图与分类按钮之间那条空带。
 */
function placeCaptions(catsTop) {
  const imgBottom = fullRect.y + fullRect.h
  const band = catsTop - 14 - imgBottom
  if (band < 150 || window.innerHeight <= 560) {
    titleEl.style.top = ''
    titleEl.style.bottom = ''
    footEl.style.top = ''
    footEl.style.bottom = ''
    return
  }
  const th = titleEl.offsetHeight
  const fh = footEl.offsetHeight
  const top = imgBottom + Math.max(18, (band - th - 12 - fh) / 2)
  titleEl.style.top = `${Math.round(top)}px`
  titleEl.style.bottom = 'auto'
  footEl.style.top = `${Math.round(top + th + 12)}px`
  footEl.style.bottom = 'auto'
}

/* ------------------------------------------------------------------ 画 */

let lastW = 0
let lastH = 0
// 水光时钟（秒）。resize 会重建 WebGL 绘制缓冲，缓冲一重建就被清空，
// 要等下一帧 render 才又有画面 —— 中间那一帧就是肉眼看到的"屏闪"。
// 所以 resize 之后必须**当场**补画一次，这条要留着，别再删。
let aquaTime = 0

function paint(r, force) {
  canvas.style.left = `${r.x.toFixed(1)}px`
  canvas.style.top = `${r.y.toFixed(1)}px`
  canvas.style.width = `${r.w.toFixed(1)}px`
  canvas.style.height = `${r.h.toFixed(1)}px`
  if (!aqua) return
  // 推镜时盒子一直在长，缓冲却只在跨过阈值时重建一次。阈值太大，
  // 中间几帧是"小缓冲拉满大盒子"，图会被纵向抻长；太小又重建得太勤。
  // 16px 是试出来的：一次 640ms 的推镜重建 4~5 次，抻长不超过 5%，手机上也不会重建太勤。
  if (force || Math.abs(r.w - lastW) > 16 || Math.abs(r.h - lastH) > 16) {
    aqua.resize(r.w, r.h)
    lastW = r.w
    lastH = r.h
    // 关键：重建缓冲后立刻补一帧，别等下一个 rAF
    aqua.render(aquaTime)
  }
}

function paintWindow(w) {
  aqua?.setWindow(w.x, w.y, w.w, w.h)
}

/* ------------------------------------------------------------------ 推镜 */

let zoomed = false
let anim = null

function tweenTo(target) {
  anim = { from: { rect: { ...view.rect }, win: { ...view.win } }, to: target, t0: performance.now() }
  if (DUR === 0) step(performance.now())
  else requestAnimationFrame(step)
}

function step(now) {
  if (!anim) return
  const p = Math.min(1, (now - anim.t0) / DUR)
  const e = easeOut(p)
  const { from, to } = anim

  view.rect = {
    x: mix(from.rect.x, to.rect.x, e),
    y: mix(from.rect.y, to.rect.y, e),
    w: mix(from.rect.w, to.rect.w, e),
    h: mix(from.rect.h, to.rect.h, e)
  }
  view.win = {
    x: mix(from.win.x, to.win.x, e),
    y: mix(from.win.y, to.win.y, e),
    w: mix(from.win.w, to.win.w, e),
    h: mix(from.win.h, to.win.h, e)
  }

  paint(view.rect, p === 1)
  paintWindow(view.win)

  // 片单在镜头快到位时才亮起来，早了会看到字在飘
  if (p > 0.62) {
    screenEl.classList.toggle('on', zoomed)
    document.body.classList.toggle('to-screen', zoomed)
  }

  if (p < 1) requestAnimationFrame(step)
  else anim = null
}

function toZoom() {
  if (zoomed) return
  zoomed = true
  tweenTo({ rect: { ...bandRect }, win: { ...winZoom } })
}

function toFull() {
  if (!zoomed) return
  zoomed = false
  screenEl.classList.remove('on')
  document.body.classList.remove('to-screen')
  closePlayer()
  tweenTo({ rect: { ...fullRect }, win: { ...winFull } })
}

/* ------------------------------------------------------------------ 片单 */

function filmCard(item) {
  const btn = document.createElement('button')
  btn.className = 'film'
  btn.type = 'button'
  btn.setAttribute('aria-label', item.title)

  const shot = document.createElement('span')
  shot.className = 'film-shot'
  const img = document.createElement('img')
  img.alt = ''
  img.loading = 'lazy'
  img.decoding = 'async'
  img.src = BASE + item.poster
  img.addEventListener('load', () => img.classList.add('on'))
  shot.appendChild(img)

  const name = document.createElement('span')
  name.className = 'film-name'
  name.textContent = item.title

  // 横排卡片：封面在左，片名和说明在右边这一列。
  // 竖排（图在上、字在下）的时候卡片只有 132px 宽，二十多个字的说明
  // 被压成一条缝，看得到半句 —— 版式的问题，把字挪到右边就有地方了。
  const body = document.createElement('span')
  body.className = 'film-body'
  body.appendChild(name)

  // 她给每部片子写过一句话介绍（数据里的 sub）。站内一直显示，
  // 独立页之前只在播放时的标题栏里出现 —— 客户在片单上读不到，等于白写。
  if (item.sub) {
    const sub = document.createElement('span')
    sub.className = 'film-sub'
    sub.textContent = item.sub
    body.appendChild(sub)
  }

  btn.append(shot, body)

  btn.addEventListener('click', () => play(item))
  return btn
}

function showGroup(group) {
  sTitleEl.textContent = group.label
  sCountEl.textContent = `${group.items.length} 部`
  stripEl.replaceChildren(...group.items.map(filmCard))
  requestAnimationFrame(() => {
    // 手机是竖排（看 scrollHeight），桌面是横排（看 scrollWidth）。
    // 两个方向都放得下才居中；溢出的时候居中会让上下两头都被切掉，
    // 所以溢出就一律从头排。
    const fits = stripEl.scrollWidth <= stripEl.clientWidth + 1 &&
                 stripEl.scrollHeight <= stripEl.clientHeight + 1
    stripEl.classList.toggle('is-center', fits)
    // 只有一部片子时桌面会把这一张铺满整条幕（964px），说明排成五十个字一行，
    // 眼睛要横着扫很远 —— 收在 620 里居中。
    stripEl.classList.toggle('solo', group.items.length === 1)
    // 手机上"宣传片"有三部、一屏只坐得下两部，第三部在下面。底下压一道渐隐，
    // 让人知道还能往上推 —— 否则那一栏看着就像只有两部片子。
    stripEl.classList.toggle('more', stripEl.scrollHeight > stripEl.clientHeight + 4)
    stripEl.scrollTop = 0
    stripEl.scrollLeft = 0
  })
}

const cats = GROUPS.map((g) => {
  const b = document.createElement('button')
  b.className = 'cat'
  b.type = 'button'
  const nm = document.createElement('span')
  nm.className = 'cat-name'
  nm.textContent = g.label
  const n = document.createElement('span')
  n.className = 'cat-n'
  n.textContent = `${g.items.length} 部`
  b.append(nm, n)
  b.addEventListener('click', () => {
    for (const c of cats) c.classList.toggle('on', c === b)
    showGroup(g)
    toZoom()
  })
  return b
})
catsEl.replaceChildren(...cats)

/* ------------------------------------------------------------------ 放映 */

let hideTimer = 0

function wakeBar() {
  pbarEl.classList.remove('hide')
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => pbarEl.classList.add('hide'), 2600)
}

function play(item) {
  ptitleEl.textContent = `《${item.title}》${item.sub ? ` · ${item.sub}` : ''}`
  videoEl.poster = BASE + item.poster
  videoEl.src = BASE + item.film
  playerEl.classList.add('on')
  document.title = `${item.title} · 鳄梨岛海浪影院`
  wakeBar()
  // 用户手势之外被拒是正常的，系统控件会留在那儿
  videoEl.play().catch(() => {})
}

function closePlayer() {
  if (!playerEl.classList.contains('on')) return
  playerEl.classList.remove('on')
  videoEl.pause()
  videoEl.removeAttribute('src')
  videoEl.load()
  document.title = '鳄梨岛海浪影院 · 易小楠作品'
}

pbackEl.addEventListener('click', closePlayer)
playerEl.addEventListener('pointermove', wakeBar)
playerEl.addEventListener('pointerdown', wakeBar)

/* ------------------------------------------------------------------ 事件 */

backEl.addEventListener('click', toFull)
screenEl.addEventListener('click', (e) => {
  if (e.target === screenEl) toFull()
})

let resizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const wasZoomed = zoomed
    anim = null
    measure()
    view.rect = { ...(wasZoomed ? bandRect : fullRect) }
    view.win = { ...(wasZoomed ? winZoom : winFull) }
    paint(view.rect, true)
    paintWindow(view.win)
  }, 120)
})

/* ------------------------------------------------------------------ 起来 */

measure()
view.rect = { ...fullRect }
view.win = { ...winFull }
paint(view.rect, true)
paintWindow(view.win)

// 水光的时钟从 0 起，别用 performance.now() 的绝对值 —— 那已经好几秒了，
// 一上来光带就被推到很远的位置
const start = performance.now()
function frame(now) {
  aquaTime = (now - start) / 1000
  aqua?.render(aquaTime)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
