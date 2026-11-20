import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { dumpFromText, parseQojDump, QOJ_SNIPPET, type QojDump } from './qoj'
import { aggregateTeam } from '../model/aggregate'
import { buildIndex, createContest } from '../model/contest'
import { buildSnapshot } from '../model/snapshot'
import { buildBoardColumns, projectBoardEntries } from '../model/board'
import { DEFAULT_SETTINGS } from '../rules/settings'
import { computeUnlocks } from '../rules/unlock'
import type { Settings } from '../types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoardTable } from '../../components/Board'

/**
 * 取自 qoj.ac/results/ICPCCamp2026Day1 的两行真实数据：
 * QOJ 的 "+k 0:45" 里 k 是**错误次数**（不是提交总数），罚时 = 时刻 + 20×k。
 */
const HEADER = [
  'Rank.',
  'Username',
  'A 24/61',
  'B 26/61',
  'C 4/14',
  'D 27/33',
  'E 20/62',
  'F 1/21',
  'G 17/32',
  'H 8/33',
  'I 17/37',
  'J 1/8',
  'K 27/43',
  'L 22/23',
  'M 6/30',
  'Solved',
  'Penalty',
  'Dirt',
]

const ROW1 = [
  '1',
  '北京大学 - 飞带不长队',
  '+1 0:45',
  '+ 1:06',
  '+2 4:55',
  '+ 0:17',
  '+ 0:41',
  '+ 3:20',
  '+ 2:03',
  '+ 3:37',
  '+ 1:17',
  '+ 4:13',
  '+ 0:22',
  '+ 0:55',
  '+2 2:05',
  '13',
  '1636',
  '27%',
]

const ROW2 = [
  '2',
  '清华大学 - 零基础新生1队',
  '+ 1:49',
  '+ 0:45',
  '+1 4:32',
  '+ 0:21',
  '+2 1:33',
  '-15 4:59',
  '+ 2:25',
  '+ 2:56',
  '+ 1:52',
  '-',
  '+ 0:12',
  '+ 0:35',
  '+4 4:52',
  '11',
  '1452',
  '38%',
]

const cell = (t: string) => ({ t, ti: '', d: {} })

function dumpOf(rows: string[][]): QojDump {
  return {
    v: 1,
    url: 'https://qoj.ac/results/ICPCCamp2026Day1',
    title: 'The 2026 China ICPC Training Camp. Day 1 - QOJ.ac',
    rows: rows.map((r) => r.map(cell)),
  }
}

describe('QOJ 榜单解析', () => {
  const parsed = parseQojDump(dumpOf([HEADER, ROW1, ROW2]))

  it('认出 13 道题与两支队伍', () => {
    expect(parsed.problems.map((p) => p.letter)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    ])
    expect(parsed.teams).toHaveLength(2)
  })

  it('把 "学校 - 队名" 拆成机构与队名', () => {
    expect(parsed.teams[0].organization).toBe('北京大学')
    expect(parsed.teams[0].name).toBe('飞带不长队')
  })

  it('"+k" 的 k 是错误次数，重算罚时与榜面完全一致', () => {
    const first = aggregateTeam(parsed.teams[0].cells)
    expect(first.solved).toBe(13)
    expect(first.penaltySec).toBe(1636 * 60)

    const second = aggregateTeam(parsed.teams[1].cells)
    expect(second.solved).toBe(11)
    expect(second.penaltySec).toBe(1452 * 60)
  })

  it('每次通过的提交次数 = k + 1', () => {
    const a = parsed.teams[0].cells.A
    expect(a.ac).toBe(true)
    expect(a.attempts).toBe(2)
    expect(a.acceptSec).toBe(45 * 60)
  })

  it('"-15" 是 15 次错误提交、没有通过；"-" 是没提交', () => {
    const f = parsed.teams[1].cells.F
    expect(f.ac).toBe(false)
    expect(f.attempts).toBe(15)
    expect(f.lastRejectSec).toBe(299 * 60)
    expect(parsed.teams[1].cells.J).toBeUndefined()
  })

  it('保留榜面名次，供诊断比对', () => {
    expect(parsed.teams[0].source.rank).toBe(1)
    expect(parsed.teams[0].source.solved).toBe(13)
    expect(parsed.teams[1].source.penaltySec).toBe(1452 * 60)
  })

  it('标题去掉 "- QOJ.ac"', () => {
    expect(parsed.title).toBe('The 2026 China ICPC Training Camp. Day 1')
  })
})

