import { LETTER_PAGES, LETTER_SIZE } from '../data/reports.js'

/**
 * 书信弹层 · 一叠三页，翻着读
 *
 *   第 1 页  媒体报道辑录（九条，每条都能点开原文）
 *   第 2 页  环球时报报道版面
 *   第 3 页  四川日报报道版面
 *
 * 三张图都是 3:4 竖版，所以它们是同一叠纸 —— 翻页时纸的宽高不变，
 * 只有内容换掉，像真的在翻一摞稿纸。
 *
 * 为什么用 <a href target="_blank"> 而不是 window.open：
 * 只有真链接才支持中键新标签、右键复制地址、悬停看状态栏 ——
 * 一张贴了透明热区的图，用户没有任何办法确认自己要跳去哪。
 *
 * 为什么热区不盖箭头、不加角标：
 * 纸面排满字，任何浮在文字上的装饰都会读到一半被打断。
 * 所以只在悬停时铺一层极淡的朱色 + 一条内描边，正文一个字都不挡。
 */
export function createReportLetter({ onOpen, onClose, onPage } = {}) {
  const el = document.createElement('div')
  el.className = 'cabin-letter'
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '媒体报道辑录')

  // 幕布：点空白处收起
  const veil = document.createElement('div')
  veil.className = 'cabin-letter-veil'
  el.appendChild(veil)

  const paper = document.createElement('div')
  paper.className = 'cabin-letter-paper'
  paper.style.aspectRatio = `${LETTER_SIZE.w} / ${LETTER_SIZE.h}`
  el.appendChild(paper)

  // ---------- 三页 ----------
  const pages = LETTER_PAGES.map((p, i) => {
    const page = document.createElement('div')
    page.className = 'cabin-letter-page'
    page.dataset.page = String(i)

    const img = document.createElement('img')
    img.className = 'cabin-letter-img'
    img.src = p.src
    img.alt = p.alt
    img.decoding = 'async'
    img.draggable = false
    page.appendChild(img)

    for (const it of p.items || []) {
      const a = document.createElement('a')
      a.className = 'cabin-letter-item'
      a.href = it.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.style.left = `${it.box.x * 100}%`
      a.style.top = `${it.box.y * 100}%`
      a.style.width = `${it.box.w * 100}%`
      a.style.height = `${it.box.h * 100}%`
      a.title = `${it.outlet}｜${it.date}\n${it.title}` +
        (it.more.length ? `\n\n另有转载：\n${it.more.join('\n')}` : '')
      a.setAttribute('aria-label', `${it.outlet} ${it.date} ${it.title}（新窗口打开原文）`)
      page.appendChild(a)
    }

    paper.appendChild(page)
    return page
  })

  // ---------- 纸下方那一条：页码 + 翻页 + 收起 ----------
  const bar = document.createElement('div')
  bar.className = 'cabin-letter-bar'

  const prev = document.createElement('button')
  prev.type = 'button'
  prev.className = 'cabin-letter-nav'
  prev.textContent = '‹ 上一页'
  bar.appendChild(prev)

  const tip = document.createElement('div')
  tip.className = 'cabin-letter-tip'
  bar.appendChild(tip)

  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'cabin-letter-nav'
  next.textContent = '下一页 ›'
  bar.appendChild(next)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'cabin-letter-close'
  close.textContent = '收起信纸'
  bar.appendChild(close)

  el.appendChild(bar)

  // ---------- 状态 ----------
  let visible = false
  let index = 0

  function paint() {
    pages.forEach((p, i) => {
      p.classList.toggle('on', i === index)
      // 翻过去的那几页往左错开一点，回来时才从右边滑回来
      p.classList.toggle('is-past', i < index)
    })
    const page = LETTER_PAGES[index]
    const n = LETTER_PAGES.length
    prev.disabled = index === 0
    next.disabled = index === n - 1
    tip.textContent = index === 0
      ? `第 ${index + 1} / ${n} 页 · ${page.label} · 点条目打开原文`
      : `第 ${index + 1} / ${n} 页 · ${page.label}`
    onPage?.(index)
  }

  function go(n) {
    const clamped = Math.max(0, Math.min(LETTER_PAGES.length - 1, n))
    if (clamped === index) return
    index = clamped
    paint()
  }

  function show() {
    if (visible) return
    visible = true
    index = 0
    paint()
    el.classList.add('on')
    el.setAttribute('aria-hidden', 'false')
    onOpen?.()
  }

  function hide() {
    if (!visible) return
    visible = false
    el.classList.remove('on')
    el.setAttribute('aria-hidden', 'true')
    onClose?.()
  }

  /**
   * 整个弹层吃掉点击，别让它冒到 window 上去触发"再翻一页"。
   *
   * **纸面本身不翻页。** 之前是"点纸面往后翻"，看着省事，实际很糟：
   * 纸面铺满整屏，读者想仔细看某一行、或者在找可点的地方，随手一点就被翻走了 ——
   * 翻页变成一个不受控的副作用。现在只有三种方式翻：底部按钮、←/→ 方向键、
   * 以及（第 1 页）点条目直接开原文。点哪儿都翻这件事取消。
   */
  el.addEventListener('click', (e) => {
    e.stopPropagation()
  })

  prev.addEventListener('click', () => go(index - 1))
  next.addEventListener('click', () => go(index + 1))
  veil.addEventListener('click', hide)
  close.addEventListener('click', hide)

  /**
   * 左右方向键也能翻。
   * 监听必须挂在 window 上 —— `.cabin-letter` 是个 div，不可聚焦，
   * 挂在它身上的 keydown 永远收不到（前一版就是这么哑的）。
   * 只在弹层开着时响应，别去抢页面别处的键盘。
   */
  const ac = new AbortController()
  window.addEventListener('keydown', (e) => {
    if (!visible) return
    if (e.key === 'ArrowRight') { e.stopPropagation(); go(index + 1) }
    else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(index - 1) }
  }, { signal: ac.signal })

  return {
    el,
    open: show,
    close: hide,
    isOpen: () => visible,
    /** 此刻停在第几页（验收用） */
    page: () => index,
    go,
    dispose: () => {
      ac.abort()
      hide()
    }
  }
}
