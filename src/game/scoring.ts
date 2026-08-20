/**
 * What a shot was worth — CHAPAEV-PLAN.md §5's combo counter and trick points.
 *
 * **Pure TypeScript, no Phaser.** Every input is already in the `SimOutcome` the solver produced,
 * so scoring is a function of what happened rather than a running tally something has to remember
 * to update.
 *
 * §5's framing is worth keeping in view: **none of this affects who wins.** Trick points are
 * "mastery on top of the rules, breaking nothing" — a player who ignores them entirely still plays
 * the same game, and a player who chases them is choosing a harder version of a shot they were
 * going to take anyway. The moment a trick becomes the way to win, the rules have two masters.
 */
import { involves, otherIn, type SimOutcome } from '../sim/outcome'
import { liveDiscs, opposite, type SimState, type Side } from '../sim/types'

/** Per enemy disc driven off. The floor of the whole system: an ordinary good shot scores. */
export const POINTS_PER_KNOCKOUT = 100

/**
 * A shot that removes several enemies at once multiplies by how many.
 *
 * §5 wants the double to be worth chasing rather than merely worth twice one — two knockouts score
 * 400 rather than 200, three score 900. That curve is the whole reason a player lines up a shot
 * through two discs instead of taking the safe one.
 */
export function comboMultiplier(knockouts: number): number {
  return Math.max(1, knockouts)
}

export type TrickId =
  /** The shot bounced off one of your own discs before it reached an enemy. */
  | 'bank'
  /** Taken with your last disc on the board. */
  | 'lastDisc'
  /** Removed an enemy and left every one of your own where it was. */
  | 'clean'

export const TRICK_POINTS: Record<TrickId, number> = {
  // The hardest of the three to do on purpose, and the most satisfying to watch.
  bank: 150,
  // Not a difficulty bonus so much as a nerve bonus: with one disc left, any shot risks the round.
  lastDisc: 200,
  clean: 50,
}

export interface ShotScore {
  /** Enemy discs this shot removed. */
  knockouts: number
  tricks: TrickId[]
  /** Total for the shot, combo multiplier and tricks included. */
  points: number
}

/**
 * Scores one settled shot from the shooter's point of view.
 *
 * `before` is the board as it stood when the shot was fired and `after` is where it came to rest;
 * both are needed because "left all of your own on the board" and "was your last disc" are
 * statements about the transition, not about either end of it.
 */
export function scoreShot(outcome: SimOutcome, before: SimState, after: SimState): ShotScore {
  const side = outcome.shooterSide
  if (!side) return { knockouts: 0, tricks: [], points: 0 }

  const other = opposite(side)
  const knockouts = liveDiscs(before, other).length - liveDiscs(after, other).length
  const ownLost = liveDiscs(before, side).length - liveDiscs(after, side).length

  const tricks: TrickId[] = []
  if (knockouts > 0) {
    if (bankedOffOwn(outcome, before, side)) tricks.push('bank')
    if (liveDiscs(before, side).length === 1) tricks.push('lastDisc')
    if (ownLost === 0) tricks.push('clean')
  }

  const base = knockouts * POINTS_PER_KNOCKOUT * comboMultiplier(knockouts)
  const bonus = tricks.reduce((total, trick) => total + TRICK_POINTS[trick], 0)

  return { knockouts, tricks, points: base + bonus }
}

/**
 * Did the shooter hit one of its own discs before it reached an enemy?
 *
 * Reads the impacts in the order the solver recorded them, which is exactly why `outcome.ts` keeps
 * them ordered. Note it asks about the SHOOTER's own first contact rather than the first contact on
 * the board: a chain the shooter set off elsewhere is not a bank shot, however impressive.
 */
function bankedOffOwn(outcome: SimOutcome, before: SimState, side: Side): boolean {
  const shooterId = outcome.shooterId
  if (shooterId === null) return false

  const sideOf = new Map(before.discs.map((disc) => [disc.id, disc.side]))
  let touchedOwn = false

  for (const impact of outcome.impacts) {
    if (!involves(impact, shooterId)) continue
    const otherId = otherIn(impact, shooterId)
    // The rim is not a disc; a bank off the wall in `bumperRim` mode is its own thing and not this.
    if (otherId === null) continue

    if (sideOf.get(otherId) === side) touchedOwn = true
    else return touchedOwn
  }

  return false
}

/** A short, human-readable list for the HUD — `'bank'` is not a thing to show a player. */
export function trickLabelKeys(tricks: readonly TrickId[]): readonly TrickId[] {
  return tricks
}
