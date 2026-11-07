import { describe, expect, it } from 'vitest'
import { CHENGDU, QINHUANGDAO, loadIndex } from '../testing/fixtures'
import { computeUnlocks } from '../rules/unlock'
import { DEFAULT_SETTINGS } from '../rules/settings'
import { buildSnapshot } from './snapshot'
import type { CellResult, Settings } from '../types'
import { buildIndex } from './contest'

const min = (m: number) => m * 60

const index = loadIndex(CHENGDU, '所有队伍')

function snap(t: number, settings: Settings = DEFAULT_SETTINGS, manualReveal = false) {
  const plan = computeUnlocks(index, settings)
  return buildSnapshot({ index, plan, settings, t, manualReveal })
}

describe('快照：赛前', () => {
  const s = snap(0)

  it('0:00 时没有任何通过、所有题目未解锁', () => {
    expect(s.phase).toBe('before')
    expect(s.rows.every((r) => r.solved === 0)).toBe(true)
    expect(s.problems.every((p) => !p.unlocked)).toBe(true)
    expect(s.stats.totalAc).toBe(0)
  })
})

describe('快照：逐题解锁', () => {
  it('20:00 之前 M 题仍锁定，20:00 整解锁', () => {
    expect(snap(min(20) - 1).problems.find((p) => p.letter === 'M')!.unlocked).toBe(false)
    expect(snap(min(20)).problems.find((p) => p.letter === 'M')!.unlocked).toBe(true)
  })

  it('29:00 时 M、D 已解锁，F 仍是雾格', () => {
    const s = snap(min(29))
    const by = Object.fromEntries(s.problems.map((p) => [p.letter, p]))
    expect(by.M.unlocked).toBe(true)
    expect(by.D.unlocked).toBe(true)
    expect(by.F.unlocked).toBe(false)
    expect(by.F.reason).toBe('freeze')
  })

  it('2:11:00 时恰好 5 道题解锁', () => {
    const s = snap(min(131))
    const unlocked = s.problems.filter((p) => p.unlocked).map((p) => p.letter).sort()
    expect(unlocked).toEqual(['C', 'D', 'I', 'K', 'M'])
  })

  it('解锁后能看到该题的真实通过数', () => {
    const s = snap(min(131))
    const m = s.problems.find((p) => p.letter === 'M')!
    const expected = index.acSecs.M.filter((sec) => sec <= min(131)).length
    expect(m.accepted).toBe(expected)
  })

  it('未解锁题的单元格在任何行都是 locked', () => {
    const s = snap(min(29))
    const fIndex = s.problems.findIndex((p) => p.letter === 'F')
    expect(s.rows.every((r) => r.cells[fIndex].kind === 'locked')).toBe(true)
  })

  it('刚解锁的列会被标记，用于整列点亮的动效', () => {
    expect(snap(min(20)).problems.find((p) => p.letter === 'M')!.justUnlocked).toBe(true)
    expect(snap(min(30)).problems.find((p) => p.letter === 'M')!.justUnlocked).toBe(false)
  })
})

describe('快照：通过顺序（主榜的"第 k 次通过"）', () => {
  const s = snap(min(60))

  it('每队的通过按时刻升序排列', () => {
    for (const row of s.rows) {
      for (let i = 1; i < row.solves.length; i += 1) {
        expect(row.solves[i].acceptSec).toBeGreaterThanOrEqual(row.solves[i - 1].acceptSec)
      }
    }
  })

  it('solves 长度等于通过数', () => {
    expect(s.rows.every((r) => r.solves.length === r.solved)).toBe(true)
  })

  it('锁定的题目同样计入通过数与通过顺序', () => {
    // 60:00 时只有 M、D 两道题解锁，但主榜的通过数包含全部题目
    const visibleAc = s.rows.reduce(
      (n, r) => n + r.cells.filter((c) => c.kind === 'ac').length,
      0,
    )
    const totalAc = s.rows.reduce((n, r) => n + r.solved, 0)
    expect(totalAc).toBeGreaterThan(visibleAc)
    expect(visibleAc).toBeGreaterThan(0)
  })

  it('未解锁题目在队伍抽屉的明细里仍然是雾', () => {
    const row = s.rows.find((r) => r.solved >= 3)!
    expect(row.cells.some((c) => c.kind === 'locked')).toBe(true)
  })
})

