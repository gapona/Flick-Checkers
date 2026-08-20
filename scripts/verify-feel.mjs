#!/usr/bin/env node
/**
 * How much of the pull actually does anything?
 *
 * `CHAPAEV-PLAN.md` §11 asks whether the friction feels right and says the question cannot be
 * answered on paper. That is true of the FEELING. It is not true of what the feeling stands on, and
 * this script measures that half: from the real opening formations, through the real solver, how
 * hard you have to pull to reach the enemy at all, and what a full-power miss costs.
 *
 * The diagnostic question and both thresholds are written into §11's "Трение: вопрос и пороги"
 * **before** any number here existed. Read that section before acting on this output.
 *
 * ## The two thresholds, and why they pull against each other
 *
 * 1. **Долёт ≤ 0.60.** The drag needed to touch the nearest enemy from the opening rank. Above
 *    this the shot is effectively binary — pull to the stop or do not fire — because everything
 *    below the threshold lands in empty board. Distance goes as the SQUARE of the pull, so this
 *    number is not the ratio of the distances; it is its square root, which is exactly why it is
 *    so much worse than it looks.
 * 2. **Наказание < 50%.** The share of full-power shots, over the bot's own ±25° aiming cone, that
 *    end with the SHOOTER off the board. Losing your own disc is Chapaev; losing it every time is
 *    not a risk, it is a rule.
 *
 * Anything that reduces reach (less speed, more friction) improves 2 and worsens 1. The one knob
 * that moves them apart is the power curve — see `sim/types.ts`'s `POWER_CURVE`.
 *
 * ## No bot, no randomness, no Phaser
 *
 * Every shot here is a straight line at a named target, so the numbers are exactly reproducible and
 * the whole thing runs in seconds. §3's first-move skew — the third threshold — is a different
 * instrument and lives in `verify:balance`; nothing here can answer it.
 *
 *   npm run verify:feel [-- --max-speed 15] [--friction 14] [--curve 0.5] [--branch infantry]
 *
 * Every override is applied from OUT HERE, so both arms of an A/B are measured by one build (§4's
 * rule) rather than by two states of the working tree.
 */
import { createBoardMetrics } from '../src/board/layout.ts'
import {
  createSimConfig,
  createState,
  liveDiscs,
  isMoving,
  CELL,
  MAX_SPEED_CELLS,
  FRICTION_DECEL_CELLS,
  POWER_CURVE,
} from '../src/sim/types.ts'
import { applyImpulse, runToRest } from '../src/sim/shoot.ts'
import { firstContact, MAX_DRAG_CELLS } from '../src/sim/aim.ts'
import { step } from '../src/sim/step.ts'
import { BRANCH_PROFILES, buildFormation, FORMATION_ORDER } from '../src/game/formations.ts'
import { CLASSIC_RULES } from '../src/game/rules.ts'

// -- arguments ----------------------------------------------------------------------------------

const args = process.argv.slice(2)
function num(name, fallback) {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = Number(args[i + 1])
  if (!Number.isFinite(v)) throw new Error(`--${name} needs a number`)
  return v
}
const MAX_SPEED_ARG = num('max-speed', MAX_SPEED_CELLS)
const FRICTION_ARG = num('friction', FRICTION_DECEL_CELLS)
const CURVE_ARG = num('curve', POWER_CURVE)
const BRANCH_I = args.indexOf('--branch')
const ONLY = BRANCH_I >= 0 ? args[BRANCH_I + 1] : null
if (ONLY && !FORMATION_ORDER.includes(ONLY)) {
  console.error(`unknown branch "${ONLY}" — have ${FORMATION_ORDER.join(', ')}`)
  process.exit(2)
}
const BRANCHES = ONLY ? [ONLY] : FORMATION_ORDER

/**
 * `--branch-friction <x>`, applied to `--branch` before anything runs — the same override
 * `verify:branches` carries, and here for the same reason.
 *
 * §11's curve measurement left exactly one branch failing (tanks, whose full reach is barely above
 * the gap it has to cross), so the candidate configuration is a global curve PLUS one branch's own
 * friction. Both arms of that A/B have to come out of one build or the comparison is between two
 * working trees.
 */
const BRANCH_FRICTION = num('branch-friction', null)
if (BRANCH_FRICTION !== null) {
  if (!ONLY) {
    console.error('--branch-friction needs --branch: it overrides one branch, not all five')
    process.exit(2)
  }
  console.log(`  !! OVERRIDE: ${ONLY} frictionScale ${BRANCH_PROFILES[ONLY].frictionScale} -> ${BRANCH_FRICTION}`)
  BRANCH_PROFILES[ONLY].frictionScale = BRANCH_FRICTION
}

