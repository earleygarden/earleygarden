import * as THREE from 'three'

/**
 * 第一幕 · 序章（early garden）
 * 现在是纯几何 + 光点的占位氛围。
 * 后续替换点：把 shrubs 换成真实的果树/苗圃模型，或用一段视频当背景。
 */
export function createGarden({ aspect, onEnter }) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0E1A16')
  scene.fog = new THREE.FogExp2('#0E1A16', 0.03)

  const camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 200)
  camera.position.set(0, 2.4, 10)

  const disposed = []

  const groundGeo = new THREE.PlaneGeometry(160, 160)
  const groundMat = new THREE.MeshStandardMaterial({ color: '#14251E', roughness: 1 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  disposed.push(groundGeo, groundMat)

  // 浮尘光点
  const COUNT = 320
  const pos = new Float32Array(COUNT * 3)
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 48
    pos[i * 3 + 1] = Math.random() * 8 + 0.2
    pos[i * 3 + 2] = (Math.random() - 0.5) * 42 - 6
  }
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const pMat = new THREE.PointsMaterial({
    color: '#E8B77A', size: 0.075, transparent: true, opacity: 0.72,
    depthWrite: false, sizeAttenuation: true
  })
  const points = new THREE.Points(pGeo, pMat)
  scene.add(points)
  disposed.push(pGeo, pMat)

  // 远处的树影 —— 占位，后面换成真实苗木
  const shrubGeo = new THREE.CylinderGeometry(0.7, 1, 1, 7)
  const shrubMat = new THREE.MeshStandardMaterial({ color: '#1B322A', roughness: 1 })
  const shrubs = new THREE.Group()
  for (let i = 0; i < 16; i++) {
    const r = 0.6 + Math.random() * 0.9
    const h = 1 + Math.random() * 2.6
    const s = new THREE.Mesh(shrubGeo, shrubMat)
    s.scale.set(r, h, r)
    const a = Math.random() * Math.PI * 2
    const d = 9 + Math.random() * 16
    s.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d - 8)
    shrubs.add(s)
  }
  scene.add(shrubs)
  disposed.push(shrubGeo, shrubMat)

  scene.add(new THREE.HemisphereLight('#4A7A68', '#0A1310', 1.2))
  const key = new THREE.DirectionalLight('#FFE2B8', 1.8)
  key.position.set(-6, 12, 6)
  scene.add(key)

  let t = 0
  const update = (dt) => {
    t += dt
    points.rotation.y = t * 0.012
    camera.position.y = 2.4 + Math.sin(t * 0.5) * 0.07
    camera.position.x = Math.sin(t * 0.17) * 0.55
    camera.lookAt(0, 1.5, 0)
  }

  const resize = (_w, _h, newAspect) => {
    camera.aspect = newAspect
    camera.updateProjectionMatrix()
  }

  // ---- DOM ----
  const intro = document.createElement('div')
  intro.className = 'intro'
  intro.innerHTML = `
    <div class="kicker">Avocado Island</div>
    <h1>鳄梨<em>岛</em></h1>
    <p>一个只有一个人的展馆。<br/>走进来，慢慢看。</p>
  `
  const btn = document.createElement('button')
  btn.className = 'btn'
  btn.textContent = '进入展厅'
  btn.addEventListener('click', onEnter)
  intro.appendChild(btn)

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent = '地图上五个展馆'

  const dispose = () => {
    disposed.forEach((d) => d.dispose?.())
  }

  return {
    scene, camera, update, resize, dispose,
    ui: [intro, hint],
    labels: null
  }
}
