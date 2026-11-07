// 用本机 Chrome 跑一遍核心交互并截图。
// 用法：先 `pnpm dev`，再 `node scripts/verify-ui.mjs`
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const OUT = process.env.SCREENSHOT_DIR || 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const errors = []
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1 })
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

const shot = async (name) => {
  await page.waitForTimeout(220)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`✓ ${name}`)
}

const seekRatio = async (ratio) => {
  const box = await page.locator('.tl-track').boundingBox()
  if (!box) throw new Error('找不到时间轴')
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
  await page.waitForTimeout(160)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.empty')
await shot('01-empty')

// 导入榜单后会弹「创建我的队伍」，这里先跳过（专属流程见 verify-team.mjs）
const skipTeamDialog = async () => {
  await page.waitForTimeout(300)
  const btn = page.getByRole('button', { name: '先不用' })
  if (await btn.count()) {
    await btn.click()
    await page.waitForTimeout(200)
  }
}

// 载入成都站示例
await page.getByRole('button', { name: /成都站/ }).click()
await skipTeamDialog()
await page.waitForSelector('.board .score-team-info')
const rowCount = await page.locator('.board .score-team-info').count()
const colCount = await page.locator('.board thead th').count()
const slotCount = await page.locator('.board thead th.h-slot').count()
console.log(`rows=${rowCount} cols=${colCount} slots=${slotCount}`)
if (rowCount !== 328) throw new Error(`期望 328 行，实际 ${rowCount}`)
if (colCount !== 16) throw new Error(`期望 16 列（3 信息列 + 13 道题），实际 ${colCount}`)
if (slotCount !== 13) throw new Error(`期望 13 个题目格，实际 ${slotCount}`)
await shot('02-t0')

// 播放时钟按墙钟推算：后台标签页会冻结 rAF，靠帧累加就会"挂后台不动"
const readClock = async () => {
  const text = (await page.locator('.clock').innerText()).trim()
  const [h, m, s] = text.split(':').map(Number)
  return h * 3600 + m * 60 + s
}
await page.locator('.play-btn').click()
await page.waitForTimeout(500)
await page.evaluate(() => {
  window.__realNow = Date.now
  window.__offset = 0
  Date.now = () => window.__realNow() + window.__offset
  window.__jump = (ms) => {
    window.__offset += ms
  }
})
const clockBefore = await readClock()
await page.evaluate(() => window.__jump(10 * 60 * 1000))
await page.waitForTimeout(500)
const clockAfter = await readClock()
await page.evaluate(() => {
  Date.now = window.__realNow
})
console.log(`时钟：墙钟前拨 10 分钟后 ${clockBefore}s → ${clockAfter}s`)
if (clockAfter - clockBefore < 595) throw new Error(`时钟没按墙钟走：${clockBefore} → ${clockAfter}`)
await page.locator('.play-btn').click()
await page.locator('.icon-btn').first().click()
await page.waitForTimeout(200)
const clockReset = await readClock()
if (clockReset > 2) throw new Error(`回到开始失败：${clockReset}s`)

// 20:10 —— M 题解锁
await seekRatio(1210 / 18000)
const openAt20 = await page.locator('.pcard.open').count()
console.log(`20:10 右栏已点亮 ${openAt20} 题`)
if (openAt20 !== 1) throw new Error(`20:10 应该只有 1 题解锁，实际 ${openAt20}`)
await shot('03-t20m')

// 2:16 —— 5 题解锁
await seekRatio(8160 / 18000)
const openAt131 = await page.locator('.pcard.open').count()
console.log(`2:16 已点亮 ${openAt131} 题`)
if (openAt131 !== 5) throw new Error(`2:16 应该有 5 题解锁，实际 ${openAt131}`)

// 解锁后：已揭题固定到左侧；题卡上通过/提交都能看到
const namedColumns = await page.locator('.h-problem').count()
const namedCells = await page.locator('.pcell:not(.is-anonymous):not(.is-empty)').count()
const golds = await page.locator('.c-rank.has-gold').count()
const foggy = await page.locator('.pcard.locked').count()
const cardText = (await page.locator('.pcard.open').first().innerText()).replace(/\s+/g, ' ')
console.log(`已揭题列 ${namedColumns} 个、对应结果格 ${namedCells} 个 · 金牌 ${golds} 人 · 雾卡 ${foggy} 张 · 卡片「${cardText}」`)
if (namedColumns !== 5 || namedCells < 100) throw new Error(`解锁后的固定题目列异常：${namedColumns} 列 / ${namedCells} 个结果格`)
if (golds !== 33) throw new Error(`328 队按 10% 应该有 33 个金牌，实际 ${golds}`)
if (foggy !== 8) throw new Error(`2:16 应该还有 8 张雾卡，实际 ${foggy}`)
if (!/ \d+ \d+\+?/.test(cardText)) throw new Error(`题卡上应该同时有通过数与提交数：${cardText}`)
await shot('04-t131m')

// 点开一道已解锁的题看通过名单
await page.locator('.pcard.open').first().click()
await page.waitForSelector('.solver')
const solverCount = await page.locator('.solver').count()
console.log(`题目详情里能看到 ${solverCount} 支通过队伍`)
if (solverCount < 10) throw new Error(`题目详情通过名单异常：${solverCount}`)
await shot('04b-problem')
await page.locator('.rail-back').click()
await page.waitForTimeout(150)

// 4:05 —— 封榜
await seekRatio(14700 / 18000)
const phaseText = (await page.locator('.playbar-right .chip').last().innerText()).trim()
console.log(`4:05 阶段标记：${phaseText}`)
if (!phaseText.includes('封榜中')) throw new Error(`4:05 应处于封榜，实际 ${phaseText}`)
await shot('05-frozen')

// 解封
await page.getByRole('button', { name: '解封' }).click()
await page.waitForTimeout(200)
await shot('06-unsealed')

// 终榜
await seekRatio(0.998)
await page.waitForTimeout(250)
await shot('07-final')

// 队伍抽屉
await page.locator('.board .score-team-info').nth(0).locator('.team-button').click()
await page.waitForSelector('.drawer')
await shot('08-drawer')
await page.keyboard.press('Escape')

// 设置面板
await page.getByRole('button', { name: '设置' }).click()
await page.waitForSelector('.dialog')
await shot('09-settings')
await page.keyboard.press('Escape')

// 规则面板
await page.getByRole('button', { name: '规则' }).click()
await page.waitForSelector('.dialog')
await shot('10-rules')
await page.keyboard.press('Escape')

// 播放
await page.locator('.play-btn').click()
await page.waitForTimeout(1200)
const clock = await page.locator('.clock').innerText()
console.log(`播放中的时钟：${clock}`)
await shot('11-playing')
await page.locator('.play-btn').click()

// 秦皇岛站
await page.getByRole('button', { name: '导入' }).click()
await page.waitForSelector('.dialog')
await page.getByRole('button', { name: /秦皇岛站/ }).click()
await skipTeamDialog()
await page.waitForSelector('.board .score-team-info')
const qhdRows = await page.locator('.board .score-team-info').count()
console.log(`秦皇岛 rows=${qhdRows}`)
if (qhdRows !== 375) throw new Error(`秦皇岛期望 375 行，实际 ${qhdRows}`)
await seekRatio(3100 / 18000)
await shot('12-qinhuangdao')

// 移动端
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(250)
await shot('13-mobile')

// 回到桌面，测搜索 / 我的队伍 / 帧率
await page.setViewportSize({ width: 1600, height: 980 })
await seekRatio(1210 / 18000)
await page.locator('.search-box input').fill('武汉')
await page.waitForTimeout(200)
const filtered = await page.locator('.board .score-team-info').count()
console.log(`搜索「武汉」→ ${filtered} 行`)
if (filtered === 0 || filtered >= 100) throw new Error(`搜索筛选异常：${filtered}`)
await shot('14-search')
await page.locator('.search-clear').click()

// 回到成都站，验证「我的队伍」的明细豁免
await page.getByRole('button', { name: '导入' }).click()
await page.waitForSelector('.dialog')
await page.getByRole('button', { name: /成都站/ }).click()
await skipTeamDialog()
await page.waitForSelector('.board .score-team-info')
await seekRatio(3600 / 18000)

// 普通队伍的抽屉：未解锁的题应该留雾
await page.locator('.board .score-team-info').nth(1).locator('.team-button').click()
await page.waitForSelector('.drawer')
const otherLocked = await page.locator('.drawer .mini-cell.locked').count()
console.log(`普通队伍抽屉里未解锁的格子：${otherLocked}`)
if (otherLocked === 0) throw new Error('普通队伍的抽屉没有隐藏未解锁的题')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// 设为我的队伍后：自己的格子全部可见
await page.locator('.board .score-team-info').nth(0).locator('.team-button').click()
await page.waitForSelector('.drawer')
await page.getByRole('button', { name: '设为「我的队伍」' }).click()
await page.waitForTimeout(300)
await page.locator('.score-team-info.is-self .team-button').click()
await page.waitForSelector('.drawer')
const selfLocked = await page.locator('.drawer .mini-cell.locked').count()
const selfAc = await page.locator('.drawer .mini-cell.ac').count()
console.log(`我的队伍抽屉：${selfAc} 题可见，${selfLocked} 题是雾`)
if (selfLocked !== 0 || selfAc === 0) throw new Error('「我的队伍」的抽屉没有显示自己的全部题目')
await page.waitForTimeout(3400)
await shot('15-self-team')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// 帧率（30× 播放）
await page.locator('.segmented button', { hasText: '30×' }).click()
await page.locator('.play-btn').click()
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      const tick = () => {
        frames += 1
        if (performance.now() - start < 2500) requestAnimationFrame(tick)
        else resolve(frames / ((performance.now() - start) / 1000))
      }
      requestAnimationFrame(tick)
    }),
)
await page.locator('.play-btn').click()
console.log(`30× 播放时帧率约 ${fps.toFixed(1)} fps`)
if (fps < 24) throw new Error(`播放帧率过低：${fps.toFixed(1)} fps`)