describe('快照：封榜与终榜', () => {
  const atFreeze = snap(min(240))
  const frozen = snap(min(245))
  const final = snap(min(300))

  it('4:00 时所有题目解锁（封榜全解锁）', () => {
    expect(atFreeze.problems.every((p) => p.unlocked)).toBe(true)
    expect(atFreeze.phase).toBe('frozen')
  })

  it('封榜期间数据冻结在 4:00', () => {
    expect(frozen.phase).toBe('frozen')
    expect(frozen.dataT).toBe(min(240))
    expect(frozen.stats.totalAc).toBe(atFreeze.stats.totalAc)
    expect(frozen.rows.map((r) => r.solved)).toEqual(atFreeze.rows.map((r) => r.solved))
  })

  it('封榜期间不显示错误提交数', () => {
    expect(frozen.rows.every((r) => r.cells.every((c) => c.kind !== 'rejected'))).toBe(true)
  })

  it('5:00 终榜解冻，能看到 4:00 之后的通过', () => {
    expect(final.phase).toBe('final')
    expect(final.stats.totalAc).toBeGreaterThan(frozen.stats.totalAc)
    expect(final.rows.some((r) => r.cells.some((c) => c.kind === 'rejected'))).toBe(true)
    expect(final.stats.totalAc).toBe(1214)
  })

  it('终榜名次与导出文件逐队一致', () => {
    const bad = final.rows.filter((r) => r.team.source.rank !== r.rank)
    expect(bad.map((r) => `${r.team.name}: 文件 ${r.team.source.rank} / 重算 ${r.rank}`)).toEqual([])
  })

  it('终榜第一与文件的 Rank 1 一致', () => {
    expect(final.rows[0].team.name).toBe('CF皇帝')
    expect(final.rows[0].solved).toBe(11)
    expect(final.rows[0].penaltySec).toBe(1294 * 60)
  })

  it('手动解封可以提前看到封榜后的数据', () => {
    const s = snap(min(245), DEFAULT_SETTINGS, true)
    expect(s.revealed).toBe(true)
    expect(s.dataT).toBe(min(245))
    expect(s.stats.totalAc).toBeGreaterThan(frozen.stats.totalAc)
  })
})

