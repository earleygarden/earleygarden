/**
 * 通用「图片场景」—— 木屋内景、海底放映厅，以及后面几个展厅都用这一套。
 *
 * 一个场景 = 若干张全屏图（视图）+ 视图之间的跳转。每个视图上可以放灯点，
 * 灯点既是"这里能点"的提示，也是点击目标。
 *
 * 交互约定（和用户反复调出来的，别改回去）：
 *   · 一进来是一幅干净的画，鼠标有动作后灯点才淡入
 *   · 鼠标移动只做提示：亮灯 + 换底部文案，绝不自动换场景
 *   · 换场景只认点击
 *   · 整屏图（信纸 / 窗）只有灯点周围才算命中，点别处不响应
 *   · 左上角按钮 / Esc 走 parent 逐级退回；没有 parent 就交给 onExit
 *   · 同场景内切视图不重挂载，靠图层交叉淡入 + 推近动画，避免黑场
 *
 * 视图可以声明三种"能力"，场景负责把它们搭在图层上：
 *   film  黑幕上的一块银幕      （水下放映厅）
 *   aqua  玻璃外面会动的水      （水下放映厅）
 *   tracks 一副耳机的播放器     （林间）
 *
 * 两个刻意的取舍：
 *
 * 1. 不做鼠标视差。
 *    视差要么把整层平移（边缘露底），要么给图层加缩放（热区和画面就偏了）。
 *    这里的灯点是贴着窗框、桌沿、门框放上去的，一偏就会"点框子没反应"，
 *    那比画面不动难受得多。"活"的感觉交给转场时的推近动画。
 *
 * 2. 坐标是「图片坐标」。
 *    布局由 JS 按图片原始比例算出实际尺寸（LAYOUT），图层宽高就等于 LAYOUT，
 *    所以 图片坐标 × LAYOUT = 屏幕坐标，没有 object-fit 的暗裁切，
 *    任何窗口比例下灯点都不会漂。
 */

import { createAqua } from '../core/aqua.js'
import { createFoliage } from '../core/foliage.js'
import { createAudioPlayer } from '../core/player.js'
import { createDotReveal } from '../core/reveal.js'
import { createReportLetter } from './reportLetter.js'

