import * as THREE from 'three'

/**
 * 首页水面
 *
 * 做法：把主图当纹理，沿「以岛为圆心」的径向做一圈圈外扩的行波，
 * 用位移 + 明暗让画布上已经画好的涟漪真的往外走。
 *
 * 五条硬要求（都是被实际效果打回来才定下来的，别再改回去）：
 *
 * 1. 海平面必须是一条持平的线。地平线以上完全静止 —— 那里一抖，
 *    整个画面就"浮"起来了，比海面不动还糟。
 * 2. 岸上不许动。木屋、沙滩、礁石、椰树全部冻结。
 *    靠 uMask 这张离屏遮罩来确定岸的形状，着色器里不做任何颜色猜测 ——
 *    背光椰叶和深海水的色值完全一致，猜不出来（见下面 landness 处的说明）。
 *    遮罩由 tools/make_land_mask.py 生成，换主图要重跑。
 * 3. 能量从紧贴岸边的那一圈开始最强，一圈一圈往外递减，远海趋于静止。
 * 4. 波纹是同心圆往外推（相位 dist*k - t*ω），不是整体抖动。
 * 5. 灯光倒影要单独一层。它"绷"在水面上，会被波纹切断、拉长、忽明忽暗；
 *    只跟着水的位移走就等于冻在画里，那是最假的地方。
 *
 * 位移量必须很小（千分之几）。油画笔触一拉就糊，质感全毁，
 * 「看见在动」主要靠明暗，不靠位移。
 */

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */`
uniform sampler2D uTex;
uniform sampler2D uMask;   // 离屏算好的陆地遮罩（0 = 水，1 = 岸）
uniform float uHasMask;    // 遮罩没加载完时退回矩形兜底
uniform vec2 uRes;
uniform vec4 uRect;        // 主图在屏幕上的位置与尺寸（像素）
uniform vec2 uOrigin;      // 推近原点（图片坐标）
uniform float uScale;      // 推近倍数
uniform vec2 uShift;       // 视差位移（像素）
uniform float uTime;

uniform vec2 uCenter;      // 同心圈圆心（图片坐标）
uniform vec2 uIsland;      // 岛体保护矩形的半宽/半高（以图片高度为单位，x 已按宽高比折算）
uniform float uHorizon;    // 地平线 y，以上完全静止
uniform float uReach;      // 能量从这里开始向外衰减
uniform float uFalloff;    // 衰减快慢
uniform float uWaterline;  // 沙滩下沿 y，灯影只认它以下的水面

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/**
 * 注意：这里刻意没有"按颜色判断哪块是岸"的代码。
 * 试过，不成立 —— 背光椰叶的 b - max(r,g) 中位数是 +0.26，
 * 深海水是 +0.27，两者数值上一模一样，任何阈值都分不开。
 * 岸的位置只能由形状决定，所以改用离屏算好的 uMask（见 tools/make_land_mask.py）。
 */

void main() {
  // ── 屏幕 → 图片坐标 ──
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 uv = (px - uRect.xy) / uRect.zw;
  uv = (uv - uOrigin) / uScale + uOrigin;   // 悬停推近
  uv -= uShift / uRect.zw;                  // 鼠标视差

  // ── 以岛为原点 ──
  // asp 把横向拉齐到「图片高度」这个统一单位，否则同心圈会被拉成椭圆
  vec2 asp = vec2(uRect.z / uRect.w, 1.0);
  vec2 rel = (uv - uCenter) * asp;
  float dist = length(rel);
  float t = uTime;

  // ══ 三条遮罩，任一为 0 的地方完全静止 ══════════════════════

  // ① 天空：地平线以上画的是什么就是什么，一个像素都不许动
  float sky = smoothstep(uHorizon, uHorizon + 0.09, uv.y);

  // ② 岸上：读离屏算好的遮罩。
  //    过渡带 0.06→0.50 是刻意「不对称」的：遮罩被高斯柔化过，
  //    边缘处的值正好是 0.5，所以从 0.5 开始就已经完全冻结 ——
  //    冻区一口气盖到几何边界之外一点点，陆地一侧没有任何过渡。
  //    如果反过来写成 0.28→0.72，细椰叶会整片停在半冻区，
  //    叶子就会自己"呼吸"，那正是"连树都在动"的来源。
  float land = uHasMask > 0.5 ? texture2D(uMask, uv).r : 0.0;

  // 矩形兜底：遮罩没加载完 / 换图还没重算时，至少保证岛体核心区不动
  vec2 q = abs(rel) / uIsland;
  float rectShore = smoothstep(1.0, 1.32, max(q.x, q.y));

  // 两者取小 —— 任一判定为岸，就按岸处理
  float shore = min(rectShore, 1.0 - smoothstep(0.06, 0.50, land));

  // ③ 远近：紧贴岸边最强，一圈一圈往外递减
  float reach = exp(-max(dist - uReach, 0.0) * uFalloff);

  float energy = sky * shore * reach;

  // ══ 同心行波 ══════════════════════════════════════════════
  // 相位 dist*k - t*ω：同相位的点随 t 增大而 r 增大，就是一圈圈往外扩。
  // 四种波长叠加，波长越短跑得越慢（真实水波的频散），
  // 中频那层刻意对准画布上原生涟漪的间距，让每一圈看得出在单独往外走。
  float swell = sin(dist * 26.0 - t * 0.83)
              + 0.42 * sin(dist * 44.0 - t * 1.13)
              + 0.34 * sin(dist * 70.0 - t * 1.43)
              + 0.11 * sin(dist * 112.0 - t * 1.80);

  vec2 dir = normalize(rel + vec2(1e-5)) / asp;   // 径向单位向量（图片坐标）

  // 细碎扰动：防止波纹机械得像贴图在平移，幅度极小，不构成抖动
  vec2 nPos = uv * 8.0;
  float n1 = noise2(nPos + vec2(t * 0.030, -t * 0.020));
  float n2 = noise2(nPos * 2.3 + vec2(-t * 0.020, t * 0.030));

  // ══ 灯光倒影 ══════════════════════════════════════════════
  // 岛的灯是暖橘、海水是冷蓝，R-B 的差就能把灯影干净地挑出来，
  // 不用额外传遮罩图，换主图也不失效。
  vec3 seed = texture2D(uTex, uv).rgb;
  float seedLum = dot(seed, vec3(0.299, 0.587, 0.114));
  float warm = seed.r - seed.b;

  // 只认沙滩下沿以下的水面：水线以上那些暖色是窗、被照亮的枝叶和沙子，
  // 它们属于岸，必须一动不动
  float below = smoothstep(uWaterline, uWaterline + 0.034, uv.y);
  float lamp = smoothstep(0.10, 0.32, warm)
             * smoothstep(0.26, 0.55, seedLum)
             * below * sky * shore;

  // 倒影的碎片：高频同心圈，把光带切成一段一段
  float shard = sin(dist * 318.0 - t * 2.90) * 0.55
              + sin(dist * 131.0 - t * 1.62) * 0.45;
  float chip = sin(dist * 540.0 - t * 4.10);

  // ══ 采样 ══════════════════════════════════════════════════
  vec2 offset = dir * (swell * 0.0026 * energy)
              // 倒影单独走垂直方向：光带是被横向波纹上下揉搓、拉开又挤扁的
              + vec2(0.0, 1.0) * ((shard * 0.0120 + chip * 0.0034) * lamp)
              + (vec2(n1, n2) - 0.5) * 0.0009 * energy;

  vec3 col = texture2D(uTex, uv + offset).rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));

  // 水面明暗 —— 「看见一圈一圈在动」的主力
  float shade = swell * 0.078 + (n1 - 0.5) * 0.045;
  col *= 1.0 + shade * energy;

  // 倒影明暗：只压不提。
  // 金色本来就贴着满值，一乘就会先把暖色比例削掉、爆成惨白；
  // 真实水面也是这样，水波只能把灯光按下去，偶尔甩出一两个亮点。
  float flick = shard * 0.42 + chip * 0.16 + swell * 0.14
              + (0.5 + 0.5 * sin(t * 1.25 + dist * 9.0)) * 0.14;
  col *= max(1.0 + flick * (flick > 0.0 ? 0.10 : 1.0) * lamp, 0.0);
  col += pow(max(shard * 0.7 + chip * 0.3, 0.0), 2.4) * 0.16 * lamp
       * vec3(1.0, 0.74, 0.40);
  col += lamp * (0.028 + 0.032 * (0.5 + 0.5 * sin(t * 2.1 + dist * 18.0)))
       * vec3(1.0, 0.70, 0.36);

  // 冷白波光只加在普通水面；灯影区掐掉，否则金色中间会插进一道道惨白斜纹
  float crest = smoothstep(0.42, 1.20, swell);
  col += crest * smoothstep(0.38, 0.78, lum) * 0.13 * energy
       * (1.0 - smoothstep(0.12, 0.60, lamp)) * vec3(0.88, 0.94, 1.0);

  // 视差把画面推出边界时，用深海底色兜住
  float inside = step(0.0, uv.x) * step(uv.x, 1.0)
               * step(0.0, uv.y) * step(uv.y, 1.0);
  col = mix(vec3(0.031, 0.094, 0.169), col, inside);

  gl_FragColor = vec4(col, 1.0);
}
`