describe('QOJ 错误提交回放', () => {
  const parsed = parseQojDump(dumpOf([
    ['Rank.', 'Username', 'A', 'B', 'C', 'D', 'Solved', 'Penalty'],
    ['1', '我的队伍', '+ 0:01', '+ 0:01', '-', '+ 0:01', '3', '3'],
    ['2', '其他队伍', '+ 0:01', '-3 0:02', '-4', '-5 4:01', '1', '1'],
  ]))
  const index = buildIndex(createContest({
    fileName: 'qoj-wa.json', sheetName: 'standings', source: 'qoj', parsed,
  }))

  function replay(t: number, overrides: Partial<Settings> = {}, manualReveal = false) {
    const settings: Settings = {
      ...DEFAULT_SETTINGS, selfTeamId: parsed.teams[0].id,
      unlockCount: 50, unlockPercent: null, ...overrides,
    }
    const snapshot = buildSnapshot({
      index, settings, plan: computeUnlocks(index, settings), t, manualReveal,
    })
    const row = snapshot.rows.find((r) => r.teamId === parsed.teams[1].id)!
    return { snapshot, row, entries: projectBoardEntries(row, buildBoardColumns(snapshot)) }
  }

  it('其他队伍的 WA 在已知最后提交时刻出现，回退时重新隐藏', () => {
    expect(replay(119).entries.some((entry) => entry?.kind === 'fail')).toBe(false)
    const atWrong = replay(120)
    expect(atWrong.row.isSelf).toBe(false)
    expect(atWrong.entries.find((entry) => entry?.kind === 'fail'))
      .toMatchObject({ attempts: 3, firstSec: Infinity, sec: 120 })
    expect(atWrong.entries.every((entry) => !entry?.letter)).toBe(true)
    expect(atWrong.row.cells[1].kind).toBe('locked')
    const markup = renderToStaticMarkup(createElement(BoardTable, {
      rows: [atWrong.row], snapshot: atWrong.snapshot, minutePrecision: true, onSelectTeam: vi.fn(),
    }))
    expect(markup).toContain('is-fail')
    expect(markup).toContain('−3')
    expect(atWrong.snapshot.problems[1]).toMatchObject({ submitted: 4, submittedPending: 0 })
    expect(replay(119).entries.some((entry) => entry?.kind === 'fail')).toBe(false)
    expect(replay(119).snapshot.problems[1]).toMatchObject({ submitted: 1, submittedPending: 3 })
  })

  it('揭题后 WA 对齐到题目列，仍保留错误次数和时间', () => {
    const result = replay(120, { unlockCount: 1 })
    expect(result.entries[1]).toMatchObject({ kind: 'fail', letter: 'B', attempts: 3, sec: 120 })
    expect(result.row.cells[1]).toMatchObject({ kind: 'rejected', attempts: 3 })
    expect(result.row.solved).toBe(1)
    expect(result.row.penaltySec).toBe(60)
  })

  it('封榜保留此前 WA，封榜后的 WA 在解封或终榜后显示', () => {
    const frozen = replay(242 * 60)
    expect(frozen.entries[1]).toMatchObject({ kind: 'fail', letter: 'B', attempts: 3, sec: 120 })
    expect(frozen.entries[3]).toBeUndefined()
    expect(frozen.snapshot.problems[3]).toMatchObject({ submitted: 1, submittedPending: 5 })
    for (const result of [replay(242 * 60, {}, true), replay(300 * 60)]) {
      expect(result.entries[3]).toMatchObject({ kind: 'fail', letter: 'D', attempts: 5, sec: 241 * 60 })
      expect(result.snapshot.problems[3]).toMatchObject({ submitted: 6, submittedPending: 0 })
    }
    expect(replay(240 * 60, {}, true).entries[3]).toBeUndefined()
  })

  it('无 WA 时刻的旧数据继续在终榜显示，并保留未知提交数', () => {
    const live = replay(242 * 60)
    expect(live.entries[2]).toBeUndefined()
    expect(live.snapshot.problems[2]).toMatchObject({ submitted: 0, submittedPending: 4 })
    const final = replay(300 * 60)
    expect(final.entries[2]).toMatchObject({ kind: 'fail', letter: 'C', attempts: 4, firstSec: Infinity })
    expect(final.entries[2]?.sec).toBeUndefined()
    expect(final.snapshot.problems[2]).toMatchObject({ submitted: 4, submittedPending: 0 })
  })

  it('超过默认五小时的 WA 仍在比赛时长内并能进入终榜', () => {
    const longParsed = parseQojDump(dumpOf([
      ['Rank.', 'Username', 'A', 'B', 'Solved', 'Penalty'],
      ['1', '我的队伍', '+ 0:01', '-', '1', '1'],
      ['2', '其他队伍', '+ 0:02', '-3 6:15', '1', '2'],
    ]))
    const contest = createContest({
      fileName: 'qoj-long-wa.json', sheetName: 'standings', source: 'qoj', parsed: longParsed,
    })
    const longIndex = buildIndex(contest)
    const settings: Settings = {
      ...DEFAULT_SETTINGS, selfTeamId: longParsed.teams[0].id,
      durationMin: 300, freezeEnabled: false,
    }
    const plan = computeUnlocks(longIndex, settings)
    expect(contest.suggestedDurationSec).toBe(375 * 60)
    expect(plan.durationSec).toBe(375 * 60)
    const snapshot = buildSnapshot({
      index: longIndex, settings, plan, t: 375 * 60, manualReveal: false,
    })
    expect(snapshot.phase).toBe('final')
    const other = snapshot.rows.find((row) => row.teamId === longParsed.teams[1].id)!
    expect(projectBoardEntries(other, buildBoardColumns(snapshot))[1])
      .toMatchObject({ kind: 'fail', letter: 'B', attempts: 3, sec: 375 * 60 })
  })
})

