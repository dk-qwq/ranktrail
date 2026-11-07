import { useCallback, useEffect, useMemo, useState } from 'react'
import chengduUrl from '../fixtures/board-xcpcio-chengdu.xlsx?url'
import qinhuangdaoUrl from '../fixtures/xcpclink-qinhuangdao.xlsx?url'

import { analyzeSheet, analyzeWorkbook, type WorkbookReport } from './lib/parse/detect'
import { parseWorkbook, readWorkbookFile } from './lib/parse/workbook'
import { parseXcpcio } from './lib/parse/xcpcio'
import { parseXcpclink } from './lib/parse/xcpclink'
import { dumpFromText, parseQojDump } from './lib/parse/qoj'
import { parseXcpcioBoard } from './lib/parse/xcpcio-board'
import { buildIndex, createContest, isMinutePrecision } from './lib/model/contest'
import {
  MANUAL_TEAM_ID,
  addSubmission,
  clearSubmissions,
  createManualTeam,
  loadManualTeam,
  manualLetterStates,
  manualTeamRecord,
  saveManualTeam,
  undoLastSubmission,
} from './lib/model/manual'
import { computeUnlocks } from './lib/rules/unlock'
import { buildSnapshot } from './lib/model/snapshot'
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from './lib/rules/settings'
import type { Contest, ManualTeam, Settings, WorkbookFile } from './lib/types'
import { cx, Icon, Toast } from './components/ui'
import { formatAcceptTime, formatClock } from './lib/format'
import { BoardTable } from './components/Board'
import { Playbar, Timeline } from './components/Playback'
import { Rail } from './components/Rail'
import {
  CreateTeamDialog,
  DiagnosticsDialog,
  ImportDialog,
  RuleDialog,
  SettingsDialog,
  TeamDrawer,
} from './components/Dialogs'
import { usePlayback } from './state/usePlayback'
import { BRAND } from './lib/brand'

type DialogName = 'import' | 'settings' | 'help' | 'diagnostics' | 'team' | null

const SAMPLE_FILE = {
  chengdu: 'board-xcpcio-chengdu.xlsx',
  qinhuangdao: 'xcpclink-qinhuangdao.xlsx',
} as const