export function createWater(url, maskUrl) {
  const canvas = document.createElement('canvas')
  canvas.className = 'intro-water'

  let renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    })
  } catch (err) {
    return null
  }
  if (!renderer || !renderer.getContext()) return null

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x08182b, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const placeholder = new THREE.DataTexture(
    new Uint8Array([8, 24, 43, 255]), 1, 1, THREE.RGBAFormat
  )
  placeholder.needsUpdate = true

  const uniforms = {
    uTex: { value: placeholder },
    uMask: { value: placeholder },
    uHasMask: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uScale: { value: 1 },
    uShift: { value: new THREE.Vector2(0, 0) },
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.533, 0.453) },
    uIsland: { value: new THREE.Vector2(0.134, 0.080) },
    uHorizon: { value: 0.100 },
    uReach: { value: 0.20 },
    uFalloff: { value: 4.5 },
    uWaterline: { value: 0.522 }
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false
  })

  const geometry = new THREE.PlaneGeometry(2, 2)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)

  let ready = false
  let texture = null
  let maskTexture = null

  const loader = new THREE.TextureLoader()

  /** 主图和遮罩必须用完全一样的采样设置，否则两者会错位 */
  function configure(t) {
    // 不做 sRGB→线性 的自动转换：自定义着色器的输出不会自动编码回去，
    // 一转就会整体变暗。这里让采样值就是原图的 sRGB 值，直接输出。
    t.colorSpace = THREE.NoColorSpace
    t.flipY = false
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.generateMipmaps = false
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    return t
  }

  loader.load(
    url,
    (tex) => {
      uniforms.uTex.value = configure(tex)
      texture = tex
      ready = true
    },
    undefined,
    () => { /* 加载失败就保持深海底色，不崩 */ }
  )

  // 陆地遮罩：拿不到就退回矩形兜底，画面不会坏，只是树冠会漏
  if (maskUrl) {
    loader.load(
      maskUrl,
      (tex) => {
        uniforms.uMask.value = configure(tex)
        uniforms.uHasMask.value = 1
        maskTexture = tex
      },
      undefined,
      () => { /* 保持 uHasMask = 0 */ }
    )
  }

  function resize(vw, vh) {
    renderer.setSize(vw, vh, false)
    uniforms.uRes.value.set(vw, vh)
  }

  function setLayout(rect) {
    uniforms.uRect.value.set(rect.x, rect.y, rect.w, rect.h)
  }

  function setPose(scale, originX, originY, shiftX, shiftY) {
    uniforms.uScale.value = scale
    uniforms.uOrigin.value.set(originX, originY)
    uniforms.uShift.value.set(shiftX, shiftY)
  }

  /**
   * 换主图后需要重标的全部水面参数，都放在 data/intro.js 的 WATER 里。
   * 之前这些写死在 shader 常量里，换一张图就得进 GPU 代码改，很容易漏。
   */
  function setWater(w) {
    uniforms.uCenter.value.set(w.center[0], w.center[1])
    uniforms.uIsland.value.set(w.island[0], w.island[1])
    uniforms.uHorizon.value = w.horizon
    uniforms.uReach.value = w.reach
    uniforms.uFalloff.value = w.falloff
    uniforms.uWaterline.value = w.waterline
  }

  function render(time) {
    uniforms.uTime.value = time
    renderer.render(scene, camera)
  }

  function dispose() {
    texture?.dispose()
    maskTexture?.dispose()
    placeholder.dispose()
    geometry.dispose()
    material.dispose()
    renderer.dispose()
  }

  return {
    canvas,
    resize,
    setLayout,
    setPose,
    setWater,
    render,
    dispose,
    isReady: () => ready
  }
}
