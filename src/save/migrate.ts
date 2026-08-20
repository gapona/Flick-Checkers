import { isOpponentId, opponentsBefore } from '../game/opponents'
import { isRulesId, RULES_IDS, type RulesId } from '../game/rules'
import {
  DEFAULT_SAVE_STATE,
  DIFFICULTIES,
  emptyStats,
  type RulesRecord,
  type SaveDifficulty,
  type SavedDaily,
  type SavedDisc,
  type SavedMatch,
  type SaveState,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function normalizeStats(raw: unknown): Record<RulesId, RulesRecord> {
  const stats = emptyStats()
  if (!isRecord(raw)) return stats
  for (const id of RULES_IDS) {
    const entry = raw[id]
    if (!isRecord(entry)) continue
    stats[id] = { wins: count(entry.wins), losses: count(entry.losses) }
  }
  return stats
}

function side(value: unknown): 'player' | 'opponent' | null {
  return value === 'player' || value === 'opponent' ? value : null
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * A saved match, or `null` for anything that does not parse.
 *
 * Validated by REBUILDING it rather than by checking that it is an object: a truncated or
 * hand-edited payload would otherwise reach the solver as a board and crash the round. Anything
 * unrecognisable degrades to "no match to continue" — the same state a first-time player is in, and
 * never an error.
 *
 * A match with no live disc on one side is rejected too. That is not a corrupt file so much as a
 * finished round nobody wrote the result of, and resuming it would drop the player into a board
 * that is already over.
 */
function normalizeMatch(raw: unknown): SavedMatch | null {
  if (!isRecord(raw)) return null

  const rules = typeof raw.rules === 'string' && isRulesId(raw.rules) ? raw.rules : null
  const turn = side(raw.turn)
  const first = side(raw.first)
  if (!rules || !turn || !first || !Array.isArray(raw.board)) return null

  const board: SavedDisc[] = []
  for (const entry of raw.board) {
    if (!isRecord(entry)) return null
    const discSide = side(entry.side)
    if (discSide === null || typeof entry.id !== 'number') return null
    board.push({
      id: Math.floor(entry.id),
      side: discSide,
      stack: entry.stack === true,
      x: finite(entry.x),
      y: finite(entry.y),
      r: finite(entry.r, 1),
      mass: Math.max(0.01, finite(entry.mass, 1)),
      friction: Math.max(0, finite(entry.friction, 1)),
      restitution: Math.max(0, finite(entry.restitution, 0.92)),
      split: Math.max(0, finite(entry.split)),
      alive: entry.alive !== false,
    })
  }

  if (board.length === 0) return null
  if (!board.some((d) => d.alive && d.side === 'player') || !board.some((d) => d.alive && d.side === 'opponent')) return null

  const wins = isRecord(raw.wins) ? raw.wins : {}
  const advance = isRecord(raw.advance) ? raw.advance : {}
  const lost = isRecord(raw.lostADisc) ? raw.lostADisc : {}

  return {
    rules,
    roundIndex: count(raw.roundIndex),
    wins: { player: count(wins.player), opponent: count(wins.opponent) },
    first,
    advance: { player: count(advance.player), opponent: count(advance.opponent) },
    score: count(raw.score),
    turn,
    shotsLeft: Math.max(1, count(raw.shotsLeft) || 1),
    lastHope: side(raw.lastHope),
    lostADisc: { player: lost.player === true, opponent: lost.opponent === true },
    twoPlayer: raw.twoPlayer === true,
    shots: count(raw.shots),
    board,
  }
}

/**
 * Every field is checked individually and defaulted on its own. A payload with one corrupt number
 * therefore loses that number and keeps the rest, instead of the whole save being thrown away — a
 * player who somehow ends up with a NaN score should not also lose the skins they bought.
 */
/**
 * `v2 -> v3`: the two on/off sound flags become two levels.
 *
 * The ladder's first upgrade step that actually DERIVES anything — `v1 -> v2` only added a field
 * that defaults to "nothing there", so it fell straight through. `true -> 1`, `false -> 0`, which
 * is the only mapping that preserves what the player had: a muted game stays muted and an audible
 * one comes back at full level, since full is all the old schema could express.
 *
 * Mutates a copy rather than `raw`: the caller owns that object and a migration that edited its
 * input would make the ladder order matter in a way nothing else here does.
 */
function upgradeV2ToV3(raw: Record<string, unknown>): Record<string, unknown> {
  const old = isRecord(raw.settings) ? raw.settings : {}
  return {
    ...raw,
    v: 3,
    settings: {
      sfx: old.sound === false ? 0 : 1,
      music: old.music === false ? 0 : 1,
      // Full, for both, whatever the flag said. The old schema could not express a level, so there
      // is no quieter value to come back to that would not be invented.
      sfxRestore: 1,
      musicRestore: 1,
    },
  }
}

/**
 * `v3 -> v4`: the difficulty becomes an opponent.
 *
 * The second deriving step, and it derives for the same reason `upgradeV2ToV3` does — the field does
 * not merely disappear, it changes meaning, and defaulting it would silently put every returning
 * player back on the weakest character regardless of what they had been playing.
 *
 * **This is the only place the three retired values are still spelled out**, which is the point of
 * having a step rather than a fallback. The mapping picks the character each level most resembles in
 * the one thing the levels actually were — a search budget and a shake:
 *
 *   easy (60 candidates)   -> recruit     (40)
 *   medium (200)           -> sergeant    (160), the deliberate baseline
 *   hard (600)             -> marshal     (700)
 *
 * **`defeated` is seeded to whatever the mapped character needs, and that is the interesting half.**
 * Left empty, the mapping above is a lie for two of the three values: only the first
 * {@link import('../game/opponents').FREE_OPPONENTS} are open with nothing beaten, so a player who
 * had set Hard would be pointed at a character the gate refuses — `Modes` would show no card
 * selected while `Game` played the locked one anyway, which is precisely the bug this note exists to
 * record. Seeding the rungs BELOW the mapped character is what makes the derived value reachable.
 *
 * It does mean claiming wins that never happened, which is why it is here and not somewhere quieter:
 * the alternative is demoting a Hard player to a raw recruit, and between inventing a ladder position
 * and throwing away the only statement of skill the old save contained, the ladder position is the
 * smaller invention. Nothing else reads `defeated`.
 */
const DIFFICULTY_TO_OPPONENT: Record<SaveDifficulty, string> = {
  easy: 'recruit',
  medium: 'sergeant',
  hard: 'marshal',
}

function upgradeV3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  const old = DIFFICULTIES.includes(raw.difficulty as SaveDifficulty) ? (raw.difficulty as SaveDifficulty) : 'medium'
  const mapped = DIFFICULTY_TO_OPPONENT[old]
  const { difficulty: _dropped, ...rest } = raw
  return { ...rest, v: 4, opponent: mapped, defeated: opponentsBefore(mapped) }
}

/** A restore level, which additionally may never be silence — see `SaveSettings.sfxRestore`. A
 * file claiming `0` here would leave the mute button one-way. */
function restoreLevel(value: unknown): number {
  const clamped = level(value, 1)
  return clamped > 0 ? clamped : 1
}

/** A level out of a save file: finite, clamped to `0..1`, anything else defaulted. */
function level(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function normalizeV4(raw: Record<string, unknown>): SaveState {
  const settings = isRecord(raw.settings) ? raw.settings : {}
  const skins = isRecord(raw.skins) ? raw.skins : {}
  const purchases = Array.isArray(raw.purchases) ? raw.purchases.filter((p): p is string => typeof p === 'string') : DEFAULT_SAVE_STATE.purchases

  return {
    v: 4,
    bestScore: typeof raw.bestScore === 'number' && Number.isFinite(raw.bestScore) ? raw.bestScore : DEFAULT_SAVE_STATE.bestScore,
    bestCombo: typeof raw.bestCombo === 'number' && Number.isFinite(raw.bestCombo) ? raw.bestCombo : 0,
    coins: typeof raw.coins === 'number' && Number.isFinite(raw.coins) && raw.coins >= 0 ? raw.coins : DEFAULT_SAVE_STATE.coins,
    purchases,
    settings: {
      sfx: level(settings.sfx, DEFAULT_SAVE_STATE.settings.sfx),
      music: level(settings.music, DEFAULT_SAVE_STATE.settings.music),
      sfxRestore: restoreLevel(settings.sfxRestore),
      musicRestore: restoreLevel(settings.musicRestore),
    },
    rules: typeof raw.rules === 'string' && isRulesId(raw.rules) ? raw.rules : DEFAULT_SAVE_STATE.rules,
    // Same shape as `rules` above, and the same consequence: a character retired in a future build
    // costs the player their selection and nothing else.
    opponent: typeof raw.opponent === 'string' && isOpponentId(raw.opponent) ? raw.opponent : DEFAULT_SAVE_STATE.opponent,
    // Unknown ids are dropped rather than kept: `defeated` is read by `isOpponentUnlocked`, so a
    // stale id would be a key that unlocks nothing — harmless, but it would accumulate forever.
    defeated: Array.isArray(raw.defeated) ? raw.defeated.filter((id): id is string => typeof id === 'string' && isOpponentId(id)) : [],
    // Not validated against SKIN_IDS here: `game/economy.ts`'s `equippedSkin()` already refuses an
    // unknown or unowned id at the point of use, and doing it in both places means a skin renamed
    // in a future build silently wipes the field on load instead of degrading to 'default'.
    skins: {
      board: typeof skins.board === 'string' ? skins.board : DEFAULT_SAVE_STATE.skins.board,
      pieces: typeof skins.pieces === 'string' ? skins.pieces : DEFAULT_SAVE_STATE.skins.pieces,
      effects: typeof skins.effects === 'string' ? skins.effects : DEFAULT_SAVE_STATE.skins.effects,
    },
    stats: normalizeStats(raw.stats),
    match: normalizeMatch(raw.match),
    daily: normalizeDaily(raw.daily),
  }
}

/** A daily record, defaulted field by field. A corrupt streak costs the streak and nothing else. */
function normalizeDaily(raw: unknown): SavedDaily {
  if (!isRecord(raw)) return { ...DEFAULT_SAVE_STATE.daily }

  const streak = count(raw.streak)
  return {
    lastPlayed: typeof raw.lastPlayed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastPlayed) ? raw.lastPlayed : null,
    streak,
    // The best can never be below the current streak — a save edited to claim otherwise is repaired
    // rather than trusted.
    best: Math.max(streak, count(raw.best)),
    solvedToday: raw.solvedToday === true,
  }
}

/**
 * Migrates a parsed-but-unverified save payload to the current SaveState shape.
 * Returns null for anything unrecognized — the caller falls back to DEFAULT_SAVE_STATE.
 *
 * Ladder pattern (CHAPAEV-PLAN.md §8): each case upgrades the payload in place and falls through to
 * the next, ending at SAVE_SCHEMA_VERSION. **v1 -> v2 added the match in progress**, and a v1
 * payload simply lacks the field — `normalizeMatch` returns `null` for anything it does not
 * recognise, including absence, so the case falls straight through with no upgrade step at all. A
 * v1 save therefore keeps its coins, skins, stats and settings and merely has nothing to continue,
 * which is exactly right.
 *
 * **v2 -> v3 is the first bump that could not fall through**: the two sound flags became two
 * levels, and a type change has to be converted rather than defaulted, or every player who had
 * muted the game would come back to it audible. That is what {@link upgradeV2ToV3} is, and it is
 * the shape any future deriving bump should copy.
 *
 * **v3 -> v4 is the second**: the difficulty became an opponent. See {@link upgradeV3ToV4}. Note
 * that the two steps now COMPOSE — a v1 payload runs through both — which is the property a ladder
 * exists for and the thing to keep true when adding a third.
 */
export function migrate(raw: unknown): SaveState | null {
  if (!isRecord(raw)) {
    return null
  }

  switch (raw.v) {
    case 1:
    // falls through — v2 only added a field that defaults to `null`
    case 2:
      return normalizeV4(upgradeV3ToV4(upgradeV2ToV3(raw)))
    case 3:
      return normalizeV4(upgradeV3ToV4(raw))
    case 4:
      return normalizeV4(raw)

    default:
      return null
  }
}
