#!/usr/bin/env node
// S11's definition of done, from CHAPAEV-PLAN.md §10:
//
//   "the script generates 30 days and proves each one solvable"
//
// It does exactly that, and "proves" is meant literally: for every date it generates the puzzle,
// then re-runs every candidate shot through the real solver and confirms at least one clears the
// board — and that not too many do, because §7 rejects a trivial puzzle as firmly as an impossible
// one.
//
// NOT part of `npm test`: a month of dates is a few hundred thousand solver runs. Run it when the
// generator, the solver or the bot's candidate generation changes — all three can turn a proved
// puzzle into an unsolvable one.
import assert from 'node:assert/strict'

import { BOT_LEVELS } from '../src/bot/levels.ts'
import { createBoardMetrics } from '../src/board/layout.ts'
import { runToRest } from '../src/sim/shoot.ts'
import { cloneState, createState, liveDiscs } from '../src/sim/types.ts'
import { generateCandidates } from '../src/bot/search.ts'
import {
  DAILY_BOARD_SIZE,
  DAILY_TARGETS,
  MAX_SOLUTION_SHARE,
  MIN_SOLUTION_SHARE,
  dailyConfig,
  dateKey,
  generateDaily,
  seedForDate,
} from '../src/daily/puzzle.ts'

const DAYS = 30
const METRICS = createBoardMetrics(DAILY_BOARD_SIZE)
const CONFIG = dailyConfig(METRICS)
// Hard is the setting the proof runs at, per §7 — the puzzle has to be solvable by the finest search
// the game contains, or "solvable" is a claim about a search nobody uses.
const LEVEL = BOT_LEVELS.hard

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** Independently re-derives whether a puzzle is solvable, without trusting what the generator said. */
function proveSolvable(puzzle) {
  const state = createState(puzzle.discs.map((d) => ({ ...d })))
  const candidates = generateCandidates(state, 'player', LEVEL)

  let solutions = 0
  let firstSolution = null
  for (const candidate of candidates) {
    const trial = cloneState(state)
    runToRest(trial, CONFIG, { shot: candidate })
    if (liveDiscs(trial, 'opponent').length === 0) {
      solutions++
      if (!firstSolution) firstSolution = candidate
    }
  }

  return { solutions, candidates: candidates.length, firstSolution }
}

console.log('src/daily -- the date is the whole input')

check('the same date always gives the same seed, and different dates do not', () => {
  // §7's puzzle is generated from the date on every device, with nothing transmitted and nothing
  // stored. That only works if this is a pure function of the string.
  assert.equal(seedForDate('2026-08-15'), seedForDate('2026-08-15'))
  assert.notEqual(seedForDate('2026-08-15'), seedForDate('2026-08-16'))
  assert.notEqual(seedForDate('2026-08-15'), seedForDate('2025-08-15'))
})

check('the day turns over in UTC, not wherever the player happens to be', () => {
  // Two players in different time zones on different puzzles cannot discuss the day's puzzle, which
  // is most of the point of having one.
  assert.equal(dateKey(new Date('2026-08-15T00:00:01Z')), '2026-08-15')
  assert.equal(dateKey(new Date('2026-08-15T23:59:59Z')), '2026-08-15')
  assert.equal(dateKey(new Date('2026-08-16T00:00:00Z')), '2026-08-16')
})

check('generating the same date twice gives an identical board', () => {
  const a = generateDaily('2026-09-01', LEVEL, METRICS)
  const b = generateDaily('2026-09-01', LEVEL, METRICS)
  assert.ok(a, 'the date produced no puzzle at all')
  assert.equal(JSON.stringify(a.discs), JSON.stringify(b?.discs))
  assert.equal(a.seed, b?.seed)
})

console.log(`src/daily -- ${DAYS} days, each proved`)

check(`every one of ${DAYS} consecutive days has a puzzle with a proved one-shot solution`, () => {
  const started = performance.now()
  const shares = []
  let hardest = { date: null, solutions: Infinity }

  for (let day = 0; day < DAYS; day++) {
    const date = dateKey(new Date(Date.UTC(2026, 8, 1 + day)))
    const puzzle = generateDaily(date, LEVEL, METRICS)
    assert.ok(puzzle, `${date}: the generator gave up without producing a puzzle`)

    assert.equal(puzzle.discs.filter((d) => d.side === 'opponent').length, DAILY_TARGETS, `${date}: wrong number of targets`)
    assert.equal(puzzle.discs.filter((d) => d.side === 'player').length, 1, `${date}: a one-shot puzzle needs exactly one shooter`)

    // The proof, re-derived rather than taken from the generator's own report.
    const proof = proveSolvable(puzzle)
    assert.ok(proof.solutions > 0, `${date}: NO shot clears the board — the puzzle is impossible`)

    const share = proof.solutions / proof.candidates
    assert.ok(share <= MAX_SOLUTION_SHARE, `${date}: ${(share * 100).toFixed(1)}% of shots solve it — trivial (§7 allows ${MAX_SOLUTION_SHARE * 100}%)`)
    // The floor is not §7's; see MIN_SOLUTION_SHARE for why it had to be added.
    assert.ok(share >= MIN_SOLUTION_SHARE, `${date}: only ${proof.solutions}/${proof.candidates} shots solve it — nobody will ever find that`)
    shares.push(share)

    if (proof.solutions < hardest.solutions) hardest = { date, solutions: proof.solutions }

    // And the solution really does what it claims, played out one more time on its own.
    const replay = createState(puzzle.discs.map((d) => ({ ...d })))
    runToRest(replay, CONFIG, { shot: proof.firstSolution })
    assert.equal(liveDiscs(replay, 'opponent').length, 0, `${date}: the "solution" did not actually clear the board`)
  }

  const mean = shares.reduce((a, b) => a + b, 0) / shares.length
  console.log(
    `    ${DAYS}/${DAYS} proved in ${((performance.now() - started) / 1000).toFixed(1)}s — ` +
      `mean ${(mean * 100).toFixed(1)}% of shots solve, tightest was ${hardest.date} with ${hardest.solutions}`,
  )
})

check('a puzzle nobody can solve would be caught, not shipped', () => {
  // The guard has to fail on a board it cannot clear, or the proof above proves nothing. Three
  // targets tucked into a corner behind each other, with the shooter facing the wrong way down the
  // board, is not clearable in one shot.
  const tile = METRICS.tile
  const state = createState([
    { ...{}, ...createStub(0, 'player', tile * 0.5, tile * 7.5) },
    createStub(1, 'opponent', tile * 0.5, tile * 0.5),
    createStub(2, 'opponent', tile * 7.5, tile * 0.5),
    createStub(3, 'opponent', tile * 7.5, tile * 3.5),
  ])

  const proof = proveSolvable({ discs: state.discs })
  assert.equal(proof.solutions, 0, 'this board should not be clearable in one shot')
})

function createStub(id, side, x, y) {
  return {
    id,
    side,
    kind: 'single',
    x,
    y,
    vx: 0,
    vy: 0,
    prevX: x,
    prevY: y,
    r: 25.6,
    mass: 1,
    invMass: 1,
    frictionScale: 1,
    restitution: 0.92,
    splitImpulse: 0,
    alive: true,
  }
}

console.log(`${passed} checks passed`)
