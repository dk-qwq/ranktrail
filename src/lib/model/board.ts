import type { CellView, EntryView, ProblemView, RowView, Snapshot } from '../types'

export type BoardColumn =
  | { kind: 'problem'; problem: ProblemView; problemIndex: number }
  | { kind: 'anonymous'; ordinal: number }

/**
 * 已揭题固定在最左侧并保留原题序，其余列仍是每队自己的匿名提交顺序。
 * 默认封榜规则会在封榜时揭开全部题目，此时自然恢复完整的原题序。
 * 这里只使用快照给出的解锁状态，关闭封榜揭题时也不会额外暴露题号。
 */
export function buildBoardColumns(snapshot: Snapshot): BoardColumn[] {
  const columns: BoardColumn[] = []
  snapshot.problems.forEach((problem, problemIndex) => {
    if (problem.unlocked) columns.push({ kind: 'problem', problem, problemIndex })
  })
  const remaining = snapshot.problems.length - columns.length
  for (let i = 1; i <= remaining; i += 1) columns.push({ kind: 'anonymous', ordinal: i })
  return columns
}

function entryFromCell(cell: CellView | undefined, letter: string): EntryView | undefined {
  if (cell?.kind === 'ac' && cell.acceptSec != null) {
    return {
      kind: 'ac',
      attempts: cell.attempts,
      firstSec: cell.acceptSec,
      sec: cell.acceptSec,
      firstBlood: cell.firstBlood,
      recent: cell.recent,
      letter,
    }
  }
  if (cell?.kind === 'rejected') {
    return { kind: 'fail', attempts: cell.attempts, firstSec: Infinity, letter }
  }
  return undefined
}

/**
 * 不读取原始 team.cells：快照已负责截断赛时、封榜和“我的队伍”的可见范围。
 * 逐条提交的未通过格同样来自 entries，避免被抽屉 cells 的展示规则丢掉。
 */
export function projectBoardEntries(row: RowView, columns: BoardColumn[]): (EntryView | undefined)[] {
  const visibleLetters = new Set(
    columns.flatMap((column) => column.kind === 'problem' ? [column.problem.letter] : []),
  )
  const named = new Map<string, EntryView>()
  const anonymous: EntryView[] = []
  for (const entry of row.entries) {
    if (entry.letter && visibleLetters.has(entry.letter)) {
      named.set(entry.letter, entry)
    } else {
      // 即使调用者意外传入带着锁定题号的格子，匿名列也不把它交给 DOM。
      anonymous.push(entry.letter ? { ...entry, letter: undefined } : entry)
    }
  }

  let nextAnonymous = 0
  return columns.map((column) => {
    if (column.kind === 'anonymous') return anonymous[nextAnonymous++]
    return named.get(column.problem.letter) ?? entryFromCell(row.cells[column.problemIndex], column.problem.letter)
  })
}
