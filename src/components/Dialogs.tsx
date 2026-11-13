import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Contest, ManualTeam, ProblemView, RowView, Settings, SheetAnalysis } from '../lib/types'
import type { WorkbookReport } from '../lib/parse/detect'
import { computeThreshold } from '../lib/rules/unlock'
import { sourceLabel } from '../lib/model/contest'
import { QOJ_SNIPPET } from '../lib/parse/qoj'
import { formatAcceptTime, formatClock, formatPenalty, formatPenaltyFull } from '../lib/format'
import { cx, Icon, Modal, Switch } from './ui'
import { BRAND } from '../lib/brand'

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function NumberInput({
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <div className="input-row">
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n)
        }}
      />
      {suffix ? <span className="input-suffix">{suffix}</span> : null}
    </div>
  )
}

export function SettingsDialog({
  settings,
  teamCount,
  selfName,
  onChange,
  onReset,
  onClose,
}: {
  settings: Settings
  teamCount: number
  selfName: string | null
  onChange: (patch: Partial<Settings>) => void
  onReset: () => void
  onClose: () => void
}) {
  const effective = useMemo(() => computeThreshold(teamCount, settings), [teamCount, settings])
  const medalCuts = useMemo(
    () => ({
      gold: Math.max(0, Math.round((teamCount * settings.medalGoldPct) / 100)),
      silver: Math.max(0, Math.round((teamCount * settings.medalSilverPct) / 100)),
      bronze: Math.max(0, Math.round((teamCount * settings.medalBronzePct) / 100)),
    }),
    [teamCount, settings.medalGoldPct, settings.medalSilverPct, settings.medalBronzePct],
  )

  return (
    <Modal
      title="回放规则"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="action-btn" onClick={onReset}>
            恢复默认
          </button>
          <button className="action-btn primary" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      <div className="note">
        <Icon name="book" />
        <span>
          默认按 CCPC 2026 赛时榜「分步展示」实现：题目通过数达到阈值，右栏这张题卡才亮、才能点开看名单；封榜时其余题目一并亮起。
          所有参数都可以改，改完立刻重算。
        </span>
      </div>

      <div className="group-title">题目解锁</div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">固定阈值</span>
          <span className="setting-desc">一道题被这么多支队伍通过后解锁。</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch
            checked={settings.unlockCount != null}
            onChange={(v) => onChange({ unlockCount: v ? 50 : null })}
            label=""
          />
          {settings.unlockCount != null ? (
            <NumberInput
              value={settings.unlockCount}
              min={1}
              max={1000}
              suffix="队"
              onChange={(v) => onChange({ unlockCount: v })}
            />
          ) : null}
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">百分比阈值</span>
          <span className="setting-desc">按当前口径的队伍总数计算，达到即解锁。</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch
            checked={settings.unlockPercent != null}
            onChange={(v) => onChange({ unlockPercent: v ? 20 : null })}
            label=""
          />
          {settings.unlockPercent != null ? (
            <NumberInput
              value={settings.unlockPercent}
              min={0.1}
              max={100}
              suffix="%"
              onChange={(v) => onChange({ unlockPercent: v })}
            />
          ) : null}
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">两条规则的关系</span>
          <span className="setting-desc">
            当前生效阈值 <strong style={{ color: 'var(--amber)' }}>{effective.threshold ?? '—'}</strong> 队
            {effective.source === 'min' ? '（任一满足即可）' : effective.source === 'max' ? '（需同时满足）' : ''}
          </span>
        </div>
        <div className="segmented">
          <button data-on={settings.combine === 'min'} onClick={() => onChange({ combine: 'min' })}>
            任一
          </button>
          <button data-on={settings.combine === 'max'} onClick={() => onChange({ combine: 'max' })}>
            同时
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">封榜时全部解锁</span>
          <span className="setting-desc">封榜后所有题目可见，但榜单数据冻结在封榜时刻。</span>
        </div>
        <Switch
          checked={settings.unlockAtFreeze}
          onChange={(v) => onChange({ unlockAtFreeze: v })}
          label=""
        />
      </div>

      <div className="group-title">实时奖牌线</div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">用名次底色标金牌 / 银牌 / 铜牌</span>
          <span className="setting-desc">
            当前口径 {teamCount} 队：
            <strong style={{ color: 'var(--medal-gold)' }}> 金 {medalCuts.gold}</strong>
            <strong style={{ color: 'var(--medal-silver)' }}> · 银 {medalCuts.silver}</strong>
            <strong style={{ color: 'var(--medal-bronze)' }}> · 铜 {medalCuts.bronze}</strong>
            。名次实时变化，线也跟着走；一题没过的算铁牌，不标。
          </span>
        </div>
        <Switch
          checked={settings.medalEnabled}
          onChange={(v) => onChange({ medalEnabled: v })}
          label=""
        />
      </div>

      {settings.medalEnabled ? (
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-title">三档比例</span>
            <span className="setting-desc">累积名次百分比：前 金% 是金，前 银% 是银（含金），前 铜% 是铜（含银）。</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NumberInput value={settings.medalGoldPct} min={0} max={100} suffix="%" onChange={(v) => onChange({ medalGoldPct: v })} />
            <NumberInput value={settings.medalSilverPct} min={0} max={100} suffix="%" onChange={(v) => onChange({ medalSilverPct: v })} />
            <NumberInput value={settings.medalBronzePct} min={0} max={100} suffix="%" onChange={(v) => onChange({ medalBronzePct: v })} />
          </div>
        </div>
      ) : null}

      <div className="group-title">封榜与时长</div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">启用封榜</span>
          <span className="setting-desc">封榜期间不显示新的通过结果。</span>
        </div>
        <Switch
          checked={settings.freezeEnabled}
          onChange={(v) => onChange({ freezeEnabled: v })}
          label=""
        />
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">封榜时刻</span>
          <span className="setting-desc">比赛开始后第几分钟封榜。</span>
        </div>
        <NumberInput
          value={settings.freezeStartMin}
          min={0}
          max={600}
          suffix="分"
          onChange={(v) => onChange({ freezeStartMin: v })}
        />
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">比赛时长</span>
          <span className="setting-desc">小于数据里最晚的通过时刻时会自动延长。</span>
        </div>
        <NumberInput
          value={settings.durationMin}
          min={1}
          max={600}
          suffix="分"
          onChange={(v) => onChange({ durationMin: v })}
        />
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">每次罚时</span>
          <span className="setting-desc">每道题在通过前的错误提交扣时。</span>
        </div>
        <NumberInput
          value={settings.penaltyPerWrongMin}
          min={0}
          max={120}
          suffix="分"
          onChange={(v) => onChange({ penaltyPerWrongMin: v })}
        />
      </div>

      <div className="group-title">榜单口径</div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">统计与展示范围</span>
          <span className="setting-desc">
            影响分母 N、阈值计数以及榜单上出现的队伍。当前 N = {teamCount}。
          </span>
        </div>
        <div className="segmented">
          <button data-on={settings.scope === 'all'} onClick={() => onChange({ scope: 'all' })}>
            全部
          </button>
          <button data-on={settings.scope === 'official'} onClick={() => onChange({ scope: 'official' })}>
            仅正式
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">我的队伍</span>
          <span className="setting-desc">
            {selfName ? `当前：${selfName}。` : '尚未指定。'}封榜时它也照样停住 —— 和真实榜单一样。
            打开「实时」只影响你自己那一行，方便一边打一边看账。
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Switch
            checked={settings.selfSeesLive}
            onChange={(v) => onChange({ selfSeesLive: v })}
            label="封榜中实时"
          />
          {settings.selfTeamId ? (
            <button className="action-btn" onClick={() => onChange({ selfTeamId: null })}>
              清除
            </button>
          ) : null}
        </div>
      </div>

      <div className="group-title">调试</div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">显示未解锁题的进度</span>
          <span className="setting-desc">在题目卡上显示"已通过 / 阈值"。真实榜单不会显示这个。</span>
        </div>
        <Switch
          checked={settings.showLockedProgress}
          onChange={(v) => onChange({ showLockedProgress: v })}
          label=""
        />
      </div>

      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-title">显示完整信息</span>
          <span className="setting-desc">跳过解锁与封榜，直接看全场明细。用于核对数据。</span>
        </div>
        <Switch
          checked={settings.showFullInfo}
          onChange={(v) => onChange({ showFullInfo: v })}
          label=""
        />
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 导入                                                                */
/* ------------------------------------------------------------------ */

export function ImportDialog({
  report,
  activeSheet,
  onFile,
  onPickSheet,
  onSample,
  onQojText,
  onClose,
}: {
  report: WorkbookReport | null
  activeSheet: string | null
  onFile: (file: File) => void
  onPickSheet: (name: string) => void
  onSample: (which: 'chengdu' | 'qinhuangdao') => void
  onQojText: (text: string) => string | null
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [qojText, setQojText] = useState('')
  const [qojError, setQojError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(QOJ_SNIPPET)
      setCopied(true)
      setQojError(null)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setQojText(QOJ_SNIPPET)
      setQojError('浏览器不让写剪贴板，脚本已填到下面的框里，手动全选复制')
    }
  }

  const pasteAndImport = async () => {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setQojError('读不到剪贴板（浏览器权限），请手动 Ctrl+V 粘到下面的框里')
      return
    }
    if (!text.trim()) {
      setQojError('剪贴板是空的：先在 QOJ 榜单页跑一遍抓取脚本')
      return
    }
    const err = onQojText(text)
    if (err) setQojError(err)
  }

  return (
    <Modal title="导入榜单" onClose={onClose}>
      <div
        className="dropzone"
        data-over={over}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
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
        <span className="dz-title">拖入 xlsx / JSON，或点击选择文件</span>
        <span className="dz-sub">支持 board.xcpio、xcpclink 的 xlsx，以及 board.xcpcio 的合并 JSON</span>
      </div>
      <p className="field-help">
        board.xcpcio 的榜单带<b>逐条提交</b>（时间精确到秒、没通过的题也占一格）。它没有开 CORS，
        页面里直接拉会被浏览器挡住，先用
        <code className="code-inline">node scripts/fetch-xcpcio.mjs &lt;榜单链接&gt;</code>
        生成 JSON，再把那个文件拖进来。
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />

      {report ? (
        <div className="field">
          <span className="field-label">
            工作表 · <span className="fn">{report.fileName}</span>
          </span>
          <div className="sheet-list">
            {report.sheets.map((s) => (
              <SheetRow
                key={s.name}
                sheet={s}
                active={s.name === activeSheet}
                onPick={() => onPickSheet(s.name)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="note">
          <Icon name="book" />
          <span>
            还没有载入文件。可以先看看内置的两份真实榜单：一份来自 board.xcpio（成都站），一份来自 xcpclink（秦皇岛站）。
          </span>
        </div>
      )}

      <div className="field">
        <span className="field-label">内置示例</span>
        <div className="sample-row">
          <button className="sample-btn" onClick={() => onSample('chengdu')}>
            <b>成都站 · 所有队伍</b>
            <span>board.xcpio · 328 队 · 13 题</span>
          </button>
          <button className="sample-btn" onClick={() => onSample('qinhuangdao')}>
            <b>秦皇岛站 · Main</b>
            <span>xcpclink · 375 队 · 13 题</span>
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">QOJ 榜单</span>
        <p className="field-help">
          <b>分页榜单请复制全榜抓取脚本</b>，在 QOJ 榜单页的开发者工具控制台运行，再回来点「粘贴并导入」。
          直接复制页面文本或另存 HTML 会导入当前页。
        </p>
        <div className="qoj-row">
          <button className="action-btn" onClick={copySnippet}>
            {copied ? '已复制 ✓' : '复制全榜抓取脚本'}
          </button>
          <button className="action-btn primary" onClick={pasteAndImport}>
            粘贴并导入
          </button>
        </div>
        <textarea
          className="input qoj-input"
          spellCheck={false}
          placeholder="把榜单页 Ctrl+A 复制出来的整段文本粘在这里（也可以粘抓取脚本的 JSON 或另存的 HTML）"
          value={qojText}
          onChange={(e) => {
            setQojText(e.target.value)
            setQojError(null)
          }}
        />
        <div className="qoj-row">
          <button
            className="action-btn"
            disabled={!qojText.trim()}
            onClick={() => {
              const err = onQojText(qojText)
              if (err) setQojError(err)
            }}
          >
            导入这段内容
          </button>
          {qojError ? <span className="qoj-err">{qojError}</span> : null}
        </div>
      </div>
    </Modal>
  )
}

function SheetRow({
  sheet,
  active,
  onPick,
}: {
  sheet: SheetAnalysis
  active: boolean
  onPick: () => void
}) {
  const usable = sheet.score > 0
  return (
    <button className="sheet-item" data-on={active} disabled={!usable} onClick={onPick}>
      <span className="s-name">{sheet.name}</span>
      {sheet.format ? (
        <span className={cx('badge', 'ok')}>{sheet.format === 'xcpcio' ? 'board.xcpio' : 'xcpclink'}</span>
      ) : (
        <span className="badge">无法识别</span>
      )}
      <span className="s-meta">{usable ? `${sheet.teamCount} 队` : '—'}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 规则说明                                                            */
/* ------------------------------------------------------------------ */

export function RuleDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={BRAND.nameChinese + ' · 规则与来源'} onClose={onClose} wide>
      <p className="source-credit">{BRAND.nameChinese} {BRAND.name} 由 {BRAND.owner} 维护，基于 <a href={BRAND.upstream.url} target="_blank" rel="noreferrer">{BRAND.upstream.author} 的开源项目</a>，沿用 MIT 开源协议。</p>
      <ol className="rules">
        <li>
          <strong>赛时主榜将已揭题固定在左侧，其余提交仍按时间顺序匿名排列。</strong>
          锁定题目被通过也会计入 —— 通过数、罚时、第几次通过照常更新；但你不知道那是哪一道题。
        </li>
        <li>
          <strong>题目通过数达到阈值，右栏的题卡才亮。</strong>
          固定阈值与百分比阈值取较小者：<span className="formula">k = min(50, ⌈20% × N⌉)</span>
          ，亮起的时刻 = 这道题第 k 个 AC 发生的时刻；对应题目会移到主榜左侧，点开题卡能看到通过名单。
        </li>
        <li>
          <strong>封榜（默认 4:00）时所有题卡一起亮，但数据冻结。</strong>
          主榜切换为按 A、B、C…对齐的完整逐题布局。封榜后不再能看到新的通过，直到比赛结束或手动解封。
        </li>
        <li>
          <strong>终榜。</strong>
          5:00 或点「解封」后显示完整数据，队伍抽屉里才会出现未通过题目的错误提交次数。
        </li>
      </ol>

      <div className="note warn">
        <Icon name="pulse" />
        <span>
          <strong>数据边界：</strong>
          导出文件里每题只有一条聚合结果（第几次提交通过、错了多少次），没有逐条提交记录。所以：通过时刻是精确的；
          错误提交的时刻不知道，未通过的 <span className="formula">−n</span> 只在终榜显示。封榜期间"看得到提交、看不到结果"的中间态无法重建，这里做的是整榜冻结。
        </span>
      </div>

      <div className="field">
        <span className="field-label">快捷键</span>
        <span className="field-help">
          空格 播放/暂停 · ← → 前后 10 秒（Shift 前后 1 分钟）· Home / End 开头与终榜 · U 解封/复原 · Esc 关闭弹层
        </span>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 诊断                                                                */
/* ------------------------------------------------------------------ */

export function DiagnosticsDialog({
  contest,
  report,
  activeSheet,
  onPickSheet,
  onClose,
}: {
  contest: Contest
  report: WorkbookReport | null
  activeSheet: string | null
  onPickSheet: (name: string) => void
  onClose: () => void
}) {
  const totalAc = contest.teams.reduce(
    (n, t) => n + Object.values(t.cells).filter((c) => c.ac).length,
    0,
  )
  return (
    <Modal title="数据诊断" onClose={onClose} wide>
      <dl className="stat-list">
        <div className="stat-row">
          <dt>来源</dt>
          <dd style={{ fontSize: 12 }}>
            {sourceLabel(contest.source)} ·{' '}
            {contest.sheetName}
          </dd>
        </div>
        <div className="stat-row">
          <dt>文件</dt>
          <dd style={{ fontSize: 12 }}>{contest.fileName}</dd>
        </div>
        <div className="stat-row">
          <dt>队伍 / 通过</dt>
          <dd>
            {contest.teams.length} <em>队</em> {totalAc} <em>次</em>
          </dd>
        </div>
        <div className="stat-row">
          <dt>建议时长 / 封榜</dt>
          <dd style={{ fontSize: 12 }}>
            {formatClock(contest.suggestedDurationSec)} / {formatClock(contest.suggestedFreezeSec)}
          </dd>
        </div>
      </dl>

      <div className="field">
        <span className="field-label">校验结果</span>
        <ul className="diag-list">
          {contest.diagnostics.map((d, i) => (
            <li key={i}>
              <span className="k">{d.level === 'warn' ? '注意' : '信息'}</span>
              <span style={{ color: d.level === 'warn' ? 'var(--amber)' : undefined }}>{d.message}</span>
            </li>
          ))}
        </ul>
      </div>

      {report ? (
        <div className="field">
          <span className="field-label">切换工作表</span>
          <div className="sheet-list">
            {report.sheets.map((s) => (
              <SheetRow
                key={s.name}
                sheet={s}
                active={s.name === activeSheet}
                onPick={() => onPickSheet(s.name)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 创建我的虚拟队伍                                                     */
/* ------------------------------------------------------------------ */

export function CreateTeamDialog({
  existing,
  onSubmit,
  onClose,
}: {
  existing: ManualTeam | null
  onSubmit: (input: { name: string; organization: string; members: string[] }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [organization, setOrganization] = useState(existing?.organization ?? '')
  const [members, setMembers] = useState(existing?.members.join(', ') ?? '')

  const submit = () => {
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      organization: organization.trim(),
      members: members.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    })
  }

  return (
    <Modal
      title={existing ? '编辑我的队伍' : '创建我的队伍'}
      onClose={onClose}
      footer={
        <>
          <button className="action-btn" onClick={onClose}>
            先不用
          </button>
          <button className="action-btn primary" disabled={!name.trim()} onClick={submit}>
            {existing ? '保存' : '创建并加入榜单'}
          </button>
        </>
      }
    >
      <p className="field-help">
        这支队伍不在榜单里 —— 它是你自己。创建后会以「虚拟」身份出现在榜上参与排名，
        但你的提交不会点亮题卡、也不会改变别人的名次。
        <br />
        之后在右栏「我的队伍」里，选题号 + 「通过了 / 没通过」记录你的每一次提交，时刻取当前回放时刻。
      </p>

      <div className="field">
        <span className="field-label">队名</span>
        <input
          className="input"
          value={name}
          autoFocus
          placeholder="例如：孤军奋战"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </div>

      <div className="field">
        <span className="field-label">学校 / 组织（可选）</span>
        <input
          className="input"
          value={organization}
          placeholder="例如：某大学"
          onChange={(e) => setOrganization(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="field-label">队员（可选，逗号分隔）</span>
        <input
          className="input"
          value={members}
          placeholder="例如：张三, 李四, 王五"
          onChange={(e) => setMembers(e.target.value)}
        />
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 队伍抽屉                                                            */
/* ------------------------------------------------------------------ */

export function TeamDrawer({
  row,
  problems,
  minutePrecision,
  onClose,
  onSetSelf,
  onClearSelf,
}: {
  row: RowView
  problems: ProblemView[]
  minutePrecision: boolean
  onClose: () => void
  onSetSelf: () => void
  onClearSelf: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { team } = row
  const medals = [team.markers.medal, team.markers.girl ? '女队' : '', team.markers.starred ? '打星' : '']
    .filter(Boolean)
    .join(' · ')

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={team.name}>
        <div className="drawer-head">
          <span className="d-org">{[team.organization, medals].filter(Boolean).join(' · ')}</span>
          <span className="d-name">{team.name}</span>
          <button className="x-btn" onClick={onClose} aria-label="关闭">
            <Icon name="x" />
          </button>
        </div>

        <dl className="kv-grid">
          <div className="kv">
            <dt>名次</dt>
            <dd>{row.rank > 0 ? `#${row.rank}` : '—'}</dd>
          </div>
          <div className="kv">
            <dt>通过</dt>
            <dd>{row.solved}</dd>
          </div>
          <div className="kv">
            <dt>罚时</dt>
            <dd>{formatPenalty(row.penaltySec)}</dd>
          </div>
        </dl>

        <div className="drawer-section">
          <span className="field-label">题目明细</span>
          <div className="cell-grid">
            {row.cells.map((cell, i) => (
              <div
                key={problems[i].letter}
                className={cx(
                  'mini-cell',
                  cell.kind === 'ac' && 'ac',
                  cell.kind === 'rejected' && 'rj',
                  cell.kind === 'locked' && 'locked',
                )}
                title={
                  problems[i].unlocked
                    ? `${problems[i].letter} 题`
                    : `${problems[i].letter} 题 · 未解锁（这是"我的队伍"自己知道的信息）`
                }
              >
                <span className="l">{problems[i].letter}</span>
                <span className="s">
                  {cell.kind === 'ac'
                    ? `+${cell.attempts}`
                    : cell.kind === 'rejected'
                      ? `−${cell.attempts}`
                      : cell.kind === 'locked'
                        ? '·'
                        : '·'}
                </span>
                <span className="t">
                  {cell.kind === 'ac' ? formatAcceptTime(cell.acceptSec ?? 0, minutePrecision) : ''}
                </span>
              </div>
            ))}
          </div>
          <span className="field-help">
            通过时刻与错误次数都来自导出文件；未解锁题目在真实榜单上是看不见的。
          </span>
        </div>

        {team.members.length > 0 ? (
          <div className="drawer-section">
            <span className="field-label">队员</span>
            <span className="members">{team.members.join(' · ')}</span>
            {team.coaches ? <span className="members">教练：{team.coaches}</span> : null}
          </div>
        ) : null}

        <div className="drawer-section">
          <span className="field-label">罚时构成</span>
          <span className="field-help">
            {row.solved} 题通过，合计 {formatPenaltyFull(row.penaltySec)}
            {row.lastAcSec >= 0
              ? `，最后一次通过 ${formatAcceptTime(row.lastAcSec, minutePrecision)}`
              : ''}
          </span>
        </div>

        <div className="drawer-section" style={{ borderBottom: 0 }}>
          {row.isSelf ? (
            <button className="action-btn" onClick={onClearSelf}>
              取消「我的队伍」
            </button>
          ) : (
            <button className="action-btn primary" onClick={onSetSelf}>
              设为「我的队伍」
            </button>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  )
}
