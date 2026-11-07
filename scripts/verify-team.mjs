// 虚拟队伍端到端验证：建队 → 记录通过/没通过 → 榜面与解锁都不受我影响。
// 用法：先 `pnpm dev`，再 `node scripts/verify-team.mjs`
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')

import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const OUT = process.env.SCREENSHOT_DIR || 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const errors = []
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const seekRatio = async (ratio) => {
  const box = await page.locator('.tl-track').boundingBox()
  if (!box) throw new Error('找不到时间轴')
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
  await page.waitForTimeout(200)
}

const selfInfo = page.locator('.score-team-info.is-self')
const selfResult = page.locator('.score-team-result.is-self')
const selfSolved = async () => Number((await selfResult.locator('.solved-num').innerText()).trim())

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /成都站/ }).click()
await page.waitForSelector('.dialog')
await page.screenshot({ path: OUT + '/20-team-dialog.png' })

// 1. 建队
await page.locator('.dialog input').first().fill('测试一队')
await page.getByRole('button', { name: '创建并加入榜单' }).click()
await page.waitForTimeout(500)

const rows = await page.locator('.board .score-team-info').count()
const tags = await page.locator('.score-team-info .score-team-name small').filter({ hasText: '虚拟队伍' }).count()
console.log(`建队后：${rows} 行，虚拟标签 ${tags} 个`)
if (rows !== 329) throw new Error(`建队后应该是 329 行，实际 ${rows}`)
if (tags !== 1) throw new Error(`虚拟标签数异常：${tags}`)
if ((await selfSolved()) !== 0) throw new Error('新队伍初始应该 0 题')

// 2. 到 26:40 记一题
await seekRatio(1600 / 18000)
const tNow = (await page.locator('.clock').innerText()).trim()
const openBefore = await page.locator('.pcard.open').count()
await page.locator('.manual-letters .letter-chip').nth(5).click() // F 题
await page.getByRole('button', { name: '通过了' }).click()
await page.waitForTimeout(400)
const solvedAfter = await selfSolved()
const openAfter = await page.locator('.pcard.open').count()
console.log(`在 ${tNow} 记录 F 题通过后：自己 ${solvedAfter} 题；解锁题卡 ${openBefore} → ${openAfter}`)
if (solvedAfter !== 1) throw new Error(`通过后应该是 1 题，实际 ${solvedAfter}`)
if (openAfter !== openBefore) throw new Error('自己的通过不该点亮题卡')

// 3. 再交两次没通过（别的题），榜面不动
await page.locator('.manual-letters .letter-chip').nth(8).click() // I 题
await page.getByRole('button', { name: '没通过' }).click()
await page.getByRole('button', { name: '没通过' }).click()
if ((await selfSolved()) !== 1) throw new Error('没通过的提交不该改变通过数')
const logRows = await page.locator('.manual-log li').count()
console.log(`记录流水 ${logRows} 条`)
if (logRows !== 3) throw new Error(`流水应该有 3 条，实际 ${logRows}`)

// 4. 撤销最后一条
await page.getByRole('button', { name: '撤销' }).click()
await page.waitForTimeout(300)
if ((await page.locator('.manual-log li').count()) !== 2) throw new Error('撤销没有生效')

// 5. 抽屉里能看到自己的逐题结果（此刻 F 还没解锁）
await selfInfo.locator('.team-button').click()
await page.waitForSelector('.drawer')
const ac = await page.locator('.drawer .mini-cell.ac').count()
const locked = await page.locator('.drawer .mini-cell.locked').count()
console.log(`抽屉里自己的通过格子：${ac}（其余 ${locked} 格仍在雾里）`)
if (ac < 1) throw new Error('抽屉里看不到自己的题')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 6. 回到 AC 之前：自己那行应该还是 0 题
await seekRatio(600 / 18000)
if ((await selfSolved()) !== 0) throw new Error('AC 之前应该是 0 题')

await seekRatio(1600 / 18000)
await page.waitForTimeout(300)
await page.screenshot({ path: OUT + '/19-virtual-team.png' })

// 7. 封榜之后：榜面停住，只有自己的卡片继续记账
await seekRatio(16200 / 18000) // 4:30
const boardBefore = await selfSolved()
await page.locator('.manual-letters .letter-chip').nth(6).click() // G 题
await page.getByRole('button', { name: '通过了' }).click()
await page.waitForTimeout(500)
const boardAfter = await selfSolved()
const cardMeta = (await page.locator('.manual-meta').innerText()).replace(/\s+/g, ' ')
const hint = await page.locator('.manual-frozen').count()
console.log(`封榜中记一题：榜面 ${boardBefore} → ${boardAfter}，自己的账本「${cardMeta}」，提示 ${hint}`)
if (boardAfter !== boardBefore) throw new Error('封榜后自己那行不该跟着变')
if (!cardMeta.includes('2 题')) throw new Error(`自己的账本应该是 2 题：${cardMeta}`)
if (hint !== 1) throw new Error('没有提示"封榜中"')
await page.screenshot({ path: OUT + '/21-frozen-self.png' })

// 8. 解封之后追平
await page.getByRole('button', { name: '解封' }).click()
await page.waitForTimeout(500)
const revealed = await selfSolved()
console.log(`解封后自己那行：${revealed} 题`)
if (revealed !== 2) throw new Error(`解封后应该是 2 题，实际 ${revealed}`)

await browser.close()
if (errors.length) {
  console.error('控制台错误：', errors)
  process.exit(1)
}
console.log('虚拟队伍 OK')
