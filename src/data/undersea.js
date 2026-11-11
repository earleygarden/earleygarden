import { ASSETS } from './base.js'

/**
 * 水下放映厅
 *
 * 房间四面都是泡在海里的玻璃，正中一块黑幕。幕上不是"一部片子"，
 * 是整个片单 —— 这里就是岛上的影院，进来先看到排片。
 *
 * 黑幕的位置（图片坐标，按亮度扫出来的矩形：658×299px，比 2.2:1）：
 * 片子大多是 16:9，放进这块更宽的幕里会左右留黑，正好是电影院的画幅感。
 *
 * 片源与封面都在 /assets/cinema/ 下：
 *   films/  转码后的 mp4（原片是 PCM 音轨 + 10-28Mbps，1.9 GB，见 tools/encode_cinema.sh）
 *   covers/ 16:9 封面（1280×720）
 * 封面和视频本来就是分开的两个文件，这里让它们并成一个条目：
 * 封面当卡面，也当视频的 poster —— 片子在按下播放之前就已经是"一幅画"，
 * 不是一块空洞的黑。视频文件本身一个字节都不用改。
 */

export const UNDERSEA_ASSETS = ASSETS + 'undersea/'

/** 片源和封面都在这下面，跟房间那张图分开放 */
export const CINEMA_ASSETS = ASSETS + 'cinema/'

export const UNDERSEA_SIZE = { w: 1920, h: 1080 }

export const UNDERSEA_VIEWS = {
  room: {
    image: 'room.jpg',
    title: '水下放映厅',

    // 水里的光：房间一个像素都不动，只在墙面、顶棚、地面上叠一层缓慢游走的
    // 焦散（水波聚出来的那张亮网）。
    // mask 是 tools/make_light_mask.py 生成的 —— 黑幕和沙发在里面是黑的，
    // 光不会打到它们上面；结构线不冻，光该越过檐口铺满整面墙。
    aqua: { mask: 'light-mask.png' },

    guide: '幕上是片单 · 先选分类',

    parent: null,
    backLabel: '回到木屋',

    cinema: {
      box: { x0: 0.3297, y0: 0.2870, x1: 0.6724, y1: 0.5639 },
      // 片源和封面不在 undersea/ 下，单独一条路径
      base: CINEMA_ASSETS,

      /**
       * 幕上分两层：先四类，点进去才看见这一类里的片子。
       *
       * 分类就这四种（电影 / MV / 短片 / 宣传片），不增不减 ——
       * 一层四格、每格写着"几部"，观众一眼知道自己拍过什么、各有多少。
       * 归类的依据只看片子自己的 sub：
       *   招引宣传片、公益宣传片、广告片 → 宣传片
       *   品牌短片、剧情短片             → 短片
       * 如果哪一部归错了，改它所在的数组就行 —— 分类名不写在这里，
       * 由这个数组的顺序决定（见下面的 label）。
       */
      groups: [
        {
          label: '电影',
          items: [
            {
              id: 'baishe',
              title: '白蛇传之我叫王道灵',
              sub: '预告 · 腾讯视频在播',
              film: 'films/baishe.mp4',
              poster: 'covers/baishe.jpg'
            }
          ]
        },
        {
          label: 'MV',
          items: [
            {
              id: 'buhuo',
              title: '不惑',
              // 副题只写她自己给的。没给的宁可空着，不替她编"专辑""古风"这类说法
              sub: '',
              film: 'films/buhuo.mp4',
              poster: 'covers/buhuo.jpg'
            },
            {
              id: 'jimao',
              title: '鸡毛令箭',
              sub: '',
              film: 'films/jimao.mp4',
              poster: 'covers/jimao.jpg'
            }
          ]
        },
        {
          label: '短片',
          items: [
            {
              id: 'peiban',
              title: '陪伴',
              sub: '七彩虹品牌获奖短片',
              film: 'films/peiban.mp4',
              poster: 'covers/peiban.jpg'
            }
          ]
        },
        {
          label: '宣传片',
          items: [
            {
              id: 'jincai',
              title: '锦才通关记',
              sub: '锦江区人才招引宣传片',
              // 片源还没发过来。排片上照样占一格 —— 片单是"我拍过什么"，
              // 不是"服务器上有什么"；点进去会说明还没放进来
              film: null
            },
            {
              id: 'xuhang',
              title: '续航',
              sub: '宜宾动力电池公益宣传片',
              film: 'films/xuhang.mp4',
              poster: 'covers/xuhang.jpg'
            },
            {
              id: 'wuhuang',
              title: '吾皇驾到',
              sub: '文旅机器人广告片',
              film: 'films/wuhuang.mp4',
              poster: 'covers/wuhuang.jpg'
            }
          ]
        }
      ]
    },

    hotspots: []
  }
}
