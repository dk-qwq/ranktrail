import type { CellResult, Diagnostic, ProblemInfo, TeamRecord } from '../types'
import type { ParsedSheet } from './xcpcio'
import { info, warning } from './shared'

/**
 * QOJ 榜单导入。
 *
 * QOJ 榜单可能需要登录或通过 Cloudflare 检查。抓取脚本在已打开的榜单页读取表格。
 *
 * 抓取结果是一张表的原样序列化（单元格文本 + title + data-*），
 * 解析（认表头、认 +k/-n、认时刻）全部放在这里做，抓取端保持"哑"。
 */

export interface QojCell {
  /** 单元格文本（空白已折叠） */
  t: string
  /** title 属性 */
  ti?: string
  /** data-* 属性 */
  d?: Record<string, string>
}

export interface QojDump {
  v?: number
  url?: string
  title?: string
  rows: QojCell[][]
}

/** 在 QOJ 控制台运行，合并分页表格并复制到剪贴板 */
export const QOJ_SNIPPET = `(() => {
  const standingsRoot = document.querySelector('#standings');
  const pageNumber = (el) => Number(el?.textContent?.trim());
  const currentPage = () => pageNumber(standingsRoot?.querySelector('.pagination li.active')) || 1;
  const findPage = (page) => [...(standingsRoot?.querySelectorAll('.pagination li:not(.disabled) > a') ?? [])]
    .find(link => pageNumber(link) === page);
  // QOJ 的分页在浏览器中同步重绘表格和页码。每次翻页后重新查找链接。
  const goToPage = (page) => {
    while (currentPage() !== page) {
      const current = currentPage();
      const step = current + Math.sign(page - current);
      const link = findPage(page) || findPage(step);
      if (!link) throw new Error('找不到第 ' + step + ' 页的链接');
      const target = pageNumber(link);
      if (typeof window.jQuery === 'function') window.jQuery(link).triggerHandler('click');
      if (currentPage() === current) link.click();
      if (currentPage() !== target) throw new Error('无法打开第 ' + target + ' 页');
    }
  };
  const readRows = () => {
    const tables = [...(standingsRoot || document).querySelectorAll('table')];
    let table = tables[0];
    if (!standingsRoot) {
      const score = (tb) => [...tb.querySelectorAll('td')].filter(c => /^\\*?[+\\-]/.test(c.innerText.trim())).length;
      const candidate = tables.map(tb => [score(tb), tb]).sort((a, b) => b[0] - a[0])[0];
      table = candidate?.[0] >= 5 ? candidate[1] : null;
    }
    if (!table) throw new Error('没找到榜单表格，请确认当前页面是比赛榜单');
    return [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(c => ({
      t: c.innerText.replace(/\\s+/g, ' ').trim(),
      ti: c.getAttribute('title') || '',
      d: Object.fromEntries([...c.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name.slice(5), a.value]))
    })));
  };
  const initialPage = currentPage();
  const headerText = (row) => row?.map(cell => cell.t).join('\\t');
  let rows;
  try {
    goToPage(1);
    rows = readRows();
    if (!rows.length) throw new Error('榜单表格为空');
    const header = headerText(rows[0]);
    for (let page = 2; findPage(page); page += 1) {
      goToPage(page);
      const [pageHeader, ...teams] = readRows();
      if (!teams.length || headerText(pageHeader) !== header) {
        throw new Error('第 ' + page + ' 页的榜单表格不完整');
      }
      rows.push(...teams);
    }
    const fullStandings = typeof standings === 'undefined' ? window.standings : standings;
    if (standingsRoot && Array.isArray(fullStandings) && rows.length - 1 !== fullStandings.length) {
      throw new Error('抓到 ' + (rows.length - 1) + ' 队，QOJ 榜单共有 ' + fullStandings.length + ' 队');
    }
  } catch (error) {
    console.warn('QOJ 榜单抓取失败：' + error.message);
    return;
  } finally {
    try { goToPage(initialPage); }
    catch (error) { console.warn('未能恢复原来的榜单页：' + error.message); }
  }
  const out = { v: 1, url: location.href, title: document.title, rows };
  const json = JSON.stringify(out);
  console.log('题迹：抓到 ' + (rows.length - 1) + ' 支队伍');
  if (typeof copy === 'function') { copy(json); }
  else {
    const ta = document.createElement('textarea'); ta.value = json;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  console.log('已复制，回到题迹点「粘贴并导入」');
})()`

