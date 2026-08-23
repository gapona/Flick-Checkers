/**
 * The bridge between a live match and the save file: everything that reads or writes
 * `SaveState.rules` / `.opponent` / `.defeated` / `.stats` / `.bestScore` / `.match` goes through
 * here, so a scene never has to know the storage shape.
 *
 * Writes always go via `store.mutate()`, which debounces to at most one write every 2s and is
 * flushed on platform PAUSE and `pagehide` (see `save/store.ts`). A match is saved after every
 * settled shot, so a reload loses at most the shot that was in the air.
 *
 * **Why the whole board is stored and not just "which formation, and who died".** Discs move. A
 * match is saved mid-round, so where each one ended up IS the state — and after a stack splits (§4)
 * the board holds discs no formation ever placed, which kills the derived-from-formation shortcut
 * outright.
 */
import { isOpponentUnlocked, opponent, OPPONENTS, type Opponent } from './opponents'
import { DEFAULT_RULES_ID, isRulesId, type RulesId } from './rules'
import { createRound, type RoundState } from './round'
import { createMatch, type MatchState } from './match'
import { getState, mutate } from '../save/store'
import type { SavedDisc, SavedMatch } from '../save/types'
import { createDisc, createState, liveDiscs, type Disc, type SimState } from '../sim/types'
import type { MatchOutcome } from './economy'

/** The rule set a fresh match starts under — the last one played, or the default if the save
 * predates this build's rule ids. */
export function currentRulesId(): RulesId {
  const saved = getState().rules
  return isRulesId(saved) ? saved : DEFAULT_RULES_ID
}

export function rememberRuleSet(rulesId: RulesId): void {
  mutate((state) => {
    state.rules = rulesId
  })
}

/**
 * The character a fresh match is played against.
 *
 * **Clamped to an UNLOCKED one, and that guard is not paranoia.** The stored id and the stored
 * `defeated` list are two fields that have to agree, and there are at least two ways for them not
 * to: a `v3 -> v4` migration maps a difficulty onto a character further up the ladder than an empty
 * `defeated` list can reach, and a hand-edited save can say anything. Without this, `Modes` would
 * show no card selected while `Game` played the locked character anyway — which is exactly what it
 * did.
 *
 * Falls back to the strongest character the player HAS reached rather than to the bottom of the
 * ladder: a save pointing past the gate is a save that was aiming high, and demoting it to the
 * recruit would be a worse guess than the one it made.
 */
export function currentOpponent(): Opponent {
  const state = getState()
  const stored = opponent(state.opponent)
  if (stored && isOpponentUnlocked(stored.id, state.defeated)) return stored

  const reachable = OPPONENTS.filter((one) => isOpponentUnlocked(one.id, state.defeated))
  return reachable[reachable.length - 1] ?? OPPONENTS[0]
}

export function rememberOpponent(id: string): void {
  mutate((state) => {
    state.opponent = id
  })
}

/** Who the player has beaten — the unlock ladder's only input (`game/opponents.ts`). */
export function defeatedOpponents(): readonly string[] {
  return getState().defeated
}

/**
 * Records a match win over a character, which is what opens the next rung.
 *
 * **Only ever called on a win, and idempotent.** A list rather than a count is the whole point (see
 * `SaveStateV4.defeated`), and appending a duplicate would grow the save every rematch for no gain.
 */
export function rememberDefeated(id: string): void {
  mutate((state) => {
    if (!state.defeated.includes(id)) state.defeated.push(id)
  })
}

/**
 * Files a finished match under its rule set, from the PLAYER's point of view. A match still in
 * progress is ignored, so this is safe to call from a general "the state changed" path.
 */
export function recordResult(rulesId: RulesId, outcome: MatchOutcome): void {
  if (outcome === 'ongoing') return

  mutate((state) => {
    const record = state.stats[rulesId]
    if (outcome === 'won') record.wins++
    else record.losses++
  })
}

/**
 * Raises the best score if this run beat it, and reports whether it did — a new personal best is
 * worth saying out loud on the result screen, and the caller would otherwise have to read the old
 * value before writing the new one and race its own debounce.
 *
 * The platform's own leaderboard is fed separately, by `platform/yt.ts`'s `sendScore()`; this is
 * the local copy the game shows.
 */
export function recordScore(score: number): boolean {
  if (!Number.isFinite(score) || score <= getState().bestScore) return false
  mutate((state) => {
    state.bestScore = Math.floor(score)
  })
  return true
}

export function bestScore(): number {
  return getState().bestScore
}

/**
 * The same shape as {@link recordScore}, for the largest combo ever landed.
 *
 * Separate from the score because they are separate claims: the score says how a whole match went,
 * a combo says one shot went better than every shot before it. Reported rather than just written so
 * the result panel can award the badge without reading the old value first and racing its own
 * debounced save — the identical reason `recordScore` returns a boolean.
 */
export function recordCombo(knockouts: number): boolean {
  if (!Number.isFinite(knockouts) || knockouts <= getState().bestCombo) return false
  mutate((state) => {
    state.bestCombo = Math.floor(knockouts)
  })
  return true
}

export function bestCombo(): number {
  return getState().bestCombo
}

// -- the tutorial ---------------------------------------------------------------------------------

/**
 * Whether the player has been through the tutorial.
 *
 * Read by `MainMenu` only, to decide whether to offer it as a button. Everything else reaches it
 * through the gear, unconditionally — a screen that explains the game must not become unreachable
 * because somebody once pressed Finish on it.
 */
