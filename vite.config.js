import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * 两个入口：
 *   index.html   站内那套（电子展厅，路由在 # 后面）
 *   cinema.html  单独发给客户的「鳄梨岛海浪影院」，一屏到底，不滚
 *
 * 不写 input 的话 Vite 只认 index.html —— cinema.html 会被当静态文件原样
 * 拷过去，里面 ./src/cinema.js 到了线上就是 404。2026-11-24 重建时踩到过。
 */
export default defineConfig({
  /**
   * 用相对路径导出资源，而不是写死 '/earleygarden/'。
   *
   * 原因：GitHub Pages 的项目站点挂在 /<仓库名>/ 子路径下，
   * 而仓库名是可改的、以后也可能换别的托管。用 './' 之后，
   * 不管挂在域名根还是任意子路径，构建产物都不用重新配置。
   */
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        cinema: resolve(process.cwd(), 'cinema.html')
      }
    }
  }
})
