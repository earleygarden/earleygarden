import { ASSETS } from './base.js'

/**
 * 林间
 *
 * 从序章封面（岛上那片暗林子）点进来。一棵鳄梨树，树下扔着一张墨绿的
 * 绒面沙发椅，一副橘色的耳机搁在扶手上。
 *
 * 这是"坐下来听/看一会儿"的地方，岛上最安静的一角。
 * 现在这里的全部内容，就是耳机里的四首歌。
 * 以后要再挂东西（播客、短片、读书片段），在 hotspots 里加灯点即可。
 */

export const GROVE_ASSETS = ASSETS + 'grove/'
export const GROVE_SIZE = { w: 1920, h: 1080 }

export const GROVE_VIEWS = {
  room: {
    image: 'room.jpg',
    title: '林间',
    guide: '耳机搁在沙发上 · 点左上角回岛上',
    // 没有上一级视图，返回 = 离开林间，回序章封面
    parent: null,
    backLabel: '回到岛上',

    // 树叶的风：整张图只有叶子在动，沙发、耳机、树干一个像素都不动。
    // mask 是 tools/make_leaf_mask.py 生成的；换 room.jpg 之后要重跑那个脚本
    foliage: { mask: 'leaves-mask.png' },

    // 耳机里存着四首本地 mp3。播放器是 imageScene 的一份能力，
    // 和 film / aqua 一样：视图声明要什么，场景负责把它搭出来。
    // len 是实测时长，先垫上；元数据一到会用真的顶掉。
    tracks: [
      {
        title: '天何言哉',
        sub: '《白蛇传之我叫王道灵》主题曲',
        src: 'audio/tianheyanzai.mp3',
        len: 86.6
      },
      {
        title: '不惑',
        sub: '',
        src: 'audio/buhuo.mp3',
        len: 184.6
      },
      {
        title: '黑白无间',
        sub: '',
        src: 'audio/heibaiwujian.mp3',
        len: 176.8
      },
      {
        title: '鸡毛令箭',
        sub: '',
        src: 'audio/jimaolingjian.mp3',
        len: 204.9
      }
    ],

    hotspots: [
      {
        id: 'headphone',
        name: '耳机',
        hint: '点一下 · 放出四首歌',
        hintOpen: '点一下 · 收起播放器',
        // 耳机本体：画面里唯一的暖色，落位不会含糊
        box: { x0: 0.6300, y0: 0.6120, x1: 0.7020, y1: 0.7020 },
        // 灯点落在左耳罩的暗窝里 —— 那一小块 luma 只有 0.01，
        // 白芯立得住；四面又被橘色的耳罩包着，读得出"耳机上有一盏灯"，
        // 而不是"沙发上有个点"。大耳罩那一面反而是亮的（0.4 以上），
        // 白点压上去会糊成一块高光。
        dotAt: [0.6510, 0.6504],
        // PLAYER 是 imageScene 认识的第三种去向：不换视图、不出场景，
        // 只把播放器叫出来
        to: 'PLAYER'
      }
    ]
  }
}