const METRICS = createBoardMetrics(8)
const OVERRIDES = { maxSpeed: MAX_SPEED_ARG * CELL, frictionDecel: FRICTION_ARG * CELL, powerCurve: CURVE_ARG }
const SIM = createSimConfig(METRICS, OVERRIDES)

/** Deliberately much larger than the real board, so the free-run curve is not truncated by an edge
 * at 8 cells and every branch reported as "the same". Same trick, same reason, as
 * `verify:branches`. */
const OPEN_METRICS = createBoardMetrics(24)
const OPEN_SIM = createSimConfig(OPEN_METRICS, OVERRIDES)

/** §11's threshold 1: the pull that just reaches the nearest enemy from the opening. */
const REACH_THRESHOLD = 0.6
/** §11's threshold 2: the share of full-power shots that cost the shooter its own disc. */
const SELF_LOSS_THRESHOLD = 0.5
/** The bot's own aiming cone (`bot/search.ts`'s AIM_SPREAD). Used here as the definition of "a shot
 * a player would plausibly take": aimed at something, not fired at the compass. */
const FAN_RADIANS = (25 * Math.PI) / 180
const FAN_SAMPLES = 21

// -- helpers ------------------------------------------------------------------------------------

const cells = (units) => units / CELL
const pct = (x) => `${(x * 100).toFixed(1)}%`

function openingState(branch) {
  return createState(buildFormation(branch, METRICS, { piecesPerSide: CLASSIC_RULES.piecesPerSide }))
}

/** A cheap deep copy of one board, so a trial shot never touches the opening it was taken from. */
function copyOf(state) {
  return createState(state.discs.map((d) => ({ ...d })))
}

/**
 * The nearest enemy this disc can actually see, and the angle to it.
 *
 * Uses the real `firstContact` ray rather than plain distance: in a three-deep formation (planes)
 * the nearest enemy is often behind one of your own discs, and a "shot at it" would really be a shot
 * at your own front rank. Those discs are counted and excluded rather than silently averaged in.
 */
function clearShot(state, shooter) {
  const enemies = state.discs
    .filter((d) => d.alive && d.side !== shooter.side)
    .map((d) => ({ d, dist: Math.hypot(d.x - shooter.x, d.y - shooter.y) }))
    .sort((a, b) => a.dist - b.dist)

  for (const { d } of enemies) {
    const angle = Math.atan2(d.y - shooter.y, d.x - shooter.x)
    const contact = firstContact(state, shooter, angle, SIM)
    if (contact.discId === d.id) return { angle, target: d, distance: contact.distance }
  }
  return null
}

/**
 * The smallest power at which this shot touches an enemy, by bisection on the REAL solver.
 *
 * Monotone in power — the ray is fixed, and more speed cannot fall short of less — so the bisection
 * is exact to its own tolerance rather than a heuristic. Deliberately measured rather than inverted
 * from `reachOf`: the closed form is the thing under suspicion, and a threshold checked against the
 * formula that produced it checks nothing.
 */
function minimumPowerToReach(state, shooter, angle) {
  const touches = (power) => runToRest(copyOf(state), SIM, { shot: { discId: shooter.id, angle, power } }).touchedEnemy
  if (!touches(1)) return null
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (touches(mid)) hi = mid
    else lo = mid
  }
  return hi
}

// -- part 1: the free-run curve ------------------------------------------------------------------
//
// Descriptive, not a threshold. It is here because every number below is a consequence of it, and
// because the closed form `d = v^2/2a` stops being the whole story the moment the curve is not 1.

function freeRun(branch, power) {
  const discs = buildFormation(branch, OPEN_METRICS, { piecesPerSide: 1 })
  const disc = discs.find((d) => d.side === 'player')
  disc.x = OPEN_METRICS.boardW / 2
  disc.y = OPEN_METRICS.boardH - CELL
  const state = createState([disc])
  const startY = disc.y
  applyImpulse(disc, -Math.PI / 2, power, OPEN_SIM.maxSpeed, OPEN_SIM.powerCurve)
  let steps = 0
  while (isMoving(state) && steps < 8000) {
    step(state, OPEN_SIM)
    steps++
  }
  return cells(startY - disc.y)
}

// -- part 2: долёт --------------------------------------------------------------------------------

function reachReport(branch) {
  const state = openingState(branch)
  const mine = liveDiscs(state, 'player')
  const powers = []
  let blocked = 0
  let unreachable = 0
  let gapCells = 0

  for (const shooter of mine) {
    const shot = clearShot(state, shooter)
    if (!shot) {
      blocked++
      continue
    }
    gapCells += cells(shot.distance)
    const p = minimumPowerToReach(state, shooter, shot.angle)
    if (p === null) unreachable++
    else powers.push(p)
  }

  powers.sort((a, b) => a - b)
  const median = powers.length ? powers[Math.floor(powers.length / 2)] : NaN
  return {
    branch,
    discs: mine.length,
    blocked,
    unreachable,
    meanGap: gapCells / Math.max(1, mine.length - blocked),
    best: powers[0] ?? NaN,
    median,
    worst: powers[powers.length - 1] ?? NaN,
  }
}

