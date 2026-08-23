/**
 * The match: a run of rounds, one per branch of arms, with a winner at the end.
 *
 * **Pure TypeScript, no Phaser** — same rule as `game/round.ts`, which this sits directly on top of.
 * A round knows nothing about the match; the match reads a round's `RoundSummary` and decides what
 * happens next.
 *
 * GAME-PLAN.md §3: "a match is best of N rounds, not one round — one round is too short for a
 * session". §4 supplies what the rounds differ by: the five branches, walked in order, so a match is
 * also a tour of the whole game rather than the same board five times.
 */
import type { RulesId } from './rules'
import type { RoundSummary } from './round'
import { FORMATION_ORDER } from './formations'
import type { FormationId } from './rules'
import { opposite, type Side } from '../sim/types'

/** Rounds in a match. Five is not arbitrary — it is exactly §4's five branches, so a match shows
 * every one of them once and nobody has to decide which to leave out. */
export const MATCH_ROUNDS = FORMATION_ORDER.length

/** Rounds needed to win. Best of five: first to three, so a match can end early rather than playing
 * out rounds that cannot change the result. */
export const ROUNDS_TO_WIN = Math.floor(MATCH_ROUNDS / 2) + 1

export interface MatchState {
  rulesId: RulesId
  /** Which round is being played, `0`-based — also the index into {@link FORMATION_ORDER}. */
  roundIndex: number
  wins: Record<Side, number>
  /**
   * Who won each round, in order — the match panel's five-mark strip.
   *
   * Not derivable from {@link MatchState.wins}, and the difference is the whole point: the strip
   * says WHICH rounds went which way, and the rounds are §4's branches of arms in a fixed order, so
   * mark three is always artillery. Two counts cannot say that.
   */
  results: Side[]
  /** Who opens the current round. §3's last-hope strike is the only thing that changes it from the
   * default of "whoever lost the last one". */
  first: Side
  /** Rows each side's formation starts further forward, from `advanceOnCleanWin` (§3). */
  advance: Record<Side, number>
  /** Running score across the whole match — §5's combos and trick shots, and what `sendScore()`
   * reports. */
  score: number
  /** `null` until somebody has taken it. */
  winner: Side | null
}

export function createMatch(rulesId: RulesId, first: Side = 'player'): MatchState {
  return {
    rulesId,
    roundIndex: 0,
    wins: { player: 0, opponent: 0 },
    results: [],
    first,
    advance: { player: 0, opponent: 0 },
    score: 0,
    winner: null,
  }
}

/** The branch of arms the current round is fought with (§4). */
export function currentFormation(match: MatchState): FormationId {
  return FORMATION_ORDER[match.roundIndex % FORMATION_ORDER.length]
}

/** Rounds still to play, assuming nobody clinches it early. */
export function roundsLeft(match: MatchState): number {
  return Math.max(0, MATCH_ROUNDS - match.roundIndex)
}

/**
 * Folds a finished round into the match and sets up the next one.
 *
 * The two between-rounds promises of §3 are both cashed here, and only here: the last-hope strike
 * decides who opens, and a clean win moves the winner's formation a row forward. Everything the
 * decision needs is already in the `RoundSummary` — the match never looks at a board.
 */
export function recordRound(match: MatchState, summary: RoundSummary, advanceOnCleanWin: boolean): void {
  if (match.winner) return

  match.wins[summary.winner]++
  match.results.push(summary.winner)
  if (advanceOnCleanWin && summary.cleanWin) match.advance[summary.winner]++

  if (match.wins[summary.winner] >= ROUNDS_TO_WIN) {
    match.winner = summary.winner
    return
  }

  match.roundIndex++
  match.first = summary.firstNextRound

  // Out of rounds without either side reaching the target: the one ahead takes it. A drawn match is
  // possible on paper with an even round count and is not with five, but the fallback stays because
  // `MATCH_ROUNDS` is derived from §4's branch list and could change with it.
  if (match.roundIndex >= MATCH_ROUNDS) {
    match.winner = match.wins.player >= match.wins.opponent ? 'player' : 'opponent'
  }
}

/** Human-facing round number, `1`-based. */
export function roundNumber(match: MatchState): number {
  return Math.min(match.roundIndex + 1, MATCH_ROUNDS)
}

/** True once one side cannot be caught, even before the match formally ends. */
export function isDecided(match: MatchState): boolean {
  return match.winner !== null || match.wins.player >= ROUNDS_TO_WIN || match.wins.opponent >= ROUNDS_TO_WIN
}

/** The side that is behind, for a HUD that wants to say so. `null` when level. */
export function trailing(match: MatchState): Side | null {
  if (match.wins.player === match.wins.opponent) return null
  return match.wins.player < match.wins.opponent ? 'player' : opposite('player')
}
