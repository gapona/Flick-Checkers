import { DEFAULT_OPPONENT_ID } from '../game/opponents'
import { DEFAULT_RULES_ID, RULES_IDS, type RulesId } from '../game/rules'

/**
 * **Version 1, and not a continuation of the draughts project's v3** (GAME-PLAN.md §8). This is
 * a different game with a different save directory on the platform; there is no v3 payload in the
 * wild that could ever be handed to this build, so pretending to migrate one would be ceremony.
 * What DID transfer is the machinery around it — the ladder in `migrate.ts`, the per-field
 * normalisation, `save.ts`'s guards — because the first schema bump of this project needs all of
 * it and none of it is worth rediscovering.
 */
export const SAVE_SCHEMA_VERSION = 4 as const

export interface SaveSettings {
  /**
   * Output levels, `0..1`, not on/off flags.
   *
   * **This is `v3`'s change, and it is a type change rather than a new field** — which is why it
   * needed a real upgrade step in `migrate.ts` where `v1 -> v2` needed none. A boolean cannot be
   * defaulted into a level without losing what the player chose, and "muted" is a level (`0`), so
   * keeping both a flag and a number would be two values that must agree forever.
   */
  sfx: number
  music: number
  /**
   * The level un-muting returns to: the last non-silent level the player chose.
   *
   * **It has to be persisted, and that is not obvious.** The mute button writes `0` into the level
   * above, so the previous value is gone the moment it is pressed — if the thing to come back to
   * lives only in a scene's local variable, muting and then reloading leaves the player at zero
   * with nothing to restore. It is a second number and not a duplicate of the first: `sfx` is where
   * the volume IS, this is where it was.
   *
   * Never `0`. A restore level of silence would make un-muting do nothing, which is the one value
   * it cannot hold — `migrate.ts` repairs it rather than trusting the file.
   */
  sfxRestore: number
  musicRestore: number
}

/**
 * **The `v1`–`v3` difficulty, kept only so `migrate.ts` can name what it converts FROM.**
 *
 * Three levels became eighteen opponents (`game/opponents.ts`), each of which is the same three numbers
 * with a face and one more axis. Nothing in the game reads this type any more; deleting it would
 * leave {@link SaveStateV1.difficulty} typed `unknown` and the upgrade step unable to say what it is
 * reading, which is the same reason `SaveSettingsV1V2` is still here.
 */
export type SaveDifficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTIES: readonly SaveDifficulty[] = ['easy', 'medium', 'hard']

export interface SaveSkins {
  board: string
  pieces: string
  /**
   * The particle wardrobe — the third slot.
   *
   * Optional, and for the same reason `SavedMatch.twoPlayer` is: a save written before the slot
   * existed simply lacks it and normalises to the free set, which is exactly the truth about it. A
   * version bump is for a field whose MEANING changed.
   */
  effects?: string
}

/** No draws: a round ends when one side has no discs left on the board, which cannot be
 * mutual — unlike draughts, where a repetition or a blocked side is a real third outcome. */
export interface RulesRecord {
  wins: number
  losses: number
}

/**
 * One disc, flattened for storage.
 *
 * Deliberately every field the solver needs to rebuild it rather than "the formation id plus what
 * died": discs move, and a match is saved mid-round, so where each one ended up IS the state. A
 * split stack is the reason the derived-from-formation shortcut cannot work at all — after one the
 * board holds discs that no formation ever placed.
 */
export interface SavedDisc {
  id: number
  side: 'player' | 'opponent'
  stack: boolean
  x: number
  y: number
  r: number
  mass: number
  friction: number
  restitution: number
  split: number
  alive: boolean
}

/** A match in progress. Stored as structured data rather than a packed string — the save file is
 * JSON already, so a custom encoding would buy nothing and cost a parser. */
