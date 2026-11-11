import * as THREE from 'three'

/**
 * 三维空间里的 HTML 文字层。
 * 用真实 DOM 而不是三维字体：中文字体文件动辄几 MB，
 * 而 DOM 直接用系统字体，清晰、可选中、可点击。
 */
export function createLabelLayer() {
  const root = document.getElementById('labels')
  const items = []
  const v = new THREE.Vector3()

  return {
    add({ name, sub, position, pickable = false, onClick }) {
      const el = document.createElement('div')
      el.className = 'label' + (pickable ? ' pickable' : '')
      el.innerHTML =
        `<div class="name">${name}</div>` + (sub ? `<div class="sub">${sub}</div>` : '')
      if (onClick) {
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onClick()
        })
      }
      root.appendChild(el)
      const item = { el, position: position.clone(), visible: true }
      items.push(item)
      return item
    },

    update(camera, width, height) {
      for (const it of items) {
        v.copy(it.position).project(camera)
        const x = (v.x * 0.5 + 0.5) * width
        const y = (-v.y * 0.5 + 0.5) * height
        const on = it.visible && v.z < 1
        it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
        it.el.style.opacity = on ? '1' : '0'
        it.el.style.pointerEvents = on ? '' : 'none'
      }
    },

    clear() {
      items.length = 0
      root.innerHTML = ''
    }
  }
}
