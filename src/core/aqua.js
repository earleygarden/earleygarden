import * as THREE from 'three'

/**
 * 水下放映厅 · 水里的光
 *
 * ── 2026-10-23 深夜，第二版。第一版整个推倒 ───────────────────────
 *
 * 第一版做的是"玻璃后面的水在流"：把整张 room.jpg 当作水面，给整片水区
 * 一个 ±30px 的**整体位移**，再用噪声去拉扯它。
 * 用户的原话是「看上去就是一坨」。
 *
 * 逐块放大对比之后，问题很清楚：这张图里的水不是"透明的水体"，而是
 * **已经画在墙面、顶棚、地面上的焦散光纹**。那些光纹细、密、脆，
 * 一旦被整体推走 30 个像素，双线性重采样就把它们全部抹平 ——
 * 原图顶部那层细密的鳞状光斑，在渲染结果里变成了一片糊开的白雾，
 * 连檐口那条硬边都被带软了。位移越大，糊得越均匀，最后就是"一坨"。
 *
 * 所以这一版把所有位移**全部删掉**（一行都不留）：
 *
 *     col = texture2D(uTex, uv).rgb;        // 逐像素等于原图，零重采样
 *
 * 屋子、沙发、幕、每一条结构边，都跟静态图一模一样，锐度一分不丢。
 * 动的只有**光**：在上面叠一层会缓慢游走的焦散，再让原本就亮的地方
 * 跟着这层光微微起伏。
 *
 * 这在物理上也更对：屋子泡在水里，焦散是**光打在家具和墙上的投影**。
 * 水面在头顶动，墙上那些光斑才会跟着爬 —— 而墙本身是不动的。
 *
 * 三条约束（都是踩出来的）：
 *
 * 1. 只给"光"，不给"形变"。形变 = 重采样 = 糊，这条没有例外。
 * 2. 加的光必须落在本来就亮的地方。黑幕是黑的、暗角是暗的，
 *    往上面加光只会脏；所以加性项都过一道 smoothstep(lum)。
 * 3. 遮罩只冻两样：黑幕、沙发（连接触阴影）。结构线**不冻** ——
 *    光本来就该越过檐口和踢脚，铺满整面墙。这一点和第一版正相反：
 *    第一版冻结构线是为了防位移跳动，这一版没有位移，就没有那个顾虑。
 *    见 tools/make_light_mask.py。
 *
 * 色温：加的光偏青白（0.55, 0.82, 1.00）。屋里的水是冷蓝的，暖光会假。
 *
 * ── 2026-10-24 凌晨，第三版：把"动"提上来，但仍然一个像素都不许挪 ─────
 *
 * 用户的反馈是「几乎看不到任何外围水的动效」，同时把红线又划了一遍：
 * 「坚决不能碰影厅内部的任何固件，影厅本身的分隔线禁止有任何形式的位移，
 *   水波纹不要动得太厉害」。
 *
 * 查下来，问题不在幅度，在**速率**。上一版量出来的"两帧差 4.96"是 1.4 秒
 * 累积出来的量；换成连拍看相邻帧（约 100ms）只有 0.45 级 —— 眼睛根本读不到
 * 运动，只会觉得"这张图好像有点亮"。两个原因：
 *   1. 光带 15px/秒，100ms 只挪 1.5px；
 *   2. 加性项的门限 smoothstep(0.24, 0.66, lum) 太紧 —— 墙面亮度中位数只有
 *      0.30，算下来乘子只有 0.17~0.20，等于把效果砍掉了八成。
 *      （那一版的门限是按"别把黑幕刷亮"设的，可黑幕和沙发本来就在遮罩里，
 *        门限再拦一遍是多余的。）
 *
 * 这一版加的是**第三层：细碎闪烁**，并把门限按实测亮度重新标定
 * （墙 0.30 / 幕 0.03 / 沙发 0.04，见 tools/measure_aqua3.py 的分档统计）：
 *   - 门限放到 smoothstep(0.10, 0.34)：墙面乘子 0.17 → 0.9，暗处仍然不动
 *   - 闪烁层频率 52/86（格子 28/17px），速度 1.8/2.4 格每秒 → 约 25% 的像素
 *     每帧变 3 级以上，相邻帧差 0.45 → 2.35（和树叶那版的 2.11 同量级）
 *   - 光带幅度相应调小（0.145 → 0.075），因为门限放宽后它会被放大三倍；
 *     不调的话整面墙会被垫亮一层
 *
 * **位移仍然是零**。全片唯一的采样就是 `texture2D(uTex, uv)`，uv 没有任何偏移，
 * 所以幕、沙发、檐口、踢脚、每一条分隔线在数学上不可能移动一个像素。
 * 这一条可以用测量验证（tools/measure_aqua3.py）：拿原图的强边缘当模板，
 * 在 ±2px 内找帧间最佳对齐，结果永远是 (0,0)。
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
uniform sampler2D uMask;   // 0 = 不给光（黑幕 / 沙发），1 = 可以打光
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
  // 画布只盖它自己那一层，图层宽高 == 图的显示宽高，
  // 所以 vUv 一次上下翻转就是图片的归一化坐标。
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

  // ── 原图一个像素都不动。这条是这一版的全部要点，不要再改成 uv + off。
  vec3 col = texture2D(uTex, uv).rgb;

  float wet = uHasMask > 0.5 ? texture2D(uMask, uv).r : 1.0;
  // 遮罩本身已经羽化过 6px，这里再收一次，让光在幕框和沙发边上淡出
  wet = smoothstep(0.04, 0.72, wet);
  if (wet <= 0.001) { gl_FragColor = vec4(col, 1.0); return; }

  float t = uTime;

  // ── 水面形状：两层很慢的噪声，只用来把下面那些光带推歪，
  //    不让它变成百叶窗。
  float w1 = noise2(uv * vec2(2.6, 1.7) + vec2(t * 0.030, -t * 0.042));
  float w2 = noise2(uv * vec2(5.4, 3.6) - vec2(t * 0.052, t * 0.061));

  // ── 光带：水里的光是从头顶往下走的，所以一条条近乎横着的亮带往上推。
  //    频率 6.2 → 屏高 810px 时一条带约 130px 宽；速度约 15px/秒。
  //    太密就成了条纹布，太慢就看不见在动 —— 这两个数都是在屏上比出来的。
  //    相位被两层噪声推歪 2.2 + 0.9 弧度，所以带子是弯的、粗细不匀，
  //    像水面把光揉碎了再投下来。
  float phase = uv.y * 6.2 - t * 0.78 + (w1 - 0.5) * 2.2 + (w2 - 0.5) * 0.9;
  float band = 0.5 + 0.5 * sin(phase);
  band = pow(band, 4.0);          // 收窄：亮带窄、间隙宽，才像聚起来的光

  // ── 大尺度的明暗起伏：整片墙一起慢慢地亮一下暗一下。
  //    它不是主角，但少了它，光带会像贴上去的贴纸。
  float swell = smoothstep(0.28, 0.78, w1);

  // ── 零均值的调制量。
  //    两个减数（0.19 / 0.50）不是凑的，是两项各自的均值：
  //    pow(band,4) 之后 band 的均值约 0.19，swell 约 0.50。
  //    不减去它们的话，调制量平均下来不是 0 —— 整间屋子会被整体压暗或提亮，
  //    量出来与原图的差能到 13 级，水还没动屋子先变了一层。
  float lightMod = (band - 0.19) * 0.72 + (swell - 0.50) * 0.30;

  // ── 第一层：伽马调制。这是"亮带扫过墙面"的底子。
  //    为什么不用加减亮度：试过两版 col *= 1 + mod，量出来与原图的平均差
  //    都是 13 级左右 —— 整面墙像被刷了一层奶白，亮部暗部一起抬，
  //    对比度掉了，看着不是"有光扫过"，是"这张图变浅了"。
  //    伽马不一样：暗处（黑幕、四角）几乎不动，亮处响应大 ——
  //    光扫过时亮纹跳出来、间隙沉下去，细节对比度反而更高。
  //    实测高频细节量 12.26 vs 原图 11.33（+8%），不是变糊，是更利。
  //    -0.020 是把整体亮度拉回原图的那一点补偿（伽马偏一点就整体变暗）。
  float g = 1.0 - lightMod * 0.30 * wet - 0.020 * wet;
  col = pow(max(col, vec3(0.0)), vec3(g));

  // ── 第二层：顺着原有焦散网的冷色高光。
  //    这一层才是"看得见水在动"的主力 ——
  //    伽马那层是平滑的明暗，眼睛读成"亮度在变"；要读成"水在走"，
  //    必须有**能被跟住的结构**。原图里现成就有：那张焦散网的网线。
  //    加性光只落在本来就亮的地方（lum 的门限），所以亮起来的正是那些网线，
  //    光顺着网线一段段走过去，看起来就是水在墙上爬。
  //    128 分量的冷白（0.50, 0.80, 1.00）：屋里的水是冷蓝的，暖光会假。
  float lum = dot(col, vec3(0.299, 0.587, 0.114));

  // ── 第三层：细碎的闪烁，让**网纹本身**一段段地活过来。
  //    前两层是"一条宽光带整片扫过"，那是光的运动；水面自己的波纹没有表现出来，
  //    所以在墙上一遍遍扫过的其实是同一条带子 —— 看久了像有人在推灯。
  //    这一层亮起来的是一小截一小截的网线，彼此不同步，才是"水在晃"。
  //    格子 28px / 17px（频率 52 / 86），叠两层是为了不让人看出
  //    "一个规整的图案在平移"；速度 1.8 / 2.4 格每秒 ≈ 50 / 40 px 每秒。
  //    这个速度是量出来的：上一版 0.3 格每秒时，连拍相邻帧只差 0.45 级，
  //    眼睛读不到；现在是 2.35 级，约 25% 的像素每帧变 3 级以上。
  float r1 = noise2(uv * vec2(52.0, 36.0) + vec2(t * 1.80, -t * 1.40));
  float r2 = noise2(uv * vec2(86.0, 60.0) - vec2(t * 2.40, t * 1.95));
  float ripple = (r1 - 0.5) * 0.62 + (r2 - 0.5) * 0.38;

  col += band * 0.075 * wet * smoothstep(0.10, 0.40, lum) * vec3(0.50, 0.80, 1.00);
  // 闪烁同样只给"有光纹的地方"：黑幕、四角、沙发底下没有水纹可闪，
  // 往上面加光只会脏。门限 0.10~0.34 是按实测亮度标的 ——
  // 墙面中位 0.30（乘子约 0.9），最暗的 10% 在 0.18 以下（乘子 0.1 左右），
  // 幕 0.03、沙发 0.04 直接是 0。上一版写成 0.24~0.66，墙面乘子只有 0.17，
  // 等于把这一层砍掉了八成，这是"看不到动"最主要的原因。
  col += ripple * 0.260 * wet * smoothstep(0.10, 0.34, lum) * vec3(0.62, 0.87, 1.00);

  gl_FragColor = vec4(col, 1.0);
}
`

export function createAqua(url, maskUrl) {
  const canvas = document.createElement('canvas')
  canvas.className = 'aqua-canvas'

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
  renderer.setClearColor(0x04141c, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const placeholder = new THREE.DataTexture(
    new Uint8Array([4, 20, 28, 255]), 1, 1, THREE.RGBAFormat
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
    // 不做 sRGB→线性 自动转换：自定义着色器的输出不会自动编码回去，一转就整体变暗
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
  }, undefined, () => { /* 失败就保持深水底色，不崩 */ })

  if (maskUrl) {
    loader.load(maskUrl, (tex) => {
      uniforms.uMask.value = configure(tex)
      uniforms.uHasMask.value = 1
      maskTexture = tex
    }, undefined, () => { /* 没有遮罩就整屏给光，至少不会整屏不动 */ })
  }

  /**
   * w / h 是**这一层图的显示尺寸**，不是视口尺寸。canvas 的 CSS 盒由样式
   * 定死为 inset:0 + 100%，缓冲区必须跟它一致，否则采样坐标和显示画面
   * 就不同比例（见片头那段注释）。
   */
  let lastW = 0
  let lastH = 0
  function resize(w, h) {
    const cw = Math.max(1, Math.round(w))
    const ch = Math.max(1, Math.round(h))
    // setSize 会重建绘制缓冲。拖窗口时 resize 一秒能来几十次，
    // 尺寸没变就别动它
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
    // 见 foliage.js 同处注释：dispose() 不归还 WebGL 上下文，
    // 反复进出水下放映厅会把浏览器的上下文配额吃满，然后画面整块黑掉
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
