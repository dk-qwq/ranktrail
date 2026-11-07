import { describe, expect, it } from 'vitest'
import type { Contest, EntryView, Settings, Snapshot, TeamRecord } from '../types'
import { DEFAULT_SETTINGS } from '../rules/settings'
import { computeUnlocks } from '../rules/unlock'
import { buildIndex } from './contest'
import { buildSnapshot } from './snapshot'
import { buildBoardColumns, projectBoardEntries } from './board'

const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const freezeSec = 4 * 3600
const teams: TeamRecord[] = [
  {
    id: 'alpha', name: '甲队', organization: '', members: [],
    markers: { official: true, starred: false, girl: false }, source: { rowIndex: 1 },
    cells: {
      B: { letter: 'B', ac: true, attempts: 2, acceptSec: 600, submits: [{ sec: 200, ac: false }, { sec: 600, ac: true }] },
      G: { letter: 'G', ac: true, attempts: 1, acceptSec: 900, submits: [{ sec: 900, ac: true }] },
      A: { letter: 'A', ac: false, attempts: 2, submits: [{ sec: 100, ac: false }, { sec: 1000, ac: false }] },
      C: { letter: 'C', ac: false, attempts: 3 },
      E: { letter: 'E', ac: true, attempts: 1, acceptSec: freezeSec + 60, submits: [{ sec: freezeSec + 60, ac: true }] },
    },
  },
  {
    id: 'beta', name: '乙队', organization: '', members: [],
    markers: { official: true, starred: false, girl: false }, source: { rowIndex: 2 },
    cells: {
      G: { letter: 'G', ac: true, attempts: 1, acceptSec: 1200 },
      B: { letter: 'B', ac: true, attempts: 1, acceptSec: 1800 },
    },
  },
]
const contest: Contest = {
  id: 'projection-test', title: 'Projection', fileName: 'projection', sheetName: 'test', source: 'xcpcio-board',
  problems: letters.map((letter) => ({ letter })), teams,
  suggestedDurationSec: 5 * 3600, suggestedFreezeSec: freezeSec, importedAt: 0, diagnostics: [],
}
const index = buildIndex(contest)
const settings: Settings = { ...DEFAULT_SETTINGS, unlockCount: 2, unlockPercent: null }

function snap(t: number, overrides: Partial<Settings> = {}, manualReveal = false): Snapshot {
  const s = { ...settings, ...overrides }
  return buildSnapshot({ index, plan: computeUnlocks(index, s), settings: s, t, manualReveal })
}

function columnLabels(snapshot: Snapshot) {
  return buildBoardColumns(snapshot).map((column) => column.kind === 'problem' ? column.problem.letter : '?')
}

function projected(snapshot: Snapshot, teamId = 'alpha') {
  const row = snapshot.rows.find((r) => r.teamId === teamId)!
  return projectBoardEntries(row, buildBoardColumns(snapshot))
}

function signature(entry: EntryView) {
  return [entry.kind, entry.attempts, entry.firstSec, entry.sec, entry.firstBlood, entry.recent].join('|')
}