describe('快照：题号、提交数与实时奖牌线', () => {
  it('题目解锁后，主榜对应格子才补上题号', () => {
    const before = snap(min(19)) // M 还没解锁
    const after = snap(min(21)) // M 在 20:00 解锁
    const mBefore = before.rows.flatMap((r) => r.solves).filter((s) => s.letter === 'M')
    const mAfter = after.rows.flatMap((r) => r.solves).filter((s) => s.letter === 'M')
    expect(mBefore).toHaveLength(0)
    expect(mAfter.length).toBeGreaterThan(0)
    // 同一道题在不同队伍的行里、不同的第 k 格上被补出来
    const positions = after.rows
      .map((r) => r.solves.findIndex((s) => s.letter === 'M'))
      .filter((i) => i >= 0)
    expect(new Set(positions).size).toBeGreaterThan(1)
  })

  it('没解锁的题在任何人行里都不带题号', () => {
    const s = snap(min(21))
    const locked = s.problems.filter((p) => !p.unlocked).map((p) => p.letter)
    const leaked = s.rows.flatMap((r) => r.solves).filter((x) => x.letter && locked.includes(x.letter))
    expect(leaked).toHaveLength(0)
  })

  it('每题都能拿到通过数与提交数，且提交数不小于通过数', () => {
    const s = snap(min(60))
    for (const p of s.problems) {
      expect(p.accepted).toBeGreaterThanOrEqual(0)
      expect(p.submitted).toBeGreaterThanOrEqual(p.accepted)
    }
  })

  it('题目解锁前后都能读提交数（锁定的也有）', () => {
    const s = snap(min(21))
    const locked = s.problems.filter((p) => !p.unlocked)
    expect(locked.length).toBeGreaterThan(0)
    expect(locked.some((p) => p.submitted > 0)).toBe(true)
    // 没时刻的错误提交单列出来，界面上显示成 "N+"
    expect(locked.some((p) => p.submittedPending > 0)).toBe(true)
  })

  it('奖牌线按人数百分比实时算，铁牌不给', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, selfTeamId: null }
    const s = snap(min(300), settings)
    expect(s.medals.gold).toBe(Math.round((s.teamCount * 10) / 100))
    expect(s.medals.silver).toBe(Math.round((s.teamCount * 30) / 100))
    expect(s.medals.bronze).toBe(Math.round((s.teamCount * 60) / 100))

    const golds = s.rows.filter((r) => r.medal === 'gold')
    expect(golds.length).toBeGreaterThan(0)
    expect(golds.every((r) => r.rank <= s.medals.gold && r.solved > 0)).toBe(true)
    // 一题没过的没有奖牌
    expect(s.rows.filter((r) => r.solved === 0).every((r) => r.medal === null)).toBe(true)
    // 名次越界的不给
    expect(s.rows.filter((r) => r.rank > s.medals.bronze).every((r) => r.medal === null)).toBe(true)
  })

  it('关掉奖牌线后一个都不标', () => {
    const s = snap(min(300), { ...DEFAULT_SETTINGS, medalEnabled: false })
    expect(s.rows.every((r) => r.medal === null)).toBe(true)
  })
})

describe('快照：我的队伍与口径', () => {
  const early = index.teams.find((t) => Object.values(t.cells).some((c) => c.ac && (c.acceptSec ?? 1e9) <= 600))!

  it('找到一支在 10 分钟内就通过的队伍用于测试', () => {
    expect(early).toBeTruthy()
  })

  it('未解锁题目下，只有"我的队伍"能看见自己的格子', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, selfTeamId: early.id }
    const s = snap(600, settings)
    const self = s.rows.find((r) => r.teamId === early.id)!
    expect(self.isSelf).toBe(true)
    expect(self.cells.filter((c) => c.kind === 'ac').length).toBeGreaterThan(0)
    const others = s.rows.filter((r) => !r.isSelf)
    expect(others.every((r) => r.cells.every((c) => c.kind === 'locked'))).toBe(true)
  })

  it('封榜后自己那行也停住：只有打开「封榜中实时」才继续走', () => {
    const late = index.teams.find((t) =>
      Object.values(t.cells).some((c) => c.ac && (c.acceptSec ?? 0) > min(240)),
    )!
    expect(late).toBeTruthy()
    const cell = Object.values(late.cells).find((c) => c.ac && (c.acceptSec ?? 0) > min(240))!
    const t = (cell.acceptSec ?? 0) + 30

    const settings: Settings = { ...DEFAULT_SETTINGS, selfTeamId: late.id }
    const frozenRow = snap(t, settings).rows.find((r) => r.teamId === late.id)!
    const liveRow = snap(t, { ...settings, selfSeesLive: true }).rows.find((r) => r.teamId === late.id)!

    // 封榜中：榜面停在 4:00，自己那行也不更新
    expect(snap(t, settings).phase).toBe('frozen')
    expect(liveRow.solved).toBeGreaterThan(frozenRow.solved)
    // 解封后追上
    const revealed = snap(t, settings, true).rows.find((r) => r.teamId === late.id)!
    expect(revealed.solved).toBe(liveRow.solved)
  })

  it('只统计正式队时，N 与行数都变成 319', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, scope: 'official' }
    const s = snap(min(300), settings)
    expect(s.teamCount).toBe(319)
    expect(s.rows).toHaveLength(319)
    expect(s.rows.every((r) => r.team.markers.official)).toBe(true)
  })

  it('降低阈值后，同一时刻解锁的题更多', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, unlockCount: 30 }
    const looser = snap(min(20), settings)
    const base = snap(min(20))
    expect(looser.stats.unlockedProblems).toBeGreaterThanOrEqual(base.stats.unlockedProblems)
    expect(looser.problems.find((p) => p.letter === 'M')!.unlocked).toBe(true)
  })

  it('调试开关"显示完整信息"会跳过解锁与封榜', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, showFullInfo: true }
    const s = snap(min(10), settings)
    expect(s.problems.every((p) => p.unlocked)).toBe(true)
    expect(s.revealed).toBe(true)
  })
})

