import type { CellResult, ManualSubmission, ManualTeam, TeamRecord } from '../types'

/** 虚拟队伍的固定 id：只可能有一支 */
export const MANUAL_TEAM_ID = 'virtual'

const STORAGE_KEY = 'ranktrail.manual.v1'
const LEGACY_STORAGE_KEY = 'fogboard.manual.v1'

export function createManualTeam(input: {
  name: string
  organization?: string
  members?: string[]
}): ManualTeam {
  return {
    id: MANUAL_TEAM_ID,
    name: input.name.trim() || '我的队伍',
    organization: (input.organization ?? '').trim(),
    members: (input.members ?? []).map((m) => m.trim()).filter(Boolean),
    submissions: [],
  }
}

/**
 * 把提交流水折算成题目结果：
 *   - 只统计首个 AC **之前**的错误提交（ICPC 规则：过了之后的提交不算）
 *   - 有 AC：attempts = 错误数 + 1，acceptSec = 首个 AC 时刻
 *   - 没 AC：attempts = 错误数
 */
export function manualCells(team: ManualTeam, letters: string[]): Record<string, CellResult> {
  const cells: Record<string, CellResult> = {}
  for (const letter of letters) {
    const subs = team.submissions.filter((s) => s.letter === letter).sort((a, b) => a.sec - b.sec)
    if (subs.length === 0) continue
    const acIndex = subs.findIndex((s) => s.ac)
    // 保留真实时刻供快照截断，回退播放或封榜时不能读到未来的错误提交。
    const upto = acIndex >= 0 ? subs.slice(0, acIndex + 1) : subs
    const submits = upto.map(({ sec, ac }) => ({ sec, ac }))
    cells[letter] = {
      letter,
      ac: acIndex >= 0,
      attempts: upto.length,
      acceptSec: acIndex >= 0 ? upto[upto.length - 1].sec : undefined,
      submits,
    }
  }
  return cells
}

/** 每题当前状态，供记分板显示 */
export interface ManualLetterState {
  ac: boolean
  wrongs: number
  acceptSec?: number
}

export function manualLetterStates(
  team: ManualTeam,
  letters: string[],
): Record<string, ManualLetterState> {
  const cells = manualCells(team, letters)
  const out: Record<string, ManualLetterState> = {}
  for (const letter of letters) {
    const cell = cells[letter]
    out[letter] = {
      ac: cell?.ac ?? false,
      wrongs: cell ? (cell.ac ? cell.attempts - 1 : cell.attempts) : 0,
      acceptSec: cell?.acceptSec,
    }
  }
  return out
}

export function manualTeamRecord(team: ManualTeam, letters: string[]): TeamRecord {
  return {
    id: MANUAL_TEAM_ID,
    name: team.name,
    organization: team.organization,
    members: team.members,
    markers: { official: false, starred: false, girl: false },
    source: { rowIndex: -1 },
    cells: manualCells(team, letters),
    virtual: true,
  }
}

export function addSubmission(
  team: ManualTeam,
  submission: ManualSubmission,
  letters: string[],
): ManualTeam {
  const state = manualLetterStates(team, letters)[submission.letter]
  // 已经通过的题不再接受新的记录（按钮本来也会禁用，这里兜一层）
  if (state?.ac) return team
  return { ...team, submissions: [...team.submissions, submission] }
}

export function undoLastSubmission(team: ManualTeam): ManualTeam {
  if (team.submissions.length === 0) return team
  return { ...team, submissions: team.submissions.slice(0, -1) }
}

export function clearSubmissions(team: ManualTeam): ManualTeam {
  return { ...team, submissions: [] }
}

export function hasAnySubmission(team: ManualTeam): boolean {
  return team.submissions.length > 0
}

/* ------------------------------------------------------------------ */
/* 持久化：刷新不丢自己的提交                                           */
/* ------------------------------------------------------------------ */

interface StoredManual {
  contestId: string
  team: ManualTeam
}

export function saveManualTeam(contestId: string, team: ManualTeam | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (!team) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ contestId, team } satisfies StoredManual))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* 隐私模式忽略 */
  }
}

export function loadManualTeam(contestId: string): ManualTeam | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredManual
    if (!parsed || parsed.contestId !== contestId || !parsed.team) return null
    const team = parsed.team
    if (!team.name || !Array.isArray(team.submissions)) return null
    return {
      id: MANUAL_TEAM_ID,
      name: String(team.name),
      organization: String(team.organization ?? ''),
      members: Array.isArray(team.members) ? team.members.map(String) : [],
      submissions: team.submissions
        .filter((s) => s && typeof s.letter === 'string' && typeof s.sec === 'number')
        .map((s) => ({ letter: s.letter, ac: Boolean(s.ac), sec: s.sec })),
    }
  } catch {
    return null
  }
}
