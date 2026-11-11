import { ASSETS } from './base.js'

/**
 * 鳄梨岛地图（手绘藏宝图）
 *
 * 这张图替换掉原来那个等距 3D 地图：五个几何体换成画上五个标了地名的地方。
 * 画面本身就是内容，所以这里的交互比图片场景更轻。
 *
 * 为什么这里不放小灯点：
 *   灯点是"白芯 + 暖晕"，在米黄卷轴上白点会直接糊掉，读不出"这里有灯"。
 *   而画上每个地方本来就带着一块写了名字的卷轴，可点的提示已经长在画里了，
 *   再叠五个白点只是往一张老地图上撒 UI 碎屑。
 *   所以这里改成：指上去的时候，那块地方被一盏灯照到 —— 暖光从卷轴底下
 *   漫到周围的水面和林子上。暗处提亮，比白点更像"这里有人去过"。
 *
 * 坐标是图片坐标（0–1，相对原图），布局由 JS 按原图比例算出，不靠 object-fit 裁切，
 * 所以任何窗口比例下热区都不会漂。
 */

export const MAPBOARD_ASSETS = ASSETS + 'map/'
export const MAPBOARD_SIZE = { w: 1824, h: 1026 }
export const MAPBOARD_IMAGE = 'map.jpg'

export const MAPBOARD_BACK = '回到岛上'
export const MAPBOARD_GUIDE = '画上有名字的地方，点一下进去'

/**
 * 五个地方。box 量的是那块卷轴（含两端飘带）的包围盒。
 *
 * to = 进去以后的路由：
 *   - 直接写路由名（grove / cabin / undersea）就是跳到那个展厅
 *   - 写 "garden/lighthouse" 这种带子路由的，是回到序章封面并直接
 *     打开灯塔特写（灯塔不是一个独立房间，它的特写长在序章里）
 * 开发者沙滩现在直接进 beach（那片有真海浪和睡猫的沙滩），
 * 不再是原来那个叫 interactive 的等距房间 —— 后者只留给三维展厅那条老路径。
 * 想换去处只改 to 一个字，位置不用动。
 */
export const PLACES = [
  {
    id: 'lighthouse',
    name: '幻想灯塔',
    hint: '点一下 · 近看灯塔',
    box: { x0: 0.8130, y0: 0.1430, x1: 0.9178, y1: 0.2185 },
    to: 'garden/lighthouse'
  },
  {
    id: 'music',
    name: '音乐树',
    hint: '林子里坐会儿 · 听点风声',
    box: { x0: 0.3129, y0: 0.3576, x1: 0.4201, y1: 0.4290 },
    to: 'grove'
  },
  {
    id: 'archive',
    name: '鳄梨岛文献馆',
    hint: '进来坐坐 · 木屋全景',
    box: { x0: 0.3925, y0: 0.5110, x1: 0.5554, y1: 0.5680 },
    to: 'cabin'
  },
  {
    id: 'beach',
    name: '开发者沙滩',
    hint: '小程序与互动作品',
    box: { x0: 0.6232, y0: 0.5750, x1: 0.7488, y1: 0.6240 },
    to: 'beach'
  },
  {
    id: 'cinema',
    name: '海浪影院',
    hint: '潜下去 · 水下放映厅',
    box: { x0: 0.2482, y0: 0.7806, x1: 0.3642, y1: 0.8539 },
    to: 'undersea'
  }
]
