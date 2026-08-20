/**
 * One round: whose turn it is, how many shots they owe, and when it is over.
 *
 * **Pure TypeScript, no Phaser** — same rule as `game/rules.ts` and `src/sim/`. Every decision here
 * is a function of the rule flags plus what the last shot did, so the whole turn matrix of
 * CHAPAEV-PLAN.md §3 is enumerable under plain `node` (`npm run test:gameplay`).
 *
 * It reads the board but never touches it: the solver owns where discs are, and this owns what that
 * means. The two meet in exactly one place — {@link resolveShot} takes a settled `SimState` and the
 * `SimOutcome` that produced it.
 *
 * ## Where the rules stop being obvious
 *
 * §3 lists the flags but does not say what happens when two of them fire on the same shot, and the
 * combinations are not rare — knocking an enemy off while losing one of your own is a completely
 * ordinary result. Every such choice is made once, here, and written down:
 *
 * 1. **A penalty beats an extra shot.** Lose one of your own and the turn ends, even if you also
 *    knocked an enemy off. "Свою за борт — противник бьёт дважды" is unconditional in the original,
 *    and the alternative — rewarding a shot that cost you a disc with another go — makes the
 *    penalty toothless exactly when it should bite.
 * 2. **Penalties do not stack.** Losing your own disc AND failing to touch an enemy is still two
 *    shots for the opponent, not four. Two penalties for one shot is a spiral a beginner cannot get
 *    out of, and §3 asks for one consequence per rule, not a sum.
 * 3. **Knocking your own last disc off loses the round**, even if the same shot cleared the
 *    opponent. Someone has to lose a mutual wipe-out, and it should be whoever caused it.
 * 4. **The last-hope strike is sticky.** It has to be: it is checked while a side is down to one
 *    disc, and the side it protects is usually the side that then loses every disc — a check made
 *    at the end of the round could never fire.
 */
import type { BoardMetrics } from '../board/layout'
import type { ChapaevRules } from './rules'
import { enemyKnockouts, ownKnockouts, type SimOutcome } from '../sim/outcome'
import { liveDiscs, opposite, type Disc, type SimState, type Side } from '../sim/types'

/** Shots the opponent is awarded by a penalty — §3's "противник бьёт дважды". */
export const PENALTY_SHOTS = 2

export interface RoundState {
  /** The side to move. */
  turn: Side
  /** Shots {@link RoundState.turn} still owes before it passes. Never below 1 while the round is
   * running. */
  shotsLeft: number
  /** `null` while the round is running. */
  winner: Side | null
  /**
   * The side that earned §3's last-hope strike — reduced to a single disc on its own back rank, and
   * therefore first to shoot next round. Sticky once set (see the header). `null` if nobody has.
   */
  lastHope: Side | null
  /** Which sides have lost a disc this round, for `advanceOnCleanWin`. */
  lostADisc: Record<Side, boolean>
  /** Shots taken by both sides. */
  shots: number
  /**
   * Enemy discs each side has knocked off this round, and the most one shot of theirs took.
   *
   * Kept here rather than tallied by the scene because the result panel reads them after the round
   * has ended, and a round can be saved and resumed in between — a counter living in `Game` would
   * silently reset to zero on a reload and quietly under-report the player's own round. They are the
   * same kind of thing as {@link RoundState.shots}, so they live in the same place.
   */
  knockedOut: Record<Side, number>
  bestCombo: Record<Side, number>
}

export function createRound(first: Side = 'player'): RoundState {
  return {
    turn: first,
    shotsLeft: 1,
    winner: null,
    lastHope: null,
    lostADisc: { player: false, opponent: false },
    shots: 0,
    knockedOut: { player: 0, opponent: 0 },
    bestCombo: { player: 0, opponent: 0 },
  }
}

/** A snapshot, for anything that has to be able to put a round back — §8's retake, and any future
 * replay. Every nested object has to be copied, or a restored round would share its tallies with
 * the one it was supposed to replace. */
export function cloneRound(round: RoundState): RoundState {
  return {
    ...round,
    lostADisc: { ...round.lostADisc },
    knockedOut: { ...round.knockedOut },
    bestCombo: { ...round.bestCombo },
  }
}

/** Why the turn ended up where it did — for the HUD to say so, and for the tests to name it. */
export type TurnReason =
  /** The shooter knocked an enemy off and keeps the turn (`extraShotOnKnockout`). */
  | 'extraShot'
  /** The shooter lost one of its own, or failed to touch an enemy. The opponent shoots twice. */
  | 'penalty'
  /** The shooter still owes a shot from an earlier award. */
  | 'sameTurn'
  /** Ordinary hand-over. */
  | 'pass'
  | 'roundOver'

export interface ShotResolution {
  reason: TurnReason
  turn: Side
  shotsLeft: number
  winner: Side | null
  /** Enemy discs this one shot removed — §5's combo counter reads it. */
  knockouts: number
  /** The shooter's own discs this shot cost it. */
  ownLosses: number
}

/**
 * Applies a settled shot to the round.
 *
 * `state` must already be at rest — the solver decides what happened, this decides what it means.
 * Mutates `round` and returns a summary of the decision.
 *
 * A shot from the side that is not to move is refused rather than trusted: it is always a caller
 * bug, and quietly accepting it would let a UI race hand a side two turns in a row.
 */