// QOJ 导入（粘贴抓取脚本的 JSON）
await page.getByRole('button', { name: '导入', exact: true }).click()
await page.waitForSelector('.dialog')
await shot('17-qoj-import')
const qojText = readFileSync('fixtures/qoj-paste.txt', 'utf8')
await page.locator('.qoj-input').fill(qojText)
await page.getByRole('button', { name: '导入这段内容' }).click()
await skipTeamDialog()
await page.waitForTimeout(500)
const qojRows = await page.locator('.board .score-team-info').count()
const railText = await page.locator('.rail').innerText()
console.log(`QOJ 纯文本导入 → ${qojRows} 行；来源标记：${railText.includes('QOJ') ? 'QOJ ✓' : '缺失'}`)
if (qojRows !== 5) throw new Error(`QOJ 导入行数异常：${qojRows}`)
if (!railText.includes('QOJ')) throw new Error('右栏没有显示 QOJ 来源')
const qojBoard = await page.locator('.board .score-team-info').first().innerText()
if (!qojBoard.includes('USA1')) throw new Error(`QOJ 第一行异常：${qojBoard}`)
await seekRatio(0.62)
await shot('16-qoj')

await browser.close()

if (errors.length) {
  console.error('控制台错误：')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('全部通过，截图在', OUT)
