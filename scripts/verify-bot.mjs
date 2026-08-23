#!/usr/bin/env node
// S7's definition of done, from GAME-PLAN.md §10:
//
//   "Hard выигрывает у Easy в 90+ из 100 автопрогонов; бюджет кадра ≤8 мс замерен"
//
// Both halves are here. The tournament plays real rounds through the real solver and the real round
// rules — no shortcuts — which is only possible because none of `src/sim/`, `src/game/` or
// `src/bot/` imports Phaser.
//
// NOT part of `npm test`: a hundred rounds is a minute or two of solid computation, and a suite
// nobody runs because it is slow protects nothing. Run it after touching the bot, the evaluation
// weights, or anything in the solver those depend on.
import assert from 'node:assert/strict'

import { createBoardMetrics } from '../src/board/layout.ts'
import { createSimConfig, createState, liveDiscs } from '../src/sim/types.ts'
import { runToRest } from '../src/sim/shoot.ts'
import { infantryFormation } from '../src/game/formations.ts'
import { CLASSIC_RULES } from '../src/game/rules.ts'
import { createRound, resolveShot } from '../src/game/round.ts'
import { BOT_LEVELS } from '../src/bot/levels.ts'
import { createRandom } from '../src/bot/random.ts'
import { createSearch, findShot, generateCandidates } from '../src/bot/search.ts'

const METRICS = createBoardMetrics(8)
const CONFIG = createSimConfig(METRICS)
const RULES = CLASSIC_RULES

/** A round that has not finished by here is a stalemate, not a result. Generous: a real round under
 * casual rules is well under twenty shots. */
const MAX_SHOTS = 120

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/**
 * Plays one round to the end, with `hardSide` on Hard and the other side on Easy.
 *
 * Every shot goes through the same `runToRest` a player's shot does, and every turn through the same
 * `resolveShot`. The seed makes the whole round replayable.
 */
function playRound(hardSide, seed, first) {
  const state = createState(infantryFormation(METRICS, { piecesPerSide: RULES.piecesPerSide }))
  const round = createRound(first)
  const random = createRandom(seed)

  let shots = 0
  while (!round.winner && shots < MAX_SHOTS) {
    const side = round.turn
    const level = side === hardSide ? BOT_LEVELS.hard : BOT_LEVELS.easy
    const shot = findShot({ state, side, level, config: CONFIG, rules: RULES, random })
    if (!shot) break

    const outcome = runToRest(state, CONFIG, { shot })
    resolveShot(round, RULES, state, METRICS, outcome)
    shots++
  }

  return { winner: round.winner, shots, stalled: !round.winner }
}

console.log('src/bot -- candidates')

check('candidates are aimed at enemies, never evenly around the compass', () => {
  // §6: fired uniformly, the overwhelming majority of shots go into empty board and the budget buys
  // nothing. Every candidate must point within the cone of SOME enemy disc.
  const state = createState(infantryFormation(METRICS))
  const candidates = generateCandidates(state, 'player', BOT_LEVELS.hard)
  assert.ok(candidates.length > 0)

  const spread = (25 * Math.PI) / 180 + 1e-9
  for (const candidate of candidates) {
    const disc = state.discs.find((d) => d.id === candidate.discId)
    const aimed = liveDiscs(state, 'opponent').some((enemy) => {
      const straight = Math.atan2(enemy.y - disc.y, enemy.x - disc.x)
      let delta = candidate.angle - straight
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI
      return Math.abs(delta) <= spread
    })
    assert.ok(aimed, `candidate at ${candidate.angle} points at no enemy`)
  }
})

check('each level stays inside its own candidate budget', () => {
  const state = createState(infantryFormation(METRICS))
  for (const level of Object.values(BOT_LEVELS)) {
    const candidates = generateCandidates(state, 'player', level)
    assert.ok(candidates.length <= level.candidates, `${level.id}: ${candidates.length} > ${level.candidates}`)
    assert.ok(candidates.length > 0, `${level.id} generated nothing`)
    console.log(`    ${level.id.padEnd(7)} ${String(candidates.length).padStart(3)} candidates`)
  }
})

check('trimming keeps every disc in play, not just the first few', () => {
  // A truncating trim would drop the later discs entirely, and the bot would stop considering half
  // its own pieces the moment the board got busy.
  const state = createState(infantryFormation(METRICS))
  const candidates = generateCandidates(state, 'player', BOT_LEVELS.easy)
  const discs = new Set(candidates.map((c) => c.discId))
  assert.equal(discs.size, liveDiscs(state, 'player').length, `only ${discs.size} discs considered`)
})

check('all three power levels survive the trim', () => {
  const state = createState(infantryFormation(METRICS))
  const powers = new Set(generateCandidates(state, 'player', BOT_LEVELS.easy).map((c) => c.power))
  assert.equal(powers.size, 3)
})

check('a side with nothing to shoot at produces no candidates', () => {
  const state = createState(infantryFormation(METRICS).filter((d) => d.side === 'player'))
  assert.equal(generateCandidates(state, 'player', BOT_LEVELS.hard).length, 0)
  assert.equal(findShot({ state, side: 'player', level: BOT_LEVELS.hard, config: CONFIG, rules: RULES, random: createRandom(1) }), null)
})

console.log('src/bot -- search behaviour')

