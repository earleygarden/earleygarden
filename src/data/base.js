/**
 * 站内静态资源都放在 public/assets 下。
 *
 * 上传到 GitHub Pages 之后，站点是挂在 /<仓库名>/ 这样的子路径上的
 * （https://earleygarden.github.io/earleygarden/），写死的 '/assets/...'
 * 会被解析到域名根目录，全部 404。
 *
 * 所以统一从这里取前缀。值由 vite.config.js 里的 base 决定：
 * 构建时配成 './'，开发时是 '/'，两边都能用。
 */
export const ASSETS = import.meta.env.BASE_URL + 'assets/'
