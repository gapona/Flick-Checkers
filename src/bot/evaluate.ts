/**
 * How good a shot turned out to be — one number per candidate.
 *
 * **Pure TypeScript, no Phaser.** It compares the board before the shot with the board after it,
 * which is the only honest way to score a carrom shot: nothing about the aim predicts the result,
 * so the search plays every candidate out and judges the wreckage.
 *
 * The weights are GAME-PLAN.md §6's, with two additions noted below. They are deliberately blunt.
 * A finely-tuned evaluation would make the bot stronger, and §6 is explicit that strength is not
 * what varies between difficulties — noise is. A bot that is merely competent and occasionally
 * fluffs a shot is a better opponent than one that is precise and inhuman.
 */
import type { SimOutcome } from '../sim/outcome'
import { CELL, liveDiscs, opposite, type SimConfig, type SimState, type Side } from '../sim/types'

/** A disc within this much of any edge is one nudge from being lost. */
export const NEAR_EDGE_CELLS = 1

export interface EvaluationWeights {
  /** Per enemy disc driven off. §6: +3. */
  knockout: number
  /** Per own disc lost. §6: −4 — losing your own hurts more than taking theirs helps, which is what
   * stops the bot from trading evenly on a board where it has no material advantage to spend. */
  ownLoss: number
  /** Per own disc left within {@link NEAR_EDGE_CELLS} of an edge. §6: −1. */
  nearEdge: number
  /** Per cell of reduction in the mean distance from your discs to theirs. §6: +0.5. */
  approach: number
  /**
   * **Not in §6's list.** Winning or losing the round outright, which §6's four terms cannot
   * express: clearing the last enemy disc scores the same +3 as clearing any other, and knocking
   * your own last disc off scores −4 when it has in fact cost the whole round. Without this the bot
   * declines free wins on ties and walks into losses a single number would have ruled out.
   */
  decisive: number
  /**
   * **Not in §6's list.** A shot that would be penalised under the rules in force —
   * `mustTouchEnemy` with nothing touched, or `ownOffIsPenalty` with a disc lost. Handing the
   * opponent two shots costs about as much as losing a disc, and a bot blind to it played the
   * board-game-strict rule set noticeably worse than the lenient one back when both shipped. No
   * shipped set turns `mustTouchEnemy` on today, so this term currently fires only on
   * `ownOffIsPenalty` — which every set does have.
   */
  penalty: number
  /**
   * **A shot that touched no enemy disc at all**, whatever the rules say about penalties.
   *
   * Distinct from {@link EvaluationWeights.penalty}'s `mustTouchEnemy` half, which no shipped set
   * turns on. Under strict alternation (§3) that left a whiffed shot
   * costing literally nothing in the evaluation, when in fact it hands the opponent a free turn.
   * While the turn could be bought back by hitting something, tempo was a thing the bot got for
   * free by aiming at discs; now it has to be priced.
   */
  wasted: number
  /**
   * **How uncomfortable the board is left for the opponent** — per cell of reduction in the mean
   * distance from THEIR discs to the nearest edge.
   *
   * The counterpart to {@link EvaluationWeights.approach}, and needed for the same reason `wasted`
   * is: with no extra shot to win, a shot that drives an enemy disc toward the rim without taking it
   * is real progress rather than a wasted turn, and nothing in §6's four terms could say so. The bot
   * without this plays every shot as all-or-nothing.
   */
  expose: number
}

/**
 * Picked by `scripts/tune-weights.mjs`, and picked in two steps because the criterion could not do
 * it alone.
 *
 * §10's gate — Hard beats Easy in 90+ of 100 rounds — **ruled nothing out**: seven vectors were
 * played, all seven passed, and the pre-change baseline passed too at 91/100. So the old weights
 * were never wrong under strict alternation, only incomplete: a whiffed shot and a disc shoved
 * toward the rim were both worth exactly zero to them.
 *
 * Re-running the three leaders at 300 rounds gave 284 / 286 / 289, a spread of 1.6 points against a
 * standard error of 1.26 — still indistinguishable. Taking the top of that is picking the argmax of
 * noise, which is eyeballing with a spreadsheet in front of it.
 *
 * So the tie is broken by a design rule instead, stated here so the next person does not re-derive
 * it: **a knockout stays the largest single-event term.** The winning-est vector (`all-hot`) put
 * `nearEdge` at −3.5 against a knockout's +3, which makes not-being-near-an-edge worth more than
 * taking a disc — a different game from the one §6 describes. `all-firm` raises the edge term as far
 * as it goes while leaving that ordering intact.
 */
