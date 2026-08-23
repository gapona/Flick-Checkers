#!/usr/bin/env node
/**
 * Picks `src/bot/evaluate.ts`'s weights by playing them, not by arguing about them.
 *
 * Strict alternation (GAME-PLAN.md §3) changed what a shot is worth. Under the old rule a
 * knockout bought a knockout AND the next turn, so tempo was something the evaluation got for free
 * by aiming at discs. It is not free any more, and three terms follow from that:
 *
 * 1. **A shot that touches no enemy is penalised explicitly.** It used to cost nothing unless
 *    `mustTouchEnemy` was on, and casual has it off. Now it hands the opponent a turn.
 * 2. **"My disc is near an edge" matters more relative to "+3 for a knockout."** Trading evenly is
 *    worse when the trade does not also buy the board.
 * 3. **A new positional term**: how uncomfortable the board is left for the opponent, measured as
 *    the mean distance of THEIR discs to the nearest edge. Driving a disc toward the rim without
 *    taking it is now real progress rather than a wasted shot.
 *
 * The criterion is unchanged and is not negotiable: **Hard beats Easy in 90+ of 100 rounds**. If a
 * weight vector cannot do that it is wrong, however sensible it reads.
 *
 * Every candidate plays the SAME seeds from BOTH orientations, so a vector cannot win by being
 * lucky with who opened. Both sides always use the same weights — §6's rule is that difficulty is
 * noise, never a different evaluation.
 *
 * Not part of `npm test`: this is a tuning tool, and its output is a decision, not an assertion.
 * `npm run verify:bot` is what holds the decision in place afterwards.
 *
 *   node --import ./scripts/register-ts-loader.mjs scripts/tune-weights.mjs [--rounds N]
 */
import { createBoardMetrics } from '../src/board/layout.ts'
import { createSimConfig, createState } from '../src/sim/types.ts'
import { runToRest } from '../src/sim/shoot.ts'
import { infantryFormation } from '../src/game/formations.ts'
import { CLASSIC_RULES } from '../src/game/rules.ts'
import { createRound, resolveShot } from '../src/game/round.ts'
import { BOT_LEVELS } from '../src/bot/levels.ts'
import { createRandom } from '../src/bot/random.ts'
import { findShot } from '../src/bot/search.ts'

const METRICS = createBoardMetrics(8)
const SIM = createSimConfig(METRICS)
const RULES = CLASSIC_RULES
const MAX_SHOTS = 200

/**
 * The vectors on the table.
 *
 * Not a grid search: the point is to separate the three changes from each other, so each row turns
 * on one thing. A full sweep of five weights would take hours and answer a question nobody asked —
 * which vector is BEST is not the criterion, "does it clear 90" is.
 */
/** What the weights were before strict alternation — spelled out rather than spread from
 * `DEFAULT_WEIGHTS`, which now holds the CHOSEN vector and would make the baseline row a copy of the
 * answer. Every vector below lists all seven terms for the same reason: `evaluate` sums them
 * unconditionally, so a missing key is a silent `NaN`, not a default. */
const BASELINE = { knockout: 3, ownLoss: -4, nearEdge: -1, approach: 0.5, decisive: 100, penalty: -3, wasted: 0, expose: 0 }

const CANDIDATES = [
  { id: 'baseline', weights: { ...BASELINE } },
  { id: 'wasted', weights: { ...BASELINE, wasted: -2 } },
  { id: 'edge', weights: { ...BASELINE, nearEdge: -1.75 } },
  { id: 'expose', weights: { ...BASELINE, expose: 0.6 } },
  { id: 'all-mild', weights: { ...BASELINE, wasted: -2, nearEdge: -1.75, expose: 0.6 } },
  { id: 'all-firm', weights: { ...BASELINE, wasted: -3, nearEdge: -2.5, expose: 1 } },
  { id: 'all-hot', weights: { ...BASELINE, wasted: -4, nearEdge: -3.5, expose: 1.6 } },
]

/** One round, Hard against Easy, both on the same weights. */
function playRound(weights, seed, hardSide, first) {
  const state = createState(infantryFormation(METRICS, { piecesPerSide: RULES.piecesPerSide }))
  const round = createRound(first)
  const randoms = { player: createRandom(seed * 2 + 1), opponent: createRandom(seed * 2 + 2) }

  let shots = 0
  while (!round.winner && shots < MAX_SHOTS) {
    const side = round.turn
    const level = side === hardSide ? BOT_LEVELS.hard : BOT_LEVELS.easy
    const shot = findShot({ state, side, level, config: SIM, rules: RULES, random: randoms[side], weights })
    if (!shot) break
    resolveShot(round, RULES, state, METRICS, runToRest(state, SIM, { shot }))
    shots++
  }
  return { winner: round.winner, shots }
}

function evaluateVector(candidate, rounds) {
  let hardWins = 0
  let stalled = 0
  let shots = 0
  const started = Date.now()

  // Half the rounds from each orientation: Hard opens in one, Easy in the other, on the same seed.
  for (let i = 0; i < rounds / 2; i++) {
    for (const first of ['player', 'opponent']) {
      const result = playRound(candidate.weights, i + 1, 'player', first)
      shots += result.shots
      if (!result.winner) stalled++
      else if (result.winner === 'player') hardWins++
    }
  }

  return { id: candidate.id, hardWins, stalled, rounds, shotsPerRound: shots / rounds, seconds: (Date.now() - started) / 1000 }
}

const args = process.argv.slice(2)
const i = args.indexOf('--rounds')
const rounds = i === -1 ? 100 : Number(args[i + 1])
if (rounds % 2 !== 0) throw new Error('--rounds must be even: every seed is played from both orientations')

// A sweep at 100 rounds carries a standard error near 2.6 points, so it separates "passes 90" from
// "does not" and nothing finer. Picking the argmax of it would be eyeballing with extra steps —
// `--only` exists to re-run the survivors at a sample that can actually tell them apart.
const onlyAt = args.indexOf('--only')
const only = onlyAt === -1 ? null : args[onlyAt + 1].split(',')
const vectors = only ? CANDIDATES.filter((c) => only.includes(c.id)) : CANDIDATES
if (only && vectors.length !== only.length) throw new Error(`unknown vector in --only; have ${CANDIDATES.map((c) => c.id).join(', ')}`)

console.log(`tune-weights: ${vectors.length} vectors x ${rounds} rounds, Hard vs Easy\n`)
console.log('vector      hard wins   shots/rnd   sec   verdict')

for (const candidate of vectors) {
  const r = evaluateVector(candidate, rounds)
  const rate = (r.hardWins / rounds) * 100
  const verdict = rate >= 90 ? 'PASS' : 'fail'
  console.log(
    `${r.id.padEnd(11)} ${String(r.hardWins).padStart(3)}/${rounds}   ${r.shotsPerRound.toFixed(1).padStart(9)}  ${r.seconds.toFixed(0).padStart(4)}   ${verdict}${r.stalled ? `  (${r.stalled} stalled)` : ''}`,
  )
}
