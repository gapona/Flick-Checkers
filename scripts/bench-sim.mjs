#!/usr/bin/env node
// How long one `runToRest()` costs on a full 16-disc board.
//
// GAME-PLAN.md §11, item 2, asks for this number BEFORE S7 and says why: the bot (§6) and the
// daily-puzzle generator (§7) are both "run this a few hundred times", so whether either is
// affordable is entirely a function of this measurement. §6 estimates ~0.2s for a 600-candidate
// Hard search from a paper count of ~35M pair checks. That estimate is what this replaces.
//
// Deliberately NOT part of `npm test`: a timing is not a pass/fail assertion, and a machine having
// a bad afternoon should not fail a build. Run it by hand (`npm run bench:sim`) when the solver
// changes, and again on a real phone-class device before S7 commits to a candidate count.
import { CELL, createDisc, createSimConfig, createState, cloneState } from '../src/sim/types.ts'
import { runToRest } from '../src/sim/shoot.ts'
import { createBoardMetrics } from '../src/board/layout.ts'

const BOARD = createBoardMetrics(8)
const CONFIG = createSimConfig(BOARD)

/** The same crowded 16-disc board `verify-sim.mjs` uses, and the shape a real round has. */
function breakState() {
  const discs = []
  let id = 0
  for (let i = 0; i < 8; i++) discs.push(createDisc({ id: id++, side: 'player', x: (0.5 + i * 0.95) * CELL, y: (6.9 + (i % 2) * 0.12) * CELL }))
  for (let i = 0; i < 8; i++) discs.push(createDisc({ id: id++, side: 'opponent', x: (0.62 + i * 0.95) * CELL, y: (1.1 - (i % 3) * 0.07) * CELL }))
  return createState(discs)
}

/** A spread of shots rather than one repeated: a shot into open space settles in a fraction of the
 * steps a full cascade needs, and the bot's candidate list is mostly the former. Averaging over a
 * fan is the honest number to plan a search budget against. */
function candidates(count) {
  const shots = []
  for (let i = 0; i < count; i++) {
    shots.push({
      discId: i % 8,
      // Fanned across the half-circle facing the opponent, the way §6 says candidates are generated
      // (aimed at the enemy ±25°, not uniformly around the compass).
      angle: -Math.PI / 2 + (((i * 7919) % 101) / 100 - 0.5) * 0.9,
      power: 0.4 + (((i * 6271) % 61) / 60) * 0.6,
    })
  }
  return shots
}

function bench(label, count) {
  const template = breakState()
  const shots = candidates(count)

  // Warm-up, so the measurement is of the steady state rather than of the JIT.
  for (let i = 0; i < Math.min(count, 200); i++) runToRest(cloneState(template), CONFIG, { shot: shots[i % shots.length] })

  let steps = 0
  let impacts = 0
  let timedOut = 0
  const start = performance.now()
  for (let i = 0; i < count; i++) {
    const outcome = runToRest(cloneState(template), CONFIG, { shot: shots[i] })
    steps += outcome.steps
    impacts += outcome.impacts.length
    if (outcome.timedOut) timedOut++
  }
  const elapsed = performance.now() - start

  const per = elapsed / count
  console.log(
    `${label.padEnd(22)} ${elapsed.toFixed(1).padStart(8)}ms total  ${per.toFixed(3).padStart(7)}ms per shot  ` +
      `${(steps / count).toFixed(0).padStart(4)} steps avg  ${(impacts / count).toFixed(1).padStart(5)} impacts avg` +
      (timedOut ? `  ${timedOut} TIMED OUT` : ''),
  )
  return per
}

console.log(`node ${process.version}, 16 discs on an ${BOARD.size}x${BOARD.size} board, ${(1 / (1 / 240)).toFixed(0)}Hz fixed step\n`)

bench('1 shot', 1)
bench('60 candidates (Easy)', 60)
bench('200 candidates (Medium)', 200)
const perShot = bench('600 candidates (Hard)', 600)

// §6 requires the Hard search to be sliced across frames at a ~8ms budget rather than run in one
// go. That is a requirement about total work, so the useful readout is how many candidates fit in
// one slice — which is what S7 will actually code against.
const FRAME_BUDGET_MS = 8
console.log(
  `\nAt ${FRAME_BUDGET_MS}ms per frame: ~${Math.max(1, Math.floor(FRAME_BUDGET_MS / perShot))} candidates per slice, ` +
    `so a 600-candidate Hard search spans ~${Math.ceil((600 * perShot) / FRAME_BUDGET_MS)} frames ` +
    `(~${((600 * perShot) / 1000).toFixed(2)}s of thinking).`,
)
console.log('This is a desktop number. Re-measure on a phone-class device before S7 fixes the candidate counts.')
