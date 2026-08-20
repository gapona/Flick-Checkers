/**
 * Every shipped rule set must be finishable.
 *
 * **This exists because one was not.** `bumper` shipped with `bumperRim: true` and `pits: false`,
 * and those two together mean no disc can ever leave the board: a disc is removed only when its
 * centre crosses the edge or enters a pit, and a bouncing rim guarantees the first never happens
 * while `pits: false` removes the second. Measured at the time: six rounds of Hard against Hard,
 * **zero finished**, all six ran to the shot ceiling, and **not one disc was removed in any of
 * them**. Every other set finishes in about ten shots.
 *
 * The defect was invisible to the whole existing suite, which tests flags one at a time — and it is
 * a COMBINATION of two flags that has no sink. So this test is deliberately not about flags at all:
 * it plays each set and asks the only question that matters about a mode, which is whether it can
 * be won.
 *
 * It is a real self-play round through the real bot and the real solver, not a scripted board,
 * because "can this be finished" is a question about the whole system. That costs a few seconds per
 * set, which is why the shot ceiling is low and the sample is one seed: this is a smoke test for an
 * absolute (finishable at all), not a balance measurement — `verify:branches` and `verify:balance`
 * are where the shades of grey live.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ALL_RULE_SETS, getRuleSet, type RulesId } from '../../src/game/rules'
import { buildFormation } from '../../src/game/formations'
import { hazardsFor } from '../../src/game/hazards'
import { createRound, resolveShot } from '../../src/game/round'
import { createSimConfig, createState } from '../../src/sim/types'
import { runToRest } from '../../src/sim/shoot'
import { BOT_LEVELS } from '../../src/bot/levels'
import { createRandom } from '../../src/bot/random'
import { findShot } from '../../src/bot/search'
import { METRICS } from './helpers'

/** Generous: the slowest legitimate set (`bumper`, which has to bank into a hole) averages about
 * nineteen shots, and a set that cannot finish runs forever rather than merely long. */
const SHOT_CEILING = 90

interface Played {
  winner: string | null
  shots: number
  removed: number
}

function playRound(id: RulesId): Played {
  const rules = getRuleSet(id)
  const config = createSimConfig(METRICS, { bumperRim: rules.bumperRim, ...hazardsFor(rules, METRICS) })
  const state = createState(buildFormation(rules.formation, METRICS, { piecesPerSide: rules.piecesPerSide }))
  const round = createRound('player')
  const random = { player: createRandom(11), opponent: createRandom(12) }

  let shots = 0
  let removed = 0
  while (!round.winner && shots < SHOT_CEILING) {
    const side = round.turn
    const shot = findShot({ state, side, level: BOT_LEVELS.hard, config, rules, random: random[side] })
    if (!shot) break
    const outcome = runToRest(state, config, { shot })
    resolveShot(round, rules, state, METRICS, outcome)
    removed += outcome.knockedOff.length
    shots++
  }

  return { winner: round.winner, shots, removed }
}

describe('every shipped rule set can be finished', () => {
  for (const set of ALL_RULE_SETS) {
    test(`${set.id} produces a winner`, () => {
      const played = playRound(set.id)
      assert.ok(
        played.winner !== null,
        `${set.id} did not finish in ${SHOT_CEILING} shots (${played.removed} discs removed) — ` +
          `a mode with no way to take a disc off the board cannot be won`,
      )
    })
  }

  test('a bouncing rim always has a sink, or nothing can ever leave', () => {
    // The invariant behind the bug, stated where a future rule set will trip over it: if the edge
    // cannot take a disc then something else must, and `pits` is the only other thing that can.
    for (const set of ALL_RULE_SETS) {
      if (!set.bumperRim) continue
      assert.ok(set.pits, `${set.id} bounces off the rim but has no pits — no disc could ever leave the board`)
    }
  })
})
