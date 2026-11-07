// 把 vite 产出的外链 JS / CSS 塞回 index.html，得到可以双击打开的单文件版本。
// 用法：vite build --config vite.single.config.ts && node scripts/inline-single.mjs
import { readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist-single'
const out = join(dir, 'RankTrail.html')

let html = readFileSync(join(dir, 'index.html'), 'utf8')

const script = /<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/
const link = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/

const scriptMatch = html.match(script)
const linkMatch = html.match(link)

if (!scriptMatch) throw new Error('index.html 里没找到 module script')
const strip = (p) => p.replace(/^\.?\//, '')
const jsPath = join(dir, strip(scriptMatch[1]))
const js = readFileSync(jsPath, 'utf8').replace(/<\/script/gi, '<\\/script')
if (!js.includes('createRoot') && js.length < 100_000) throw new Error('JS 看起来不对，检查构建产物')

html = html.replace(scriptMatch[0], () => `<script type="module">\n${js}\n</script>`)

if (linkMatch) {
  const cssPath = join(dir, strip(linkMatch[1]))
  const css = readFileSync(cssPath, 'utf8')
  html = html.replace(linkMatch[0], () => `<style>\n${css}\n</style>`)
}

// 还剩下外链就说明 assetsInlineLimit 没生效
const leftovers = [...html.matchAll(/(?:src|href)="\.\/assets\/[^"]+"/g)].map((m) => m[0])
if (leftovers.length) throw new Error(`还有外链资源没内联：${leftovers.join(', ')}`)

// 单文件分发时一并保留上游许可证与衍生项目说明。
const notices = ['LICENSE', 'NOTICE'].map((file) => readFileSync(file, 'utf8').trim()).join('\n\n') + '\n\n' + readFileSync(join(dir, 'THIRD_PARTY_LICENSES.txt'), 'utf8')
html = html.replace('<!doctype html>', '<!doctype html>\n<!--\n' + notices.replaceAll('--', '—') + '\n-->')
writeFileSync(out, html, 'utf8')

// 清掉已经内联的 assets，免得目录里留一堆重复文件
rmSync(join(dir, 'assets'), { recursive: true, force: true })
for (const file of readdirSync(dir)) {
  if (file !== 'RankTrail.html') rmSync(join(dir, file), { recursive: true, force: true })
}

const kb = statSync(out).size / 1024
console.log(`✓ ${out}  ${kb.toFixed(0)} KB`)
