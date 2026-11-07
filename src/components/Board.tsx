import { Fragment, memo, useMemo, type CSSProperties } from 'react'
import type { EntryView, RowView, Snapshot } from '../lib/types'
import { buildBoardColumns, projectBoardEntries, type BoardColumn } from '../lib/model/board'
import { formatAcceptTime, formatPenalty, formatPenaltyFull } from '../lib/format'
import { cx } from './ui'

interface BoardProps {
  rows: RowView[]
  snapshot: Snapshot
  minutePrecision: boolean
  onSelectTeam: (id: string) => void
}

/** 赛时已揭题固定在左侧，其余匿名；封榜后恢复完整题序。 */
export function BoardTable({ rows, snapshot, minutePrecision, onSelectTeam }: BoardProps) {
  const columns = useMemo(() => buildBoardColumns(snapshot), [snapshot])
  const live = snapshot.phase === 'before' || snapshot.phase === 'live'
  const layoutKey = columns.map((column) => column.kind === 'problem' ? column.problem.letter : '#' + column.ordinal).join('|')
  return (
    <table className={cx('board', 'board-problems', live && 'board-live', !minutePrecision && 'has-second-times')}
      style={{ '--problem-count': columns.length } as CSSProperties} aria-label={live ? '赛时匿名榜单' : '逐题榜单'}>
      <colgroup>
        <col className="col-rank" /><col className="col-solved" /><col className="col-penalty" />
        {columns.map((_, i) => <col className="col-slot" key={i} />)}
      </colgroup>
      <thead>
        <tr>
          <th className="h-rank" scope="col">排名<small>Rank</small></th>
          <th className="h-solved" scope="col">题数<small>Solved</small></th>
          <th className="h-penalty" scope="col">罚时<small>Penalty</small></th>
          {columns.map((column, i) => (
            <th className={cx('h-slot', column.kind === 'problem' ? 'h-problem' : 'h-anonymous', isAnonymousStart(columns, i) && 'is-anonymous-start')}
              key={i} scope="col" aria-label={column.kind === 'problem' ? column.problem.letter + ' 题' : '未揭题匿名列 ' + column.ordinal}
              title={column.kind === 'problem' ? column.problem.letter + ' 题 · 通过数 / 已知提交数' : '未揭题 · 按首次提交时刻排列，不含题号'}>
              {column.kind === 'problem' ? <><span className="n">{column.problem.letter}</span><span className="u">{column.problem.accepted}/{column.problem.submitted}</span></> : <HiddenIcon />}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <TeamRow key={row.teamId} row={row} entries={projectBoardEntries(row, columns)} columns={columns}
            layoutKey={layoutKey} even={i % 2 === 1} onSelect={onSelectTeam} minutePrecision={minutePrecision} />
        ))}
        {rows.length === 0 ? <tr><td className="board-no-results" colSpan={columns.length + 3}>没有匹配的队伍</td></tr> : null}
      </tbody>
    </table>
  )
}

function isAnonymousStart(columns: BoardColumn[], i: number): boolean {
  return i > 0 && columns[i].kind === 'anonymous' && columns[i - 1].kind === 'problem'
}

interface TeamRowProps {
  row: RowView
  entries: (EntryView | undefined)[]
  columns: BoardColumn[]
  layoutKey: string
  even: boolean
  onSelect: (id: string) => void
  minutePrecision: boolean
}