export interface SavedMatch {
  rules: RulesId
  roundIndex: number
  wins: { player: number; opponent: number }
  first: 'player' | 'opponent'
  advance: { player: number; opponent: number }
  score: number
  /** Whose turn it is in the round in progress, and how many shots they still owe. */
  turn: 'player' | 'opponent'
  shotsLeft: number
  /** `game/round.ts`'s sticky last-hope flag, which spans the round it was earned in. */
  lastHope: 'player' | 'opponent' | null
  lostADisc: { player: boolean; opponent: boolean }
  /**
   * This match is being played by two people on one device rather than against a character.
   *
   * Optional, and deliberately NOT a schema bump — same reasoning as `results`, `knockedOut` and
   * `bestCombo` above: a save written before the field existed simply lacks it and normalises to
   * `false`, which is exactly the truth about it. A bump is for a field whose MEANING changed.
   *
   * It has to be stored at all because resuming decides more than which board to draw: a two-player
   * match must come back with the bot still silent, and a solo one must come back with it playing.
   * Getting that from anywhere but the record would mean guessing.
   */
  twoPlayer?: boolean
  shots: number
  board: SavedDisc[]
  /**
   * The result panel's numbers: who won each round so far, and what each side has done with this
   * round's shots.
   *
   * **Optional, and no schema bump.** They were added after `v3` shipped as a dev build, and every
   * one of them normalises to "nothing recorded" — an empty strip, a zero tally — exactly like `v1`'s
   * missing `match`/`daily` did. That is the case `migrate.ts`'s ladder falls straight through, as
   * opposed to a field that must be DERIVED from old data and therefore needs a real upgrade step.
   * A match resumed from a save written before this build shows an empty strip for the rounds it
   * cannot know about, which is honest; it fills in from the next round on.
   */
  results?: ('player' | 'opponent')[]
  knockedOut?: { player: number; opponent: number }
  bestCombo?: { player: number; opponent: number }
}

/** The `v1`/`v2` settings shape: two on/off flags. Kept so `migrate.ts` can name what it converts
 * from — see {@link SaveStateV3}. */
export interface SaveSettingsV1V2 {
  sound: boolean
  music: boolean
}

export interface SaveStateV1 {
  v: 1
  /** The combo/trick score of §5, and what `sendScore()` reports to the platform. */
  bestScore: number
  /** Shop currency balance — see `src/shop/coins.ts` for the pure earn/spend/afford logic that
   * operates on this field (always via `store.mutate()`), and CLAUDE.md "Shop Layer". */
  coins: number
  /** Ids of every `'unlock'`-kind `ShopItem` (`src/shop/catalog.ts`) ever purchased — a
   * `'consumable'` purchase never appears here, only one-time unlocks do. */
  purchases: string[]
  settings: SaveSettingsV1V2
  /** Last rule set played — what a fresh match defaults to (`src/game/rules.ts`). */
  rules: RulesId
  difficulty: SaveDifficulty
  /** Cosmetic set ids. A set is bought and worn as one package, so both fields are always written
   * together; they are kept separate because that is where a future mix-and-match would go. */
  skins: SaveSkins
  /** Per-rule-set record, for the stats screen of S9. */
  stats: Record<RulesId, RulesRecord>
}

/**
 * **v2 adds the match in progress** — the first real bump, and the one `migrate.ts`'s ladder was
 * built for. A v1 payload simply lacks the field, so it falls straight through and normalises to
 * "no match to continue", which is the same state a first-time player is in.
 */
/**
 * §7's daily record.
 *
 * A streak is the whole reason a daily is a daily rather than a puzzle mode, so it is stored from
 * the start. `lastPlayed` is a `YYYY-MM-DD` in UTC, matching `daily/puzzle.ts`'s `dateKey` — the day
 * has to turn over at the same instant everywhere or two players are on different puzzles.
 */
export interface SavedDaily {
  lastPlayed: string | null
  /** Consecutive days solved, including today if it has been. */
  streak: number
  best: number
  /** Whether today's has been solved, so reopening the game does not offer it again. */
  solvedToday: boolean
}

export interface SaveStateV2 extends Omit<SaveStateV1, 'v'> {
  v: 2
  /** The match to resume, or `null`. Written after every settled shot, so a reload loses at most
   * the shot that was in flight. */
  match: SavedMatch | null
  daily: SavedDaily
}

/**
 * `v3` replaces the two sound FLAGS with two LEVELS.
 *
 * The historic shapes are kept as their own interfaces rather than being edited in place, because
 * `migrate.ts`'s upgrade step has to be able to name what it is reading — `SaveSettingsV1V2` is the
 * thing `upgradeV2ToV3` converts FROM, and deleting it would leave that function taking `unknown`
 * and checking types it can no longer name.
 */
export interface SaveStateV3 extends Omit<SaveStateV2, 'v' | 'settings'> {
  v: 3
  settings: SaveSettings
  /**
   * The most discs one shot has ever knocked off, across every match.
   *
   * Its own field rather than something derived from {@link SaveStateV1.bestScore}: a score is a
   * running total over a whole match, a combo is one moment, and the result panel wants to say "that
   * was your best one yet" about the moment.
   *
   * **Declared here and not on `v1`, because it did not exist then** — the historic interfaces are
   * the record of what each version actually held, and back-dating a field into one makes that record
   * a lie. A `v1`/`v2`/`v3` payload written before this build simply lacks it and `migrate.ts`
   * normalises it to `0`: nothing to beat yet, which is where every new player starts anyway. That is
   * the "falls straight through" case, not the kind of change that needs a ladder step.
   */
  bestCombo: number
}

