/**
 * §5's board modifier, as geometry.
 *
 * **Pure TypeScript, no Phaser.** Builds the pits a rule set asks for out of the board's own metrics,
 * so the solver never learns what a cell is and the renderer and the physics cannot disagree about
 * where a hazard is.
 *
 * §5 asked for two modifiers and this file built both; the ice bands were removed with the mode that
 * was their only caller — see `game/rules.ts`'s `RULES_IDS`.
 *
 * Two rules from §5 govern everything here:
 *
 * 1. **Never in the core set.** A modifier is a mode of its own — `game/rules.ts`'s `classic` produces
 *    an empty list from this file, and the gameplay tests assert it.
 * 2. **Symmetric, so there is no unfairness.** Every hazard is placed by mirroring about the board's
 *    centre. A pit nearer one side's home rank is a pit that side loses discs to more often, and no
 *    amount of "it evens out" makes that true within a single round.
 */
import type { BoardMetrics } from '../board/layout'
import type { Pit } from '../sim/types'
import type { ChapaevRules } from './rules'

/** A pit's mouth, in cells. Smaller than a disc's diameter on purpose: it should be something a
 * player steers around rather than a hole half the board falls into. */
export const PIT_RADIUS_CELLS = 0.34

export interface Hazards {
  pits: Pit[]
}

export const NO_HAZARDS: Hazards = { pits: [] }

/**
 * Four pits, one per quadrant, mirrored about both axes.
 *
 * Two would be enough to be symmetric about the halfway line, but four is symmetric about both — so
 * neither side is punished more for shooting down one flank than the other.
 */
export function pits(metrics: BoardMetrics): Pit[] {
  const { tile, boardW, boardH } = metrics
  const r = tile * PIT_RADIUS_CELLS
  // On the corners of the middle four cells: far enough from the home ranks that no formation starts
  // beside one, close enough to the middle that every crossing shot has to consider them.
  const inset = tile * 2.5

  return [
    { x: inset, y: inset, r },
    { x: boardW - inset, y: inset, r },
    { x: inset, y: boardH - inset, r },
    { x: boardW - inset, y: boardH - inset, r },
  ]
}

/** The hazards a rule set asks for. Empty for every set that is not about them. */
export function hazardsFor(rules: ChapaevRules, metrics: BoardMetrics): Hazards {
  return {
    pits: rules.pits ? pits(metrics) : [],
  }
}
