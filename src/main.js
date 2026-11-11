import * as THREE from 'three'
import { createIntro } from './scenes/intro.js'
import { createImageScene } from './scenes/imageScene.js'
import { createMapBoard } from './scenes/mapBoard.js'
import { createRoom } from './scenes/room.js'
import { createLabelLayer } from './core/label.js'
import { ROOMS } from './data/works.js'
import { CABIN_ASSETS, CABIN_SIZE, CABIN_VIEWS } from './data/cabin.js'
import { UNDERSEA_ASSETS, UNDERSEA_SIZE, UNDERSEA_VIEWS } from './data/undersea.js'
import { GROVE_ASSETS, GROVE_SIZE, GROVE_VIEWS } from './data/grove.js'
import { createBeach } from './scenes/beach.js'
import { initAmbience, ambience } from './core/ambience.js'

const canvas = document.getElementById('stage')
const overlay = document.getElementById('overlay')
const fade = document.getElementById('fade')

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance'
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const labelLayer = createLabelLayer()
const clock = new THREE.Clock()

let current = null
let currentName = null
let switching = false
/** 切换途中又来的请求，等这一次走完再补上（见 mount 里的注释） */
let pending = null

const aspect = () => window.innerWidth / window.innerHeight
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 水下放映厅现在有两个入口：封面岛下那片海（garden），和藏宝图上的
 * 「海浪影院」（map）。木屋里那幅画的入口已随 2026-10-24 换图撤掉 ——
 * 新房间没有那幅画。
 * 从哪儿进去，返回就回哪儿 —— 否则从地图进去、退出来却掉进封面，
 * 人会莫名其妙。这里只记一个来源，够用了。
 */
let underseaFrom = 'map'

/**
 * 开发者沙滩同理，也有两个入口：封面沙滩上的灯点（garden），和藏宝图上的
 * 「开发者沙滩」（map）。返回键的文案跟着来源走，不然从地图进去、
 * 按钮写着"回到岛上"，人会以为按错了。
 */
let beachFrom = 'map'

/**
 * 路由 → 环境声。
 *
 * 六个场景各一床，灯塔是序章里的特写（#/garden/lighthouse），所以它虽然
 * 挂在 garden 名下，听感要单独给 —— 站在礁石边上和站在岛中央不是一回事。
 * 底噪怎么合成见 core/ambience.js，这里只管"哪儿该是哪一床"。
 */
function bedFor(name, sub) {
  if (name === 'garden') return sub === 'lighthouse' ? 'harbor' : 'sea'
  if (name === 'cabin') return 'room'
  if (name === 'grove') return 'forest'
  if (name === 'beach') return 'beach'
  if (name === 'undersea') return 'deep'
  if (name === 'map') return 'map'
  return 'room' // 三维展厅那几条老路由，按室内处理
}

function buildRoute(name, sub) {
  if (name === 'garden') {
    return createIntro({
      onEnter: () => go('map'),
      onCabin: () => go('cabin'),
      onGrove: () => go('grove'),
      onUndersea: () => {
        underseaFrom = 'garden'
        go('undersea')
      },
      onBeach: () => {
        beachFrom = 'garden'
        go('beach')
      },
      // 从地图点「幻想灯塔」进来：直接落在灯塔特写上（#/garden/lighthouse）
      initialDetail: sub === 'lighthouse' ? 'lighthouse' : null
    })
  }
  if (name === 'beach') {
    return createBeach({
      onBack: () => go(beachFrom),
      backLabel: beachFrom === 'garden' ? '回到岛上' : '回到地图'
    })
  }
  if (name === 'cabin') {
    return createImageScene({
      assets: CABIN_ASSETS,
      size: CABIN_SIZE,
      views: CABIN_VIEWS,
      initial: sub || 'wide',
      // 木屋内景只有一层全景，点窗 = 离开木屋回岛上；子场景已撤掉
      onView: (v) => go('cabin', v === 'wide' ? null : v),
      onExit: () => go('garden')
    })
  }
  if (name === 'undersea') {
    // 从封面进来写"回到岛上"，从藏宝图进来写"回到地图"
    const views = {
      ...UNDERSEA_VIEWS,
      room: {
        ...UNDERSEA_VIEWS.room,
        backLabel: underseaFrom === 'garden' ? '回到岛上' : '回到地图'
      }
    }
    return createImageScene({
      assets: UNDERSEA_ASSETS,
      size: UNDERSEA_SIZE,
      views,
      initial: sub || 'room',
      onExit: () => go(underseaFrom)
    })
  }
  if (name === 'grove') {
    return createImageScene({
      assets: GROVE_ASSETS,
      size: GROVE_SIZE,
      views: GROVE_VIEWS,
      initial: sub || 'room',
      // 耳机里一放歌，虫鸣就往后退 —— 别跟人声抢
      onPlayerPlaying: (on) => ambience.duck(on),
      // 从封面岛上的林子进来，返回就回封面
      onExit: () => go('garden')
    })
  }
  if (name === 'map') {
    // 换成了手绘藏宝图那张图；原来的等距 3D 地图已归档到 _archive/map-isometric.js
    return createMapBoard({
      // to 可能带子路由（"garden/lighthouse"），拆开交给 go()，
      // 让它落到 #/garden/lighthouse，序章一进来就打开灯塔特写
      onSelect: (to) => {
        const [n, s] = String(to).split('/')
        // 从地图点「海浪影院」/「开发者沙滩」下去，退出来要回地图，不能掉进封面
        if (n === 'undersea') underseaFrom = 'map'
        if (n === 'beach') beachFrom = 'map'
        go(n, s || null)
      },
      onExit: () => go('garden')
    })
  }
  const cfg = ROOMS[name]
  if (!cfg) return null
  return createRoom(cfg, { aspect: aspect(), onBack: () => go('map'), labelLayer })
}