/**
 * **`v4` replaces the difficulty with an opponent, and adds who has been beaten.**
 *
 * A deriving bump, like `v2 -> v3` and unlike `v1 -> v2`: `difficulty` does not merely disappear, it
 * has to become an `opponent` id, or every returning player is silently put back on the weakest
 * character. `migrate.ts`'s `upgradeV3ToV4` does that mapping and it is the only place the three old
 * values are still spelled out.
 *
 * `defeated` is the other half and it CANNOT be derived — a v3 save has no record of which
 * characters were beaten, because there were no characters. It starts empty, which puts a returning
 * player at the same gate a new one is at (the first {@link import('../game/opponents').FREE_OPPONENTS}
 * are open regardless). That is a real, if small, loss of progress for an existing player, and it is
 * the honest option: the alternative is inventing a history from a difficulty setting.
 */
export interface SaveStateV4 extends Omit<SaveStateV3, 'v' | 'difficulty'> {
  v: 4
  /** Which character the next match is against — `game/opponents.ts`'s `Opponent.id`. */
  opponent: string
  /**
   * Every opponent id the player has beaten, in no particular order.
   *
   * A LIST rather than a count, because the unlock ladder asks "did you beat the one before this",
   * which a count cannot answer. Only a win ever appends to it: losing must never unlock anything,
   * and a record that could also be set by losing well would.
   */
  defeated: string[]
  /**
   * The tutorial has been finished at least once.
   *
   * **Optional, and deliberately NOT a schema bump** — same reasoning as `bestCombo` above and
   * `skins.effects`: a save written before the field existed simply lacks it and normalises to
   * `false`, which is exactly the truth about it. A bump is for a field whose MEANING changed.
   *
   * Its only reader is `MainMenu`, which offers the tutorial as a button until this is set. A
   * returning player therefore sees the offer once more after this build lands, which is the right
   * failure: the alternative is inventing a history nobody recorded, and the cost of being wrong is
   * one button they can ignore. It is set by FINISHING the last lesson, never by skipping through
   * them — `Tutorial` only writes it from the ending panel.
   */
  tutorialDone?: boolean
  /**
   * Which chapters of the GUIDED TOUR this save has been shown (`game/tour.ts`).
   *
   * A different thing from {@link tutorialDone}, which is the hands-on lessons: the tour is the
   * spotlight that rings one control at a time and says what it does, and it is met on two screens
   * at two different moments. Hence a LIST rather than a flag — "has the menu been explained" and
   * "has a board been explained" are two questions, and a third chapter added later must not be
   * suppressed by the first two having been seen.
   *
   * `string[]` and not `TourChapter[]` on purpose, and `migrate.ts` keeps whatever strings it
   * finds: the save layer importing `game/tour.ts` would drag the store into the import graph of
   * every test that touches a payload, and it has nothing to ask anyway — a chapter id this build
   * does not know gates nothing, because `isChapterSeen` simply never matches it.
   *
   * Optional and NOT a schema bump, for the same reason as the two fields above: a save written
   * before it existed lacks it, and an empty list is exactly the truth about such a save.
   */
  tour?: string[]
}

export type SaveState = SaveStateV4

export const EMPTY_RECORD: RulesRecord = { wins: 0, losses: 0 }

export function emptyStats(): Record<RulesId, RulesRecord> {
  return Object.fromEntries(RULES_IDS.map((id) => [id, { ...EMPTY_RECORD }])) as Record<RulesId, RulesRecord>
}

export const DEFAULT_SAVE_STATE: SaveState = {
  v: SAVE_SCHEMA_VERSION,
  bestScore: 0,
  bestCombo: 0,
  coins: 0,
  purchases: [],
  settings: {
    sfx: 1,
    music: 1,
    sfxRestore: 1,
    musicRestore: 1,
  },
  rules: DEFAULT_RULES_ID,
  opponent: DEFAULT_OPPONENT_ID,
  defeated: [],
  tutorialDone: false,
  tour: [],
  skins: { board: 'default', pieces: 'default', effects: 'classic' },
  stats: emptyStats(),
  match: null,
  daily: { lastPlayed: null, streak: 0, best: 0, solvedToday: false },
}