describe('榜单列：揭开的题固定左侧', () => {
  it('只有 G 揭开时，G 后面保留六个匿名位置与每队原有顺序', () => {
    const s = snap(1200)
    expect(columnLabels(s)).toEqual(['G', '?', '?', '?', '?', '?', '?'])
    const entries = projected(s)
    expect(entries[0]).toMatchObject({ kind: 'ac', letter: 'G', sec: 900 })
    expect(entries[1]).toMatchObject({ kind: 'fail', attempts: 2, firstSec: 100, sec: 1000 })
    expect(entries[2]).toMatchObject({ kind: 'ac', attempts: 2, firstSec: 200, sec: 600 })
    expect(entries.slice(1).every((entry) => !entry?.letter)).toBe(true)
    expect(entries.slice(3).every((entry) => entry === undefined)).toBe(true)
  })

  it('多个题揭开后按原题序靠左，即使各队解题的顺序不同', () => {
    const s = snap(2000)
    expect(columnLabels(s)).toEqual(['B', 'G', '?', '?', '?', '?', '?'])
    expect(projected(s).slice(0, 2).map((entry) => entry?.letter)).toEqual(['B', 'G'])
    expect(projected(s, 'beta').slice(0, 2).map((entry) => entry?.sec)).toEqual([1800, 1200])
  })

  it('精确到 4h 才恢复完整题序，并按题对齐 AC、错误和空格', () => {
    expect(columnLabels(snap(freezeSec - 1))).toEqual(['B', 'G', '?', '?', '?', '?', '?'])
    const s = snap(freezeSec)
    expect(s.phase).toBe('frozen')
    expect(columnLabels(s)).toEqual(letters)
    const entries = projected(s)
    expect(entries[0]).toMatchObject({ letter: 'A', kind: 'fail', attempts: 2, sec: 1000 })
    expect(entries[1]).toMatchObject({ letter: 'B', kind: 'ac', sec: 600 })
    // 聚合错误没有提交时刻，封榜时仍留空，终榜才对齐显示。
    expect(entries[2]).toBeUndefined()
    expect(projected(snap(5 * 3600))[2]).toMatchObject({ letter: 'C', kind: 'fail', attempts: 3, firstSec: Infinity })
    expect(entries[3]).toBeUndefined()
    expect(entries[4]).toBeUndefined()
    expect(entries[5]).toBeUndefined()
    expect(entries[6]).toMatchObject({ letter: 'G', sec: 900 })
  })

  it('回退时间轴时恢复匿名顺序，再次揭题没有残留状态', () => {
    const atFreeze = projected(snap(freezeSec))
    expect(columnLabels(snap(1199))).toEqual(Array(7).fill('?'))
    expect(projected(snap(1199)).slice(0, 3).map((entry) => entry?.firstSec)).toEqual([100, 200, 900])
    expect(columnLabels(snap(1200))[0]).toBe('G')
    expect(projected(snap(freezeSec))).toEqual(atFreeze)
  })

  it('各阶段都不重复或丢掉提交格，输入快照保持不变', () => {
    for (const t of [0, 599, 1200, 2000, freezeSec - 1, freezeSec, freezeSec + 120, 5 * 3600]) {
      const s = snap(t)
      const columns = buildBoardColumns(s)
      for (const row of s.rows) {
        const before = row.entries.map((entry) => ({ ...entry }))
        const out = projectBoardEntries(row, columns).filter((entry): entry is EntryView => entry !== undefined)
        expect(out.map(signature).sort()).toEqual(row.entries.map(signature).sort())
        expect(row.entries).toEqual(before)
      }
    }
  })
})

describe('榜单列：遵守快照可见范围', () => {
  it('封榜后的数据保持冻结，自己的实时与手动解封由快照决定', () => {
    const t = freezeSec + 120
    expect(projected(snap(t))[4]).toBeUndefined()
    expect(projected(snap(t, { selfTeamId: 'alpha' }))[4]).toBeUndefined()
    expect(projected(snap(t, { selfTeamId: 'alpha', selfSeesLive: true }))[4]).toMatchObject({ letter: 'E', kind: 'ac', sec: freezeSec + 60 })
    expect(projected(snap(t, {}, true))[4]).toMatchObject({ letter: 'E', kind: 'ac', sec: freezeSec + 60 })
    expect(projected(snap(5 * 3600))[4]).toMatchObject({ letter: 'E', kind: 'ac', sec: freezeSec + 60 })
  })

  it('关闭封榜揭题时仍然匿名，手动解封和完整信息显示完整题序', () => {
    expect(columnLabels(snap(freezeSec, { unlockAtFreeze: false }))).toEqual(['B', 'G', '?', '?', '?', '?', '?'])
    expect(columnLabels(snap(1200, {}, true))).toEqual(letters)
    expect(columnLabels(snap(1200, { showFullInfo: true }))).toEqual(letters)
  })

  it('列和提交输出不携带任何未揭题的题号，即使输入格误带了题号', () => {
    const s = snap(1200)
    const columns = buildBoardColumns(s)
    expect(columns.flatMap((column) => column.kind === 'problem' ? [column.problem.letter] : [])).toEqual(['G'])
    const row = s.rows.find((r) => r.teamId === 'alpha')!
    const output = projectBoardEntries({ ...row, entries: [{ kind: 'fail', attempts: 1, firstSec: 5, letter: 'A' }] }, columns)
    expect(output[1]).toMatchObject({ kind: 'fail', attempts: 1 })
    expect(output.flatMap((entry) => entry?.letter ? [entry.letter] : [])).toEqual(['G'])
    expect(JSON.stringify(columns)).not.toContain('"letter":"A"')
    expect(JSON.stringify(output)).not.toContain('"letter":"A"')
  })
})
