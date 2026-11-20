import type { Contest, Diagnostic, ProblemInfo, SourceFormat, TeamRecord } from '../types'
import type { ParsedSheet } from '../parse/xcpcio'
import { info, warning } from '../parse/shared'
import { aggregateTeam } from './aggregate'

/** 这个数据源的时刻精度只到分钟（xlsx 导出）还是到秒（xcpclink / QOJ / board.xcpcio） */
export function isMinutePrecision(source: SourceFormat): boolean {
  return source === 'xcpcio' || source === 'qoj'
}

/** 来源的展示名 */
export function sourceLabel(source: SourceFormat): string {
  switch (source) {
    case 'xcpcio':
      return 'board.xcpio'
    case 'xcpclink':
      return 'xcpclink'
    case 'qoj':
      return 'QOJ'
    default:
      return 'board.xcpcio'
  }
}

export interface CreateContestInput {
  fileName: string
  sheetName: string
  source: SourceFormat
  parsed: ParsedSheet
  penaltyPerWrongSec?: number
}

export function createContest(input: CreateContestInput): Contest {
  const { parsed, source, fileName, sheetName } = input
  const penaltyPerWrongSec = input.penaltyPerWrongSec ?? 20 * 60
  const diagnostics: Diagnostic[] = [...parsed.notes]

  const acCount: Record<string, number> = {}
  const nameCount = new Map<string, number>()
  let maxResultSec = 0
  let solvedMismatch = 0
  let penaltyMismatch = 0
  let maxPenaltyDelta = 0

  for (const team of parsed.teams) {
    nameCount.set(team.name, (nameCount.get(team.name) ?? 0) + 1)
    for (const cell of Object.values(team.cells)) {
      maxResultSec = Math.max(maxResultSec, cell.acceptSec ?? 0, cell.lastRejectSec ?? 0)
      if (!cell.ac || cell.acceptSec == null) continue
      acCount[cell.letter] = (acCount[cell.letter] ?? 0) + 1
    }
    if (team.source.solved == null && team.source.penaltySec == null) continue
    const agg = aggregateTeam(team.cells, penaltyPerWrongSec)
    if (team.source.solved != null && team.source.solved !== agg.solved) solvedMismatch += 1
    if (team.source.penaltySec != null) {
      const delta = Math.abs(team.source.penaltySec - agg.penaltySec)
      if (delta > maxPenaltyDelta) maxPenaltyDelta = delta
      if (delta > 1) penaltyMismatch += 1
    }
  }

  const problems: ProblemInfo[] = parsed.problems
  const totalAc = Object.values(acCount).reduce((a, b) => a + b, 0)

  diagnostics.push(
    info(`识别 ${parsed.teams.length} 支队伍、${problems.length} 道题、${totalAc} 次通过`),
  )

  if (solvedMismatch > 0) {
    diagnostics.push(warning(`${solvedMismatch} 支队伍的"通过数"与文件不一致（以重算值为准）`))
  }
  if (penaltyMismatch > 0) {
    diagnostics.push(
      warning(
        `${penaltyMismatch} 支队伍的"罚时"与文件不一致，最大偏差 ${Math.round(maxPenaltyDelta / 60)} 分钟（以重算值为准）`,
      ),
    )
  } else if (parsed.teams.length > 0) {
    diagnostics.push(info(`${parsed.teams.length} 支队伍的罚时与文件逐队一致`))
  }

  const statMismatch: string[] = []
  for (const p of problems) {
    if (!p.headerStats) continue
    const computed = acCount[p.letter] ?? 0
    if (p.headerStats.ac !== computed) {
      statMismatch.push(`${p.letter} 表头 ${p.headerStats.ac} / 实算 ${computed}`)
    }
  }
  if (statMismatch.length > 0) {
    diagnostics.push(warning(`表头通过数与实算不一致：${statMismatch.join('，')}`))
  }

  const dup = [...nameCount.entries()].filter(([, n]) => n > 1)
  if (dup.length > 0) {
    diagnostics.push(info(`有 ${dup.length} 组同名队伍，已在内部按行号区分`))
  }
  if (parsed.teams.length === 0) {
    diagnostics.push(warning('该工作表没有解析到任何队伍'))
  }

  const suggestedDurationSec = Math.max(300 * 60, Math.ceil(maxResultSec / 60) * 60)
  const suggestedFreezeSec = Math.max(0, suggestedDurationSec - 3600)

  const title = parsed.title?.trim() || fileName.replace(/\.xlsx?$/i, '')

  return {
    id: `${source}:${fileName}:${sheetName}`,
    title,
    fileName,
    sheetName,
    source,
    problems,
    teams: parsed.teams,
    suggestedDurationSec,
    suggestedFreezeSec,
    importedAt: Date.now(),
    diagnostics,
  }
}

export interface ContestIndex {
  contest: Contest
  letters: string[]
  teams: TeamRecord[]
  /** 参与解锁统计的队伍（不含虚拟队伍） */
  fieldTeams: TeamRecord[]
  officialTeams: TeamRecord[]
  /** 自己创建的虚拟队伍 */
  virtualTeams: TeamRecord[]
  teamById: Map<string, TeamRecord>
  /** 每题全部 AC 时刻（升序） */
  acSecs: Record<string, number[]>
  /** 每题仅正式队的 AC 时刻（升序） */
  officialAcSecs: Record<string, number[]>
  totalAc: number
  maxAcceptSec: number
  maxRejectSec: number
  firstBlood: Record<string, { teamId: string; teamName: string; sec: number } | undefined>
}

export function buildIndex(contest: Contest): ContestIndex {
  const letters = contest.problems.map((p) => p.letter)
  const acSecs: Record<string, number[]> = {}
  const officialAcSecs: Record<string, number[]> = {}
  const firstBlood: ContestIndex['firstBlood'] = {}
  for (const letter of letters) {
    acSecs[letter] = []
    officialAcSecs[letter] = []
  }

  // 虚拟队伍只上榜，不进任何统计
  const fieldTeams = contest.teams.filter((t) => !t.virtual)
  const virtualTeams = contest.teams.filter((t) => t.virtual)

  let maxAcceptSec = 0
  let maxRejectSec = 0
  let totalAc = 0
  for (const team of fieldTeams) {
    for (const letter of letters) {
      const cell = team.cells[letter]
      if (cell?.lastRejectSec != null) maxRejectSec = Math.max(maxRejectSec, cell.lastRejectSec)
      if (!cell?.ac || cell.acceptSec == null) continue
      totalAc += 1
      acSecs[letter].push(cell.acceptSec)
      if (team.markers.official) officialAcSecs[letter].push(cell.acceptSec)
      if (cell.acceptSec > maxAcceptSec) maxAcceptSec = cell.acceptSec
      const fb = firstBlood[letter]
      if (!fb || cell.acceptSec < fb.sec) {
        firstBlood[letter] = { teamId: team.id, teamName: team.name, sec: cell.acceptSec }
      }
    }
  }

  for (const letter of letters) {
    acSecs[letter].sort((a, b) => a - b)
    officialAcSecs[letter].sort((a, b) => a - b)
  }

  return {
    contest,
    letters,
    teams: contest.teams,
    fieldTeams,
    officialTeams: fieldTeams.filter((t) => t.markers.official),
    virtualTeams,
    teamById: new Map(contest.teams.map((t) => [t.id, t])),
    acSecs,
    officialAcSecs,
    totalAc,
    maxAcceptSec,
    maxRejectSec,
    firstBlood,
  }
}
