/**
 * 展厅内容数据 —— 所有厅的内容都从这里读。
 * 加作品、改标题只动这个文件，不用碰任何场景代码。
 *
 * ratio = 宽 / 高
 * type: poster | video | shot | record  （只影响播放行为，不影响排版）
 *
 * 说明：除了《白蛇传》《云端奇幻之旅》这两个真实条目，
 * 其余 title 全是「待定」占位，等你确认后再换。
 */

export const ROOMS = {
  cinema: {
    id: 'cinema',
    title: '电影放映厅',
    subtitle: '一部长片，一部剧集。一个人，一套 AI 工具。',
    accent: '#2F6E5F',
    wall: '#E7E1D4',
    items: [
      { id: 'snake', title: '白蛇传之我叫王道灵', meta: '80 分钟 · 2026-06-19 上线', ratio: 0.67, type: 'poster' },
      { id: 'cloud', title: '云端奇幻之旅', meta: '儿童科普剧集 · 进行中', ratio: 1.78, type: 'video' }
    ]
  },

  promo: {
    id: 'promo',
    title: '宣传片展映厅',
    subtitle: '待定 —— 这里放各个项目的宣传片、片花、活动回顾。',
    accent: '#B4622F',
    wall: '#E9E2D6',
    items: [
      { id: 'promo-1', title: '待定 · 宣传片 A', meta: '横版 16:9 · 待补', ratio: 1.78, type: 'video' },
      { id: 'promo-2', title: '待定 · 宣传片 B', meta: '横版 16:9 · 待补', ratio: 1.78, type: 'video' },
      { id: 'promo-3', title: '待定 · 宣传片 C', meta: '横版 16:9 · 待补', ratio: 1.78, type: 'video' }
    ]
  },

  interactive: {
    id: 'interactive',
    title: '互动厅',
    subtitle: '小程序与互动作品。三维展厅里放二维码，扫码进真程序。',
    accent: '#4A6480',
    wall: '#E4E7EA',
    items: [
      { id: 'mini-1', title: '待定 · 小程序 A', meta: '小程序截图 · 待补', ratio: 0.56, type: 'shot' },
      { id: 'mini-2', title: '待定 · 小程序 B', meta: '小程序截图 · 待补', ratio: 0.56, type: 'shot' },
      { id: 'mini-3', title: '待定 · 小程序 C', meta: '小程序截图 · 待补', ratio: 0.56, type: 'shot' }
    ]
  },

  avatar: {
    id: 'avatar',
    title: '数字人口播',
    subtitle: '一段替你在展厅里站着说话的视频。',
    accent: '#7A5C86',
    wall: '#E6E0E6',
    items: [
      { id: 'avatar-1', title: '待定 · 口播介绍', meta: '横版 16:9 · 30–60 秒 · 待生产', ratio: 1.78, type: 'video' }
    ]
  },

  archive: {
    id: 'archive',
    title: '鳄梨文献馆',
    subtitle: '报道、访谈、知识沉淀。',
    accent: '#8A6A3A',
    wall: '#E8E3D5',
    items: [
      { id: 'press-1', title: '待定 · 报道 A', meta: '媒体 · 日期 · 待补', ratio: 1.4, type: 'record' },
      { id: 'press-2', title: '待定 · 报道 B', meta: '媒体 · 日期 · 待补', ratio: 1.4, type: 'record' },
      { id: 'press-3', title: '待定 · 报道 C', meta: '媒体 · 日期 · 待补', ratio: 1.4, type: 'record' },
      { id: 'press-4', title: '待定 · 知识库', meta: '内部沉淀 · 待整理', ratio: 1.4, type: 'record' }
    ]
  }
}

/** 地图上五个入口的排布顺序与坐标（x, z），后续微调只改这里 */
export const MAP_LAYOUT = [
  { id: 'cinema', x: -10.5, z: -1.5, shape: 'hall', short: '长片 · 剧集' },
  { id: 'promo', x: -5, z: 6.5, shape: 'tube', short: '宣传片 · 片花' },
  { id: 'interactive', x: 1, z: -6.5, shape: 'cube', short: '小程序' },
  { id: 'avatar', x: 6.5, z: 4.5, shape: 'tower', short: '数字人' },
  { id: 'archive', x: 11, z: -2.5, shape: 'stack', short: '报道 · 知识库' }
]

export const ORDER = ['cinema', 'promo', 'interactive', 'avatar', 'archive']