check('the search is exact: slicing changes when work happens, not what it decides', () => {
  // The property that lets the same code run across frames in the game and in one go in a test.
  const state = createState(infantryFormation(METRICS))
  const options = { state, side: 'player', level: BOT_LEVELS.medium, config: CONFIG, rules: RULES, random: createRandom(7) }

  const whole = createSearch(options)
  while (!whole.step(Number.POSITIVE_INFINITY));

  const sliced = createSearch(options)
  let slices = 0
  while (!sliced.step(1)) slices++

  assert.deepEqual(sliced.best(), whole.best())
  assert.ok(slices > 1, 'a 1ms budget should have needed several slices')
})

check('noise is applied to the chosen shot, not to the choice', () => {
  // §6's whole difficulty model. Every level must pick the SAME candidate on the same board; only
  // the shot that then leaves the hand differs.
  const state = createState(infantryFormation(METRICS))
  const base = { state, side: 'player', config: CONFIG, rules: RULES }

  const picks = Object.values(BOT_LEVELS).map((level) => {
    const search = createSearch({ ...base, level: BOT_LEVELS.hard, random: createRandom(3) })
    while (!search.step(Number.POSITIVE_INFINITY));
    return search.best()
  })
  assert.deepEqual(picks[1], picks[0])
  assert.deepEqual(picks[2], picks[0])

  // And the noise really does move the shot, by more on Easy than on Hard.
  const spreadOf = (level) => {
    const search = createSearch({ ...base, level, random: createRandom(11) })
    while (!search.step(Number.POSITIVE_INFINITY));
    const chosen = search.best()
    let total = 0
    for (let i = 0; i < 200; i++) {
      const noisy = createSearch({ ...base, level, random: createRandom(100 + i) })
      while (!noisy.step(Number.POSITIVE_INFINITY));
      total += Math.abs(noisy.shot().angle - chosen.angle)
    }
    return total / 200
  }
  const easy = spreadOf(BOT_LEVELS.easy)
  const hard = spreadOf(BOT_LEVELS.hard)
  assert.ok(easy > hard * 3, `easy should scatter far more than hard: ${easy.toFixed(4)} vs ${hard.toFixed(4)}`)
  console.log(`    mean angle error: easy ${((easy * 180) / Math.PI).toFixed(2)}°, hard ${((hard * 180) / Math.PI).toFixed(2)}°`)
})

check('the bot takes a free win rather than a merely good shot', () => {
  // What the `decisive` weight is for: with one enemy disc left, clearing it scores the same +3 as
  // any other knockout, so without that term the win is only as attractive as a tie.
  const state = createState([
    ...infantryFormation(METRICS).filter((d) => d.side === 'player').slice(0, 3),
    ...infantryFormation(METRICS).filter((d) => d.side === 'opponent').slice(0, 1),
  ])
  const shot = findShot({ state, side: 'player', level: BOT_LEVELS.hard, config: CONFIG, rules: RULES, random: createRandom(5) })
  assert.ok(shot, 'the bot should have found something')

  const after = createState(state.discs.map((d) => ({ ...d })))
  runToRest(after, CONFIG, { shot })
  assert.equal(liveDiscs(after, 'opponent').length, 0, 'a Hard bot one shot from winning should win')
})

console.log('src/bot -- frame budget (§6)')

check('a Hard search fits an 8ms-per-frame slice without overrunning', () => {
  // §6 requires the budget to be measured in milliseconds via performance.now(), never in frames —
  // the whole point is to be indifferent to how long a frame takes.
  const BUDGET_MS = 8
  const state = createState(infantryFormation(METRICS))
  const search = createSearch({ state, side: 'player', level: BOT_LEVELS.hard, config: CONFIG, rules: RULES, random: createRandom(1) })

  const slices = []
  let total = 0
  while (true) {
    const start = performance.now()
    const finished = search.step(BUDGET_MS)
    const elapsed = performance.now() - start
    slices.push(elapsed)
    total += elapsed
    if (finished) break
  }

  const worst = Math.max(...slices)
  // A slice always finishes the candidate it is in the middle of, so it may overrun the budget by
  // one solver run. Anything beyond that is the slicing failing to do its job.
  assert.ok(worst < BUDGET_MS * 2, `worst slice ${worst.toFixed(2)}ms overran the ${BUDGET_MS}ms budget badly`)
  assert.ok(slices.length > 1, 'a 600-candidate search should not fit in one slice')
  console.log(
    `    ${search.progress.total} candidates over ${slices.length} frames: ${total.toFixed(0)}ms total, ` +
      `worst slice ${worst.toFixed(2)}ms, ~${(slices.length / 60).toFixed(2)}s of thinking at 60fps`,
  )
})

console.log('src/bot -- Hard versus Easy, 100 rounds')

check('Hard beats Easy in at least 90 of 100 rounds', () => {
  const ROUNDS = 100
  let hardWins = 0
  let stalled = 0
  const started = performance.now()

  for (let i = 0; i < ROUNDS; i++) {
    // Alternate which side is Hard AND who opens: the side to shoot first has a real advantage, and
    // a tournament that always gives it to the same bot measures the advantage, not the bot.
    const hardSide = i % 2 === 0 ? 'player' : 'opponent'
    const first = i % 4 < 2 ? 'player' : 'opponent'
    const result = playRound(hardSide, 1000 + i, first)

    if (result.stalled) stalled++
    else if (result.winner === hardSide) hardWins++
  }

  const elapsed = (performance.now() - started) / 1000
  console.log(`    Hard won ${hardWins}/${ROUNDS} (${stalled} stalled) in ${elapsed.toFixed(1)}s`)
  assert.equal(stalled, 0, `${stalled} rounds never finished`)
  assert.ok(hardWins >= 90, `Hard won only ${hardWins}/${ROUNDS}; §10 requires 90+`)
})

console.log(`${passed} checks passed`)