export function tutorialDone(): boolean {
  return getState().tutorialDone === true
}

/** Set by finishing the last lesson, never by skipping through them — see `scenes/Tutorial.ts`. */
export function rememberTutorialDone(): void {
  mutate((state) => {
    state.tutorialDone = true
  })
}

// -- the match in progress ----------------------------------------------------------------------

/** True when there is something for a "Continue" entry point to resume. */
export function hasSavedMatch(): boolean {
  return getState().match !== null
}

/** Positions are stored to a tenth of a board unit — well under a pixel at any zoom this game
 * reaches, and it keeps the payload from being mostly floating-point noise. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function toSavedDisc(disc: Disc): SavedDisc {
  return {
    id: disc.id,
    side: disc.side,
    stack: disc.kind === 'stack',
    x: round1(disc.x),
    y: round1(disc.y),
    r: round1(disc.r),
    mass: disc.mass,
    friction: disc.frictionScale,
    restitution: disc.restitution,
    split: disc.splitImpulse,
    alive: disc.alive,
  }
}

function fromSavedDisc(saved: SavedDisc): Disc {
  const disc = createDisc({
    id: saved.id,
    side: saved.side,
    x: saved.x,
    y: saved.y,
    kind: saved.stack ? 'stack' : 'single',
    r: saved.r,
    mass: saved.mass,
    frictionScale: saved.friction,
    restitution: saved.restitution,
    splitImpulse: saved.split,
  })
  disc.alive = saved.alive
  return disc
}

/**
 * Writes the match, the round and the board as one record.
 *
 * Called after a shot has SETTLED, never during one: a board saved mid-flight would restore discs
 * with velocities the round has not accounted for, and the first frame after the reload would
 * resolve a shot the player never saw.
 */
export function saveMatch(match: MatchState, round: RoundState, board: SimState, twoPlayer = false): void {
  const record: SavedMatch = {
    rules: match.rulesId,
    roundIndex: match.roundIndex,
    wins: { ...match.wins },
    first: match.first,
    advance: { ...match.advance },
    score: match.score,
    turn: round.turn,
    shotsLeft: round.shotsLeft,
    lastHope: round.lastHope,
    lostADisc: { ...round.lostADisc },
    shots: round.shots,
    board: board.discs.map(toSavedDisc),
    results: [...match.results],
    knockedOut: { ...round.knockedOut },
    bestCombo: { ...round.bestCombo },
    twoPlayer,
  }

  mutate((state) => {
    state.match = record
  })
}

/** Drops the saved match — it finished, or the player started a new one. */
export function clearMatch(): void {
  mutate((state) => {
    state.match = null
  })
}

/**
 * **True when a restored board belongs to a round that is already OVER.**
 *
 * `Game.finishRound` persists after `recordRound`, so the record it writes is a decided round on a
 * board that has just been cleared. `startRound` normally overwrites that a moment later with the
 * fresh board — but not if the player leaves from the result panel, or the tab dies while it is up.
 * Adopting that board put the player on a field with no opponent on it and a round whose `winner`
 * was still `null`, so the HUD said "Your shot" forever with nothing to shoot at.
 *
 * The caller starts the NEXT round instead of dropping the match, because the saved match is
 * already post-`recordRound` — its `wins`, `roundIndex` and `first` describe the round that should
 * come next, so nothing is replayed and nothing is re-awarded. Asked on the RESUME side rather than
 * guarded on the write side so it holds for every writer: `finishRound`, `Game.leave()`, and
 * `bindAutosave`'s flush on `pagehide`.
 */
export function savedRoundIsOver(board: SimState): boolean {
  return liveDiscs(board, 'player').length === 0 || liveDiscs(board, 'opponent').length === 0
}

export interface ResumedMatch {
  match: MatchState
  round: RoundState
  board: SimState
  /** The match was two people on one device. `Game` needs it before it decides whether to build a
   * bot, so it travels with the board rather than being asked for separately. */
  twoPlayer: boolean
}

/**
 * The match to continue, or `null` if there is none.
 *
 * The rule-set check is not paranoia: the flags decide whether the turn passes, whether a penalty
 * applies and whether the rim bounces, so resuming a board under a different set would silently
 * change what the player is allowed to do mid-match. `migrate.ts` has already rejected anything
 * structurally broken by this point; what is left is the question of whether it belongs to the
 * match being started.
 */
export function loadMatch(rulesId: RulesId): ResumedMatch | null {
  const saved = getState().match
  if (!saved || saved.rules !== rulesId) return null

  const match = createMatch(saved.rules, saved.first)
  match.roundIndex = saved.roundIndex
  match.wins = { ...saved.wins }
  match.advance = { ...saved.advance }
  match.score = saved.score
  // Normalised, not trusted: these three arrived after the shape shipped, so a save written by an
  // earlier build simply lacks them. See `SavedMatch`'s own note on why that needs no version bump.
  match.results = [...(saved.results ?? [])]

  const round = createRound(saved.turn)
  round.shotsLeft = saved.shotsLeft
  round.lastHope = saved.lastHope
  round.lostADisc = { ...saved.lostADisc }
  round.shots = saved.shots
  if (saved.knockedOut) round.knockedOut = { ...saved.knockedOut }
  if (saved.bestCombo) round.bestCombo = { ...saved.bestCombo }

  return { match, round, board: createState(saved.board.map(fromSavedDisc)), twoPlayer: saved.twoPlayer === true }
}
