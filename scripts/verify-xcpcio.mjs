// board.xcpcio 数据导入的端到端验证（用真实的重庆站数据）。
// 用法：先 `pnpm dev`，再 `node scripts/verify-xcpcio.mjs`
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const FILE = resolve('fixtures/xcpcio-chongqing.json')
const OUT = process.env.SCREENSHOT_DIR || 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const errors = []
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('.empty .dropzone').click()
await page.waitForSelector('.dialog')
await page.locator('input[type=file]').setInputFiles(FILE)
await page.waitForSelector('.board .score-team-info', { timeout: 20000 })
await page.waitForTimeout(600)

const skip = page.getByRole('button', { name: '先不用' })
if (await skip.count()) {
  await skip.click()
  await page.waitForTimeout(300)
}

const rows = await page.locator('.board .score-team-info').count()
const title = await page.locator('.context-title').innerText()
console.log(`载入 ${rows} 行 · ${title}`)
if (rows !== 324) throw new Error(`期望 324 行，实际 ${rows}`)
if (!title.includes('重庆站')) throw new Error(`标题不对：${title}`)

const seek = async (ratio) => {
  const box = await page.locator('.tl-track').boundingBox()
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
  await page.waitForTimeout(350)
}

await seek(0.25)
const failsEarly = await page.locator('.pcell.is-fail').count()
const acEarly = await page.locator('.pcell .tile').count()
await seek(0.6)
const failsLate = await page.locator('.pcell.is-fail').count()
const acLate = await page.locator('.pcell .tile').count()
console.log(`1:15 → −n ${failsEarly} / +k ${acEarly}`)
console.log(`3:00 → −n ${failsLate} / +k ${acLate}`)
if (acLate <= acEarly) throw new Error('通过格没有随时间增长')
if (failsEarly === 0 || failsLate === 0) throw new Error('逐条提交流水没有显示当时尚未通过的错误提交')

const failTime = await page.locator('.tile-fail-time').first().innerText().catch(() => null)
console.log(`失败格上的最后一次提交：${failTime ?? '缺失'}`)
if (!failTime) throw new Error('失败格没有带时刻')

const stats = (await page.locator('.stat-list').first().innerText()).replace(/\s+/g, ' ')
console.log(`统计：${stats}`)
if (!/累计通过 \d+\/ 1351/.test(stats)) throw new Error(`累计通过的数字不对：${stats}`)

await page.screenshot({ path: OUT + '/25-xcpcio-board.png' })
await browser.close()

if (errors.length) {
  console.error('控制台错误：', errors)
  process.exit(1)
}
console.log('board.xcpcio 导入 OK')
