import { DEFAULT_SAVE_STATE, SaveState } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeV2(raw: Record<string, unknown>): SaveState {
  const settings = isRecord(raw.settings) ? raw.settings : {}
  const purchases = Array.isArray(raw.purchases) ? raw.purchases.filter((p): p is string => typeof p === 'string') : DEFAULT_SAVE_STATE.purchases

  return {
    v: 2,
    bestScore:
      typeof raw.bestScore === 'number' && Number.isFinite(raw.bestScore) ? raw.bestScore : DEFAULT_SAVE_STATE.bestScore,
    coins: typeof raw.coins === 'number' && Number.isFinite(raw.coins) && raw.coins >= 0 ? raw.coins : DEFAULT_SAVE_STATE.coins,
    purchases,
    settings: {
      sound: typeof settings.sound === 'boolean' ? settings.sound : DEFAULT_SAVE_STATE.settings.sound,
      music: typeof settings.music === 'boolean' ? settings.music : DEFAULT_SAVE_STATE.settings.music,
    },
  }
}

/**
 * Migrates a parsed-but-unverified save payload to the current SaveState shape.
 * Returns null for anything unrecognized — the caller falls back to DEFAULT_SAVE_STATE.
 *
 * Ladder pattern for future schema bumps: each case upgrades the payload in place and falls
 * through to the next, ending at SAVE_SCHEMA_VERSION. The v1 -> v2 bump (adding `coins`/
 * `purchases`) needed no actual upgrade step — a real v1 payload simply has neither field,
 * and `normalizeV2`'s own `typeof`/`Array.isArray` checks already default a missing field —
 * so `case 1` falls straight through with no separate `upgradeV1ToV2()`. A future bump that
 * needs to *derive* a new field from old data (not just default it) would add that upgrade
 * function here, e.g.:
 *
 *   case 2:
 *     raw = upgradeV2ToV3(raw)
 *   // falls through
 *   case 3:
 *     return normalizeV3(raw)
 */
export function migrate(raw: unknown): SaveState | null {
  if (!isRecord(raw)) {
    return null
  }

  switch (raw.v) {
    case 1:
    case 2:
      return normalizeV2(raw)

    default:
      return null
  }
}
