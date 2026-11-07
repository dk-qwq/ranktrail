// 后台回放验证：真的把页面冻住（定时器 + rAF 全停），确认时钟会追平。
// 用法：先 `pnpm dev`，再 `node scripts/verify-background.mjs`
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const FREEZE_MS = 3000

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /成都站/ }).click()
await page.waitForSelector('.board .score-team-info')
// 导入后会弹「创建我的队伍」，这里不需要
const skip = page.getByRole('button', { name: '先不用' })
if (await skip.count()) {
  await skip.click()
  await page.waitForTimeout(200)
}

const readClock = async () => {
  const text = (await page.locator('.clock').innerText()).trim()
  const [h, m, s] = text.split(':').map(Number)
  return h * 3600 + m * 60 + s
}

await page.locator('.play-btn').click()
await page.waitForTimeout(400)

const cdp = await page.context().newCDPSession(page)
const before = await readClock()
await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
console.log(`冻结页面 ${FREEZE_MS / 1000} 秒…`)
await page.waitForTimeout(FREEZE_MS)
await cdp.send('Page.setWebLifecycleState', { state: 'active' })
await page.waitForTimeout(800)

const after = await readClock()
console.log(`冻结 ${FREEZE_MS / 1000}s：${before}s → ${after}s（差 ${after - before}s）`)
await browser.close()

if (after - before < FREEZE_MS / 1000) {
  throw new Error('冻结期间时钟没有继续走：播放时钟又变成按帧累加了')
}
console.log('后台回放 OK：冻结期间时间照走，恢复后追平')