describe('快照：秦皇岛站', () => {
  const qhd = loadIndex(QINHUANGDAO, 'Main')
  const plan = computeUnlocks(qhd, DEFAULT_SETTINGS)
  const s = buildSnapshot({ index: qhd, plan, settings: DEFAULT_SETTINGS, t: 3000, manualReveal: false })

  it('50 分钟时 B、I、J、H 已解锁，A 未解锁', () => {
    const by = Object.fromEntries(s.problems.map((p) => [p.letter, p]))
    expect(by.B.unlocked).toBe(true)
    expect(by.I.unlocked).toBe(true)
    expect(by.J.unlocked).toBe(true)
    expect(by.H.unlocked).toBe(true)
    expect(by.A.unlocked).toBe(false)
  })

  it('首杀标记随解锁一起可见', () => {
    const j = s.problems.findIndex((p) => p.letter === 'J')
    expect(s.rows.some((r) => r.cells[j].firstBlood)).toBe(true)
  })
})

describe('快照：逐条提交与聚合错误数据的时间边界', () => {
  const cells: Record<string, CellResult> = {
    A: { letter: 'A', ac: true, attempts: 4, acceptSec: 15000, submits: [
      { sec: 700, ac: false }, { sec: 14000, ac: false },
      { sec: 14500, ac: false }, { sec: 15000, ac: true },
    ] },
    B: { letter: 'B', ac: false, attempts: 3, submits: [
      { sec: 600, ac: false }, { sec: 14400, ac: false }, { sec: 14700, ac: false },
    ] },
    C: { letter: 'C', ac: false, attempts: 5 },
    D: { letter: 'D', ac: true, attempts: 1, acceptSec: 1000 },
  }
  const team = { ...index.teams[0], id: 'timed', cells }
  const timedIndex = buildIndex({
    ...index.contest,
    problems: Object.keys(cells).map((letter) => ({ letter })),
    teams: [team],
  })
  function at(t: number, overrides: Partial<Settings> = {}, manualReveal = false) {
    const settings: Settings = { ...DEFAULT_SETTINGS, unlockCount: 1, unlockPercent: null, ...overrides }
    return buildSnapshot({ index: timedIndex, plan: computeUnlocks(timedIndex, settings), settings, t, manualReveal })
  }

  it('题目解锁或设为我的队伍都不提前展示无时刻的最终错误数', () => {
    for (const settings of [{}, { selfTeamId: team.id }, { selfTeamId: team.id, selfSeesLive: true }]) {
      const s = at(14600, settings)
      expect(s.problems.find((p) => p.letter === 'C')!.unlocked).toBe(true)
      expect(s.rows[0].entries.some((entry) => entry.letter === 'C')).toBe(false)
      expect(s.rows[0].cells[2].kind).toBe('empty')
    }
    expect(at(14600, {}, true).rows[0].entries.find((entry) => entry.letter === 'C'))
      .toMatchObject({ kind: 'fail', attempts: 5, firstSec: Infinity })
    expect(at(18000).rows[0].cells[2]).toMatchObject({ kind: 'rejected', attempts: 5 })
  })

  it('最终通过的题在通过前仍按已发生的错误提交展示，之后转为 AC', () => {
    expect(at(699).rows[0].entries).toHaveLength(1) // 只有 B 在 600 秒提交过
    expect(at(700).rows[0].entries.find((entry) => entry.firstSec === 700))
      .toMatchObject({ kind: 'fail', attempts: 1, sec: 700 })
    const beforeAc = at(14000).rows[0]
    expect(beforeAc.entries.find((entry) => entry.firstSec === 700))
      .toMatchObject({ kind: 'fail', attempts: 2, sec: 14000 })
    expect(beforeAc.solved).toBe(1)
    expect(at(15000, {}, true).rows[0].entries.find((entry) => entry.letter === 'A'))
      .toMatchObject({ kind: 'ac', attempts: 4, firstSec: 700, sec: 15000 })
  })

  it('封榜精确截断逐条提交，封榜整秒的错误包含在内', () => {
    const freeze = at(14400)
    const frozen = at(14600)
    expect(frozen.dataT).toBe(14400)
    expect(frozen.rows[0].entries).toEqual(freeze.rows[0].entries)
    expect(frozen.rows[0].entries.find((entry) => entry.letter === 'A'))
      .toMatchObject({ kind: 'fail', attempts: 2, sec: 14000 })
    expect(frozen.rows[0].entries.find((entry) => entry.letter === 'B'))
      .toMatchObject({ kind: 'fail', attempts: 2, sec: 14400 })
    expect(frozen.rows[0].cells[0]).toMatchObject({ kind: 'rejected', attempts: 2 })
    expect(at(14600, { selfTeamId: team.id, selfSeesLive: true }).rows[0].entries.find((entry) => entry.letter === 'A'))
      .toMatchObject({ kind: 'fail', attempts: 3, sec: 14500 })
  })

  it('未揭题仍隐藏队伍抽屉的逐条错误，自己的错误按当前时刻可见', () => {
    expect(at(14000).rows[0].cells[0].kind).toBe('locked')
    expect(at(14000, { selfTeamId: team.id }).rows[0].cells[0])
      .toMatchObject({ kind: 'rejected', attempts: 2, lockedColumn: true })
  })

  it('题目表头的提交数只统计截断时刻前的流水，无时刻错误另存 pending', () => {
    const before = Object.fromEntries(at(14000).problems.map((p) => [p.letter, p]))
    expect(before.A).toMatchObject({ accepted: 0, submitted: 2, submittedPending: 0 })
    expect(before.B).toMatchObject({ accepted: 0, submitted: 1, submittedPending: 0 })
    expect(before.C).toMatchObject({ submitted: 0, submittedPending: 5 })
    const frozen = Object.fromEntries(at(14600).problems.map((p) => [p.letter, p]))
    expect(frozen.A.submitted).toBe(2)
    expect(frozen.B.submitted).toBe(2)
    const revealed = Object.fromEntries(at(14600, {}, true).problems.map((p) => [p.letter, p]))
    expect(revealed.A.submitted).toBe(3)
    expect(revealed.B.submitted).toBe(2)
    expect(revealed.C).toMatchObject({ submitted: 5, submittedPending: 0 })
  })

  it('关闭封榜或封榜全揭后，解封与终榜仍揭开全部题目', () => {
    for (const overrides of [{ freezeEnabled: false }, { unlockAtFreeze: false }]) {
      expect(at(14600, overrides).problems.find((p) => p.letter === 'C')!.unlocked).toBe(false)
      expect(at(14600, overrides, true).problems.every((p) => p.unlocked)).toBe(true)
      expect(at(18000, overrides).problems.every((p) => p.unlocked)).toBe(true)
    }
  })
})
