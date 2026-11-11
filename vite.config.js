import { defineConfig } from 'vite'

export default defineConfig({
  /**
   * 用相对路径导出资源，而不是写死 '/earleygarden/'。
   *
   * 原因：GitHub Pages 的项目站点挂在 /<仓库名>/ 子路径下，
   * 而仓库名是可改的、以后也可能换别的托管。用 './' 之后，
   * 不管挂在域名根还是任意子路径，构建产物都不用重新配置。
   */
  base: './'
})