export default function App() {
  const [workbook, setWorkbook] = useState<WorkbookFile | null>(null)
  const [report, setReport] = useState<WorkbookReport | null>(null)
  const [sheetName, setSheetName] = useState<string | null>(null)
  const [contest, setContest] = useState<Contest | null>(null)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [manualReveal, setManualReveal] = useState(false)
  const [dialog, setDialog] = useState<DialogName>(null)
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [selectedProblem, setSelectedProblem] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(true)
  const [compactRail, setCompactRail] = useState(() => window.matchMedia('(max-width: 1280px)').matches)
  const [railOverlayOpen, setRailOverlayOpen] = useState(false)
  const railVisible = compactRail ? railOverlayOpen : railOpen

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1280px)')
    const update = () => { setCompactRail(media.matches); setRailOverlayOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!railOverlayOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialog && !selectedTeam) setRailOverlayOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [railOverlayOpen, dialog, selectedTeam])
  const [manualTeam, setManualTeam] = useState<ManualTeam | null>(null)
  const [manualPick, setManualPick] = useState<string | null>(null)

  // 虚拟队伍并入参赛名单：它只上榜，不参与解锁与统计
  const effectiveContest = useMemo<Contest | null>(() => {
    if (!contest) return null
    if (!manualTeam) return contest
    const letters = contest.problems.map((p) => p.letter)
    return { ...contest, teams: [...contest.teams, manualTeamRecord(manualTeam, letters)] }
  }, [contest, manualTeam])

  const index = useMemo(() => (effectiveContest ? buildIndex(effectiveContest) : null), [effectiveContest])
  const plan = useMemo(() => (index ? computeUnlocks(index, settings) : null), [index, settings])
  const durationSec = plan?.durationSec ?? 300 * 60
  const playback = usePlayback(durationSec)

  const snapshot = useMemo(() => {
    if (!index || !plan) return null
    return buildSnapshot({ index, plan, settings, t: playback.t, manualReveal })
  }, [index, plan, settings, playback.t, manualReveal])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3400)
    return () => window.clearTimeout(id)
  }, [toast])

  const finishLoad = useCallback(
    (next: Contest, sheetLabel: string) => {
      const saved = loadManualTeam(next.id)
      setContest(next)
      setSheetName(sheetLabel)
      setManualReveal(false)
      setSelectedTeam(null)
      setSelectedProblem(null)
      setQuery('')
      setSettings((prev) => ({
        ...prev,
        durationMin: Math.round(next.suggestedDurationSec / 60),
        freezeStartMin: Math.round(next.suggestedFreezeSec / 60),
        selfTeamId: saved ? MANUAL_TEAM_ID : null,
      }))
      setDialog(saved ? null : 'team')
      setToast(`${next.title} · ${next.teams.length} 支队伍 · ${next.problems.length} 道题`)
      playback.pause()
      playback.seek(0)
    },
    [playback],
  )

  const applySheet = useCallback(
    (file: WorkbookFile, name: string) => {
      const sheet = file.sheets.find((s) => s.name === name)
      if (!sheet) return
      const analysis = analyzeSheet(sheet)
      if (!analysis.format) {
        setToast(`工作表「${name}」里没有找到题目列`)
        setDialog('import')
        return
      }
      const parsed =
        analysis.format === 'xcpcio'
          ? parseXcpcio({ fileName: file.fileName, sheet, analysis })
          : parseXcpclink({ fileName: file.fileName, sheet, analysis })
      const next = createContest({
        fileName: file.fileName,
        sheetName: name,
        source: analysis.format,
        parsed,
      })
      setWorkbook(file)
      setReport(analyzeWorkbook(file))
      finishLoad(next, name)
    },
    [finishLoad],
  )

  /** 粘贴 QOJ 抓取结果（JSON）或另存网页的 HTML；返回错误信息，成功返回 null */
  const loadQojText = useCallback(
    (text: string): string | null => {
      try {
        const dump = dumpFromText(text)
        const parsed = parseQojDump(dump)
        const next = createContest({
          fileName: dump.url || 'qoj',
          sheetName: 'QOJ 榜单',
          source: 'qoj',
          parsed,
        })
        setWorkbook(null)
        setReport(null)
        finishLoad(next, 'QOJ 榜单')
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    [finishLoad],
  )

  /** 切换榜单时恢复属于自己的那支虚拟队伍 */
  useEffect(() => {
    if (!contest) {
      setManualTeam(null)
      return
    }
    const saved = loadManualTeam(contest.id)
    setManualTeam(saved)
    if (saved) setSettings((prev) => ({ ...prev, selfTeamId: MANUAL_TEAM_ID }))
  }, [contest])

  const commitManual = useCallback(
    (next: ManualTeam | null) => {
      setManualTeam(next)
      if (contest) saveManualTeam(contest.id, next)
    },
    [contest],
  )

  const handleCreateTeam = useCallback(
    (input: { name: string; organization: string; members: string[] }) => {
      if (!contest) return
      const base = createManualTeam(input)
      // 编辑已有队伍时保留提交流水，只改名字
      const team = manualTeam ? { ...base, submissions: manualTeam.submissions } : base
      commitManual(team)
      setSettings((prev) => ({ ...prev, selfTeamId: MANUAL_TEAM_ID }))
      setDialog(null)
      setToast(
        manualTeam
          ? `已更新队伍信息：${team.name}`
          : `${team.name} 加入榜单：从现在开始，点「通过了 / 没通过」记录你的提交`,
      )
    },
    [contest, commitManual, manualTeam],
  )

  const handleRemoveTeam = useCallback(() => {
    commitManual(null)
    setSettings((prev) => ({ ...prev, selfTeamId: null }))
    setToast('已移除虚拟队伍')
  }, [commitManual])

  const handleRecord = useCallback(
    (letter: string, ac: boolean) => {
      if (!manualTeam || !contest) return
      const letters = contest.problems.map((p) => p.letter)
      const before = manualLetterStates(manualTeam, letters)[letter]
      if (before?.ac) {
        setToast(`${letter} 题已经通过了`)
        return
      }
      const sec = Math.floor(playback.t)
      const next = addSubmission(manualTeam, { letter, ac, sec }, letters)
      commitManual(next)
      const minutePrecision = isMinutePrecision(contest.source)
      const frozen = snapshot?.phase === 'frozen' && !snapshot.revealed
      const tail = frozen ? '（封榜中，解封后才上榜）' : ''
      if (ac) {
        const wrongs = manualLetterStates(next, letters)[letter].wrongs
        setToast(
          `${letter} 题通过 · ${formatAcceptTime(sec, minutePrecision)}${wrongs > 0 ? ` · 之前错了 ${wrongs} 次` : ''}${tail}`,
        )
      } else {
        setToast(`${letter} 题没通过（第 ${manualLetterStates(next, letters)[letter].wrongs} 次）${tail}`)
      }
    },
    [manualTeam, contest, playback.t, commitManual, snapshot],
  )

  const handleUndoSubmission = useCallback(() => {
    if (!manualTeam || manualTeam.submissions.length === 0) return
    const last = manualTeam.submissions[manualTeam.submissions.length - 1]
    commitManual(undoLastSubmission(manualTeam))
    setToast(`撤销：${last.letter} 题 ${last.ac ? '通过' : '没通过'} · ${formatClock(last.sec)}`)
  }, [manualTeam, commitManual])

  const handleClearSubmissions = useCallback(() => {
    if (!manualTeam) return
    commitManual(clearSubmissions(manualTeam))
    setToast('已清空所有提交记录')
  }, [manualTeam, commitManual])

  const loadFromBuffer = useCallback(
    (buffer: ArrayBuffer, fileName: string) => {
      try {
        const file = parseWorkbook(buffer, fileName)
        const rep = analyzeWorkbook(file)
        setWorkbook(file)
        setReport(rep)
        if (rep.bestSheet) applySheet(file, rep.bestSheet)
        else {
          setDialog('import')
          setToast('没有识别到榜单工作表，请确认是 board.xcpio 或 xcpclink 的导出')
        }
      } catch (err) {
        setToast(`读取失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [applySheet],
  )

  /** board.xcpcio 的合并 JSON（config + team + run） */
  const loadXcpcioBoard = useCallback(
    (text: string, fileName: string): string | null => {
      try {
        const raw = JSON.parse(text) as unknown
        const parsed = parseXcpcioBoard(raw as never)
        const next = createContest({
          fileName,
          sheetName: 'xcpcio',
          source: 'xcpcio-board',
          parsed,
        })
        setWorkbook(null)
        setReport(null)
        finishLoad(next, 'xcpcio')
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    [finishLoad],
  )

  const loadFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.json')) {
        const text = await file.text()
        const err = loadXcpcioBoard(text, file.name)
        if (err) setToast(`读取失败：${err}`)
        return
      }
      try {
        const parsed = await readWorkbookFile(file)
        const rep = analyzeWorkbook(parsed)
        setWorkbook(parsed)
        setReport(rep)
        if (rep.bestSheet) applySheet(parsed, rep.bestSheet)
        else {
          setDialog('import')
          setToast('没有识别到榜单工作表，请确认是 board.xcpio 或 xcpclink 的导出')
        }
      } catch (err) {
        setToast(`读取失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [applySheet, loadXcpcioBoard],
  )

  const loadSample = useCallback(
    async (which: 'chengdu' | 'qinhuangdao') => {
      const url = which === 'chengdu' ? chengduUrl : qinhuangdaoUrl
      try {
        const res = await fetch(url)
        const buffer = await res.arrayBuffer()
        loadFromBuffer(buffer, SAMPLE_FILE[which])
      } catch (err) {
        setToast(`示例载入失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [loadFromBuffer],
  )

  const pickSheet = useCallback(
    (name: string) => {
      if (!workbook) return
      applySheet(workbook, name)
    },
    [workbook, applySheet],
  )

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => normalizeSettings({ ...prev, ...patch }))
  }, [])

  const resetSettings = useCallback(() => {
    setSettings((prev) => ({
      ...DEFAULT_SETTINGS,
      durationMin: prev.durationMin,
      freezeStartMin: prev.freezeStartMin,
      selfTeamId: prev.selfTeamId,
    }))
  }, [])

  const visibleRows = useMemo(() => {
    if (!snapshot) return []
    const q = query.trim().toLowerCase()
    if (!q) return snapshot.rows
    return snapshot.rows.filter(
      (r) =>
        r.team.name.toLowerCase().includes(q) ||
        r.team.organization.toLowerCase().includes(q) ||
        r.team.members.join(' ').toLowerCase().includes(q),
    )
  }, [snapshot, query])

  const selectedRow = useMemo(
    () => (snapshot && selectedTeam ? snapshot.rows.find((r) => r.teamId === selectedTeam) ?? null : null),
    [snapshot, selectedTeam],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (dialog) return
      if (selectedTeam) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          playback.toggle()
          break
        case 'ArrowLeft':
          e.preventDefault()
          playback.step(e.shiftKey ? -60 : -10)
          break
        case 'ArrowRight':
          e.preventDefault()
          playback.step(e.shiftKey ? 60 : 10)
          break
        case 'Home':
          e.preventDefault()
          playback.seek(0)
          break
        case 'End':
          e.preventDefault()
          playback.seek(durationSec)
          break
        case 'u':
        case 'U':
          setManualReveal((v) => !v)
          break
        case 'Enter':
          // 虚拟队伍：选中的题记为通过（别抢按钮自己的 Enter）
          if (manualPick && tag !== 'BUTTON') {
            e.preventDefault()
            handleRecord(manualPick, true)
          }
          break
        case 'Backspace':
          if (manualPick && tag !== 'BUTTON') {
            e.preventDefault()
            handleRecord(manualPick, false)
          }
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playback, dialog, selectedTeam, durationSec, manualPick, handleRecord])

  const selfName =
    (settings.selfTeamId && index?.teamById.get(settings.selfTeamId)?.name) || null

  return (
    <div className={cx('app', !snapshot && 'empty-shell')}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">{BRAND.nameChinese}</span>
          <span className="brand-latin">{BRAND.nameLatin}</span>
        </div>
        <div className="topbar-sep" />
        <div className="topbar-context">
          <span className="context-tag">by {BRAND.owner}</span>
          <span className="context-title">
            {contest
              ? `${[...new Set([contest.title, contest.sheetName].filter(Boolean))].join(' · ')} · ${
                  contest.teams.length
                } 队`
              : '赛时榜单回放'}
          </span>
        </div>
        <div className="topbar-actions">
          <button className="ghost-btn" onClick={() => setDialog('import')} title="导入榜单文件">
            <Icon name="upload" />
            <span>导入</span>
          </button>
          <button className="ghost-btn" onClick={() => setDialog('help')} title="规则与数据说明">
            <Icon name="book" />
            <span>规则</span>
          </button>
          <button
            className="ghost-btn"
            onClick={() => setDialog('diagnostics')}
            disabled={!contest}
            title="数据诊断"
          >
            <Icon name="pulse" />
            <span>诊断</span>
          </button>
          <button
            className="ghost-btn"
            data-active={railVisible}
            aria-expanded={railVisible}
            aria-controls="contest-panel"
            aria-label="面板"
            disabled={!snapshot}
            onClick={() => compactRail ? setRailOverlayOpen((v) => !v) : setRailOpen((v) => !v)}
            title="展开 / 收起右栏"
          >
            <Icon name="panel" />
            <span>面板</span>
          </button>
          <button className="ghost-btn" onClick={() => setDialog('settings')} title="回放规则设置">
            <Icon name="sliders" />
            <span>设置</span>
          </button>
        </div>
      </header>

      {snapshot && index && plan ? (
        <>
          <Playbar
            t={snapshot.t}
            durationSec={snapshot.durationSec}
            freezeSec={snapshot.freezeSec}
            phase={snapshot.phase}
            playing={playback.playing}
            speed={playback.speed}
            revealed={snapshot.revealed}
            unlocked={snapshot.stats.unlockedProblems}
            problemCount={snapshot.problems.length}
            query={query}
            filtered={query.trim() ? visibleRows.length : null}
            onQuery={setQuery}
            onToggle={playback.toggle}
            onSeek={playback.seek}
            onSpeed={playback.setSpeed}
          />

          <main className={cx('stage', railVisible && 'has-rail', compactRail && 'rail-as-overlay', snapshot.phase === 'frozen' && 'is-frozen')}>
            <div className="stage-main">
              {snapshot.phase === 'frozen' ? (
                <div className="freeze-banner" role="status">
                  <span className="fb-tag">封榜</span>
                  <span className="fb-text">
                    数据冻结于 {formatClock(snapshot.freezeSec ?? 0)}
                    {snapshot.revealed
                      ? ' · 已解封，正在显示封榜后的结果'
                      : ' · 封榜后新的通过不会显示'}
                  </span>
                  <span className="fb-spacer" />
                  <button
                    className="action-btn"
                    data-on={snapshot.revealed}
                    onClick={() => setManualReveal((v) => !v)}
                  >
                    {snapshot.revealed ? '恢复封榜' : '解封'}
                  </button>
                </div>
              ) : null}
              <div className="board-wrap">
                <BoardTable
                  rows={visibleRows}
                  snapshot={snapshot}
                  minutePrecision={isMinutePrecision(contest!.source)}
                  onSelectTeam={setSelectedTeam}
                />
              </div>
            </div>
            {compactRail && railVisible ? <button className="rail-overlay-scrim" aria-label="关闭侧栏" onClick={() => setRailOverlayOpen(false)} /> : null}
            {railVisible ? (
              <Rail
                contest={contest!}
                index={index}
                snapshot={snapshot}
                plan={plan}
                settings={settings}
                selectedProblem={selectedProblem}
                onSelectProblem={setSelectedProblem}
                onSelectTeam={setSelectedTeam}
                manualTeam={manualTeam}
                manualPick={manualPick}
                onPickProblem={setManualPick}
                onRecord={handleRecord}
                onUndo={handleUndoSubmission}
                onClear={handleClearSubmissions}
                onCreateTeam={() => setDialog('team')}
                onRemoveTeam={handleRemoveTeam}
              />
            ) : null}
          </main>

          <Timeline
            t={snapshot.t}
            durationSec={snapshot.durationSec}
            freezeSec={snapshot.freezeSec}
            onSeek={playback.seek}
          />
        </>
      ) : (
        <EmptyState
          onFile={loadFile}
          onSample={loadSample}
          onOpenImport={() => setDialog('import')}
          onOpenQoj={() => setDialog('import')}
        />
      )}

      {dialog === 'import' ? (
        <ImportDialog
          report={report}
          activeSheet={sheetName}
          onFile={loadFile}
          onPickSheet={pickSheet}
          onSample={loadSample}
          onQojText={loadQojText}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'settings' ? (
        <SettingsDialog
          settings={settings}
          teamCount={
            index ? (settings.scope === 'official' ? index.officialTeams.length : index.fieldTeams.length) : 0
          }
          selfName={selfName}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'help' ? <RuleDialog onClose={() => setDialog(null)} /> : null}

      {dialog === 'team' ? (
        <CreateTeamDialog
          existing={manualTeam}
          onSubmit={handleCreateTeam}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'diagnostics' && contest ? (
        <DiagnosticsDialog
          contest={contest}
          report={report}
          activeSheet={sheetName}
          onPickSheet={pickSheet}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {selectedRow && snapshot ? (
        <TeamDrawer
          row={selectedRow}
          problems={snapshot.problems}
          minutePrecision={isMinutePrecision(contest?.source ?? 'xcpcio')}
          onClose={() => setSelectedTeam(null)}
          onSetSelf={() => {
            patchSettings({ selfTeamId: selectedRow.teamId })
            setToast(`已设为「我的队伍」：${selectedRow.team.name}`)
            setSelectedTeam(null)
          }}
          onClearSelf={() => {
            patchSettings({ selfTeamId: null })
            setSelectedTeam(null)
          }}
        />
      ) : null}

      {toast ? <Toast text={toast} /> : null}
    </div>
  )
}

function EmptyState({
  onFile,
  onSample,
  onOpenImport,
  onOpenQoj,
}: {
  onFile: (f: File) => void
  onSample: (w: 'chengdu' | 'qinhuangdao') => void
  onOpenImport: () => void
  onOpenQoj: () => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-lead">
          <p className="eyebrow">{BRAND.nameLatin} · Virtual Contest Replay</p>
          <h1>{BRAND.nameChinese}</h1>
          <p className="lede">
            沿着时间轴，重走比赛中的每一次提交。
            赛时<em>匿名追榜</em>，随着题目揭开看清战局，再到封榜、终榜，让 VP 也有现场感。
          </p>
          <ol className="rule-brief">
            <li>
              <span className="idx">01</span>
              <span>一道题被 min(50 队, 20% 队伍) 通过后，右栏那张题卡才亮起来，点开能看是谁过的。</span>
            </li>
            <li>
              <span className="idx">02</span>
              <span>4:00 封榜：剩下的题同时亮起，但榜单停在那一刻，不再变化。</span>
            </li>
            <li>
              <span className="idx">03</span>
              <span>5:00 终榜：全部细节可见，包括没通过题目的错误提交次数。</span>
            </li>
          </ol>

          <div className="fog-strip" aria-hidden="true">
            {[
              ['A', null],
              ['B', null],
              ['C', 55],
              ['D', 302],
              ['E', null],
              ['F', null],
              ['G', null],
              ['H', null],
              ['I', 53],
              ['J', null],
              ['K', 131],
              ['L', null],
              ['M', 254],
            ].map(([letter, count]) => (
              <span key={String(letter)} className={cx('fs', count != null && 'on')}>
                <b>{letter}</b>
                <i>{count != null ? count : '?'}</i>
              </span>
            ))}
          </div>
        </div>

        <div className="empty-side">
          <div
            className="dropzone"
            data-over={over}
            role="button"
            tabIndex={0}
            onClick={onOpenImport}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onOpenImport()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) onFile(file)
            }}
          >
            <Icon name="upload" />
            <span className="dz-title">把榜单 xlsx 拖进来</span>
            <span className="dz-sub">board.xcpio 与 xcpclink 的导出都能直接用</span>
          </div>

          <div className="sample-row">
            <button className="sample-btn" onClick={() => onSample('chengdu')}>
              <b>成都站 · 所有队伍</b>
              <span>board.xcpio · 328 队 · 13 题 · 5 小时</span>
            </button>
            <button className="sample-btn" onClick={() => onSample('qinhuangdao')}>
              <b>秦皇岛站 · Main</b>
              <span>xcpclink · 375 队 · 13 题 · 5 小时</span>
            </button>
          </div>

          <p className="side-note">
            文件只在本机解析，不会上传。回放规则、封榜时刻、解锁阈值都可以改。
            <br />
            <button className="qoj-link" onClick={onOpenQoj}>
              榜单在 QOJ 上？用「QOJ 导入」→
            </button>
          </p>
          <p className="source-credit">
            <span>由 {BRAND.owner} 维护 · <a href={BRAND.repoUrl} target="_blank" rel="noreferrer">GitHub</a></span>
            <span>基于 <a href={BRAND.upstream.url} target="_blank" rel="noreferrer">{BRAND.upstream.author} / {BRAND.upstream.name}</a> 改造</span>
          </p>
        </div>
      </div>
    </div>
  )
}
