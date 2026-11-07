import { useMemo, useRef } from 'react'
import type { Phase } from '../lib/types'
import { clamp, formatClock, formatShort } from '../lib/format'
import { cx, Icon } from './ui'

const SPEEDS = [1, 2, 5, 10, 30]

interface PlaybarProps {
  t: number
  durationSec: number
  freezeSec: number | null
  phase: Phase
  playing: boolean
  speed: number
  revealed: boolean
  unlocked: number
  problemCount: number
  query: string
  filtered: number | null
  onQuery: (q: string) => void
  onToggle: () => void
  onSeek: (v: number) => void
  onSpeed: (v: number) => void
}

export function Playbar(props: PlaybarProps) {
  const {
    t,
    durationSec,
    freezeSec,
    phase,
    playing,
    speed,
    revealed,
    unlocked,
    problemCount,
    query,
    filtered,
    onQuery,
    onToggle,
    onSeek,
    onSpeed,
  } = props

  const toFreeze = freezeSec != null ? freezeSec - t : null
  const showFreezeChip = phase === 'live' && freezeSec != null && toFreeze != null && toFreeze > 0

  return (
    <div className="playbar">
      <div className="clock-block">
        <span className="clock">{formatClock(t)}</span>
        <span className="clock-total">/ {formatShort(durationSec)}</span>
      </div>

      <div className="transport">
        <button className="icon-btn" onClick={() => onSeek(0)} title="回到开始（Home）" aria-label="回到开始">
          <Icon name="rewind" />
        </button>
        <button className="icon-btn" onClick={() => onSeek(t - 10)} title="后退 10 秒（←）" aria-label="后退 10 秒">
          <Icon name="back10" />
        </button>
        <button
          className="icon-btn play-btn"
          onClick={onToggle}
          title={playing ? '暂停（空格）' : '播放（空格）'}
          aria-label={playing ? '暂停' : '播放'}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button className="icon-btn" onClick={() => onSeek(t + 10)} title="前进 10 秒（→）" aria-label="前进 10 秒">
          <Icon name="fwd10" />
        </button>
        <button
          className="icon-btn"
          onClick={() => onSeek(durationSec)}
          title="跳到终榜（End）"
          aria-label="跳到终榜"
        >
          <Icon name="forward" />
        </button>
      </div>

      <div className="segmented" role="group" aria-label="播放速度">
        {SPEEDS.map((s) => (
          <button key={s} data-on={speed === s} onClick={() => onSpeed(s)} title={`${s} 倍速`}>
            {s}×
          </button>
        ))}
      </div>

      <label className="search-box">
        <Icon name="search" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索队伍 / 学校"
          aria-label="搜索队伍"
        />
        {query ? (
          <button className="search-clear" onClick={() => onQuery('')} aria-label="清空搜索">
            <Icon name="x" />
          </button>
        ) : null}
      </label>

      <div className="playbar-right">
        {filtered != null ? <span className="chip countdown filter-count">筛选 {filtered} 队</span> : null}
        <span className="chip countdown problem-count">
          题目 {unlocked}/{problemCount}
        </span>
        {showFreezeChip ? (
          <span className="chip countdown freeze-countdown" title="距离封榜">
            封榜 −{formatClock(toFreeze ?? 0)}
          </span>
        ) : null}

        <span
          className={cx('chip', phase === 'live' && 'live', phase === 'frozen' && 'frozen', phase === 'final' && 'final')}
        >
          <span className="dot" />
          {phase === 'before'
            ? '未开始'
            : phase === 'live'
              ? '赛时'
              : phase === 'frozen'
                ? revealed
                  ? '已解封'
                  : '封榜中'
                : '终榜'}
        </span>

        {phase === 'final' ? (
          <button className="action-btn" onClick={() => onSeek(0)}>
            再看一遍
          </button>
        ) : null}
      </div>
    </div>
  )
}

export interface TimelineProps {
  t: number
  durationSec: number
  freezeSec: number | null
  onSeek: (v: number) => void
}

export function Timeline({ t, durationSec, freezeSec, onSeek }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const ratio = durationSec > 0 ? clamp(t / durationSec, 0, 1) : 0

  const ticks = useMemo(() => {
    const stepMin = durationSec <= 3 * 3600 ? 30 : 60
    const out: number[] = []
    for (let m = 0; m * 60 <= durationSec + 1; m += stepMin) out.push(Math.min(durationSec, m * 60))
    if (out[out.length - 1] !== durationSec) out.push(durationSec)
    return out
  }, [durationSec])

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const r = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0
    onSeek(r * durationSec)
  }

  return (
    <div className="timeline">
      <div className="tl-head">
        <span className="tl-title">赛程时间轴</span>
        <div className="tl-legend">
          <span>
            <i className="sw-freeze" />
            封榜区间
          </span>
        </div>
      </div>

      <div
        className="tl-track"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="回放时间轴"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={formatClock(t)}
        onPointerDown={(e) => {
          dragging.current = true
          seekFromClientX(e.clientX)
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* 合成事件或触摸设备上可能拿不到指针，忽略即可 */
          }
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          if (e.buttons === 0) {
            dragging.current = false
            return
          }
          seekFromClientX(e.clientX)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* 同上 */
          }
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      >
        {freezeSec != null && freezeSec < durationSec ? (
          <div
            className="tl-freeze"
            style={{
              left: `${(freezeSec / durationSec) * 100}%`,
              width: `${((durationSec - freezeSec) / durationSec) * 100}%`,
            }}
            title={`封榜 ${formatShort(freezeSec)} – ${formatShort(durationSec)}`}
          />
        ) : null}

        <div className="tl-fill" style={{ width: `${ratio * 100}%` }} />
        <div className="tl-cursor" style={{ left: `${ratio * 100}%` }} />
      </div>

      <div className="tl-ticks">
        {ticks.map((sec) => (
          <span
            key={sec}
            className="tl-tick"
            style={{
              left: `${(sec / durationSec) * 100}%`,
              transform:
                sec === 0
                  ? 'translateX(0)'
                  : sec === durationSec
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)',
            }}
          >
            {formatShort(sec)}
          </span>
        ))}
      </div>
    </div>
  )
}
