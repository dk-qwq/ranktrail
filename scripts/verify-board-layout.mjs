// pnpm verify:board — 已揭题靠左、匿名与封榜逐题布局的真实浏览器回归。
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const out = process.env.SCREENSHOT_DIR || 'docs/screenshots'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
const seek = async (sec) => {
  const box = await page.locator('.tl-track').boundingBox()
  await page.mouse.click(box.x + box.width * sec / 18000, box.y + box.height / 2)
  await page.waitForFunction((wanted) => Math.abs(Number(document.querySelector('.tl-track').getAttribute('aria-valuenow')) - wanted) <= 1, sec)
}
const headers = () => page.locator('.h-slot').evaluateAll((els) => els.map((el) => el.querySelector('.n')?.textContent || '?'))
const result = async (name) => page.locator('.score-team-info').filter({ has: page.getByText(name, { exact: true }) }).evaluate((el) => {
  const row = el.nextElementSibling
  return {
    rank: row.querySelector('.rank-num').textContent,
    medal: row.querySelector('.c-rank').className,
    solved: row.querySelector('.solved-num').textContent,
    cells: [...row.querySelectorAll('.pcell')].map((cell) => ({
      text: cell.textContent, title: cell.title,
      kind: cell.classList.contains('is-empty') ? 'empty' : cell.classList.contains('is-fail') ? 'fail' : 'ac',
    })),
  }
})
const skipTeam = async () => { await page.getByRole('button', { name: '先不用', exact: true }).click() }
try {
  await page.goto(base)
  // N=10，阈值为2。只有 G 在赛时揭开，C 的 AC 在封榜后。
  const data = {
    contest_name: '榜单布局回归', timestamp_unit: 'second',
    problems: [...'ABCDEFG'].map((label) => ({ id: label, label })),
    teams: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), name: '测试队' + (i + 1), organization: '测试学校', group: ['official'], members: ['甲', '乙', '丙'], coaches: ['教练'] })),
    runs: [
      ['1', 'G', 300, 'WRONG_ANSWER'], ['1', 'G', 600, 'CORRECT'], ['2', 'G', 900, 'CORRECT'],
      ['1', 'A', 1000, 'CORRECT'], ['2', 'B', 1200, 'CORRECT'],
      ['1', 'C', 700, 'WRONG_ANSWER'], ['1', 'C', 14000, 'WRONG_ANSWER'], ['1', 'C', 15000, 'CORRECT'],
      ['3', 'F', 1600, 'CORRECT'], ['4', 'E', 1700, 'CORRECT'], ['5', 'D', 1800, 'CORRECT'],
      ['6', 'G', 1650, 'CORRECT'], ['7', 'G', 1750, 'CORRECT'],
    ].map(([team_id, problem_id, timestamp, status]) => ({ team_id, problem_id, timestamp, status })),
  }
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'board-layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
  await skipTeam()
  await seek(1900)
  assert.deepEqual(await headers(), ['G', '?', '?', '?', '?', '?', '?'])
  assert.equal(await page.locator('.h-anonymous svg').count(), 6)
  assert.equal(await page.locator('.score-team-info').count(), 10)
  let row = await result('测试队1')
  assert.equal(row.cells[0].kind, 'ac'); assert.match(row.cells[0].title, /G 题.*2 次提交/)
  assert.equal(row.cells[1].kind, 'fail'); assert.doesNotMatch(row.cells[1].title, /C 题/)
  assert.equal(row.cells[2].kind, 'ac'); assert.doesNotMatch(row.cells[2].title, /A 题/)
  const medalCounts = await page.locator('.score-team-result').evaluateAll((rows) => ({
    gold: rows.filter(r => r.querySelector('.has-gold')).length,
    silver: rows.filter(r => r.querySelector('.has-silver')).length,
    bronze: rows.filter(r => r.querySelector('.has-bronze')).length,
    none: rows.filter(r => !r.querySelector('.has-gold,.has-silver,.has-bronze')).length,
  }))
  assert.deepEqual(medalCounts, { gold: 1, silver: 2, bronze: 3, none: 4 }) // 0题队伍无奖
  const rankColors = await page.locator('.score-team-result').evaluateAll(rows => {
    const colors = {};
    for (const row of rows) {
      const cell = row.querySelector('.c-rank');
      const medal = ['gold', 'silver', 'bronze'].find(value => cell.classList.contains('has-' + value)) || 'none';
      colors[medal] = getComputedStyle(cell.querySelector('.rank-num')).backgroundColor;
    }
    return colors;
  });
  assert.deepEqual(rankColors, { gold: 'rgb(223, 170, 4)', silver: 'rgb(180, 189, 207)', bronze: 'rgb(191, 121, 56)', none: 'rgb(236, 238, 241)' });
  await seek(14399)
  assert.equal(await page.locator('.board-live').count(), 1)
  assert.deepEqual(await headers(), ['G', '?', '?', '?', '?', '?', '?'])
  // 用10秒前进按钮越过精确封榜边界。
  await page.getByRole('button', { name: '前进 10 秒', exact: true }).click()
  await page.locator('.freeze-banner').waitFor()
  assert.equal(await page.locator('.board-live').count(), 0)
  assert.deepEqual(await headers(), [...'ABCDEFG'])
  const frozen = await result('测试队1')
  assert.equal(frozen.cells[2].kind, 'fail'); assert.match(frozen.cells[2].title, /2 次错误提交/)
  assert.equal(frozen.solved, '2')
  await seek(17000)
  assert.deepEqual(await result('测试队1'), frozen)
  await page.getByRole('button', { name: '解封', exact: true }).click()
  row = await result('测试队1'); assert.equal(row.solved, '3'); assert.equal(row.cells[2].kind, 'ac')
  await seek(1900)
  await page.keyboard.press('u') // 恢复赛时匿名信息
  assert.deepEqual(await headers(), ['G', '?', '?', '?', '?', '?', '?'])
  await page.keyboard.press('Home')
  assert.deepEqual(await headers(), ['?', '?', '?', '?', '?', '?', '?'])
  // 两份真实样例的外观、搜索、抽屉和窄屏。
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.getByRole('button', { name: /成都站/ }).click(); await skipTeam()
  await seek(8160)
  assert.deepEqual(await headers(), ['C', 'D', 'I', 'K', 'M', '?', '?', '?', '?', '?', '?', '?', '?'])
  assert.equal(await page.locator('.score-team-info').count(), 328)
  await page.locator('.toast').waitFor({ state: 'hidden' })
  await page.screenshot({ path: out + '/26-live-layout.png' })
  await page.locator('.score-team-info .team-button').first().click(); await page.locator('.drawer').waitFor(); await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '搜索队伍', exact: true }).fill('武汉')
  const count = await page.locator('.score-team-info').count(); assert.ok(count > 0 && count < 100)
  await page.getByRole('button', { name: '清空搜索', exact: true }).click()
  await seek(14700)
  assert.deepEqual(await headers(), [...'ABCDEFGHIJKLM'])
  await page.screenshot({ path: out + '/27-frozen-layout.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: out + '/28-mobile-layout.png' })
  assert.ok(await page.locator('.board-wrap').evaluate(el => el.scrollWidth > el.clientWidth))
  await page.locator('.board-wrap').evaluate(el => { el.scrollLeft = el.scrollWidth })
  assert.equal(await page.locator('.topbar').evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await page.setViewportSize({ width: 1800, height: 1100 })
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.getByRole('button', { name: /秦皇岛站/ }).click(); await skipTeam()
  await seek(14700)
  assert.equal(await page.locator('.has-second-times').count(), 1)
  assert.deepEqual(await headers(), [...'ABCDEFGHIJKLM'])
  const overflowingTimes = await page.locator('.board .tile-time').evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).length)
  assert.equal(overflowingTimes, 0)
  assert.deepEqual(errors, [])
  console.log('✓ G揭题靠左、匿名隐藏、回退、精确封榜、冻结与解封、奖牌、真实榜单、抽屉、搜索、窄屏、秒级时间均通过')
} finally { await browser.close() }