const LETTER_HEADER = /^([A-Z])(\s|\/|\(|$)/

function norm(v: unknown): string {
  return (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()
}

type TimeMode = 'hmm' | 'mss'

interface ParsedCell {
  ac: boolean
  /** 提交总次数（含通过那一次） */
  attempts: number
  sec?: number
  /** 首杀（QOJ 用 "*+" 标记） */
  firstBlood?: boolean
}

function parseTime(raw: string, mode: TimeMode): number | undefined {
  const m = /(\d{1,3}):(\d{2})(?::(\d{2}))?/.exec(raw)
  if (!m) return undefined
  const a = Number(m[1])
  const b = Number(m[2])
  if (m[3] != null) return a * 3600 + b * 60 + Number(m[3])
  return mode === 'mss' ? a * 60 + b : a * 3600 + b * 60
}

/**
 * 解析一个题目格。
 * QOJ 的写法是 "+k 1:06"：k 是**错误次数**（和 xcpcio 的 k-1 不同），所以 attempts = k + 1。
 * 前面可能带 "*" 表示首杀。
 */
function parseCell(text: string, mode: TimeMode): ParsedCell | null {
  let t = norm(text)
  if (!t) return null
  const firstBlood = t.startsWith('*')
  if (firstBlood) t = t.slice(1).trim()
  const m = /^([+-])\s*(\d*)(?:\s+(.+))?$/.exec(t)
  if (!m) return null
  const sign = m[1]
  const n = m[2] ? Number(m[2]) : 0
  const rest = m[3] ?? ''
  if (sign === '+') {
    return { ac: true, attempts: n + 1, sec: rest ? parseTime(rest, mode) : undefined, firstBlood }
  }
  // "-" 单独出现 = 这题没提交；"-15" = 15 次错误提交
  if (n === 0) return null
  return { ac: false, attempts: n, sec: rest ? parseTime(rest, mode) : undefined, firstBlood }
}

interface SplitTeam {
  name: string
  organization: string
  starred: boolean
  members: string[]
}

/**
 * "北京大学 - 飞带不长队" → 机构 + 队名
 * "USA1 (Andrew He, Kevin Sun, Gennady Korotkevich)" → 队名 + 队员
 * 括号里只要出现数字（比如 "(1/3 failed to sync)"）就当成队名的一部分，不拆。
 */
function splitTeam(raw: string): SplitTeam {
  let text = norm(raw)
  const starred = text.startsWith('*')
  if (starred) text = text.slice(1).trim()

  let members: string[] = []
  const paren = /^(.*?)\s*\(([^()]*)\)$/.exec(text)
  if (paren) {
    const inside = paren[2].trim()
    const parts = inside
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const looksLikeMembers =
      parts.length > 0 &&
      !/\d/.test(inside) &&
      parts.every((p) => p.length >= 2) &&
      (parts.length > 1 || parts[0].includes(' '))
    if (looksLikeMembers && paren[1].trim()) {
      members = parts
      text = paren[1].trim()
    }
  }

  const sep = text.indexOf(' - ')
  if (sep > 0) {
    return {
      name: text.slice(sep + 3).trim(),
      organization: text.slice(0, sep).trim(),
      starred,
      members,
    }
  }
  return { name: text, organization: '', starred, members }
}

interface QojLayout {
  headerIndex: number
  problemCols: { letter: string; index: number }[]
  nameIndex: number
  solvedIndex: number
  penaltyIndex: number
}

function detectLayout(rows: QojCell[][]): QojLayout | null {
  let headerIndex = -1
  let best = 0
  rows.forEach((row, i) => {
    const n = row.filter((c) => LETTER_HEADER.test(norm(c.t))).length
    if (n > best) {
      best = n
      headerIndex = i
    }
  })
  if (headerIndex < 0 || best < 2) return null

  const header = rows[headerIndex]
  const problemCols: { letter: string; index: number }[] = []
  const seen = new Set<string>()
  header.forEach((c, i) => {
    const m = LETTER_HEADER.exec(norm(c.t))
    if (m && !seen.has(m[1])) {
      seen.add(m[1])
      problemCols.push({ letter: m[1], index: i })
    }
  })
  if (problemCols.length < 2) return null

  const firstProblem = problemCols[0].index
  let nameIndex = -1
  for (let i = 1; i < firstProblem; i += 1) {
    const t = norm(header[i]?.t)
    if (t && !/^[\d.*#]+$/.test(t)) {
      nameIndex = i
      break
    }
  }
  if (nameIndex < 0 && firstProblem >= 2) nameIndex = 1
  if (nameIndex < 0) nameIndex = 0

  const findHeader = (re: RegExp) => header.findIndex((c) => re.test(norm(c.t)))
  const solvedIndex = findHeader(/^(solved|通过数?)$/i)
  const penaltyIndex = findHeader(/^(penalty|罚时|time)$/i)

  return { headerIndex, problemCols, nameIndex, solvedIndex, penaltyIndex }
}

function isDataRow(row: QojCell[], layout: QojLayout): boolean {
  if (row.length <= layout.problemCols[0].index) return false
  const name = norm(row[layout.nameIndex]?.t)
  if (!name) return false
  let hits = 0
  for (const col of layout.problemCols) {
    if (/^[+-]/.test(norm(row[col.index]?.t))) hits += 1
  }
  return hits > 0
}

function buildTeams(dump: QojDump, layout: QojLayout, mode: TimeMode): {
  teams: TeamRecord[]
  missingTime: number
  acSeen: number
} {
  const teams: TeamRecord[] = []
  let missingTime = 0
  let acSeen = 0

  for (let r = layout.headerIndex + 1; r < dump.rows.length; r += 1) {
    const row = dump.rows[r]
    if (!isDataRow(row, layout)) continue
    const { name, organization, starred, members } = splitTeam(row[layout.nameIndex].t)
    if (!name) continue

    const cells: Record<string, CellResult> = {}
    for (const col of layout.problemCols) {
      const parsed = parseCell(row[col.index]?.t ?? '', mode)
      if (!parsed) continue
      if (parsed.ac) {
        acSeen += 1
        if (parsed.sec == null) {
          missingTime += 1
          continue
        }
        cells[col.letter] = {
          letter: col.letter,
          ac: true,
          attempts: parsed.attempts,
          acceptSec: parsed.sec,
          firstBlood: parsed.firstBlood,
        }
      } else {
        cells[col.letter] = { letter: col.letter, ac: false, attempts: parsed.attempts }
      }
    }

    const rankText = norm(row[0]?.t)
    const rank = /^\d+$/.test(rankText) ? Number(rankText) : undefined
    const solvedText = layout.solvedIndex >= 0 ? norm(row[layout.solvedIndex]?.t) : ''
    const penaltyText = layout.penaltyIndex >= 0 ? norm(row[layout.penaltyIndex]?.t) : ''

    teams.push({
      id: `q${r}`,
      name,
      organization,
      members,
      markers: { official: true, starred, girl: false },
      source: {
        rank,
        solved: /^\d+$/.test(solvedText) ? Number(solvedText) : undefined,
        penaltySec: /^\d+$/.test(penaltyText) ? Number(penaltyText) * 60 : undefined,
        rowIndex: r,
      },
      cells,
    })
  }

  return { teams, missingTime, acSeen }
}

/** 用榜单自带的 Solved/Penalty 反推时间格式：h:mm 还是 m:ss */
function pickTimeMode(dump: QojDump, layout: QojLayout): TimeMode {
  if (layout.penaltyIndex < 0) return 'hmm'
  const score = (mode: TimeMode): number => {
    const { teams } = buildTeams(dump, layout, mode)
    let hits = 0
    let total = 0
    for (const team of teams) {
      if (team.source.penaltySec == null) continue
      total += 1
      let pen = 0
      for (const cell of Object.values(team.cells)) {
        if (!cell.ac || cell.acceptSec == null) continue
        pen += cell.acceptSec + 20 * 60 * Math.max(0, cell.attempts - 1)
      }
      if (Math.abs(pen - team.source.penaltySec) <= 60) hits += 1
    }
    return total === 0 ? 0 : hits / total
  }
  return score('mss') > score('hmm') ? 'mss' : 'hmm'
}

export function parseQojDump(dump: QojDump): ParsedSheet {
  if (!dump || !Array.isArray(dump.rows) || dump.rows.length === 0) {
    throw new Error('抓取结果是空的：请确认在 QOJ 的榜单页执行抓取脚本')
  }
  const layout = detectLayout(dump.rows)
  if (!layout) throw new Error('没认出题目列：可能抓到了别的表格，换到比赛榜单页再试')

  const mode = pickTimeMode(dump, layout)
  const { teams, missingTime, acSeen } = buildTeams(dump, layout, mode)

  const problems: ProblemInfo[] = layout.problemCols.map((c) => ({ letter: c.letter }))
  const notes: Diagnostic[] = []
  notes.push(info(`识别 ${teams.length} 支队伍、${problems.length} 道题（时刻按 ${mode === 'hmm' ? 'h:mm' : 'm:ss'} 解读）`))

  if (acSeen === 0) throw new Error('没有解析到任何通过记录，换到比赛榜单页再试')
  if (acSeen === missingTime) {
    throw new Error(
      '这个榜单只有 +/-，没有通过时刻，没法回放。换用赛后的 results 页面，或把网页另存为 HTML 再导入试试。',
    )
  }
  if (missingTime > 0) {
    notes.push(warning(`${missingTime} 次通过没有读到时刻，已忽略（会让通过数偏少）`))
  }

  const acCount = teams.reduce((n, t) => n + Object.values(t.cells).filter((c) => c.ac).length, 0)
  if (acCount === 0) throw new Error('没有解析到任何带时刻的通过，无法回放')

  const title = (dump.title ?? '')
    .replace(/\s*-\s*QOJ\.ac\s*$/i, '')
    .replace(/^QOJ\s*-\s*/i, '')
    .trim()

  const slug = /\/results\/([^/?#]+)/.exec(dump.url ?? '')?.[1]
  const contestId = /\/contest\/(\d+)/.exec(dump.url ?? '')?.[1]

  return {
    title: title || (slug ? decodeURIComponent(slug) : contestId ? `QOJ Contest ${contestId}` : 'QOJ 榜单'),
    problems,
    teams,
    notes,
  }
}

/** 兜底：把保存下来的整页 HTML 变成 dump（浏览器里有 DOMParser 时可用） */
export function dumpFromHtml(html: string, url = ''): QojDump {
  if (typeof DOMParser === 'undefined') throw new Error('当前环境不支持解析 HTML')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const score = (tb: Element) =>
    [...tb.querySelectorAll('td')].filter((c) => /^[+-]/.test((c.textContent ?? '').trim())).length
  const tables = [...doc.querySelectorAll('table')]
  const best = tables
    .map((tb) => ({ tb, n: score(tb) }))
    .sort((a, b) => b.n - a.n)[0]
  if (!best || best.n < 5) throw new Error('页面里没找到榜单表格')

  const rows: QojCell[][] = [...best.tb.querySelectorAll('tr')].map((tr) =>
    [...tr.children].map((cell) => ({
      t: (cell as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? (cell.textContent ?? '').trim(),
      ti: cell.getAttribute('title') ?? '',
      d: Object.fromEntries(
        [...cell.attributes]
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => [a.name.slice(5), a.value]),
      ),
    })),
  )
  return { v: 1, url, title: doc.title, rows }
}

function tokenize(text: string): string[] {
  return text
    .split(/[\t\r\n]+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0)
}

const STATUS = /^\*?[+-]\d*$/
const TIME = /^\d{1,3}:\d{2}(?::\d{2})?$/

/** 表头里的题目字母是连号的（A、B、C…），取最长递增段，顺便滤掉导航里零星的单字母 */
function longestLetterRun(tokens: string[]): string[] {
  const letters = tokens.filter((t) => /^[A-Z]$/.test(t))
  let best: string[] = []
  let run: string[] = []
  for (const letter of letters) {
    const prev = run[run.length - 1]
    if (!prev || letter.charCodeAt(0) === prev.charCodeAt(0) + 1) run.push(letter)
    else run = [letter]
    if (run.length > best.length) best = [...run]
  }
  return best
}

/**
 * 兜底二：把网页里直接 Ctrl+A / Ctrl+C 复制出来的纯文本变成 dump。
 *
 * 复制出来的文本是"单元格里换行、单元格间制表符"的混合，形如
 *   1 / USA1 (…) / + / 1:36 / +1 / 4:29 / … / 11  835  26%
 * 所以先摊平成 token 流：名次、队名、然后每个格子是"状态"加一个可选时刻，
 * 最后是 Solved / Penalty / Dirt。表头里 A..K 这些单字母就是题目列。
 */
export function dumpFromPlainText(text: string): QojDump {
  const tokens = tokenize(text)
  if (tokens.length < 10) throw new Error('粘贴的文本太短，不像榜单')

  // 行首锚点必须"名次 + 队名 + 状态"三连，避免把标题里的年份当成名次
  const firstRank = tokens.findIndex(
    (t, i) =>
      /^\d+$/.test(t) &&
      !!tokens[i + 1] &&
      !STATUS.test(tokens[i + 1]) &&
      TIME.test(tokens[i + 2] ?? '') === false &&
      STATUS.test(tokens[i + 2] ?? ''),
  )
  if (firstRank < 3) throw new Error('没找到榜单的表头，请从页面顶部（含 Rank. 那一行）开始复制')

  const head = tokens.slice(0, firstRank)
  const letters = longestLetterRun(head)
  const stats = head.filter((t) => /^\d+\/\d+$/.test(t))
  if (letters.length < 2) throw new Error('表头里没有认出题目列（A、B、C…）')

  const rows: QojCell[][] = [
    [
      { t: 'Rank.' },
      { t: 'Username' },
      ...letters.map((letter, i) => ({
        t: stats.length === letters.length && stats[i] ? `${letter} ${stats[i]}` : letter,
      })),
      { t: 'Solved' },
      { t: 'Penalty' },
      { t: 'Dirt' },
    ],
  ]

  let i = firstRank
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === 'Submissions:' || token === 'Solved:' || token === '提交数' || token === '通过数') break
    if (!/^\d+$/.test(token)) {
      i += 1
      continue
    }
    const name = tokens[i + 1] ?? ''
    // 队名不可能是 "+1" 这种状态 token，否则说明这一行错位了
    if (!name || STATUS.test(name)) {
      i += 1
      continue
    }

    let cursor = i + 2
    const cells: string[] = []
    for (let p = 0; p < letters.length && cursor < tokens.length; p += 1) {
      const status = tokens[cursor]
      if (!STATUS.test(status)) break
      cursor += 1
      let cell = status
      const maybeTime = tokens[cursor]
      if (maybeTime && TIME.test(maybeTime)) {
        cell = `${status} ${maybeTime}`
        cursor += 1
      }
      cells.push(cell)
    }
    if (cells.length < letters.length) {
      i += 1
      continue
    }

    const solved = tokens[cursor]
    const penalty = tokens[cursor + 1]
    const dirt = tokens[cursor + 2]
    if (/^\d+$/.test(solved ?? '')) cursor += 1
    if (/^\d+$/.test(penalty ?? '')) cursor += 1
    if (/^\d+%$/.test(dirt ?? '')) cursor += 1

    rows.push([
      { t: token },
      { t: name },
      ...cells.map((t) => ({ t })),
      { t: solved ?? '' },
      { t: penalty ?? '' },
      { t: dirt ?? '' },
    ])
    i = cursor
  }

  if (rows.length < 2) throw new Error('只认出了表头，没有解析到队伍行')
  return { v: 1, title: '', rows }
}

/** 把粘贴进来的文本变成 dump：JSON（抓取脚本）/ HTML（另存网页）/ 纯文本（Ctrl+A 复制） */
export function dumpFromText(text: string): QojDump {
  const t = text.trim()
  if (!t) throw new Error('粘贴内容是空的')
  if (t.startsWith('{') || t.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(t)
    } catch {
      throw new Error('这段内容像 JSON，但解析失败；确认复制完整')
    }
    const dump = Array.isArray(parsed) ? { rows: parsed } : (parsed as QojDump)
    if (!dump || !Array.isArray(dump.rows)) throw new Error('JSON 里没有 rows')
    return dump
  }
  if (t.startsWith('<')) {
    const slug = /https?:\/\/qoj\.ac\/[^\s"'<>]+/.exec(t)?.[0] ?? ''
    return dumpFromHtml(t, slug)
  }
  return dumpFromPlainText(t)
}

export function qojDumpSummary(dump: QojDump): string {
  const rows = dump.rows?.length ?? 0
  return `${rows} 行`
}
