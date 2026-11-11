/**
 * 灯点 · 有人动了才亮，安静一会儿就退回去
 *
 * 序章、木屋内景、林间、水下放映厅共用这一套。
 * 一进来先是一幅干净的画，鼠标一动灯点才淡入；停住两秒它自己收回去 ——
 * 灯点是「这里能点」的提示，不是画上的装饰。人已经不动了，提示就该让位给画。
 *
 * 两个刻意的判断：
 *
 * 1. 判据是「有没有动作」，不是「光标在不在画面里」。
 *    鼠标完全可以停在画面正中一动不动地看画，那和离开窗口没有区别。
 *    所以这里只认 pointermove / pointerdown，不看 leave / enter。
 *
 * 2. 灯点灭了，**不改 hover 状态**。
 *    命中判定走的是坐标，不是灯点这个元素 —— 灯灭了不代表这里不能点。
 *    指针还停在那盏灯上时，光标该继续是手型、底部文案该继续挂着；
 *    反过来把 hover 一起清掉，人会觉得「我刚明明指着它，怎么突然坏了」。
 *    视觉提示可以退场，可点这件事不能变。
 */

const DEFAULT_DELAY = 2000
const DEFAULT_CLASS = 'has-pointer'

export function createDotReveal(root, {
  delay = DEFAULT_DELAY,
  className = DEFAULT_CLASS
} = {}) {
  let timer = 0
  let awake = false

  function wake() {
    window.clearTimeout(timer)
    if (!awake) {
      awake = true
      root.classList.add(className)
    }
    // 每一次动作都把"该睡了"的时间往后推 —— 连着动就一直亮着
    timer = window.setTimeout(sleep, delay)
  }

  function sleep() {
    window.clearTimeout(timer)
    timer = 0
    if (!awake) return
    awake = false
    root.classList.remove(className)
  }

  function dispose() {
    window.clearTimeout(timer)
    timer = 0
  }

  return {
    wake,
    sleep,
    dispose,
    /** 灯点此刻是不是亮着（调试/验收用） */
    isAwake: () => awake
  }
}
