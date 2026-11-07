// Real-browser checks for the unified light surfaces and the complete responsive board.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.BASE_URL || 'http://127.0.0.1:5173/'
const out = process.env.SCREENSHOT_DIR || 'docs/screenshots'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
const widths = [1024, 1280, 1366, 1440, 1600, 1920]
const panelButton = () => page.locator('button[aria-controls="contest-panel"]')
const seek = async sec => {
  const box = await page.locator('.tl-track').boundingBox()
  assert.ok(box, 'timeline is available')
  await page.mouse.click(box.x + box.width * sec / 18000, box.y + box.height / 2)
  await page.waitForFunction(wanted => Math.abs(Number(document.querySelector('.tl-track').getAttribute('aria-valuenow')) - wanted) <= 1, sec)
}
const settle = async () => {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(90)
}
const assertLight = async (selector, context) => {
  const surfaces = await page.locator(selector).evaluateAll(elements => elements.map(el => {
    // Resolve transparent surfaces against their ancestors rather than mistaking them for black.
    let color = [255, 255, 255]
    const ancestors = []
    for (let current = el; current; current = current.parentElement) ancestors.unshift(current)
    for (const ancestor of ancestors) {
      const channels = getComputedStyle(ancestor).backgroundColor.match(/[\d.]+/g)?.map(Number)
      if (!channels || channels.length < 3) continue
      const alpha = channels[3] ?? 1
      color = color.map((value, index) => channels[index] * alpha + value * (1 - alpha))
    }
    const linear = color.map(value => {
      value /= 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return { className: el.className, color, luminance: 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] }
  }))
  assert.ok(surfaces.length, context + ': visible surface exists')
  for (const surface of surfaces) assert.ok(surface.luminance > 0.72, context + ': dark surface ' + JSON.stringify(surface))
}
const closeOverlay = async () => {
  if (await page.locator('.rail-overlay-scrim').isVisible()) {
    await page.keyboard.press('Escape')
    await page.locator('.rail-overlay-scrim').waitFor({ state: 'hidden' })
  }
}
const geometry = async () => page.evaluate(() => {
  const wrap = document.querySelector('.board-wrap')
  const board = document.querySelector('.board')
  const header = board.querySelector('.h-slot:last-child')
  const lastCell = board.querySelector('.score-team-result .pcell:last-child')
  const container = wrap.getBoundingClientRect()
  const rightEdge = wrap.clientLeft + container.left + wrap.clientWidth
  const clipped = [...board.querySelectorAll('.tile-time,.tile-main,.tile-fail-time')].filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1).slice(0, 8).map(el => ({ text: el.textContent, width: el.clientWidth, content: el.scrollWidth }))
  return {
    viewport: window.innerWidth,
    bodyWidth: document.documentElement.scrollWidth,
    wrapWidth: wrap.clientWidth,
    scrollWidth: wrap.scrollWidth,
    headerRight: header.getBoundingClientRect().right,
    lastCellRight: lastCell.getBoundingClientRect().right,
    lastContentRight: (lastCell.querySelector('.tile,.tile-fail,.tile-empty') || lastCell).getBoundingClientRect().right,
    rightEdge,
    headerCount: board.querySelectorAll('.h-slot').length,
    clipped,
  }
})
const assertDesktop = async (width, sample, phase) => {
  const size = await geometry()
  const context = sample + ' ' + phase + ' @' + width
  assert.equal(size.headerCount, 13, context + ': all problem headers exist')
  assert.ok(size.bodyWidth <= width + 1, context + ': body overflows ' + JSON.stringify(size))
  assert.ok(size.scrollWidth <= size.wrapWidth + 1, context + ': board requires horizontal scroll ' + JSON.stringify(size))
  assert.ok(size.headerRight <= size.rightEdge + 1, context + ': last header is clipped ' + JSON.stringify(size))
  assert.ok(size.lastCellRight <= size.rightEdge + 1, context + ': last problem cell is clipped ' + JSON.stringify(size))
  assert.deepEqual(size.clipped, [], context + ': tile text is clipped')
  console.log('✓ ' + context + ' · ' + size.wrapWidth + 'px board')
}
const loadSample = async name => {
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(name) }).click()
  const skip = page.getByRole('button', { name: '先不用', exact: true })
  await skip.click()
  await page.locator('.board').waitFor()
  await settle()
}
try {
  await page.goto(base)
  await settle()
  await assertLight('body,.topbar,.dropzone', 'empty state')
  console.log('✓ empty light surfaces')
  for (const sample of ['成都站', '秦皇岛站']) {
    await loadSample(sample)
    await page.locator('.toast').waitFor({ state: 'hidden' })
    for (const phase of ['live', 'frozen']) {
      await seek(phase === 'live' ? 8160 : 14700)
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 })
        await closeOverlay()
        if (width > 1280 && await panelButton().getAttribute('aria-expanded') === 'false') await panelButton().click()
        await settle()
        await assertDesktop(width, sample, phase)
        await assertLight('.topbar,.playbar,.timeline', sample + ' chrome')
        if (sample === '成都站' && phase === 'live' && width === 1600) {
          await page.locator('.toast').waitFor({ state: 'hidden' })
          await page.screenshot({ path: out + '/responsive-1600-live.png' })
        }
        if (sample === '秦皇岛站' && phase === 'frozen' && width === 1366) await page.screenshot({ path: out + '/responsive-1366-frozen.png' })
      }
    }
    const last = page.locator('.score-team-result').last()
    await last.scrollIntoViewIfNeeded()
    const visible = await last.evaluate(el => {
      const row = el.getBoundingClientRect()
      const container = el.closest('.board-wrap').getBoundingClientRect()
      return row.top >= container.top && row.bottom <= container.bottom + 1
    })
    assert.ok(visible, sample + ': last team can be reached by vertical scrolling')
    await page.locator('.board-wrap').evaluate(el => { el.scrollTop = 0 })
  }
  await page.setViewportSize({ width: 1024, height: 900 })
  await closeOverlay()
  // Side panel must remain reachable on compact desktops, with all three close methods.
  for (const close of ['button', 'escape', 'backdrop']) {
    await panelButton().click()
    await page.locator('.rail-overlay-scrim').waitFor({ state: 'visible' })
    await assertLight('.rail', 'compact side panel')
    if (close === 'button') await panelButton().click()
    if (close === 'escape') await page.keyboard.press('Escape')
    if (close === 'backdrop') await page.locator('.rail-overlay-scrim').click({ position: { x: 8, y: 8 } })
    await page.locator('.rail-overlay-scrim').waitFor({ state: 'hidden' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await settle()
  const mobile = await geometry()
  assert.ok(mobile.bodyWidth <= 391, 'mobile: body remains inside viewport')
  assert.ok(mobile.scrollWidth > mobile.wrapWidth, 'mobile: board keeps horizontal scrolling')
  await page.locator('.board-wrap').evaluate(el => { el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }) })
  await settle()
  const mobileEnd = await geometry()
  assert.ok(mobileEnd.lastCellRight <= mobileEnd.rightEdge + 1, 'mobile: last problem can be reached ' + JSON.stringify(mobileEnd))
  await panelButton().click()
  await page.locator('.rail-overlay-scrim').waitFor({ state: 'visible' })
  await assertLight('.rail', 'mobile side panel')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.locator('.board-wrap').evaluate(el => { el.scrollLeft = 0 })
  if (await panelButton().getAttribute('aria-expanded') === 'false') await panelButton().click()
  await assertLight('.rail', 'desktop side panel')
  await page.locator('.pcard.open').first().click()
  await page.locator('.pdetail-head').waitFor()
  await assertLight('.rail', 'problem details')
  await page.locator('.rail-back').click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('dialog', { name: '回放规则', exact: true }).waitFor()
  await assertLight('.dialog,.dialog-head,.dialog-body,.dialog-foot', 'settings dialog')
  await page.screenshot({ path: out + '/responsive-settings.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await assertLight('.dialog,.dialog-body', 'import dialog')
  await page.screenshot({ path: out + '/responsive-import.png' })
  await page.keyboard.press('Escape')
  await page.locator('.score-team-info .team-button').first().click()
  await page.locator('.drawer').waitFor()
  await assertLight('.drawer', 'team drawer')
  await page.screenshot({ path: out + '/responsive-team.png' })
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  console.log('✓ 24 desktop dataset/phase/width combinations, full-board scrolling, compact/mobile panel access, light surfaces, dialogs and drawer')
} finally { await browser.close() }