const TeamRow = memo(function TeamRow({ row, entries, columns, even, onSelect, minutePrecision }: TeamRowProps) {
  const { team } = row
  const subtitle = [team.organization, team.markers.girl ? '女队' : '', team.markers.starred ? '打星' : ''].filter(Boolean).join(' · ')
  return (
    <Fragment>
      <tr className={cx('score-team-info', row.isSelf && 'is-self')} data-even={even}>
        <td className="score-members" colSpan={3}>
          {team.coaches ? <span className="member-line" title={'教练：' + team.coaches}><MemberIcon /><span>{team.coaches}</span></span> : null}
          {team.members.length > 0 ? <span className="member-line" title={'队员：' + team.members.join('、')}><MemberIcon group /><span>{team.members.join('、')}</span></span> : null}
        </td>
        <td className="score-identity" colSpan={columns.length}>
          <button className="team-button score-team-button" onClick={() => onSelect(row.teamId)} title={team.name + (subtitle ? ' · ' + subtitle : '')}>
            <span className={cx('school-badge', team.markers.starred && 'is-starred')} aria-label={team.markers.starred ? '打星队伍' : '参赛队伍'}>{team.markers.starred ? '★' : '●'}</span>
            {team.organization ? <strong className="score-org">{team.organization}</strong> : null}
            <span className="score-team-name"><span className="team-name">{team.name}</span>
              {team.virtual || row.isSelf || team.markers.girl ? <small>{[team.virtual ? '虚拟队伍' : '', row.isSelf ? '我的队伍' : '', team.markers.girl ? '女队' : ''].filter(Boolean).join(' · ')}</small> : null}
            </span>
          </button>
        </td>
      </tr>
      <tr className={cx('score-team-result', row.isSelf && 'is-self')} data-even={even}>
        <td className={cx('c-rank', row.medal && 'has-' + row.medal)}><span className="rank-num">{team.markers.starred ? '*' : row.rank > 0 ? row.rank : '–'}</span></td>
        <td className="c-solved"><span className="solved-num">{row.solved}</span></td>
        <td className="c-penalty" title={'罚时 ' + formatPenaltyFull(row.penaltySec)}>{formatPenalty(row.penaltySec)}</td>
        {entries.map((entry, i) => <ProblemCell key={i} entry={entry} column={columns[i]} anonymousStart={isAnonymousStart(columns, i)} minutePrecision={minutePrecision} />)}
      </tr>
    </Fragment>
  )
}, (a, b) => {
  if (a.layoutKey !== b.layoutKey || a.even !== b.even || a.minutePrecision !== b.minutePrecision || a.onSelect !== b.onSelect) return false
  const x = a.row, y = b.row
  if (x.rank !== y.rank || x.solved !== y.solved || x.penaltySec !== y.penaltySec || x.isSelf !== y.isSelf || x.medal !== y.medal || x.team !== y.team) return false
  return a.entries.length === b.entries.length && a.entries.every((entry, i) => {
    const other = b.entries[i]
    if (!entry || !other) return entry === other
    return entry.kind === other.kind && entry.attempts === other.attempts && entry.sec === other.sec &&
      entry.letter === other.letter && entry.firstBlood === other.firstBlood && entry.recent === other.recent
  })
})

function MemberIcon({ group = false }: { group?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="10" cy="7" r="4" /><path d="M2 22v-3a8 8 0 0 1 16 0v3" />
    {group ? <path d="M17 3a4 4 0 0 1 0 8m3 11v-3a10 10 0 0 0-3-7" /> : null}
  </svg>
}

function HiddenIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M8.3 5.8A10.6 10.6 0 0 1 12 5c5.4 0 9 7 9 7a17.1 17.1 0 0 1-3 3.9M6 6.2C4.2 7.6 3 9.5 2 12c0 0 4 7 10 7a9.4 9.4 0 0 0 4.1-.9" />
  </svg>
}

function ProblemCell({ entry, column, anonymousStart, minutePrecision }: {
  entry: EntryView | undefined; column: BoardColumn; anonymousStart: boolean; minutePrecision: boolean
}) {
  const letter = column.kind === 'problem' ? column.problem.letter : undefined
  const description = letter ? letter + ' 题' : '未揭题匿名格'
  const base = cx('pcell', !letter && 'is-anonymous', anonymousStart && 'is-anonymous-start')
  if (!entry) return <td className={cx(base, 'is-empty')} title={description + ' · 暂无可见提交'}>{letter ? <span className="tile-empty">{letter}</span> : null}</td>
  const time = entry.sec != null ? formatAcceptTime(entry.sec, minutePrecision) : null
  const displayTime = entry.sec != null && minutePrecision ? Math.floor(entry.sec / 60) + '′' : time
  if (entry.kind === 'fail') return (
    <td className={cx(base, 'is-fail')} title={description + ' · ' + entry.attempts + ' 次错误提交' + (time ? ' · 最后一次 ' + time : '')}>
      <span className="tile-fail"><span className="tile-main">−{entry.attempts}</span>{time ? <span className="tile-fail-time">{displayTime}</span> : null}</span>
    </td>
  )
  return <td className={cx(base, entry.recent && 'is-recent', entry.firstBlood && 'is-first-blood', entry.attempts > 1 && 'has-wrongs')}
    title={description + ' · ' + time + ' · ' + entry.attempts + ' 次提交' + (entry.firstBlood ? ' · 首杀' : '')}>
    <span className="tile"><span className="tile-main">{entry.attempts}</span><span className="tile-time">{displayTime}</span></span>
    {entry.firstBlood ? <span className="tile-fb" aria-label="首杀">★</span> : null}
  </td>
}