describe('QOJ 抓取内容的容错', () => {
  it('能自动区分 h:mm 与 m:ss', () => {
    const rows = [
      ['Rank.', 'Username', 'A 1/1', 'B 1/1', 'Solved', 'Penalty'],
      ['1', 'X - Y', '+ 1:30', '+ 0:10', '2', '100'],
    ]
    const dump: QojDump = { rows: rows.map((r) => r.map(cell)) }
    const parsed = parseQojDump(dump)
    // m:ss 解读下罚时 = 90 + 10 = 100 秒 ≈ 2 分钟，与榜面 100 分不符；
    // h:mm 解读 = 90 + 10 分钟 = 100 分钟，刚好对上 → 选 h:mm
    expect(parsed.notes.some((n) => n.message.includes('h:mm'))).toBe(true)
    expect(aggregateTeam(parsed.teams[0].cells).penaltySec).toBe(100 * 60)
  })

  it('粘贴 JSON 能直接解析', () => {
    const dump = dumpFromText(JSON.stringify(dumpOf([HEADER, ROW1])))
    expect(dump.rows).toHaveLength(2)
    expect(parseQojDump(dump).teams).toHaveLength(1)
  })

  it('认不出的内容给出明确错误', () => {
    expect(() => dumpFromText('hello')).toThrow(/太短|认不出/)
    expect(() => dumpFromText('')).toThrow(/空的/)
    expect(() => dumpFromText('{"foo":1}')).toThrow(/rows/)
  })

  it('抓错页面（没有题目列）时报错', () => {
    const dump: QojDump = { rows: [['a', 'b'], ['c', 'd']].map((r) => r.map(cell)) }
    expect(() => parseQojDump(dump)).toThrow(/题目列/)
  })
})

