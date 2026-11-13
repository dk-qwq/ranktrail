import type { Settings } from '../types'

export const DEFAULT_SETTINGS: Settings = {
  unlockCount: 50,
  unlockPercent: 20,
  combine: 'min',
  unlockAtFreeze: true,
  freezeEnabled: true,
  freezeStartMin: 240,
  durationMin: 300,
  penaltyPerWrongMin: 20,
  scope: 'all',
  selfTeamId: null,
  /**
   * 封榜期间「我的队伍」是否也实时更新。
   * 默认 false：封榜就是封榜，连自己那行也冻住 —— 与真实榜单一致。
   * 打开后可以当作"自己的记事本"，但榜面会跟别人不一样。
   */
  selfSeesLive: false,
  /** 实时奖牌线：金 10%、银 30%、铜 60%（累积名次百分比），铁牌不渲染 */
  medalEnabled: true,
  medalGoldPct: 10,
  medalSilverPct: 30,
  medalBronzePct: 60,
  showLockedProgress: false,
  showFullInfo: false,
}

const STORAGE_KEY = 'ranktrail.settings.v1'
const LEGACY_STORAGE_KEY = 'fogboard.settings.v1'
/** 存储结构版本：v2 起 selfSeesLive 默认关闭（老数据迁移一次） */
const SCHEMA = 2

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

export function normalizeSettings(input: Partial<Settings> | null | undefined): Settings {
  const raw = input ?? {}
  const pickNumber = (v: unknown, lo: number, hi: number, fallback: number | null): number | null => {
    if (v === null) return null
    if (v === undefined) return fallback
    return clampInt(v, lo, hi, fallback ?? lo)
  }
  return {
    unlockCount: pickNumber(raw.unlockCount, 1, 1000, 50),
    unlockPercent: pickNumber(raw.unlockPercent, 0.1, 100, 20),
    combine: raw.combine === 'max' ? 'max' : 'min',
    unlockAtFreeze: raw.unlockAtFreeze !== false,
    freezeEnabled: raw.freezeEnabled !== false,
    freezeStartMin: clampInt(raw.freezeStartMin, 0, 600, 240),
    durationMin: clampInt(raw.durationMin, 1, 600, 300),
    penaltyPerWrongMin: clampInt(raw.penaltyPerWrongMin, 0, 120, 20),
    scope: raw.scope === 'official' ? 'official' : 'all',
    selfTeamId: typeof raw.selfTeamId === 'string' ? raw.selfTeamId : null,
    selfSeesLive: raw.selfSeesLive === true,
    medalEnabled: raw.medalEnabled !== false,
    medalGoldPct: clampInt(raw.medalGoldPct, 0, 100, 10),
    medalSilverPct: clampInt(raw.medalSilverPct, 0, 100, 30),
    medalBronzePct: clampInt(raw.medalBronzePct, 0, 100, 60),
    showLockedProgress: raw.showLockedProgress === true,
    showFullInfo: raw.showFullInfo === true,
  }
}

export function loadSettings(): Settings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings> & { schema?: number }
    const settings = normalizeSettings(parsed)
    // 老版本默认"封榜期间自己实时可见"，语义变过一次，老数据按新默认重置
    if (parsed.schema !== SCHEMA) settings.selfSeesLive = false
    return settings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, schema: SCHEMA }))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* 隐私模式下忽略 */
  }
}
