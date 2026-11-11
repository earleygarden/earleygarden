import * as THREE from 'three'

/**
 * 林间 · 树叶的微微摆动
 *
 * 这幅画里除了沙发、耳机、树干，其余都是叶子。要让这张静图"活"一点，
 * 唯一的办法是让叶子自己动 —— 整个画面平移或缩放是另一回事，那是镜头动，不是风。
 *
 * 三条从水下那层（core/aqua.js）身上学来的规矩，这里同样成立：
 *
 * 1. 位移必须极小。位移一大，油画笔触被拉开，叶子边缘会拖出一条糊边。
 *    现在 x 向半幅约 3px（1440 显示）、4.2px（1920 原图），y 向更小 ——
 *    树在微风里就是横向摆。实测这条幅度只让叶子区的清晰度掉 2.5%
 *    （tools/check_leaf_sharpness.mjs：拉普拉斯方差 441.8 vs 不动时 453.0）。
 * 2. 「看见在动」主要靠明暗，不靠几何。风穿过树冠时叶片翻面，
 *    受光的一面变亮、背面变暗，这个明暗差比位移更让人相信有风。
 * 3. 动的地方靠遮罩定，不靠颜色现算。leaves-mask.png 是
 *    tools/make_leaf_mask.py 生成的（沙发、耳机、树干在里面是纯黑）。
 *    换 room.jpg 之后要重跑那个脚本。
 *
 * 还有两条是这层独有的：
 *
 * 4. 四层噪声的「快慢」必须拉开。全一样快，整片树冠会像一块布那样整体抖 —— 假。
 *    现在是：风团过境（20 秒一周期）→ 枝条摆（约 8 秒）→ 叶簇轻颤（约 3.5 秒）
 *    → 叶尖（约 1.3 秒），首尾差了 15 倍。
 * 5. 强弱用 gust 自己当包络，让"一阵风"从画面里横穿过去。
 *    全画面等幅地摆，读起来是画面在呼吸，不是风。
 *
 * 这个量级是被用户校准过的：2026-10-23 那一版四层都慢（最快一层 9 秒一周期）、
 * 幅度也小，实测两秒半的帧差只有 0.71，用户的评价是"太静止了"。
 * 现在同样口径是 2.11（约 3 倍），帧间变化 0.055/88ms。轻，但看得见。
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
uniform sampler2D uMask;   // 0 = 冻结（沙发 / 耳机 / 树干），1 = 叶子
uniform float uHasMask;
uniform float uTime;

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

void main() {
  // 画布就贴在图层上，图层宽高 == 图的显示宽高，所以 vUv 本身就是
  // 图片的归一化坐标，只差一次上下翻转（纹理是 flipY = false 加载的）。
  //
  // 以前这里写的是 px = vUv * uRes、uv = (px - uRect) / uRect.zw，
  // 其中 uRes 传的是**视口**尺寸、uRect 是**图在视口里**的矩形。
  // 只要窗口不是 16:9，两个比例就对不上，uv 会跑到 [0,1] 之外 ——
  // ClampToEdge 把图片最后一行拉成一条横带，整幅图还被压扁，
  // 树叶层和底下的沙发、贴着放的热区全部错位。
  // 量过：1440×900 越界 5.6%，1280×1024 越界 21.1%，手机竖屏 142%。
  // 现在画布只负责自己那一层，这个换算整个不需要了。
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

  float move = uHasMask > 0.5 ? texture2D(uMask, uv).r : 0.0;
  float t = uTime;

  // ── 风的总开关。要更含蓄就调到 0.7，想再起风一点到 1.5。
  //    位移的上限还是 1.3（过了叶子边缘出糊边），但明暗可以再往上走：
  //    明暗是"叶片翻面"，不碰几何，不会糊，只会在过大的时候像在闪。
  //    这一版把 GAIN 提到 1.35，动的量主要加在明暗翻转上，不是位移。
  const float GAIN = 1.35;

  // ── 四层风，从大到小：风团掠过 → 枝条摆 → 叶簇轻颤 → 叶尖
  // 第四层（叶尖）故意压得很轻：频率最高，一旦有幅度就会读成"噪点闪烁"，
  // 而不是风。真正让它活起来的是第三层 —— 尺度落在"一簇叶子"上（叶簇的
  // 大小约是画面的 1/12），整簇一起动，叶片之间的相对位置不变，
  // 看起来是叶子在风里晃，而不是画被揉了一下。
  //
  // 速度这块踩过一次坑：原来四层都慢得离谱（最快的一层走完自己一个周期
  // 要 9 秒），幅度再调都像"静止"。真实的叶片轻颤是 1~3 秒一次，
  // 所以后两层提速 2.5~3 倍，前两层保持慢 —— 慢的那层是"风在过境"，
  // 快的那两层是"叶子在颤"，两者时间尺度必须拉开 8 倍以上才不假。
  //
  // 2026-10-24 又踩一次：只测"两秒累计差 2.11"是不够的，得连拍看**相邻帧**。
  // 相邻帧只有 0.08 级，眼睛根本读不到运动，只会当成一张静图 ——
  // 用户第二次说"看不到任何动效"。所以叶簇、叶尖两层再提速约 1.9 倍：
  // 叶簇周期 3.5s → 1.8s，叶尖 1.3s → 0.7s，都落回"真实叶片轻颤"的区间内。
  float gust = noise2(uv * vec2(1.9, 1.3) + vec2(-t * 0.048, t * 0.008));
  float sway = noise2(uv * vec2(4.4, 3.0) + vec2( t * 0.058, -t * 0.026));
  float clump = noise2(uv * vec2(10.5, 8.6) + vec2(-t * 0.390, t * 0.250));
  float trem = noise2(uv * vec2(26.0, 22.0) + vec2( t * 0.610, -t * 0.455));

  // ── 风向场：不是全画面一起摆，而是让"一阵风"从画面里横穿过去。
  // 直接拿 gust 做包络 —— 它在哪儿把叶子推得多，哪儿就摆得大，
  // 于是强弱跟着那道风团走，看起来像风掠过树冠，而不是整幅画在呼吸。
  // 均值约 1.0：只做分配、不改总量，既有强弱差，又不会整体变弱。
  float amp = move * (0.62 + 0.76 * gust) * GAIN;

  // ── 位移：横向为主，纵向只给一点点
  // 合计半幅约 0.0022 → 1440 宽时约 3px、1920 原图约 4.2px。
  // 这个数是拿"清晰度"卡出来的：位移再大，油画笔触就被扯开，
  // 叶子边缘拖出一条糊边（下面 sharpness 一段有量法）。
  // 注意：GAIN 已经提到 1.35，这里四层的系数没动，位移总量会跟着
  // 放大到约 4px / 5.7px —— 仍在"不糊"的边界内（清晰度验证见下）。
  vec2 off = vec2(
    (gust - 0.5) * 0.00135 + (clump - 0.5) * 0.00280 + (sway - 0.5) * 0.00110
      + (trem - 0.5) * 0.00040,
    (sway - 0.5) * 0.00090 + (clump - 0.5) * 0.00110 + (trem - 0.5) * 0.00024
  ) * amp;

  vec3 col = texture2D(uTex, uv + off).rgb;

  // ── 翻面：风过去的时候叶片一亮一暗。
  //    这一项比位移更"骗得过眼睛" —— 位移要靠盯着边缘才看得出，
  //    明暗是余光就能感到的，所以幅度主要给在这里。
  //    叶簇（clump）那层提速后，翻面里也给它多一点权重，
  //    让"一簇叶子一起翻"这件事更容易被看见。
  float flip = (gust - 0.5) * 1.0 + (sway - 0.5) * 0.42 + (clump - 0.5) * 1.05;
  col *= 1.0 + flip * 0.115 * amp;

  // ── 叶面反光：只加在本来就亮的地方，不凭空造纹理
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += smoothstep(0.56, 1.0, gust) * smoothstep(0.26, 0.60, lum) * 0.040 * amp;

  gl_FragColor = vec4(col, 1.0);
}
`

export function createFoliage(url, maskUrl) {
  const canvas = document.createElement('canvas')
  canvas.className = 'foliage-canvas'

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
  renderer.setClearColor(0x05090b, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const placeholder = new THREE.DataTexture(
    new Uint8Array([5, 9, 11, 255]), 1, 1, THREE.RGBAFormat
  )
  placeholder.needsUpdate = true

  const uniforms = {
    uTex: { value: placeholder },
    uMask: { value: placeholder },
    uHasMask: { value: 0 },
    uTime: { value: 0 }
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
    // 自定义着色器的输出不会自动编码回去，所以输入也不做 sRGB→线性
    t.colorSpace = THREE.NoColorSpace
    t.flipY = false
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.generateMipmaps = false
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    return t
  }

  loader.load(url, (tex) => {
    uniforms.uTex.value = configure(tex)
    texture = tex
    ready = true
  }, undefined, () => { /* 加载失败就一直是底色，不崩 */ })

  if (maskUrl) {
    loader.load(maskUrl, (tex) => {
      uniforms.uMask.value = configure(tex)
      uniforms.uHasMask.value = 1
      maskTexture = tex
    }, undefined, () => { /* 没有遮罩就整屏不动 —— 宁可不给动效，也不要沙发跟着摆 */ })
  }

  /**
   * w / h 是**这一层图的显示尺寸**，不是视口尺寸。
   * canvas 的 CSS 盒由样式定死为 inset:0 + 100%，所以缓冲区必须跟它一样大，
   * 否则采样坐标和显示画面就不同比例（见片头那段注释）。
   */
  let lastW = 0
  let lastH = 0
  function resize(w, h) {
    const cw = Math.max(1, Math.round(w))
    const ch = Math.max(1, Math.round(h))
    // setSize 会重建绘制缓冲。拖窗口时 resize 一秒能来几十次，
    // 尺寸没变就别动它 —— 否则整个场景跟着抖
    if (cw === lastW && ch === lastH) return
    lastW = cw
    lastH = ch
    renderer.setSize(cw, ch, false)
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
    // dispose() 只释放 three 自己的资源，**不会**归还 WebGL 上下文。
    // 浏览器同时允许的上下文有限（Chrome 约 16 个），林间进进出出十几次
    // 就会把最老的那个强行丢掉 —— 表现就是画面整个黑掉，控制台一句
    // "Too many active WebGL contexts" 之外没有别的提示。
    // 这个场景每次退出都会走 dispose，所以这里必须真的把上下文还回去。
    renderer.forceContextLoss()
    renderer.dispose()
  }

  return {
    canvas,
    resize,
    render,
    dispose,
    isReady: () => ready
  }
}
