import type { CellView, EntryView, Phase, ProblemView, RowView, Settings, Snapshot, SolveView } from '../types'
import type { ContestIndex } from './contest'
import type { UnlockPlan } from '../rules/unlock'
import { assignRanks, sortRanked, type RankEntry } from './rank'
import { clamp } from '../format'

export interface SnapshotOptions {
  index: ContestIndex
  plan: UnlockPlan
  settings: Settings
  /** 当前播放时刻（秒） */
  t: number
  /** 用户手动"解封" */
  manualReveal: boolean
}

function upperBound(sorted: number[], value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

const EMPTY_CELL: CellView = { kind: 'empty', attempts: 0 }

export function buildSnapshot(opts: SnapshotOptions): Snapshot {
  const { index, plan, settings } = opts
  const durationSec = plan.durationSec
  const t = clamp(opts.t, 0, durationSec)
  const freezeSec = plan.freezeSec
  const freezeActive = Number.isFinite(freezeSec)

  const revealed = settings.showFullInfo || opts.manualReveal || t >= durationSec
  const frozenNow = freezeActive && t >= freezeSec && t < durationSec
  const phase: Phase = t >= durationSec ? 'final' : t <= 0 ? 'before' : frozenNow ? 'frozen' : 'live'

  const dataT = revealed ? t : freezeActive && t > freezeSec ? freezeSec : t
  const tSelf = settings.selfSeesLive ? t : dataT

  // 虚拟队伍永远出现在榜上（哪怕口径是"仅正式队"，否则一勾自己就消失了）
  const roster = settings.scope === 'official' ? index.officialTeams : index.fieldTeams
  const teams = index.virtualTeams.length ? [...roster, ...index.virtualTeams] : roster

  // 有逐条提交时只统计 dataT 之前的流水；聚合数据按已发生的 AC 计入 attempts。
  // 没有时刻的最终错误次数只在解封 / 终榜后计入，其余挂在 submittedPending 上。
  const submitted = plan.problems.map((p) => {
    let n = 0
    for (const team of roster) {
      const cell = team.cells[p.letter]
      if (!cell) continue
      if (cell.submits) {
        n += cell.submits.filter((s) => s.sec <= dataT).length
      } else if (cell.ac && cell.acceptSec != null) {
        if (cell.acceptSec <= dataT) n += cell.attempts
      } else if (!cell.ac && revealed) {
        n += cell.attempts
      }
    }
    return n
  })

  const submittedPending = plan.problems.map((p) => {
    if (revealed) return 0
    let n = 0
    for (const team of roster) {
      const cell = team.cells[p.letter]
      if (cell && !cell.ac && !cell.submits) n += cell.attempts
    }
    return n
  })

  const problems: ProblemView[] = plan.problems.map((p, i) => {
    const unlocked = revealed || p.unlockSec <= dataT
    const accepted = upperBound(p.acceptedSecs, dataT)
    const justUnlocked =
      unlocked && Number.isFinite(p.unlockSec) && dataT >= p.unlockSec && dataT - p.unlockSec <= 180
    return {
      letter: p.letter,
      unlocked,
      unlockSec: p.unlockSec,
      reason: p.reason,
      accepted,
      submitted: submitted[i],
      submittedPending: submittedPending[i],
      threshold: plan.threshold.threshold,
      justUnlocked,
    }
  })

  const unlockedLetter = new Set(problems.filter((p) => p.unlocked).map((p) => p.letter))

  // 实时奖牌线：按名次百分比（累积）。并列名次一起给，所以实际人数可能略多于上限
  const medalCuts = {
    gold: Math.max(0, Math.round((roster.length * settings.medalGoldPct) / 100)),
    silver: Math.max(0, Math.round((roster.length * settings.medalSilverPct) / 100)),
    bronze: Math.max(0, Math.round((roster.length * settings.medalBronzePct) / 100)),
  }

  const entries: (RankEntry & { row: RowView })[] = []

  for (const team of teams) {
    const isSelf = settings.selfTeamId === team.id
    const tTeam = isSelf ? tSelf : dataT

    // 主榜的"通过顺序"：与题目是否解锁无关，只看通过时刻
    const raw: { letter: string; attempts: number; acceptSec: number; firstBlood?: boolean }[] = []
    for (const cell of Object.values(team.cells)) {
      if (cell.ac && cell.acceptSec != null && cell.acceptSec <= tTeam) {
        raw.push({
          letter: cell.letter,
          attempts: cell.attempts,
          acceptSec: cell.acceptSec,
          firstBlood: cell.firstBlood,
        })
      }
    }
    raw.sort((a, b) => a.acceptSec - b.acceptSec || a.letter.localeCompare(b.letter))

    let solved = 0
    let penaltySec = 0
    let lastAcSec = -1
    const solves: SolveView[] = raw.map((s) => {
      solved += 1
      penaltySec += s.acceptSec + plan.penaltyPerWrongSec * Math.max(0, s.attempts - 1)
      if (s.acceptSec > lastAcSec) lastAcSec = s.acceptSec
      return {
        attempts: s.attempts,
        acceptSec: s.acceptSec,
        firstBlood: s.firstBlood,
        recent: tTeam - s.acceptSec <= 60,
        // 这道题解锁之后，榜上这格才补上题号
        letter: unlockedLetter.has(s.letter) ? s.letter : undefined,
      }
    })

    // 队伍抽屉用的逐题明细：受解锁状态约束
    const cells: CellView[] = plan.problems.map((p, i) => {
      const cell = team.cells[p.letter]
      const columnUnlocked = problems[i].unlocked
      const visible = columnUnlocked || isSelf
      if (!visible) return { kind: 'locked', attempts: 0, lockedColumn: true }

      if (cell?.ac && cell.acceptSec != null && cell.acceptSec <= tTeam) {
        return {
          kind: 'ac',
          attempts: cell.attempts,
          acceptSec: cell.acceptSec,
          firstBlood: cell.firstBlood,
          recent: tTeam - cell.acceptSec <= 60,
          lockedColumn: !columnUnlocked,
        }
      }

      if (cell?.submits) {
        const wrongs = cell.submits.filter((s) => s.sec <= tTeam && !s.ac).length
        if (wrongs > 0) return { kind: 'rejected', attempts: wrongs, lockedColumn: !columnUnlocked }
      } else if (revealed && cell && !cell.ac && cell.attempts > 0) {
        return { kind: 'rejected', attempts: cell.attempts, lockedColumn: !columnUnlocked }
      }

      return columnUnlocked ? EMPTY_CELL : { kind: 'empty', attempts: 0, lockedColumn: true }
    })

    // 主榜格子：一队一题一格，按"第一次交这道题的时刻"排序。
    // 有逐条提交（board.xcpcio）时，未通过的 −n 会随错误次数长出来；
    // 只有聚合数据（xlsx）时，未通过的题没有时刻，只有解封后才给出最终错误次数。
    const rowEntries: EntryView[] = []
    for (const cell of Object.values(team.cells)) {
      const label = unlockedLetter.has(cell.letter) ? cell.letter : undefined
      const submits = cell.submits

      if (cell.ac && cell.acceptSec != null && cell.acceptSec <= tTeam) {
        const upto = submits ? submits.filter((s) => s.sec <= tTeam) : null
        rowEntries.push({
          kind: 'ac',
          attempts: upto ? Math.max(1, upto.length) : cell.attempts,
          firstSec: submits?.[0]?.sec ?? cell.acceptSec,
          sec: cell.acceptSec,
          letter: label,
          firstBlood: cell.firstBlood,
          recent: tTeam - cell.acceptSec <= 60,
        })
        continue
      }

      if (cell.attempts <= 0) continue
      if (submits) {
        const wrong = submits.filter((s) => s.sec <= tTeam && !s.ac)
        if (wrong.length === 0) continue
        rowEntries.push({
          kind: 'fail',
          attempts: wrong.length,
          firstSec: wrong[0].sec,
          sec: wrong[wrong.length - 1].sec,
          letter: label,
        })
      } else if (revealed && !cell.ac) {
        // 没有时刻：解锁或设为自己的队伍都不能确定这些提交是否已经发生。
        rowEntries.push({ kind: 'fail', attempts: cell.attempts, firstSec: Infinity, letter: label })
      }
    }
    const sortKey = (e: EntryView) => (Number.isFinite(e.firstSec) ? e.firstSec : Number.MAX_SAFE_INTEGER)
    rowEntries.sort(
      (a, b) => sortKey(a) - sortKey(b) || (a.sec ?? 0) - (b.sec ?? 0) || (a.letter ?? '').localeCompare(b.letter ?? ''),
    )

    const row: RowView = {
      teamId: team.id,
      team,
      rank: 0,
      solved,
      penaltySec,
      lastAcSec,
      isSelf,
      medal: null,
      solves,
      entries: rowEntries,
      cells,
    }
    entries.push({ id: team.id, solved, penaltySec, lastAcSec, row })
  }

  const sorted = sortRanked(entries)
  const ranks = assignRanks(sorted)
  const rows: RowView[] = sorted.map((entry, i) => {
    entry.row.rank = phase === 'before' ? 0 : ranks[i]
    // 奖牌线是实时的：名次一变，档位跟着变；一题没过的没有奖牌
    const rank = entry.row.rank
    if (settings.medalEnabled && rank > 0 && entry.row.solved > 0) {
      if (rank <= medalCuts.gold) entry.row.medal = 'gold'
      else if (rank <= medalCuts.silver) entry.row.medal = 'silver'
      else if (rank <= medalCuts.bronze) entry.row.medal = 'bronze'
    }
    return entry.row
  })

  let totalAc = 0
  let solvedTeams = 0
  let acceptedRecent = 0
  for (const row of rows) {
    // 全场统计只算官方队伍，虚拟队伍不参与
    if (row.team.virtual) continue
    totalAc += row.solved
    if (row.solved > 0) solvedTeams += 1
    for (const cell of row.cells) if (cell.recent) acceptedRecent += 1
  }

  return {
    t,
    dataT,
    durationSec,
    freezeSec: freezeActive ? freezeSec : null,
    phase,
    revealed,
    threshold: plan.threshold.threshold,
    thresholdSource: plan.threshold.source,
    teamCount: roster.length,
    problems,
    rows,
    medals: medalCuts,
    stats: {
      totalAc,
      solvedTeams,
      unlockedProblems: problems.filter((p) => p.unlocked).length,
      acceptedRecent,
    },
  }
}