// -- part 3: наказание ----------------------------------------------------------------------------

function punishmentReport(branch, power = 1) {
  const state = openingState(branch)
  const mine = liveDiscs(state, 'player')

  let shots = 0
  let shooterLost = 0
  let anyOwnLost = 0
  let enemyTaken = 0
  let touched = 0

  for (const shooter of mine) {
    const shot = clearShot(state, shooter)
    if (!shot) continue
    for (let i = 0; i < FAN_SAMPLES; i++) {
      const offset = FAN_SAMPLES === 1 ? 0 : -FAN_RADIANS + (2 * FAN_RADIANS * i) / (FAN_SAMPLES - 1)
      const outcome = runToRest(copyOf(state), SIM, { shot: { discId: shooter.id, angle: shot.angle + offset, power } })
      shots++
      if (outcome.touchedEnemy) touched++
      const lost = outcome.knockedOff
      if (lost.some((k) => k.id === shooter.id)) shooterLost++
      if (lost.some((k) => k.side === 'player')) anyOwnLost++
      if (lost.some((k) => k.side === 'opponent')) enemyTaken++
    }
  }

  return {
    branch,
    shots,
    shooterLost: shooterLost / shots,
    anyOwnLost: anyOwnLost / shots,
    enemyTaken: enemyTaken / shots,
    touched: touched / shots,
  }
}

// -- report ---------------------------------------------------------------------------------------

const overridden = MAX_SPEED_ARG !== MAX_SPEED_CELLS || FRICTION_ARG !== FRICTION_DECEL_CELLS || CURVE_ARG !== POWER_CURVE
console.log(
  `verify-feel: maxSpeed ${MAX_SPEED_ARG} cells/s, friction ${FRICTION_ARG} cells/s^2, powerCurve ${CURVE_ARG}` +
    `${overridden ? '   !! OVERRIDDEN' : '   (shipped values)'}`,
)
console.log(
  `             full-power free reach (frictionScale 1): ${((MAX_SPEED_ARG * MAX_SPEED_ARG) / (2 * FRICTION_ARG)).toFixed(2)} cells, ` +
    `board is 8, pull is ${MAX_DRAG_CELLS} cells\n`,
)

console.log('free travel in cells, by pull (open 24-cell board, real solver)')
const SAMPLE_POWERS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
console.log(`${''.padEnd(11)}${SAMPLE_POWERS.map((p) => p.toFixed(1).padStart(7)).join('')}`)
for (const branch of BRANCHES) {
  console.log(`${branch.padEnd(11)}${SAMPLE_POWERS.map((p) => freeRun(branch, p).toFixed(1).padStart(7)).join('')}`)
}

console.log('\nдолёт — the pull that just touches the nearest enemy from the opening')
console.log('branch       discs  blocked   gap(cells)     best   median    worst')
const reaches = BRANCHES.map(reachReport)
for (const r of reaches) {
  console.log(
    `${r.branch.padEnd(11)}${String(r.discs).padStart(6)}${String(r.blocked).padStart(9)}${r.meanGap.toFixed(2).padStart(13)}` +
      `${r.best.toFixed(3).padStart(9)}${r.median.toFixed(3).padStart(9)}${r.worst.toFixed(3).padStart(9)}`,
  )
}

console.log('\nнаказание — full-power shots over the bot own +/-25 degree cone')
console.log('branch       shots   shooter lost   any own lost   enemy taken   touched')
const punishments = BRANCHES.map((b) => punishmentReport(b))
for (const p of punishments) {
  console.log(
    `${p.branch.padEnd(11)}${String(p.shots).padStart(6)}${pct(p.shooterLost).padStart(15)}${pct(p.anyOwnLost).padStart(15)}` +
      `${pct(p.enemyTaken).padStart(14)}${pct(p.touched).padStart(10)}`,
  )
}

// -- verdict --------------------------------------------------------------------------------------

console.log('\nвердикт против §11')
let failed = 0
for (const r of reaches) {
  const ok = r.median <= REACH_THRESHOLD
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} - долёт ${r.branch}: median pull ${r.median.toFixed(3)} vs threshold ${REACH_THRESHOLD}`)
}
for (const p of punishments) {
  const ok = p.shooterLost < SELF_LOSS_THRESHOLD
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} - наказание ${p.branch}: shooter lost ${pct(p.shooterLost)} vs threshold ${pct(SELF_LOSS_THRESHOLD)}`)
}

console.log(`\n${failed === 0 ? 'all thresholds met' : `${failed} threshold(s) failed`}`)
process.exit(failed === 0 ? 0 : 1)