function standingsFixture(
  pages: string[][][],
  initialPage: number,
  { brokenPage, expectedTeams }: { brokenPage?: number; expectedTeams?: number } = {},
) {
  let activePage = initialPage
  const copy = vi.fn<(json: string) => void>()
  const reportError = vi.fn()
  const root = {
    querySelector(selector: string) {
      if (selector === '.pagination li.active' && pages.length > 1) {
        return { textContent: String(activePage) }
      }
      return null
    },
    querySelectorAll(selector: string) {
      if (selector === '.pagination li:not(.disabled) > a' && pages.length > 1) {
        return pages.map((_, index) => ({
          textContent: String(index + 1),
          click() {
            if (index + 1 !== brokenPage) activePage = index + 1
          },
        })).filter((_, index) => Math.abs(index + 1 - activePage) <= 1)
      }
      if (selector !== 'table') return []
      const [header, ...teams] = [HEADER, ...pages[activePage - 1]].map((row) =>
        row.map((text) => ({
          innerText: text,
          textContent: text,
          attributes: [],
          getAttribute: () => null,
        })),
      )
      return [{
        querySelectorAll(tableSelector: string) {
          if (tableSelector === 'td') return teams.flat()
          if (tableSelector === 'tr') return [header, ...teams].map((children) => ({ children }))
          return []
        },
      }]
    },
  }
  const document = {
    title: 'Test Contest - QOJ.ac',
    querySelector: (selector: string) =>
      selector === '#standings' && (pages.length > 1 || expectedTeams !== undefined) ? root : null,
    querySelectorAll: root.querySelectorAll,
  }
  return {
    copy,
    reportError,
    currentPage: () => activePage,
    run: () => runInNewContext(QOJ_SNIPPET, {
      document,
      window: { standings: expectedTeams === undefined ? undefined : Array(expectedTeams) },
      location: { href: 'https://qoj.ac/contest/2575/standings#standings' },
      console: { log: vi.fn(), warn: reportError, error: reportError },
      copy,
    }),
  }
}

describe('QOJ 抓取脚本分页', () => {
  it('从中间页开始也能按顺序导入所有队伍，并恢复原页', async () => {
    const makePage = (firstRank: number, row: string[]) =>
      Array.from({ length: 100 }, (_, i) => {
        const rank = firstRank + i
        return [String(rank), `Team ${rank}`, ...row.slice(2)]
      })
    const last = ['200', 'Team 201', ...Array<string>(13).fill('-'), '0', '0', '0%']
    const fixture = standingsFixture([makePage(1, ROW1), makePage(101, ROW2), [last]], 2)

    await fixture.run()

    expect(fixture.copy).toHaveBeenCalledTimes(1)
    const dump = dumpFromText(fixture.copy.mock.calls[0][0])
    expect(dump.rows).toHaveLength(202)
    const { teams } = parseQojDump(dump)
    expect(teams.map((team) => team.name)).toEqual(Array.from({ length: 201 }, (_, i) => `Team ${i + 1}`))
    expect(teams[200].source.rank).toBe(200)
    expect(fixture.currentPage()).toBe(2)
  })

  it('没有分页的榜单仍能导入', async () => {
    const fixture = standingsFixture([[ROW1, ROW2]], 1)

    await fixture.run()

    expect(fixture.copy).toHaveBeenCalledTimes(1)
    expect(parseQojDump(dumpFromText(fixture.copy.mock.calls[0][0])).teams).toHaveLength(2)
  })

  it('分页跳转失败时提示错误，且不复制不完整的榜单', async () => {
    const fixture = standingsFixture([[ROW1], [ROW2], [ROW1]], 2, { brokenPage: 3 })

    await fixture.run()

    expect(fixture.copy).not.toHaveBeenCalled()
    expect(fixture.reportError).toHaveBeenCalled()
    expect(fixture.currentPage()).toBe(2)
  })

  it('页码缺失导致队伍总数不符时停止导出', async () => {
    const fixture = standingsFixture([[ROW1]], 1, { expectedTeams: 2 })

    await fixture.run()

    expect(fixture.copy).not.toHaveBeenCalled()
    expect(fixture.reportError.mock.calls[0][0]).toBe('QOJ 榜单抓取失败：抓到 1 队，QOJ 榜单共有 2 队')
  })
})