export function resolveShot(round: RoundState, rules: ChapaevRules, state: SimState, metrics: BoardMetrics, outcome: SimOutcome): ShotResolution {
  const shooter = outcome.shooterSide
  if (round.winner || !shooter || shooter !== round.turn) {
    return { reason: round.winner ? 'roundOver' : 'sameTurn', turn: round.turn, shotsLeft: round.shotsLeft, winner: round.winner, knockouts: 0, ownLosses: 0 }
  }

  const knockouts = enemyKnockouts(outcome)
  const ownLosses = ownKnockouts(outcome)

  round.shots++
  round.shotsLeft--
  if (ownLosses > 0) round.lostADisc[shooter] = true
  if (knockouts > 0) round.lostADisc[opposite(shooter)] = true

  // Tallied before the victory test: the shot that ends the round is the one most worth counting,
  // and returning early below would drop it.
  round.knockedOut[shooter] += knockouts
  round.bestCombo[shooter] = Math.max(round.bestCombo[shooter], knockouts)

  // Checked before the victory test, because the side it protects is normally the side about to
  // lose its last disc — see the header on why this is sticky.
  updateLastHope(round, state, metrics)

  const winner = decideWinner(state, shooter)
  if (winner) {
    round.winner = winner
    round.shotsLeft = 0
    return { reason: 'roundOver', turn: round.turn, shotsLeft: 0, winner, knockouts, ownLosses }
  }

  // Precedence 1 and 2 from the header: a penalty ends the turn whatever else happened, and two
  // penalties on one shot are still one penalty.
  const penalised = (rules.ownOffIsPenalty && ownLosses > 0) || (rules.mustTouchEnemy && !outcome.touchedEnemy)

  let reason: TurnReason
  if (penalised) {
    round.turn = opposite(shooter)
    round.shotsLeft = PENALTY_SHOTS
    reason = 'penalty'
  } else if (rules.extraShotOnKnockout && knockouts > 0) {
    round.shotsLeft++
    reason = 'extraShot'
  } else if (round.shotsLeft <= 0) {
    round.turn = opposite(shooter)
    round.shotsLeft = 1
    reason = 'pass'
  } else {
    reason = 'sameTurn'
  }

  return { reason, turn: round.turn, shotsLeft: round.shotsLeft, winner: null, knockouts, ownLosses }
}

/**
 * The shot clock ran out (`shotClockMs`, §5's blitz mode).
 *
 * A forfeit is NOT a penalty. The player has already lost the thing that matters — the shot — and
 * §5 offers the timer as a tempo device rather than a punishment; charging two shots on top would
 * make a mode meant to feel fast feel unfair. The whole turn passes rather than just one shot of it,
 * because a side that let the clock run out is not owed the remainder of an award.
 */
export function forfeitShot(round: RoundState): ShotResolution {
  if (round.winner) {
    return { reason: 'roundOver', turn: round.turn, shotsLeft: 0, winner: round.winner, knockouts: 0, ownLosses: 0 }
  }

  round.shots++
  round.turn = opposite(round.turn)
  round.shotsLeft = 1
  return { reason: 'pass', turn: round.turn, shotsLeft: 1, winner: null, knockouts: 0, ownLosses: 0 }
}

/**
 * Who has won, or `null`.
 *
 * Precedence 3 from the header: the shooter is tested first, so clearing the board of both sides in
 * one shot loses rather than wins. Someone has to lose a mutual wipe-out and it should be the side
 * that caused it.
 */
function decideWinner(state: SimState, shooter: Side): Side | null {
  if (liveDiscs(state, shooter).length === 0) return opposite(shooter)
  if (liveDiscs(state, opposite(shooter)).length === 0) return shooter
  return null
}

/** A disc sitting in its own side's outermost rank — the row it started on. */
export function isOnHomeRank(disc: Disc, side: Side, metrics: BoardMetrics): boolean {
  const row = Math.floor(disc.y / metrics.tile)
  return side === 'player' ? row >= metrics.size - 1 : row <= 0
}

function updateLastHope(round: RoundState, state: SimState, metrics: BoardMetrics): void {
  for (const side of ['player', 'opponent'] as const) {
    const remaining = liveDiscs(state, side)
    if (remaining.length === 1 && isOnHomeRank(remaining[0], side, metrics)) round.lastHope = side
  }
}

export interface RoundSummary {
  winner: Side
  /** The winner never lost a disc — `advanceOnCleanWin`'s trigger. **Earning it is S6's; acting on
   * it is S8's**, because moving a formation forward needs the formations themselves. */
  cleanWin: boolean
  /**
   * Who shoots first next round: the loser, and the last-hope side only when that is also the loser.
   *
   * **The second clause is a fix, not a subtlety.** §3's last-hope strike is a comeback rule — it
   * exists to give a side that was pinned to its own back rank something to open the next round
   * with. But `lastHope` is sticky (it has to be, see the header), so a side that was down to one
   * disc and CAME BACK still carries the flag, and the rule was then handing the next round's
   * opening shot to the round's WINNER.
   *
   * That is the rubber band pointing the wrong way, and `npm run verify:balance` measured how often:
   * **11.5% of rounds**, against a first-shooter round win rate of 71.8%. A comeback mechanism that
   * fires for the side that already came back is an amplifier of the lead, not a brake on it.
   */
  firstNextRound: Side
  shots: number
  /** What each side did with those shots — the result panel's rows, and the only place they are
   * assembled, so the panel never reaches into a live {@link RoundState}. */
  knockedOut: Record<Side, number>
  bestCombo: Record<Side, number>
}

/** The round's result, or `null` while it is still running. */
export function summarise(round: RoundState, rules: ChapaevRules): RoundSummary | null {
  if (!round.winner) return null

  const loser = opposite(round.winner)
  return {
    winner: round.winner,
    cleanWin: !round.lostADisc[round.winner],
    // `=== loser` is the whole of the fix: the flag stays sticky, but it only cashes for the side
    // that actually lost the round.
    firstNextRound: rules.lastHopeStrike && round.lastHope === loser ? round.lastHope : loser,
    shots: round.shots,
    knockedOut: { ...round.knockedOut },
    bestCombo: { ...round.bestCombo },
  }
}
