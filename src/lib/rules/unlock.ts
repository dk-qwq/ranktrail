import type { Settings } from '../types'
import type { ContestIndex } from '../model/contest'

export interface ThresholdInfo {
  /** 统计口径下的队伍总数 */
  n: number
  /** 最终生效的阈值 k；null 表示没有任何阈值规则 */
  threshold: number | null
  countThreshold: number | null
  percentThreshold: number | null
  source: 'count' | 'percent' | 'min' | 'max' | 'off'
}

export type UnlockReason = 'threshold' | 'freeze' | 'never'

export interface ProblemUnlockInfo {
  letter: string
  /** 口径内所有 AC 时刻，升序 */
  acceptedSecs: number[]
  accepted: number
  /** 第 k 个 AC 的时刻（未达到阈值则为 null） */
  thresholdAtSec: number | null
  /** 真正解锁的时刻；Infinity = 赛时永不解锁 */
  unlockSec: number
  reason: UnlockReason
}

export interface UnlockPlan {
  threshold: ThresholdInfo
  problems: ProblemUnlockInfo[]
  /** 封榜时刻；未启用封榜为 Infinity */
  freezeSec: number
  durationSec: number
  penaltyPerWrongSec: number
}

export function computeThreshold(n: number, s: Settings): ThresholdInfo {
  const countThreshold = s.unlockCount
  const percentThreshold =
    s.unlockPercent != null ? Math.max(1, Math.ceil((n * s.unlockPercent) / 100)) : null

  let threshold: number | null = null
  let source: ThresholdInfo['source'] = 'off'
  if (countThreshold != null && percentThreshold != null) {
    threshold = s.combine === 'max' ? Math.max(countThreshold, percentThreshold) : Math.min(countThreshold, percentThreshold)
    source = s.combine === 'max' ? 'max' : 'min'
  } else if (countThreshold != null) {
    threshold = countThreshold
    source = 'count'
  } else if (percentThreshold != null) {
    threshold = percentThreshold
    source = 'percent'
  }

  return { n, threshold, countThreshold, percentThreshold, source }
}

export function computeUnlocks(index: ContestIndex, s: Settings): UnlockPlan {
  const durationSec = Math.max(s.durationMin * 60, index.maxAcceptSec, index.maxRejectSec)
  const freezeSec = s.freezeEnabled ? Math.min(Math.max(0, s.freezeStartMin) * 60, durationSec) : Infinity
  const freezeActive = Number.isFinite(freezeSec)

  const officialOnly = s.scope === 'official'
  // 虚拟队伍不计入 N：你解题不会改变阈值
  const n = officialOnly ? index.officialTeams.length : index.fieldTeams.length
  const threshold = computeThreshold(n, s)
  const k = threshold.threshold

  const problems: ProblemUnlockInfo[] = index.letters.map((letter) => {
    const acceptedSecs = officialOnly ? index.officialAcSecs[letter] : index.acSecs[letter]
    const thresholdAtSec = k != null && acceptedSecs.length >= k ? acceptedSecs[k - 1] : null

    let unlockSec = Infinity
    let reason: UnlockReason = 'never'

    if (thresholdAtSec != null) {
      unlockSec = thresholdAtSec
      reason = 'threshold'
    }
    if (freezeActive && s.unlockAtFreeze && freezeSec < unlockSec) {
      unlockSec = freezeSec
      reason = 'freeze'
    }

    return {
      letter,
      acceptedSecs,
      accepted: acceptedSecs.length,
      thresholdAtSec,
      unlockSec,
      reason,
    }
  })

  return {
    threshold,
    problems,
    freezeSec,
    durationSec,
    penaltyPerWrongSec: Math.max(0, s.penaltyPerWrongMin) * 60,
  }
}