describe('直接粘贴的纯文本（Ctrl+A / Ctrl+C）', () => {
  const raw = readFileSync(resolve(process.cwd(), 'fixtures/qoj-paste.txt'), 'utf8')
  const parsed = parseQojDump(dumpFromText(raw))

  it('认出 11 道题与 5 支队伍', () => {
    expect(parsed.problems.map((p) => p.letter)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
    ])
    expect(parsed.teams).toHaveLength(5)
  })

  it('罚时与榜面逐队一致（含 *+ 首杀、-11、纯 -）', () => {
    const expected: [string, number, number][] = [
      ['USA1', 11, 835],
      ['THU1', 11, 1042],
      ['Nameless Dreamer', 10, 942],
      ['Almost Retired Dandelion', 10, 984],
      ['Jury', 0, 0],
    ]
    parsed.teams.forEach((team, i) => {
      const agg = aggregateTeam(team.cells)
      expect(team.name.startsWith(expected[i][0])).toBe(true)
      expect(agg.solved).toBe(expected[i][1])
      expect(Math.round(agg.penaltySec / 60)).toBe(expected[i][2])
    })
  })

  it('"*" 标记开成首杀', () => {
    const thu = parsed.teams[1]
    expect(thu.cells.G.firstBlood).toBe(true)
    expect(Object.values(thu.cells).filter((c) => c.firstBlood)).toHaveLength(1)
  })

  it('"队名 (队员, 队员)" 拆成队名与队员', () => {
    expect(parsed.teams[0].name).toBe('USA1')
    expect(parsed.teams[0].members).toEqual(['Andrew He', 'Kevin Sun', 'Gennady Korotkevich'])
    expect(parsed.teams[4].name).toBe('Jury')
    expect(parsed.teams[4].members).toEqual([])
  })

  it('复制时带上页面导航/年份也不影响', () => {
    const noisy = `QOJ.ac 2026 Contests  A  B\n${raw}`
    const p = parseQojDump(dumpFromText(noisy))
    expect(p.teams).toHaveLength(5)
    expect(p.problems).toHaveLength(11)
  })

  it('"-11" 是 11 次错误提交，纯 "-" 表示没提交', () => {
    expect(parsed.teams[3].cells.J.ac).toBe(false)
    expect(parsed.teams[3].cells.J.attempts).toBe(11)
    expect(parsed.teams[2].cells.J).toBeUndefined()
  })
})

describe('内置的 QOJ 示例（fixtures/qoj-demo.json）', () => {  it('四支队伍的通过数与罚时都和 QOJ 榜面一致', () => {
    const raw = readFileSync(resolve(process.cwd(), 'fixtures/qoj-demo.json'), 'utf8')
    const parsed = parseQojDump(dumpFromText(raw))
    expect(parsed.teams).toHaveLength(4)
    const expected: [number, number][] = [
      [13, 1636],
      [11, 1452],
      [11, 1713],
      [10, 1242],
    ]
    parsed.teams.forEach((team, i) => {
      const agg = aggregateTeam(team.cells)
      expect(`${team.name} ${agg.solved}/${Math.round(agg.penaltySec / 60)}`).toBe(
        `${team.name} ${expected[i][0]}/${expected[i][1]}`,
      )
      expect(agg.solved).toBe(expected[i][0])
      expect(Math.round(agg.penaltySec / 60)).toBe(expected[i][1])
    })
  })
})
