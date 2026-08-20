/**
 * Shared fixtures for the gameplay tests.
 *
 * These run under plain `node --test` with no browser and no bundler, which is possible because
 * everything they exercise — `src/game/`, `src/sim/` — is Phaser-free by rule. See CLAUDE.md.
 */
import { createBoardMetrics, type BoardMetrics } from '../../src/board/layout'
import { createOutcome, type SimOutcome } from '../../src/sim/outcome'
import { createDisc, createSimConfig, createState, opposite, type Disc, type SimConfig, type SimState, type Side } from '../../src/sim/types'

export const METRICS: BoardMetrics = createBoardMetrics(8)

export function config(overrides: Partial<SimConfig> = {}): SimConfig {
  return createSimConfig(METRICS, overrides)
}

/** A disc at cell coordinates, so a test reads like a board position rather than like arithmetic. */
export function at(id: number, side: Side, col: number, row: number): Disc {
  return createDisc({ id, side, x: (col + 0.5) * METRICS.tile, y: (row + 0.5) * METRICS.tile })
}

export function board(...discs: Disc[]): SimState {
  return createState(discs)
}

export interface FakeShot {
  shooter?: Side
  /** Enemy discs this shot sent off the board. */
  enemyOff?: number
  /** The shooter's own discs it sent off. */
  ownOff?: number
  touchedEnemy?: boolean
}

/**
 * A hand-built `SimOutcome`.
 *
 * The flag matrix is about what the round layer DOES with a result, not about reproducing that
 * result through the physics — hand-building it states each scenario in one line and cannot fail
 * for reasons that belong to the solver. The end-to-end tests alongside use the real solver instead,
 * so both halves are covered by the kind of test that suits them.
 */
export function shotOutcome({ shooter = 'player', enemyOff = 0, ownOff = 0, touchedEnemy = enemyOff > 0 }: FakeShot = {}): SimOutcome {
  const outcome = createOutcome(0, shooter)
  outcome.touchedEnemy = touchedEnemy

  let id = 100
  for (let i = 0; i < enemyOff; i++) {
    outcome.knockedOff.push({ time: 0, id: id++, side: opposite(shooter), x: 0, y: 0, edge: 'top', vx: 0, vy: 0 })
  }
  for (let i = 0; i < ownOff; i++) {
    outcome.knockedOff.push({ time: 0, id: id++, side: shooter, x: 0, y: 0, edge: 'bottom', vx: 0, vy: 0 })
  }
  return outcome
}