export function createImageScene({
  assets,
  size,
  views,
  initial,
  onExit,
  onView,
  onNav,
  onPlayerPlaying
}) {
  const viewIds = Object.keys(views)
  const firstView = viewIds[0]

  const root = document.createElement('div')
  root.className = 'cabin-stage'

  const frame = document.createElement('div')
  frame.className = 'cabin-frame'
  root.appendChild(frame)

  const vignette = document.createElement('div')
  vignette.className = 'cabin-vignette'
  root.appendChild(vignette)

  // ---------- 返回 ----------
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'cabin-back'
  const backArrow = document.createElement('span')
  backArrow.className = 'arrow'
  backArrow.textContent = '‹'
  const backLabel = document.createElement('span')
  backLabel.className = 'label'
  back.appendChild(backArrow)
  back.appendChild(backLabel)
  root.appendChild(back)

  // ---------- 提示条（外观沿用序章） ----------
  const guide = document.createElement('div')
  guide.className = 'intro-guide'
  root.appendChild(guide)

  const layers = new Map()
  const dotEls = new Map()
  const hotById = new Map()
  const aquaByView = new Map()
  const foliageByView = new Map()
  let activeId = null
  let LAYOUT = { x: 0, y: 0, w: 1, h: 1 }

  /**
   * 信纸弹层：只有声明了 letter 的热区才会用到，所以按需建。
   * 建出来就挂在 root 上（不是图层里）—— 它是压在整幕之上的东西，
   * 不该跟着图层的交叉淡入一起淡、也不该被下一次 setView 带走。
   */
  let letter = null
  function ensureLetter() {
    if (letter) return letter
    letter = createReportLetter({
      onOpen: () => {
        setGuide('信纸上的每一条都能点 · 在新窗口打开原文', false)
        root.style.cursor = 'default'
        // 信纸开着的时候灯点没有意义，收掉
        root.classList.remove('has-pointer')
      },
      onClose: () => {
        // 收起之后把底部文案和光标按当前指针位置重算一遍，
        // 否则会停在"信纸上的每一条都能点"那句话上不动
        refreshHover()
      }
    })
    root.appendChild(letter.el)
    return letter
  }

  /**
   * 播放器：哪个视图声明了 tracks，这个场景就有一台。
   * 现在只有林间用得上（耳机里那几首歌），但它不认识"林间"，
   * 只认识"这层图上有几首曲子要放"。
   */
  const trackView = Object.values(views).find((v) => v.tracks?.length)
  const player = trackView
    ? createAudioPlayer({
        assets,
        tracks: trackView.tracks,
        // 放歌时耳机上那盏灯呼吸得慢一点、亮一点 —— 像里面在响
        onPlaying: (on) => {
          for (const [id, el] of dotEls) {
            if (hotById.get(id)?.to === 'PLAYER') el.classList.toggle('is-playing', on)
          }
          // 歌一响，虫鸣让开（main.js 接给环境声）
          onPlayerPlaying?.(on)
        }
      })
    : null
  if (player) root.appendChild(player.el)

  /**
   * 片单：哪个视图声明了 cinema，这个场景就有一块这样的幕。
   * 现在只有水下放映厅用得上，但它同样不认识"放映厅"这个名字。
   */
  let cinema = null

  // ---------- 预加载，切换时才不会白闪 ----------
  for (const v of Object.values(views)) {
    const im = new Image()
    im.decoding = 'async'
    im.src = assets + v.image
  }

  // 调试用：?wt=2 把水的时间钉在 2 秒，方便逐帧比对（首页海水同款开关）
  const wtParam = new URLSearchParams(location.search).get('wt')
  const fixedTime = wtParam !== null ? parseFloat(wtParam) : null
  const startAt = performance.now()

  /**
   * 幕 · 片单
   *
   * 黑幕上不是"一部片子"，是整个片单。默认放着排片，点一部才开始放，
   * 放完/中途按「片单」退出来还能换下一部。
   *
   * 两件事是刻意的：
   *
   * 1. 不用原生 <video controls> 当唯一界面，而是在它上面压一个「片单」按钮。
   *    控制条（播放、进度、全屏）交给浏览器 —— 那套东西在每个系统上都对；
   *    但"换一部"它没有，只能自己加。
   *
   * 2. 幕会随窗口缩放，里面的字必须跟着缩。
   *    这块幕只占画面宽度的 34%，1440 宽时是 493px，1280 宽时只剩 438px。
   *    用固定 px 的话，小窗口下字会撑破卡片。所以量一次幕宽，把 1% 幕宽
   *    写进 --u，里面所有尺寸都写成 calc(var(--u) * n)。
   */
  function buildCinema(c) {
    const base = c.base || ''
    const slot = document.createElement('div')
    slot.className = 'cinema-slot'
    slot.style.left = `${c.box.x0 * 100}%`
    slot.style.top = `${c.box.y0 * 100}%`
    slot.style.width = `${(c.box.x1 - c.box.x0) * 100}%`
    slot.style.height = `${(c.box.y1 - c.box.y0) * 100}%`

    // ---------- 片单 ----------
    // 这块不是"幕上的一个面板"，而是"打在幕上的投影"：
    // 容器背景透明，让底下 room.jpg 的黑幕自己透上来，两者是同一块黑。
    // 原来给过一层 #04080a 的底 + 一圈外发光，结果是银幕上像贴了块发光的屏，
    // 四角直角、边界分明，整体感就散了。

    // 现在到第几层：'cats' 四类 / 'list' 某一类的片单
    let level = 'cats'
    // 当前打开的是哪一类
    let activeCat = null

    const board = document.createElement('div')
    board.className = 'cs-board'

    const head = document.createElement('div')
    head.className = 'cs-head'
    const headTitle = document.createElement('span')
    headTitle.className = 'cs-title'
    headTitle.textContent = '鳄梨岛原创影院'
    // 两侧的细线由 CSS 的 ::before / ::after 画，居中才像片头
    head.appendChild(headTitle)
    board.appendChild(head)

    // 「回分类」：只在片单层出现。
    // 绝对定位、不参与 head 的居中计算 —— head 是"两侧拉线、标题居中"的构图，
    // 往里面塞一个按钮会把标题推歪。
    // 标题本身也能点（见下面的 click），极小幕把这块胶囊藏掉以后还有退路。
    const up = document.createElement('button')
    up.type = 'button'
    up.className = 'cs-up'
    up.innerHTML = '<i>‹</i>分类'
    up.addEventListener('click', (e) => {
      e.stopPropagation()
      toCats()
    })
    board.appendChild(up)
    headTitle.addEventListener('click', (e) => {
      if (level !== 'list') return
      e.stopPropagation()
      toCats()
    })

    // ---------- 两层：分类 / 片单 ----------
    // 两层都建好放在同一个 body 里，靠 .is-l2 交叉淡入淡出。
    // 不重建 DOM：卡片上的监听器、已经加载好的封面都不动，
    // 来回切换也就没有白闪。
    const body = document.createElement('div')
    body.className = 'cs-body'

    const cats = document.createElement('div')
    cats.className = 'cs-page cs-cats'

    const cols = document.createElement('div')
    cols.className = 'cs-page cs-cols'
    const colEls = []
    for (let i = 0; i < 2; i++) {
      const col = document.createElement('div')
      col.className = 'cs-col'
      cols.appendChild(col)
      colEls.push(col)
    }

    /** 分类 → 这一类的卡片，点击时按两列重新摊开 */
    const cardsByGroup = new Map()
    const cards = []

    for (const g of c.groups) {
      // ---- 第一层的分类格 ----
      const cat = document.createElement('button')
      cat.type = 'button'
      cat.className = 'cs-cat'
      cat.dataset.id = g.label
      const n = g.items.length
      cat.dataset.hint = `${g.label} · 共 ${n} 部 · 点一下看这一类`

      // 代表封面取这一类里第一张有的；一张都没有就留空胶片格
      const cover = g.items.find((it) => it.poster)
      const catThumb = document.createElement('span')
      catThumb.className = 'cs-thumb'
      if (cover) {
        const im = document.createElement('img')
        im.src = base + cover.poster
        im.alt = ''
        im.decoding = 'async'
        catThumb.appendChild(im)
      } else {
        catThumb.classList.add('is-blank')
        const mark = document.createElement('i')
        mark.textContent = '待补'
        catThumb.appendChild(mark)
      }

      const catTxt = document.createElement('span')
      catTxt.className = 'cs-txt'
      const catName = document.createElement('span')
      catName.className = 'cs-name'
      catName.textContent = g.label
      const catCount = document.createElement('span')
      catCount.className = 'cs-count'
      catCount.textContent = `${n} 部`
      catTxt.appendChild(catName)
      catTxt.appendChild(catCount)

      cat.appendChild(catThumb)
      cat.appendChild(catTxt)
      cat.addEventListener('click', (e) => {
        e.stopPropagation()
        openCat(g)
      })
      cats.appendChild(cat)

      // ---- 第二层的片子 ----
      const list = []
      for (const item of g.items) {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'cs-card'
        card.dataset.id = item.id
        // 悬停时底部提示条念这一句
        card.dataset.hint = `《${item.title}》 · ${item.film ? '点一下开始放' : '片源还没放进来'}`
        if (!item.film) card.classList.add('is-pending')

        const thumb = document.createElement('span')
        thumb.className = 'cs-thumb'
        if (item.poster) {
          const im = document.createElement('img')
          im.src = base + item.poster
          im.alt = ''
          im.loading = 'lazy'
          im.decoding = 'async'
          thumb.appendChild(im)
        } else {
          // 没有封面的那一条（片源也还没到）：留一块空白的胶片格，
          // 不拿别的片的截图冒充
          thumb.classList.add('is-blank')
          const mark = document.createElement('i')
          mark.textContent = '待补'
          thumb.appendChild(mark)
        }

        const txt = document.createElement('span')
        txt.className = 'cs-txt'
        const name = document.createElement('span')
        name.className = 'cs-name'
        name.textContent = `《${item.title}》`
        txt.appendChild(name)
        if (item.sub) {
          const sub = document.createElement('span')
          sub.className = 'cs-sub'
          sub.textContent = item.sub
          txt.appendChild(sub)
        }

        card.appendChild(thumb)
        card.appendChild(txt)
        card.addEventListener('click', (e) => {
          e.stopPropagation()
          play(item)
        })
        list.push(card)
        cards.push(card)
      }
      cardsByGroup.set(g, list)
    }

    body.appendChild(cats)
    body.appendChild(cols)
    board.appendChild(body)

    // 先把所有卡片塞进（此刻还看不见的）第一列。
    // 不这么做的话，第二次层是空的，封面要等点进分类才开始下载，
    // 点进去的一瞬间是几个空框。openCat 会把它们重新摊到两列里。
    for (const card of cards) colEls[0].appendChild(card)

    // 提示条落在画面最底下，像银幕上的一行小字。
    // 原先是挂在标题栏右边的，和"鳄梨岛原创影院"并排 —— 那是网页顶栏的写法
    const foot = document.createElement('div')
    foot.className = 'cs-foot'
    board.appendChild(foot)

    slot.appendChild(board)

    // ---------- 放映 ----------
    const stage = document.createElement('div')
    stage.className = 'cs-stage'

    const video = document.createElement('video')
    video.className = 'cs-video'
    video.controls = true
    video.playsInline = true
    video.preload = 'metadata'
    video.disablePictureInPicture = true
    video.setAttribute('controlslist', 'nodownload noremoteplayback')
    stage.appendChild(video)

    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'cs-back'
    back.innerHTML = '<i>‹</i>片单'
    back.addEventListener('click', (e) => {
      e.stopPropagation()
      toBoard()
    })
    stage.appendChild(back)

    // 片源缺失 / 还没到：幕上放一块提示牌，不假装能播
    const plate = document.createElement('div')
    plate.className = 'cs-plate'
    const plateTitle = document.createElement('span')
    plateTitle.className = 'cs-plate-title'
    const plateNote = document.createElement('span')
    plateNote.className = 'cs-plate-note'
    plate.appendChild(plateTitle)
    plate.appendChild(plateNote)
    stage.appendChild(plate)

    slot.appendChild(stage)

    let playing = false
    let current = null

    // 先把第一层摆好：四类、标题"鳄梨岛原创影院"
    setLevel('cats')

    const api = {
      el: slot,

      /** 幕宽变了，重算比例尺。1% 幕宽 = --u */
      scale(layout) {
        const w = (c.box.x1 - c.box.x0) * layout.w

        // 位置尺寸**永远**是幕框里的那一块。
        // 以前窄屏时会清空内联值、让 CSS 把它接到画面底部当浮层，
        // 结果就是"幕外面另开一块屏"。现在排片只可能待在幕里。
        slot.style.left = `${c.box.x0 * 100}%`
        slot.style.top = `${c.box.y0 * 100}%`
        slot.style.width = `${(c.box.x1 - c.box.x0) * 100}%`
        slot.style.height = `${(c.box.y1 - c.box.y0) * 100}%`

        // 两档降级，都只改"里面怎么排"，不改它长在哪儿。
        // 400 以下两列压扁（去副题、缩图，仍是一屏放完）；
        // 200 以下连缩略图都放不下，只留片名。
        slot.classList.toggle('is-compact', w < 400)
        slot.classList.toggle('is-tiny', w < 200)

        slot.style.setProperty('--u', `${(w / 100).toFixed(3)}px`)
      },

      get playing() { return playing },

      /** 底部提示条在放映时说什么 */
      get hint() {
        return current ? `正在放《${current.title}》 · 点左上角的「片单」换一部` : null
      },

      /**
       * Esc 用：一层一层往上退。
       * 播放 → 该分类的片单 → 四类 → 返回 false（这时才轮到场景退出房间）。
       * 返回值是"我吃掉了这次 Esc"，让调用方决定要不要 goBack()。
       */
      up() {
        if (playing) { toBoard(); return true }
        if (level === 'list') { toCats(); return true }
        return false
      },

      /** Esc 用：在放片就先退回片单，不直接退出房间 */
      toBoard,

      dispose() {
        try { video.pause() } catch { /* 已经没了 */ }
        video.removeAttribute('src')
        try { video.load() } catch { /* 忽略 */ }
      }
    }

    /**
     * 切换层。
     *
     * 三层可见的差别只给三样东西：标题、左上角那颗「分类」、底部那句话。
     * 内容本身靠 .is-l2 做交叉淡入 —— 不用 display:none 硬切，
     * 硬切在幕上像"换了一页 PPT"，淡入淡出才像"镜头推到下一格"。
     */
    function setLevel(next) {
      level = next
      const onList = next === 'list'
      board.classList.toggle('is-l2', onList)
      up.classList.toggle('on', onList)

      headTitle.textContent = onList && activeCat ? activeCat.label : '鳄梨岛原创影院'
      headTitle.classList.toggle('is-link', onList)

      foot.textContent = onList
        ? '点片名开始放 · 左上角「分类」回上一层'
        : '四类 · 点一个进去看片单'
    }

    /**
     * 进某一类。
     *
     * 一个分类的片子摊成两列：左列 ceil(n/2)，右列剩下的。
     * 为什么不是一整列：幕是 2.2:1 的扁长条，四部堆成一列右半就空了；
     * 也不用 CSS column-count —— 那东西在换列时会把一条卡片劈成两半。
     * n=1 时左列一部、右列空着，读起来仍然是"左对齐的片单"。
     */
    function openCat(g) {
      activeCat = g
      const list = cardsByGroup.get(g) || []
      colEls[0].replaceChildren()
      colEls[1].replaceChildren()
      const half = Math.ceil(list.length / 2)
      list.forEach((card, i) => colEls[i < half ? 0 : 1].appendChild(card))
      // 只有一部的分类（电影、短片）在一整块幕上只剩左上角一小块，
      // 看着像没加载完。给它单开一种摆法：居中、放大，当"主打"来放
      cols.classList.toggle('is-one', list.length === 1)
      setLevel('list')
    }

    /** 回四类。正在放片就先退回片单，别一跳跳两层 */
    function toCats() {
      if (playing) { toBoard(); return }
      setLevel('cats')
      syncGuide()
    }

    function play(item) {
      current = item
      playing = true
      slot.classList.add('is-playing')

      if (!item.film) {
        video.removeAttribute('src')
        video.classList.add('is-off')
        plate.classList.add('on')
        plateTitle.textContent = `《${item.title}》`
        plateNote.textContent = '片源还没放进来 · 排片上先占一格'
        syncGuide()
        return
      }

      video.classList.remove('is-off')
      plate.classList.remove('on')
      video.poster = item.poster ? base + item.poster : ''
      if (video.getAttribute('src') !== base + item.film) {
        video.src = base + item.film
      }
      // 点卡片本身就是一次手势，浏览器允许自动播放
      video.play().catch((err) => {
        console.warn('[cinema] 播不出来', err?.name || err)
      })
      syncGuide()
    }

    function toBoard() {
      if (!playing) return
      playing = false
      current = null
      slot.classList.remove('is-playing')
      try { video.pause() } catch { /* 忽略 */ }
      // 退回它所在的那一类，而不是一路退回四类首页 ——
      // 看完一部想的是"这一类里还有没有别的"，不是"我重新选一遍分类"
      setLevel('list')
      syncGuide()
    }

    video.addEventListener('error', () => {
      if (!playing || !current?.film) return
      video.classList.add('is-off')
      plate.classList.add('on')
      plateTitle.textContent = `《${current.title}》`
      plateNote.textContent = '片源读不出来 · 检查一下 assets/cinema/films 里那个文件'
    })

    function syncGuide() {
      // 放映时底部那条提示要换成"正在放什么"，不然它还在说"点一部开始放"
      setGuide(playing ? api.hint : views[activeId].guide, false)
      // 播放态和片单态共用一块幕，鼠标形状要跟着换回来
      root.style.cursor = 'default'
    }

    return api
  }

  /** 灯点该落在哪：优先 dotAt，否则取包围盒中心 */
  function dotPos(h) {
    if (h.dotAt) return h.dotAt
    const b = h.box
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]
  }

  /** 整屏图的命中半径（CSS 像素）。给足余量，但别大到"随便点都中" */
  const FULL_HIT_R = 46

  function ensureLayer(id) {
    if (layers.has(id)) return layers.get(id)

    const v = views[id]
    const el = document.createElement('div')
    el.className = 'cabin-layer'
    el.dataset.view = id

    const img = document.createElement('img')
    // 这一层只有「场景底图」这一张该被 canvas 顶掉。加个明确的类，
    // 免得 has-aqua / has-foliage 的选择器顺手把层里别的图（片单封面）也藏了
    img.className = 'scene-base'
    img.src = assets + v.image
    img.alt = v.title
    img.decoding = 'async'
    el.appendChild(img)

    // 玻璃外面的水：这一层用 WebGL 画，静态图留着当降级。
    // 必须紧跟在图后面、灯点前面 —— canvas 是不透明的，放在灯点之后会把灯挡掉
    if (v.aqua) {
      const a = createAqua(assets + v.image, assets + v.aqua.mask)
      if (a) {
        el.classList.add('has-aqua')
        el.appendChild(a.canvas)
        // 画布铺满这一层，尺寸就得按**图层**算，不能用视口 —— 两者比例
        // 不同时着色器的采样坐标会跑到图外（详见 core/aqua.js 片头）
        const cur = computeLayout()
        a.resize(cur.w, cur.h)
        aquaByView.set(id, a)
      }
    }

    // 树叶的风：同一套办法，只是换了一张遮罩和一个更慢的场。
    // 两层不会出现在同一张图上，但都放在灯点之前
    if (v.foliage) {
      const f = createFoliage(assets + v.image, assets + v.foliage.mask)
      if (f) {
        el.classList.add('has-foliage')
        el.appendChild(f.canvas)
        const cur = computeLayout()
        f.resize(cur.w, cur.h)
        foliageByView.set(id, f)
      }
    }

    // 灯点：每一处能点的地方都放一盏。它是主要提示，不是装饰
    for (const h of v.hotspots || []) {
      const [du, dv] = dotPos(h)
      const d = document.createElement('div')
      d.className = 'cabin-dot'
      d.dataset.id = h.id
      d.style.left = `${du * 100}%`
      d.style.top = `${dv * 100}%`
      for (const cls of ['halo', 'ring', 'core']) {
        const i = document.createElement('i')
        i.className = cls
        d.appendChild(i)
      }
      el.appendChild(d)
      dotEls.set(h.id, d)
      hotById.set(h.id, h)
    }

    // 幕上的片单：盖在水和灯点之上（它可以接指针，卡片要能点）
    if (v.cinema) {
      cinema = buildCinema(v.cinema)
      el.appendChild(cinema.el)
      cinema.scale(LAYOUT)
    }

    frame.appendChild(el)
    layers.set(id, el)
    return el
  }

  // ---------- 布局 ----------
  /**
   * 画面（图片）在视口里的矩形。纯计算，不带副作用 ——
   * 建图层的时候要先知道图层多大才能建画布，那时还没进 measure。
   */
  function computeLayout() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const ar = size.w / size.h

    let w
    let h
    if (vw / vh > ar) {
      h = vh
      w = vh * ar
    } else {
      w = vw
      h = vw / ar
    }

    return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
  }

  function measure() {
    LAYOUT = computeLayout()
    frame.style.left = `${LAYOUT.x}px`
    frame.style.top = `${LAYOUT.y}px`
    frame.style.width = `${LAYOUT.w}px`
    frame.style.height = `${LAYOUT.h}px`

    // 画布跟着图层走，不是跟着视口走
    for (const a of aquaByView.values()) a.resize(LAYOUT.w, LAYOUT.h)
    for (const f of foliageByView.values()) f.resize(LAYOUT.w, LAYOUT.h)
    // 幕里的字按幕宽缩放，窗口一变就得重算
    cinema?.scale(LAYOUT)
  }

  // ---------- 命中判定 ----------
  /**
   * 整屏图（信纸 / 窗）只有灯点周围一圈算数。
   * 之前是"点屏幕任何地方都跳"，观感很生硬 —— 没有目标感，
   * 手一滑就把画面推走了。收窄到灯点之后，点击是"点亮那盏灯"。
   */
  function hitTest(clientX, clientY) {
    const v = views[activeId]
    if (!v) return null
    const r = frame.getBoundingClientRect()
    const nx = (clientX - r.left) / r.width
    const ny = (clientY - r.top) / r.height
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null

    for (const h of v.hotspots || []) {
      if (h.full) {
        const [du, dv] = dotPos(h)
        const dx = (nx - du) * r.width
        const dy = (ny - dv) * r.height
        if (Math.hypot(dx, dy) <= FULL_HIT_R) return h
        continue
      }
      const b = h.box
      if (nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1) return h
    }
    return null
  }

  // ---------- 界面文字 ----------
  // 提示文案直接换字会"啪"地跳一下，所以先淡出、换完再淡入
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
    }, 150)
  }

  function paint() {
    const v = views[activeId]
    backLabel.textContent = v.backLabel
    setGuide(v.guide, false)
    for (const d of dotEls.values()) d.classList.remove('hot')
  }

  function setView(to, report = true) {
    if (!views[to] || to === activeId) return
    const next = ensureLayer(to)

    for (const [id, el] of layers) {
      if (id !== to) el.classList.remove('on', 'settle')
    }
    // 挪到最上层：否则交叉淡入时新画面会被旧画面压住，中间闪一下暗
    frame.appendChild(next)

    next.classList.remove('on', 'settle')
    void next.offsetWidth        // 强制重排，让动画能重新触发
    next.classList.add('on', 'settle')

    activeId = to
    paint()
    root.style.cursor = 'default'
    if (report) onView?.(to)
  }

  function goBack() {
    const v = views[activeId]
    if (!v) return
    if (v.parent) setView(v.parent)
    else onExit?.()
  }

  back.addEventListener('click', (e) => {
    e.stopPropagation()
    goBack()
  })

  // ---------- 一次性视频（翻页） ----------
  /**
   * 热区写 video 的情形：这一下不是换视图，而是在当前画面之上播一条短片，
   * 播完**停在尾帧**不动 —— 尾帧就是"翻过去了"的那一页。
   *
   * 几个刻意的选择：
   *   · 不 loop、不重播。重播会把"翻过去"这个动作变成鬼畜循环，反而看不懂。
   *     所以第二次点同一处默认什么都不发生；但如果热区带 letter（翻到的那一页上
   *     夹着可点的东西），第二下改成"再把信纸递上来"，不留一个亮着却点不动的灯。
   *   · 播完补一次 seek 到 duration 前 1 帧。某些浏览器在 ended 那一刻会把
   *     画面清成首帧或黑帧，主动 seek 一下能保证尾帧真的留在屏幕上。
   *   · 视频铺在灯点之上，所以翻页时灯点自然被盖住，不用额外去隐藏它。
   */
  const clips = new Map()

  function playClip(h) {
    // 已经翻过去了：带 letter 的热区再点一下就是"进入下一页"——把信纸递上来。
    // 这一下是读者自己点的，不是自动弹的（自动弹会把刚定格的那一页直接盖掉）
    if (clips.has(h.id)) {
      if (h.letter && clips.get(h.id).dataset.done === '1') ensureLetter().open()
      return
    }
    const layer = layers.get(activeId)
    if (!layer) return

    const v = document.createElement('video')
    v.className = 'cabin-video'
    v.src = assets + h.video
    v.muted = true
    v.defaultMuted = true
    v.setAttribute('muted', '')
    v.playsInline = true
    v.setAttribute('playsinline', '')
    v.preload = 'auto'
    clips.set(h.id, v)
    layer.appendChild(v)

    // 视频没解码出第一帧之前先别淡入，否则会看到一下透明到有画面的跳
    const show = () => v.classList.add('on')
    v.addEventListener('loadeddata', show, { once: true })
    v.addEventListener('canplay', show, { once: true })

    v.addEventListener('ended', () => {
      v.pause()
      const dur = v.duration || 0
      if (dur > 0.1) {
        try { v.currentTime = Math.max(0, dur - 1 / 30) } catch (err) { /* 忽略 */ }
      }
      v.dataset.done = '1'
      setGuide(h.hintDone || '翻过去了 · 返回上一页', false)
      /**
       * 定格之后**不自动把信纸推上来**。
       *
       * 尾帧就是那一页本身（照片 + 介绍），它值得被看一眼 ——
       * 立刻盖一张纸上去，读者看到的是"画面闪了一下就换了"，不是"翻到这一页"。
       * 所以这里只把灯点重新浮到视频之上，让人看见"这页还能再点"，
       * 真正的下一屏等他自己点。
       *
       * 点一下 = 进入下一页（信纸）；再点才逐页往下翻，见 reportLetter.js。
       */
      const dot = dotEls.get(h.id)
      if (dot) v.parentElement?.appendChild(dot)
    }, { once: true })

    v.currentTime = 0
    const p = v.play()
    if (p) p.catch(() => { /* 自动播放被拦：留着这张静帧，用户再点一次通常就能播 */ })
    setGuide(h.hintPlaying || '正在翻页 ·', false)
  }

  // ---------- 事件 ----------
  const ac = new AbortController()

  // 灯点的出现与退场：鼠标一动就亮，停两秒自己收回去
  const reveal = createDotReveal(root)

  // 光标停在哪。播放器开关之后要靠它把提示重新算一遍 ——
  // 点一下并不会产生 pointermove，不重算的话那句话会停在旧的
  let pointer = null

  function refreshHover() {
    // 信纸开着：底下的灯点、文案、光标一律不动。
    // 不然指针扫过信纸时，底部会跟着背后的书页热区跳文案
    if (letter?.isOpen()) return
    const h = pointer ? hitTest(pointer.x, pointer.y) : null
    const v = views[activeId]
    // 幕上的分类格和卡片自己带一句话，念它就行（片单不是灯点，没有 hint 字段）
    const card = pointer?.target?.closest?.('.cs-card, .cs-cat')

    if (card) {
      // 幕上的卡片自己带一句话，念它就行（片单不是灯点，没有 hint 字段）
      root.style.cursor = 'pointer'
      setGuide(card.dataset.hint, true)
    } else if (cinema?.playing) {
      // 正放着片子：底部提示说"正在放什么"，不然它还在讲"点一部开始放"
      root.style.cursor = 'default'
      setGuide(cinema.hint, false)
    } else {
      root.style.cursor = h ? 'pointer' : 'default'
      /**
       * 三条文案，按状态挑：
       *   已经翻完的那条短片 → hintDone（"再点一下这一页"），
       *                          不然会退回"再点一下 · 翻一页"，可那一下其实不翻页
       *   播放器开着         → hintOpen
       *   其余               → hint
       */
      const doneTail = h?.video && clips.get(h.id)?.dataset.done === '1'
      const hint = h
        ? (doneTail
          ? (h.hintDone || h.hint)
          : (h.hintOpen && player?.isOpen ? h.hintOpen : h.hint))
        : v.guide
      setGuide(hint, !!h)
    }
    // 只有被指到的那盏灯亮起来，其余的继续安静呼吸
    for (const [id, d] of dotEls) d.classList.toggle('hot', !!h && id === h.id && !card)
  }

  window.addEventListener('pointermove', (e) => {
    // 首次鼠标动作才让灯点浮出来，进来先是一幅干净的画面；
    // 之后每动一下都续期，停两秒它自己退回去（见 core/reveal.js）
    reveal.wake()
    pointer = { x: e.clientX, y: e.clientY, target: e.target }
    refreshHover()
  }, { signal: ac.signal, passive: true })

  // 触屏没有 pointermove，落指时就把灯点显示出来
  window.addEventListener('pointerdown', (e) => {
    reveal.wake()
    pointer = { x: e.clientX, y: e.clientY, target: e.target }
  }, { signal: ac.signal, passive: true })

  // 切到别的窗口就别亮着了
  window.addEventListener('blur', () => reveal.sleep(), { signal: ac.signal })

  window.addEventListener('click', (e) => {
    // 信纸开着的时候，点击由信纸自己处理（条目跳转 / 点空白收起）。
    // 没有这一句，点纸面空白处会同时触发背后书页热区，又翻一次页
    if (letter?.isOpen()) return
    const h = hitTest(e.clientX, e.clientY)
    if (!h) return
    // 带 video 的热区：点一下在原图上盖一条视频，播完停在尾帧（见 playClip）
    if (h.video) {
      playClip(h)
      return
    }
    if (!h.to) return
    // EXIT = 离开本场景；GO:xxx = 去另一个路由；
    // PLAYER = 叫出播放器；其余是本场景内的视图 id
    if (h.to === 'EXIT') onExit?.()
    // 再点一次耳机上那盏灯就收起来 —— 除了右上角那个 ×，还得多一条退路
    else if (h.to === 'PLAYER') {
      if (player?.isOpen) player.close()
      else player?.open()
      refreshHover()
    } else if (h.to.startsWith('GO:')) onNav?.(h.to.slice(3))
    else setView(h.to)
  }, { signal: ac.signal })

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    // 信纸开着：Esc 先收信纸，别一下把人从木屋踢出去
    if (letter?.isOpen()) {
      letter.close()
      return
    }
    // 播放器开着的时候，Esc 先收面板 —— 不能一下就退出林间
    if (player?.isOpen) {
      player.close()
      refreshHover()
      return
    }
    // 正在放片子：第一下 Esc 回到片单，不把人直接踢出房间；
    // 已经在片单层：再一下回四类；四类还是不退，最后才退出房间。
    // 层数变了以后，"一下 Esc 就出房间"这个行为要跟着变，否则
    // 观众在片单里按 Esc 会连房间一起丢掉
    if (cinema?.up()) {
      refreshHover()
      return
    }
    goBack()
  }, { signal: ac.signal })

  window.addEventListener('resize', measure, { signal: ac.signal })

  // 先建图层再量尺寸：水那层是在 ensureLayer 里创建的，
  // 量早了它还是 300×150 的默认画布，会糊成一小块
  setView(initial && views[initial] ? initial : firstView, false)
  measure()

  // 水每帧重画一次；只画当前视图那一层。播放器的音量与进度也在这里推
  let lastFrame = performance.now()
  const update = () => {
    const now = performance.now()
    const dt = Math.min((now - lastFrame) / 1000, 0.1)
    lastFrame = now

    const t = fixedTime !== null ? fixedTime : (now - startAt) / 1000
    aquaByView.get(activeId)?.render(t)
    foliageByView.get(activeId)?.render(t)
    player?.tick(dt)
  }

  return {
    scene: null,
    camera: null,
    update,
    resize: measure,
    dispose: () => {
      ac.abort()
      window.clearTimeout(guideTimer)
      reveal.dispose()
      letter?.dispose()
      // 离开林间就闭嘴：人已经走了，歌还在唱会很怪；顺带停掉下载
      player?.dispose()
      // 片子同理，走的时候得停，不然下一次进来它还在后台拉着那几十兆
      cinema?.dispose()
      for (const a of aquaByView.values()) a.dispose()
      aquaByView.clear()
      for (const f of foliageByView.values()) f.dispose()
      foliageByView.clear()
      // 翻页视频走的时候也得停，不然它还在后台占着解码器
      for (const v of clips.values()) {
        try {
          v.pause()
          v.removeAttribute('src')
          v.load()
        } catch (err) { /* 忽略 */ }
      }
      clips.clear()
    },
    ui: [root],
    labels: null,
    defaultView: firstView,
    setView: (v) => setView(views[v] ? v : firstView, false)
  }
}