export const DEFAULT_WEIGHTS: EvaluationWeights = {
  knockout: 3,
  ownLoss: -4,
  // Raised against `knockout` when the turn stopped being purchasable with a hit: trading evenly is
  // worse when the trade no longer also buys the board. Held under 3 on purpose — see the note above.
  nearEdge: -2.5,
  approach: 0.5,
  decisive: 100,
  penalty: -3,
  wasted: -3,
  expose: 1,
}

/** Just enough of `RuleSet` to know whether a shot is punished — passed as plain values rather
 * than imported, so this module stays a function of its arguments. */
export interface PenaltyRules {
  ownOffIsPenalty: boolean
  mustTouchEnemy: boolean
}

/** Mean distance from each of `side`'s live discs to its nearest enemy, in board units. `null` when
 * either side has nothing left, where the quantity is meaningless. */
export function meanApproach(state: SimState, side: Side): number | null {
  const mine = liveDiscs(state, side)
  const theirs = liveDiscs(state, opposite(side))
  if (mine.length === 0 || theirs.length === 0) return null

  let total = 0
  for (const disc of mine) {
    let nearest = Number.POSITIVE_INFINITY
    for (const enemy of theirs) {
      const distance = Math.hypot(enemy.x - disc.x, enemy.y - disc.y)
      if (distance < nearest) nearest = distance
    }
    total += nearest
  }
  return total / mine.length
}

/**
 * Mean distance from each of `side`'s live discs to the nearest edge, in board units — "how close is
 * this side to losing something". `null` when the side has nothing left.
 *
 * The nearest edge rather than the one ahead of it: a disc goes off whichever rim it reaches, and
 * `sim/step.ts` has no notion of a direction of ejection. Measuring toward one chosen edge would
 * make the bot blind to the three others.
 */
export function meanEdgeMargin(state: SimState, side: Side, config: SimConfig): number | null {
  const discs = liveDiscs(state, side)
  if (discs.length === 0) return null

  let total = 0
  for (const disc of discs) {
    total += Math.min(disc.x, disc.y, config.boardW - disc.x, config.boardH - disc.y)
  }
  return total / discs.length
}

export function countNearEdge(state: SimState, side: Side, config: SimConfig): number {
  const margin = NEAR_EDGE_CELLS * CELL
  let count = 0
  for (const disc of liveDiscs(state, side)) {
    if (disc.x < margin || disc.x > config.boardW - margin || disc.y < margin || disc.y > config.boardH - margin) count++
  }
  return count
}

/**
 * Scores one played-out candidate from `side`'s point of view. Higher is better.
 *
 * `before` and `after` are the same board either side of the shot, and `outcome` is what the solver
 * recorded while playing it. Nothing here mutates anything.
 */
export function evaluate(
  before: SimState,
  after: SimState,
  outcome: SimOutcome,
  side: Side,
  config: SimConfig,
  rules: PenaltyRules,
  weights: EvaluationWeights = DEFAULT_WEIGHTS,
): number {
  const other = opposite(side)

  const enemiesTaken = liveDiscs(before, other).length - liveDiscs(after, other).length
  const ownLost = liveDiscs(before, side).length - liveDiscs(after, side).length

  let score = enemiesTaken * weights.knockout + ownLost * weights.ownLoss
  score += countNearEdge(after, side, config) * weights.nearEdge

  // Decided the round. Tested in this order so that clearing the board of BOTH sides reads as a
  // loss — the same precedence `game/round.ts` applies.
  if (liveDiscs(after, side).length === 0) score -= weights.decisive
  else if (liveDiscs(after, other).length === 0) score += weights.decisive

  const approachBefore = meanApproach(before, side)
  const approachAfter = meanApproach(after, side)
  if (approachBefore !== null && approachAfter !== null) {
    score += ((approachBefore - approachAfter) / CELL) * weights.approach
  }

  const exposeBefore = meanEdgeMargin(before, other, config)
  const exposeAfter = meanEdgeMargin(after, other, config)
  if (exposeBefore !== null && exposeAfter !== null) {
    score += ((exposeBefore - exposeAfter) / CELL) * weights.expose
  }

  if ((rules.ownOffIsPenalty && ownLost > 0) || (rules.mustTouchEnemy && !outcome.touchedEnemy)) {
    score += weights.penalty
  }

  // Unconditional, unlike the penalty above: this is about the turn, not about the rule set.
  if (!outcome.touchedEnemy) score += weights.wasted

  return score
}
