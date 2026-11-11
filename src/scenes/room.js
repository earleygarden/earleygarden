import * as THREE from 'three'

/**
 * 第三层 · 子展厅模板
 * 五个厅共用这一套房间工厂，只换墙色、主色和内容。
 * 这是"五个厅 ≈ 一个厅的工作量"的关键。
 */
export function createRoom(config, { aspect, onBack, labelLayer }) {
  const canvas = document.getElementById('stage')

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(config.wall)
  scene.fog = new THREE.Fog(config.wall, 15, 36)

  const W = 15
  const H = 5.4
  const D = 18

  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 80)
  camera.rotation.order = 'YXZ'
  camera.position.set(0, 1.7, 5.2)

  let yaw = 0
  let pitch = 0.05
  let targetYaw = 0
  let targetPitch = 0.05

  const disposed = []
  const geo = (g) => { disposed.push(g); return g }
  const mat = (m) => { disposed.push(m); return m }

  const matWall = mat(new THREE.MeshStandardMaterial({ color: config.wall, roughness: 0.96 }))
  const matFloor = mat(new THREE.MeshStandardMaterial({ color: '#CBC4B6', roughness: 1 }))
  const matCeil = mat(new THREE.MeshStandardMaterial({ color: '#EFEAE0', roughness: 1 }))

  const floor = new THREE.Mesh(geo(new THREE.PlaneGeometry(W, D)), matFloor)
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const ceil = new THREE.Mesh(geo(new THREE.PlaneGeometry(W, D)), matCeil)
  ceil.rotation.x = Math.PI / 2
  ceil.position.y = H
  scene.add(ceil)

  const back = new THREE.Mesh(geo(new THREE.PlaneGeometry(W, H)), matWall)
  back.position.set(0, H / 2, -D / 2)
  scene.add(back)

  const left = new THREE.Mesh(geo(new THREE.PlaneGeometry(D, H)), matWall)
  left.rotation.y = Math.PI / 2
  left.position.set(-W / 2, H / 2, 0)
  scene.add(left)

  const right = new THREE.Mesh(geo(new THREE.PlaneGeometry(D, H)), matWall)
  right.rotation.y = -Math.PI / 2
  right.position.set(W / 2, H / 2, 0)
  scene.add(right)

  // 光
  scene.add(new THREE.AmbientLight('#FFFFFF', 0.62))
  const key = new THREE.DirectionalLight('#FFF4E2', 1.55)
  key.position.set(2, 9, 7)
  scene.add(key)
  const fill = new THREE.DirectionalLight('#E2ECFF', 0.5)
  fill.position.set(-8, 5, 8)
  scene.add(fill)
  const warm = new THREE.PointLight(config.accent, 32, 22, 2)
  warm.position.set(0, H - 0.7, 1.5)
  scene.add(warm)

  // 地面上一条引导线，把视线往后墙推
  const runnerMat = mat(new THREE.MeshStandardMaterial({ color: config.accent, roughness: 0.9 }))
  runnerMat.transparent = true
  runnerMat.opacity = 0.16
  const runner = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.5, D - 2)), runnerMat)
  runner.rotation.x = -Math.PI / 2
  runner.position.set(0, 0.012, 0)
  scene.add(runner)

  // ---- 作品墙 ----
  const items = config.items ?? []
  const n = items.length
  const wallW = W - 2.6
  const slotW = n > 0 ? wallW / n : wallW
  const baseY = 2.45

  items.forEach((item, i) => {
    const ratio = item.ratio || 1.5
    let w = Math.min(slotW * 0.78, 3.3)
    let h = w / ratio
    const maxH = 2.85
    if (h > maxH) { h = maxH; w = h * ratio }

    const x = -wallW / 2 + slotW * (i + 0.5)

    const frame = new THREE.Mesh(
      geo(new THREE.PlaneGeometry(w + 0.15, h + 0.15)),
      mat(new THREE.MeshStandardMaterial({ color: '#2E3330', roughness: 0.75 }))
    )
    frame.position.set(x, baseY, -D / 2 + 0.02)
    scene.add(frame)

    const face = new THREE.Mesh(
      geo(new THREE.PlaneGeometry(w, h)),
      mat(new THREE.MeshStandardMaterial({ color: '#F5F2EB', roughness: 0.92 }))
    )
    face.position.set(x, baseY, -D / 2 + 0.035)
    scene.add(face)

    labelLayer.add({
      name: item.title,
      sub: item.meta,
      position: new THREE.Vector3(x, baseY - h / 2 - 0.45, -D / 2 + 0.2)
    })
  })

  // ---- 拖拽环视 ----
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
  const ac = new AbortController()
  let dragging = false
  let lastX = 0
  let lastY = 0

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
  }, { signal: ac.signal })

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    targetYaw = clamp(targetYaw - dx * 0.0032, -0.72, 0.72)
    targetPitch = clamp(targetPitch - dy * 0.0022, -0.3, 0.28)
  }, { signal: ac.signal })

  const endDrag = () => { dragging = false }
  canvas.addEventListener('pointerup', endDrag, { signal: ac.signal })
  canvas.addEventListener('pointercancel', endDrag, { signal: ac.signal })
  canvas.addEventListener('pointerleave', endDrag, { signal: ac.signal })

  const update = (dt) => {
    const k = Math.min(1, dt * 11)
    yaw += (targetYaw - yaw) * k
    pitch += (targetPitch - pitch) * k
    camera.rotation.set(pitch, yaw, 0)
  }

  const resize = (_w, _h, newAspect) => {
    camera.aspect = newAspect
    camera.updateProjectionMatrix()
  }

  // ---- DOM ----
  const corner = document.createElement('div')
  corner.className = 'corner'
  corner.innerHTML = `<button class="back">← 回地图</button>`
  corner.querySelector('.back').addEventListener('click', onBack)

  const head = document.createElement('div')
  head.className = 'room-head'
  head.innerHTML = `<h1>${config.title}</h1><p>${config.subtitle}</p>`

  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent = '按住拖动可以环视'

  const dispose = () => {
    ac.abort()
    disposed.forEach((d) => d.dispose?.())
  }

  return {
    scene, camera, update, resize, dispose,
    ui: [corner, head, hint],
    labels: labelLayer
  }
}