function go(name, sub) {
  const next = sub ? `#/${name}/${sub}` : `#/${name}`
  if (location.hash === next) return
  location.hash = next
}

/** #/garden/lighthouse → { name: 'garden', sub: 'lighthouse' } */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'garden'
  const [name, sub] = raw.split('/')
  return { name, sub: sub || null }
}

async function mount(name, instant = false, sub = null) {
  // 切换途中又点了一次 —— 不能像以前那样直接丢掉。
  // 丢掉之后 location.hash 已经是新值，再点同一个地方时 go() 会因为
  // 「hash 没变」当场返回，hashchange 也不会再触发，画面就永久停在上一间，
  // 只能刷新页面才回得来。表现出来就是"点了没反应""画面崩在那不动了"。
  // 现在改成先记下，等这一趟转场走完再来一次（后到的赢）。
  if (switching) {
    pending = { name, instant, sub }
    return
  }

  // 同一个场景内部的层级切换：不重新挂载，交给场景自己做转场。
  // 否则每次点细节都要走一次全屏黑场，观感会碎掉。
  if (name === currentName && current?.setView) {
    current.setView(sub || current.defaultView)
    // 声音跟着层级走：从封面点进灯塔特写，海就换成拍岸
    ambience.setScene(bedFor(name, sub))
    return
  }

  switching = true
  try {
    if (!instant) {
      fade.classList.add('on')
      await wait(430)
    }

    // 换底噪放在黑场盖住屏幕之后 —— 声音不能比画面先跳
    ambience.setScene(bedFor(name, sub))

    if (current) {
      try { current.dispose?.() } catch (err) { console.warn('[dispose]', err) }
      overlay.innerHTML = ''
      labelLayer.clear()
      current = null
    }

    const next = buildRoute(name, sub) || buildRoute('garden')
    current = next
    currentName = name
    ;(next.ui || []).forEach((el) => overlay.appendChild(el))

    await wait(instant ? 0 : 60)
  } finally {
    // 无论中间哪一步抛错，黑幕都得撤掉、锁都得放开，
    // 不然一次异常就把整个展厅锁死在黑场里
    fade.classList.remove('on')
    switching = false
  }

  if (pending) {
    const p = pending
    pending = null
    mount(p.name, p.instant, p.sub)
  }
}

window.addEventListener('hashchange', () => {
  const { name, sub } = parseRoute()
  mount(name, false, sub)
})

window.addEventListener('resize', () => {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  current?.resize?.(w, h, w / h)
})

function tick() {
  requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.08)
  if (!current) return
  current.update?.(dt)
  if (current.scene && current.camera) {
    renderer.render(current.scene, current.camera)
    labelLayer.update(current.camera, window.innerWidth, window.innerHeight)
  }
}

// 环境声：挂上右上角那只小喇叭，等着第一次点击/按键再出声
// （浏览器的自动播放策略要求先有手势；setup 里只是记账，不会响）
initAmbience()

/**
 * 录屏模式（网址带 ?capture=1）：装一只假鼠标 + 一根录音的线。
 * 动态 import，正常浏览连这个文件都不下载。
 */
if (new URLSearchParams(location.search).has('capture')) {
  import('./core/capture.js').then((m) => m.installCapture())
}

const { name: initialName, sub: initialSub } = parseRoute()
mount(initialName, true, initialSub)
tick()
