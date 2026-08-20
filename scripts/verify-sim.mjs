#!/usr/bin/env node
// Logic check for src/sim/ -- the disc solver.
//
// This is the project's single largest technical risk (CHAPAEV-PLAN.md §10: "all the risk is now in
// S2 and S5"), and the module is deliberately Phaser-free so this can run as plain assertions with
// no framework, no bundler and no browser, via the register-ts-loader.mjs +
// ts-extensionless-loader.mjs Node-native-TS setup.
//
// S2's definition of done names four properties; each has a section below, plus the traps §2 lists:
//   1. momentum is conserved
//   2. a shot stops in finite time
//   3. nothing tunnels at maximum speed
//   4. two identical runs are byte-identical
import assert from 'node:assert/strict'
import {
  CELL,
  DISC_RADIUS,
  FIXED_STEP_SECONDS,
  FRICTION_DECEL,
  MAX_SPEED,
  createDisc,
  createSimConfig,
  createState,
  cloneState,
  findDisc,
  isMoving,
} from '../src/sim/types.ts'
import { advance, createStepper, renderX, renderY, resetStepper, step } from '../src/sim/step.ts'
import { applyImpulse, runToRest } from '../src/sim/shoot.ts'
import { enemyKnockouts, involves, otherIn, ownKnockouts, peakImpact, peakImpulseOn } from '../src/sim/outcome.ts'
import { CANCEL_DISTANCE, GRAB_RADIUS_FACTOR, MAX_DRAG, MIN_POWER, computeAim, discAt, firstContact, minPowerFor, reachOf } from '../src/sim/aim.ts'
import { createBoardMetrics } from '../src/board/layout.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const BOARD = createBoardMetrics(8)

/** The real board, as the game plays it. */
function gameConfig(overrides = {}) {
  return createSimConfig(BOARD, overrides)
}

/** A board far larger than any shot can cross, for testing motion without the edge interfering.
 * Anything placed on it must sit well inside it: a disc that wanders off is a disc whose momentum
 * has legitimately left the system, which would look exactly like a conservation failure. */
function openConfig(overrides = {}) {
  return createSimConfig({ boardW: 200 * CELL, boardH: 200 * CELL }, overrides)
}

/** Middle of the open board, so a scramble has room in every direction. */
const OPEN_CENTRE = 100

/** Frictionless and perfectly elastic: the regime where conservation laws hold exactly and any
 * drift is the solver's own error rather than physics doing its job. */
function idealConfig(overrides = {}) {
  return openConfig({ frictionDecel: 0, ...overrides })
}

function disc(id, side, cellX, cellY, options = {}) {
  return createDisc({ id, side, x: cellX * CELL, y: cellY * CELL, restitution: 1, ...options })
}

function totalMomentum(state) {
  let px = 0
  let py = 0
  for (const d of state.discs) {
    if (!d.alive) continue
    px += d.mass * d.vx
    py += d.mass * d.vy
  }
  return { px, py }
}

function kineticEnergy(state) {
  let energy = 0
  for (const d of state.discs) {
    if (!d.alive) continue
    energy += 0.5 * d.mass * (d.vx * d.vx + d.vy * d.vy)
  }
  return energy
}

function stepTimes(state, config, count) {
  for (let i = 0; i < count; i++) step(state, config)
}

/**
 * A crowded 16-disc board, the shape a real round has. Deliberately not on a neat lattice: two rows
 * that line up exactly make every collision head-on and hide anything the off-axis maths gets wrong.
 *
 * `offset` shifts the whole thing, for the conservation tests — those run on the oversized open
 * board and need the formation in the middle of it rather than pressed against a corner.
 */
function breakState(offset = 0) {
  const discs = []
  let id = 0
  for (let i = 0; i < 8; i++) discs.push(disc(id++, 'player', offset + 0.5 + i * 0.95, offset + 6.9 + (i % 2) * 0.12))
  for (let i = 0; i < 8; i++) discs.push(disc(id++, 'opponent', offset + 0.62 + i * 0.95, offset + 1.1 - (i % 3) * 0.07))
  return createState(discs)
}

console.log('src/sim -- friction and finite rest')

check('a disc travels v^2/2a and stops in v/a, matching the closed form to under 1%', () => {
  // The claim §2 makes about Coulomb friction: distance and duration are predictable in closed
  // form. That is not a nicety -- it is what lets the drag length be calibrated against the board
  // by arithmetic instead of by guessing, and it is exactly what viscous drag cannot offer.
  const config = openConfig()
  const moving = disc(0, 'player', 1, 50)
  const state = createState([moving])
  applyImpulse(moving, 0, 1, config.maxSpeed)

  const startX = moving.x
  const outcome = runToRest(state, config)

  const expectedDistance = (MAX_SPEED * MAX_SPEED) / (2 * FRICTION_DECEL)
  const expectedSeconds = MAX_SPEED / FRICTION_DECEL
  const distance = moving.x - startX

  assert.equal(outcome.timedOut, false)
  assert.equal(moving.vx, 0)
  assert.equal(moving.vy, 0)
  assert.ok(
    Math.abs(distance - expectedDistance) / expectedDistance < 0.01,
    `travelled ${(distance / CELL).toFixed(3)} cells, closed form says ${(expectedDistance / CELL).toFixed(3)}`,
  )
  assert.ok(
    Math.abs(outcome.elapsed - expectedSeconds) / expectedSeconds < 0.01,
    `took ${outcome.elapsed.toFixed(4)}s, closed form says ${expectedSeconds.toFixed(4)}s`,
  )
  console.log(`    full power: ${(distance / CELL).toFixed(2)} cells in ${outcome.elapsed.toFixed(3)}s`)
})

check('friction is Coulomb, not viscous -- speed falls linearly and reaches exactly zero', () => {
  // The failure this guards against is specific: `v *= k` never reaches zero, so a disc crawls for
  // seconds after the shot is over and `runToRest` has nothing to terminate on.
  const config = openConfig()
  const moving = disc(0, 'player', 1, 50)
  const state = createState([moving])
  applyImpulse(moving, 0, 1, config.maxSpeed)

  const samples = []
  for (let i = 0; i < 4; i++) {
    stepTimes(state, config, 24)
    samples.push(moving.vx)
  }
  // Equal speed lost over equal time, which is what "constant deceleration" means.
  const drops = [samples[0] - samples[1], samples[1] - samples[2], samples[2] - samples[3]]
  for (const drop of drops) {
    assert.ok(Math.abs(drop - drops[0]) < 1e-9, `speed drops per interval must be equal, got ${drops.join(', ')}`)
  }
  assert.ok(samples[3] > 0, 'still moving after 96 steps')

  runToRest(state, config)
  assert.equal(moving.vx, 0, 'a Coulomb-damped disc must reach exactly zero, not approach it')
})

check('a whole 16-disc break comes to rest well inside the 6s ceiling', () => {
  const config = gameConfig()
  const state = breakState()
  const shooter = state.discs[3]
  // Slightly off the vertical, so the struck disc glances into its neighbours and the cascade this
  // is meant to time actually happens. A dead-straight hit just posts one disc off the far edge.
  const outcome = runToRest(state, config, { shot: { discId: shooter.id, angle: -Math.PI / 2 + 0.09, power: 1 } })

  assert.equal(outcome.timedOut, false, 'a normal break must not hit the ceiling')
  assert.equal(isMoving(state), false)
  assert.ok(outcome.elapsed < config.maxSimSeconds / 2, `break took ${outcome.elapsed.toFixed(2)}s of the ${config.maxSimSeconds}s budget`)
  console.log(`    16-disc break: ${outcome.steps} steps, ${outcome.elapsed.toFixed(3)}s, ${outcome.impacts.length} impacts, ${outcome.knockedOff.length} off`)
})

console.log('src/sim -- conservation')

check('momentum is conserved exactly through a frictionless multi-disc scramble', () => {
  const config = idealConfig()
  const state = breakState(OPEN_CENTRE)
  // Several discs moving in different directions at once, so the pass order over pairs is actually
  // exercised rather than a single tidy contact.
  applyImpulse(state.discs[0], 0.3, 1, config.maxSpeed)
  applyImpulse(state.discs[5], -1.9, 0.8, config.maxSpeed)
  applyImpulse(state.discs[9], 2.4, 0.6, config.maxSpeed)
  applyImpulse(state.discs[14], 1.1, 0.9, config.maxSpeed)

  const before = totalMomentum(state)
  // 400 steps is ~1.7s, i.e. up to 30 cells of travel from the middle of a 200-cell board — every
  // disc is still comfortably in play, so nothing can carry momentum out of the system.
  stepTimes(state, config, 400)
  const after = totalMomentum(state)

  assert.equal(
    state.discs.filter((d) => d.alive).length,
    state.discs.length,
    'the scramble must stay on the board, or "lost momentum" would just mean "a disc left"',
  )

  const scale = Math.hypot(before.px, before.py)
  assert.ok(Math.abs(after.px - before.px) / scale < 1e-12, `px drifted from ${before.px} to ${after.px}`)
  assert.ok(Math.abs(after.py - before.py) / scale < 1e-12, `py drifted from ${before.py} to ${after.py}`)
})

check('equal masses head-on swap velocities exactly', () => {
  const config = idealConfig()
  const a = disc(0, 'player', 10, 10)
  const b = disc(1, 'opponent', 12, 10)
  const state = createState([a, b])
  const speed = 6 * CELL
  a.vx = speed

  stepTimes(state, config, 200)

  assert.ok(Math.abs(a.vx) < 1e-9, `struck disc should stop, has vx=${a.vx}`)
  assert.ok(Math.abs(b.vx - speed) < 1e-9, `target should carry the full speed, has vx=${b.vx}`)
  assert.ok(Math.abs(a.vy) < 1e-9 && Math.abs(b.vy) < 1e-9, 'a head-on hit must not produce sideways motion')
})

check('a heavy disc is barely deflected by a light one, and momentum still balances', () => {
  // §4's whole content is one mass number per branch of arms, so mass has to actually do something.
  const config = idealConfig()
  const heavy = disc(0, 'player', 10, 10, { mass: 2.5 })
  const light = disc(1, 'opponent', 12, 10, { mass: 0.7 })
  const state = createState([heavy, light])
  heavy.vx = 6 * CELL

  const before = totalMomentum(state)
  stepTimes(state, config, 200)
  const after = totalMomentum(state)

  assert.ok(Math.abs(after.px - before.px) / Math.abs(before.px) < 1e-12)
  assert.ok(heavy.vx > 0, 'the heavy disc should keep going through')
  assert.ok(light.vx > heavy.vx, 'the light disc should be thrown ahead')
})

check('restitution below 1 removes energy without touching momentum', () => {
  const config = idealConfig()
  const a = createDisc({ id: 0, side: 'player', x: 10 * CELL, y: 10 * CELL })
  const b = createDisc({ id: 1, side: 'opponent', x: 12 * CELL, y: 10 * CELL })
  const state = createState([a, b])
  a.vx = 6 * CELL

  const beforeMomentum = totalMomentum(state)
  const beforeEnergy = kineticEnergy(state)
  stepTimes(state, config, 200)
  const afterMomentum = totalMomentum(state)
  const afterEnergy = kineticEnergy(state)

  assert.ok(Math.abs(afterMomentum.px - beforeMomentum.px) / Math.abs(beforeMomentum.px) < 1e-12, 'momentum must survive an inelastic hit')
  assert.ok(afterEnergy < beforeEnergy, 'an inelastic hit must lose energy')
  assert.ok(afterEnergy > beforeEnergy * 0.5, `a 0.92 restitution should lose little, lost ${(100 * (1 - afterEnergy / beforeEnergy)).toFixed(1)}%`)
})

check('a pair takes the LARGER restitution of the two -- the plane stays bouncy', () => {
  // §4 gives planes 0.98 and tanks a heavy, dead feel. Averaging would let the tank quietly damp
  // the plane's defining property away on contact.
  const config = idealConfig()
  const build = (bouncy) => {
    const a = createDisc({ id: 0, side: 'player', x: 10 * CELL, y: 10 * CELL, restitution: 0.5 })
    const b = createDisc({ id: 1, side: 'opponent', x: 12 * CELL, y: 10 * CELL, restitution: bouncy })
    const state = createState([a, b])
    a.vx = 6 * CELL
    stepTimes(state, config, 200)
    return kineticEnergy(state)
  }
  assert.ok(build(0.98) > build(0.5), 'the more elastic disc of the pair must set the outcome')
})

console.log('src/sim -- tunnelling')

check('a full-power disc never passes through a stationary one', () => {
  // The reason the step is 1/240 and not the frame rate. At 60Hz this exact setup steps clean
  // through the target -- which is the shot the game is about.
  const config = openConfig()
  const bullet = disc(0, 'player', 5, 50)
  // Two cells apart, so contact happens after ~1.2 cells of free travel — while the bullet is still
  // doing ~17 cells/s. Placing the target further away would only test a slower hit, since friction
  // caps a full-power shot at ~11.5 cells of travel in the first place.
  const target = disc(1, 'opponent', 7, 50)
  const state = createState([bullet, target])
  applyImpulse(bullet, 0, 1, config.maxSpeed)

  const targetStartX = target.x
  for (let i = 0; i < 2000 && isMoving(state); i++) {
    step(state, config)
    assert.ok(bullet.x < target.x, `bullet passed the target at step ${i}: ${bullet.x} >= ${target.x}`)
  }

  assert.ok(target.x > targetStartX, 'the target must actually have been hit')
})

check('the per-step travel at maximum speed keeps the promised margin on the radius', () => {
  // The arithmetic §2 justifies the step size with, asserted rather than believed -- so that
  // raising MAX_SPEED or shrinking the disc without revisiting the step is a failing test.
  const travel = MAX_SPEED * FIXED_STEP_SECONDS
  const ratio = (2 * DISC_RADIUS) / travel
  assert.ok(ratio >= 5, `a disc is sampled ${ratio.toFixed(1)}x across its own width; §2 promises at least 5`)
  console.log(`    ${(travel / CELL).toFixed(4)} cells per step vs a ${(2 * DISC_RADIUS) / CELL} cell disc (${ratio.toFixed(1)}x margin)`)
})

check('two discs sent into each other at full speed still collide', () => {
  // Twice the closing speed of the case above, and the true worst case for tunnelling: 0.15 cells
  // of approach per step against a 0.8-cell contact distance.
  const config = openConfig()
  const a = disc(0, 'player', 20, 50)
  const b = disc(1, 'opponent', 23, 50)
  const state = createState([a, b])
  applyImpulse(a, 0, 1, config.maxSpeed)
  applyImpulse(b, Math.PI, 1, config.maxSpeed)

  const outcome = runToRest(state, config)
  const peak = peakImpact(outcome)

  assert.ok(peak, 'a head-on approach at twice max speed must register a contact')
  assert.ok(a.x < b.x, 'the two must not swap sides')
  // The point of the test: the contact was caught at a closing speed no single disc can reach.
  assert.ok(peak.speed > 1.5 * MAX_SPEED, `closing speed at contact was only ${(peak.speed / CELL).toFixed(1)} cells/s`)
  console.log(`    caught a ${(peak.speed / CELL).toFixed(1)} cells/s closing contact`)
})

console.log('src/sim -- determinism')

check('two runs of the same break are byte-identical', () => {
  // What §6's bot, §7's solvability proof and any future replay all rest on. Nothing in src/sim/
  // may read a clock or a random number, and the pair traversal order is fixed by disc id.
  const config = gameConfig()
  const shot = { discId: 2, angle: -Math.PI / 2 + 0.11, power: 0.83 }

  const runOnce = () => {
    const state = breakState()
    const outcome = runToRest(state, config, { shot })
    return JSON.stringify({ state, outcome })
  }

  assert.equal(runOnce(), runOnce())
})

check('a cloned state runs identically to the original and leaves it untouched', () => {
  // The bot's inner loop: score a candidate on a copy, keep the real board pristine.
  const config = gameConfig()
  const shot = { discId: 5, angle: -1.3, power: 0.9 }

  const original = breakState()
  const snapshot = JSON.stringify(original)

  const copyA = cloneState(original)
  const copyB = cloneState(original)
  const outcomeA = runToRest(copyA, config, { shot })
  const outcomeB = runToRest(copyB, config, { shot })

  assert.equal(JSON.stringify(copyA), JSON.stringify(copyB))
  assert.equal(JSON.stringify(outcomeA), JSON.stringify(outcomeB))
  assert.equal(JSON.stringify(original), snapshot, 'running a clone must not touch the original board')
})

check('the same elapsed time produces the same steps at 60Hz, 120Hz and 240Hz', () => {
  // §2's trap 3, and the same property `ui/scrollMomentum.ts` needed: a frame-rate-dependent
  // simulation is a bug that cannot be seen on the machine it was written on.
  const config = gameConfig()

  const runAt = (hz) => {
    const state = breakState()
    applyImpulse(state.discs[2], -Math.PI / 2, 0.7, config.maxSpeed)
    const stepper = createStepper()
    for (let i = 0; i < hz; i++) advance(stepper, state, config, 1 / hz)
    return { steps: stepper.steps, state }
  }

  const at60 = runAt(60)
  const at120 = runAt(120)
  const at240 = runAt(240)

  assert.equal(at60.steps, 240, `one second must be 240 fixed steps, got ${at60.steps}`)
  assert.equal(at120.steps, at60.steps)
  assert.equal(at240.steps, at60.steps)

  for (let i = 0; i < at60.state.discs.length; i++) {
    for (const axis of ['x', 'y', 'vx', 'vy']) {
      assert.ok(Math.abs(at60.state.discs[i][axis] - at120.state.discs[i][axis]) < 1e-9, `disc ${i}.${axis} diverged between 60Hz and 120Hz`)
      assert.ok(Math.abs(at60.state.discs[i][axis] - at240.state.discs[i][axis]) < 1e-9, `disc ${i}.${axis} diverged between 60Hz and 240Hz`)
    }
  }
})

check('a huge frame delta is clamped instead of spiralling', () => {
  const config = gameConfig()
  const state = breakState()
  applyImpulse(state.discs[0], 0, 0.5, config.maxSpeed)
  const stepper = createStepper()
  const taken = advance(stepper, state, config, 30)
  assert.ok(taken <= Math.ceil(0.25 / FIXED_STEP_SECONDS), `a 30s delta must not run ${taken} steps in one frame`)
})

console.log('src/sim -- aiming (§3)')

check('the disc travels AWAY from the finger -- it is a slingshot, not a joystick', () => {
  // The easiest mistake in the whole chunk, and one that produces a game which is playable but
  // feels inside-out. Pull the finger BELOW the disc and the disc must go UP the board.
  const shooter = disc(0, 'player', 4, 6)
  const aim = computeAim(shooter, shooter.x, shooter.y + 2 * CELL)
  assert.ok(Math.abs(aim.angle - -Math.PI / 2) < 1e-9, `pulling down should shoot up, got ${aim.angle}`)

  const right = computeAim(shooter, shooter.x - 2 * CELL, shooter.y)
  assert.ok(Math.abs(right.angle) < 1e-9, 'pulling left should shoot right')
})

check('power is the pull length against the cap, and never exceeds 1', () => {
  const shooter = disc(0, 'player', 4, 4)
  const half = computeAim(shooter, shooter.x, shooter.y + MAX_DRAG / 2)
  assert.ok(Math.abs(half.power - 0.5) < 1e-9, `half a pull should be half power, got ${half.power}`)

  const full = computeAim(shooter, shooter.x, shooter.y + MAX_DRAG)
  assert.equal(full.power, 1)

  // Pulling past the cap is a perfectly sensible gesture and must read as "as hard as possible".
  const past = computeAim(shooter, shooter.x, shooter.y + MAX_DRAG * 3)
  assert.equal(past.power, 1)
  assert.ok(past.drag > MAX_DRAG, 'the raw pull is still reported, so a view can show the overshoot')
})

check('returning the finger to the disc cancels, and cancelling is the same rule as power', () => {
  // §3's cancel. Not a special case anywhere -- it is the low end of the power scale, which is what
  // makes it visible for the whole time it applies.
  const shooter = disc(0, 'player', 4, 4)
  assert.equal(computeAim(shooter, shooter.x, shooter.y).cancelled, true, 'no pull at all must cancel')
  assert.equal(computeAim(shooter, shooter.x, shooter.y + CANCEL_DISTANCE * 0.5).cancelled, true)
  assert.equal(computeAim(shooter, shooter.x, shooter.y + CANCEL_DISTANCE * 1.5).cancelled, false)

  // The cancel is a DISTANCE and the power fraction is derived from it, so tuning the drag length
  // — §11's first open question, and the number most likely to move — must not drag the cancel
  // radius along with it. Previously the two agreed only by coincidence.
  for (const drag of [MAX_DRAG * 0.5, MAX_DRAG, MAX_DRAG * 3]) {
    const minPower = minPowerFor(drag)
    assert.equal(computeAim(shooter, shooter.x, shooter.y + CANCEL_DISTANCE * 0.9, drag, minPower).cancelled, true, 'still cancelled just inside')
    assert.equal(computeAim(shooter, shooter.x, shooter.y + CANCEL_DISTANCE * 1.1, drag, minPower).cancelled, false, 'still fires just outside')
  }
  assert.ok(Math.abs(MIN_POWER - minPowerFor(MAX_DRAG)) < 1e-12, 'MIN_POWER is derived, not authored')
  // Zero drag has no direction; it must still produce a usable number rather than NaN.
  assert.ok(Number.isFinite(computeAim(shooter, shooter.x, shooter.y).angle))
})

check('the grab gate accepts only your own live discs, nearest first', () => {
  // §2's trap 4: with the whole board a drag surface, this is the only thing separating an aim from
  // an idle tap.
  const mine = disc(0, 'player', 4, 6)
  const theirs = disc(1, 'opponent', 4, 1)
  const dead = disc(2, 'player', 6, 6)
  dead.alive = false
  const state = createState([mine, theirs, dead])

  assert.equal(discAt(state, mine.x, mine.y, 'player'), mine)
  assert.equal(discAt(state, theirs.x, theirs.y, 'player'), null, 'an enemy disc is not yours to shoot')
  assert.equal(discAt(state, dead.x, dead.y, 'player'), null, 'a disc already off the board cannot be grabbed')
  assert.equal(discAt(state, 2 * CELL, 4 * CELL, 'player'), null, 'empty board is not a grab')

  // Reach: a press out to GRAB_RADIUS_FACTOR of a disc's own radius counts, and no further.
  assert.equal(discAt(state, mine.x + mine.r * (GRAB_RADIUS_FACTOR - 0.1), mine.y, 'player'), mine)
  assert.equal(discAt(state, mine.x + mine.r * (GRAB_RADIUS_FACTOR + 0.1), mine.y, 'player'), null)

  /**
   * The real invariant, over several layouts.
   *
   * **Not "the grab regions never overlap"** — an earlier version asserted that, and it was only
   * true of the opening. Discs come to rest touching all the time; at a centre distance of 2r the
   * half-gap is one radius and any factor above 1.0 overlaps. Overlap is the normal case.
   *
   * What must hold instead is that overlap resolves the same way every time: the NEAREST
   * qualifying disc wins, and the answer does not depend on the order the discs happen to sit in
   * the array. The expectation is computed here by an independent brute force rather than by
   * calling the thing under test.
   */
  const r = DISC_RADIUS / CELL
  const layouts = [
    {
      name: 'opening rank, one cell apart',
      discs: Array.from({ length: 8 }, (_, i) => disc(i, 'player', i + 1, 7)),
    },
    {
      name: 'a clump of four touching discs',
      // Centres exactly 2r apart: the case the opening-only proof did not cover.
      discs: [
        disc(0, 'player', 4, 4),
        disc(1, 'player', 4 + 2 * r, 4),
        disc(2, 'player', 4, 4 + 2 * r),
        disc(3, 'player', 4 + 2 * r, 4 + 2 * r),
      ],
    },
    {
      name: 'a pair at 2.1 radii',
      discs: [disc(0, 'player', 3, 3), disc(1, 'player', 3 + 2.1 * r, 3)],
    },
  ]

  const nearestByHand = (discs, x, y) => {
    let best = null
    let bestD = Number.POSITIVE_INFINITY
    for (const d of discs) {
      if (!d.alive || d.side !== 'player') continue
      const distance = Math.hypot(x - d.x, y - d.y)
      if (distance > d.r * GRAB_RADIUS_FACTOR) continue
      if (distance < bestD) {
        bestD = distance
        best = d
      }
    }
    return best
  }

  for (const layout of layouts) {
    const forward = createState(layout.discs)
    const reversed = createState([...layout.discs].reverse())

    // A grid over the layout's bounding box plus a margin, so points inside one region, inside
    // two, and outside every region are all sampled.
    const xs = layout.discs.map((d) => d.x)
    const ys = layout.discs.map((d) => d.y)
    const pad = DISC_RADIUS * 2
    let sampled = 0
    let hits = 0
    for (let x = Math.min(...xs) - pad; x <= Math.max(...xs) + pad; x += DISC_RADIUS / 3) {
      for (let y = Math.min(...ys) - pad; y <= Math.max(...ys) + pad; y += DISC_RADIUS / 3) {
        const expected = nearestByHand(layout.discs, x, y)
        const got = discAt(forward, x, y, 'player')
        assert.equal(got?.id ?? null, expected?.id ?? null, `${layout.name}: nearest wins at ${x},${y}`)
        assert.equal(
          discAt(reversed, x, y, 'player')?.id ?? null,
          expected?.id ?? null,
          `${layout.name}: the answer does not depend on array order at ${x},${y}`,
        )
        sampled++
        if (expected) hits++
      }
    }
    // A layout where nothing was ever grabbed would pass every assertion above vacuously.
    assert.ok(hits > 0 && hits < sampled, `${layout.name}: the sample covers both hits and misses`)
    console.log(`    ${layout.name}: ${sampled} points, ${hits} grabbed`)
  }

  // An enemy or a dead disc does not participate even when it is strictly closer than a live one
  // of ours — the gate is about ownership first and distance second.
  // `createDisc` always returns a LIVE disc — `alive` is not one of its options, because a disc
  // is born on the board. Killing it afterwards is how the rest of the sim does it too.
  const deadOne = disc(2, 'player', 4 + 0.4 * r, 4)
  deadOne.alive = false
  const contested = createState([disc(0, 'player', 4, 4), disc(1, 'opponent', 4 + 0.2 * r, 4), deadOne])
  const nearEnemy = contested.discs[1]
  assert.equal(discAt(contested, nearEnemy.x, nearEnemy.y, 'player')?.id, 0, 'a closer enemy disc is not grabbed')
  assert.equal(discAt(contested, deadOne.x, deadOne.y, 'player')?.id, 0, 'a closer dead disc is not grabbed')

  // Two discs whose slop circles overlap must resolve to the closer one, not to array order.
  const near = disc(3, 'player', 4, 6)
  const far = disc(4, 'player', 4.9, 6)
  const pair = createState([near, far])
  assert.equal(discAt(pair, 4.6 * CELL, 6 * CELL, 'player'), far)
  assert.equal(discAt(pair, 4.3 * CELL, 6 * CELL, 'player'), near)
})

check('reachOf matches the distance the solver actually travels', () => {
  // The aim line ends where the shot runs out, so this number has to agree with the solver or the
  // preview lies. Checked against a real run rather than against the formula it came from.
  const config = openConfig()
  for (const power of [0.4, 0.7, 1]) {
    const shooter = disc(0, 'player', 5, 50)
    const state = createState([shooter])
    const startX = shooter.x
    runToRest(state, config, { shot: { discId: 0, angle: 0, power } })

    const predicted = reachOf(power, config, shooter)
    const actual = shooter.x - startX
    assert.ok(Math.abs(predicted - actual) / predicted < 0.01, `power ${power}: predicted ${predicted.toFixed(1)}, travelled ${actual.toFixed(1)}`)
  }
})

check('firstContact finds the disc in the way, and ignores the ones that are not', () => {
  const config = gameConfig()
  const shooter = disc(0, 'player', 4, 6)
  const target = disc(1, 'opponent', 4, 2)
  const behind = disc(2, 'opponent', 4, 7)
  const aside = disc(3, 'opponent', 1, 2)
  const state = createState([shooter, target, behind, aside])

  const up = firstContact(state, shooter, -Math.PI / 2, config)
  assert.equal(up.discId, 1, 'the disc straight ahead should be the contact')
  // Contact is rim-to-rim, so the shooter's centre stops one diameter short of the target's centre.
  assert.ok(Math.abs(up.distance - (Math.abs(target.y - shooter.y) - shooter.r - target.r)) < 1e-9)
  assert.ok(Math.abs(up.y - (shooter.y - up.distance)) < 1e-9)

  const sideways = firstContact(state, shooter, 0, config)
  assert.equal(sideways.discId, null, 'nothing to the right, so the board edge is the contact')
  assert.ok(Math.abs(sideways.x - config.boardW) < 1e-9, 'without bumpers the ray ends where the CENTRE leaves')
})

check('firstContact skips discs already off the board', () => {
  const config = gameConfig()
  const shooter = disc(0, 'player', 4, 6)
  const ghost = disc(1, 'opponent', 4, 4)
  const real = disc(2, 'opponent', 4, 2)
  ghost.alive = false
  const state = createState([shooter, ghost, real])

  assert.equal(firstContact(state, shooter, -Math.PI / 2, config).discId, 2, 'a disc out of play cannot be aimed at')
})

check('with bumperRim the ray stops at the wall, not at the centre line', () => {
  // The same asymmetry the solver uses: a bouncing disc turns when its EDGE meets the rim, a
  // falling one leaves when its CENTRE crosses. The preview must not disagree with what happens.
  const shooter = disc(0, 'player', 4, 4)
  const state = createState([shooter])

  const open = firstContact(state, shooter, 0, gameConfig())
  const bumper = firstContact(state, shooter, 0, gameConfig({ bumperRim: true }))

  assert.ok(Math.abs(open.x - gameConfig().boardW) < 1e-9)
  assert.ok(Math.abs(bumper.x - (gameConfig().boardW - shooter.r)) < 1e-9)
  assert.ok(bumper.distance < open.distance)
})

check('the aim preview agrees with what the shot then does', () => {
  // The claim the whole preview rests on: if the line says it reaches that disc, the shot hits that
  // disc. Run the prediction, then run the shot, and compare.
  const config = gameConfig()
  const shooter = disc(0, 'player', 4, 6)
  const target = disc(1, 'opponent', 4, 2)
  const state = createState([shooter, target])

  const aim = computeAim(shooter, shooter.x, shooter.y + MAX_DRAG)
  const contact = firstContact(state, shooter, aim.angle, config)
  const reaches = contact.distance <= reachOf(aim.power, config, shooter)
  assert.equal(reaches, true, 'a full-power pull at a disc four cells away should reach it')

  const outcome = runToRest(state, config, { shot: { discId: 0, angle: aim.angle, power: aim.power } })
  assert.ok(outcome.impacts.length > 0, 'the preview promised a contact, so there must be one')
  // Checked through `involves`, not by reading `.b`: the pair is stored in the solver's traversal
  // order, so which field holds the target depends on the ids. Asserting `.b === target` passes for
  // a low-id shooter and fails for a high-id one, which is exactly the bug this guards against.
  assert.ok(involves(outcome.impacts[0], 0), 'the shooter must be in its own first contact')
  assert.ok(involves(outcome.impacts[0], contact.discId), 'and so must the disc the preview named')
  assert.equal(otherIn(outcome.impacts[0], 0), contact.discId)
})

check('an impact names its pair in array order, not shooter-then-target', () => {
  // The footgun `outcome.ts` documents, pinned down so S6 cannot rediscover it the hard way: fire
  // from the HIGHER id and the shooter lands in `b`.
  const config = gameConfig()
  const target = disc(0, 'opponent', 4, 2)
  const shooter = disc(1, 'player', 4, 6)
  const state = createState([target, shooter])

  const outcome = runToRest(state, config, { shot: { discId: 1, angle: -Math.PI / 2, power: 1 } })
  const [impact] = outcome.impacts
  assert.ok(impact, 'the shot should connect')
  assert.equal(impact.a, 0, 'a is simply the earlier disc in the array')
  assert.equal(impact.b, 1, 'so the shooter ended up in b')
  assert.equal(otherIn(impact, 1), 0, 'which is precisely why callers use otherIn')
})

check('a shot too weak to reach its target is predicted to fall short', () => {
  const config = gameConfig()
  const shooter = disc(0, 'player', 4, 7)
  const target = disc(1, 'opponent', 4, 0.5)
  const state = createState([shooter, target])

  const aim = computeAim(shooter, shooter.x, shooter.y + MAX_DRAG * 0.25)
  const contact = firstContact(state, shooter, aim.angle, config)
  const reach = reachOf(aim.power, config, shooter)
  assert.ok(reach < contact.distance, 'a quarter-power pull must not be predicted to cross the board')

  const outcome = runToRest(state, config, { shot: { discId: 0, angle: aim.angle, power: aim.power } })
  assert.equal(outcome.impacts.length, 0, 'and the shot must in fact fall short')
})

console.log('src/sim -- render cadence (§2, trap 3)')

/**
 * Plays one shot at a given display refresh rate and reports how the drawn position behaves
 * against the raw solver position.
 *
 * `stalled` counts frames where the value did not move at all; `jerk` is the mean frame-to-frame
 * change in APPARENT speed, relative to the mean speed — which is what judder actually is. A disc
 * decelerating smoothly has a small jerk; one that lurches has a large one.
 */
function cadence(hz, steps = 90) {
  const config = openConfig()
  const disc = createDisc({ id: 0, side: 'player', x: 5 * CELL, y: 50 * CELL })
  const state = createState([disc])
  applyImpulse(disc, 0, 0.8, config.maxSpeed)

  const stepper = createStepper()
  const dt = 1 / hz
  const drawn = []
  const raw = []

  for (let i = 0; i < steps && isMoving(state); i++) {
    advance(stepper, state, config, dt)
    drawn.push(renderX(disc, stepper.alpha))
    raw.push(disc.x)
  }

  const analyse = (series) => {
    let stalled = 0
    const speeds = []
    for (let i = 1; i < series.length; i++) {
      const delta = Math.abs(series[i] - series[i - 1])
      if (delta < 1e-9) stalled++
      speeds.push(delta / dt)
    }
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length
    const jerk = speeds.slice(1).reduce((total, v, i) => total + Math.abs(v - speeds[i]), 0) / (speeds.length - 1)
    return { stalled, jerk: jerk / mean }
  }

  return { frames: drawn.length, drawn: analyse(drawn), raw: analyse(raw) }
}

check('at a refresh rate that is not a divisor of 240Hz, the raw solver position judders', () => {
  // The bug this is all about, demonstrated first so the fix below means something. At 144Hz the
  // solver owes 1.667 steps per frame, so frames alternate between one step of travel and two: the
  // disc visibly lurches even though the physics is perfect.
  const { raw } = cadence(144)
  assert.ok(raw.jerk > 0.25, `raw apparent speed should swing wildly, relative jerk was only ${raw.jerk.toFixed(3)}`)
})

check('the interpolated position is smooth at 120Hz, 144Hz and 165Hz', () => {
  // §2's trap 3 and S3's acceptance criterion. 120 is an exact divisor and would be smooth either
  // way; 144 and 165 are the rates real high-refresh phones and monitors actually run at, and they
  // are where an un-interpolated 240Hz state falls apart.
  for (const hz of [120, 144, 165]) {
    const { frames, drawn, raw } = cadence(hz)
    assert.ok(frames > 40, `${hz}Hz produced only ${frames} frames of shot`)
    assert.equal(drawn.stalled, 0, `${hz}Hz: the drawn position stalled on ${drawn.stalled} frames`)
    assert.ok(drawn.jerk < 0.02, `${hz}Hz: drawn relative jerk ${drawn.jerk.toFixed(4)} should be near zero`)
    assert.ok(drawn.jerk < raw.jerk || raw.jerk < 0.02, `${hz}Hz: interpolation must not be worse than raw`)
    console.log(`    ${hz}Hz: drawn jerk ${drawn.jerk.toFixed(4)} vs raw ${raw.jerk.toFixed(4)}, ${drawn.stalled} stalled frames vs ${raw.stalled}`)
  }
})

check('alpha stays in [0, 1) while stepping, so a drawn position is never extrapolated', () => {
  const config = openConfig()
  const disc = createDisc({ id: 0, side: 'player', x: 5 * CELL, y: 50 * CELL })
  const state = createState([disc])
  applyImpulse(disc, 0, 1, config.maxSpeed)

  const stepper = createStepper()
  for (let i = 0; i < 200 && isMoving(state); i++) {
    advance(stepper, state, config, 1 / 144)
    assert.ok(stepper.alpha >= 0 && stepper.alpha < 1, `alpha escaped its range: ${stepper.alpha}`)
  }
})

check('resetStepper puts the drawing back exactly on the solver', () => {
  // What `scenes/Game.ts` does the moment the board comes to rest. Without it the leftover fraction
  // of a step is kept, and every disc is drawn fractionally short of where the solver says it is —
  // which is the position aiming, the bot and the save all read.
  const config = openConfig()
  const disc = createDisc({ id: 0, side: 'player', x: 5 * CELL, y: 50 * CELL })
  const state = createState([disc])
  applyImpulse(disc, 0, 0.5, config.maxSpeed)

  const stepper = createStepper()
  // Stopped mid-flight at a rate that is not a divisor of 240Hz, so there is definitely a partial
  // step left over — the state `Game.update()` is in on the frame a shot comes to rest.
  for (let i = 0; i < 25; i++) advance(stepper, state, config, 1 / 144)

  assert.ok(stepper.alpha > 0 && stepper.alpha < 1, `expected a partial step, alpha was ${stepper.alpha}`)
  assert.notEqual(renderX(disc, stepper.alpha), disc.x, 'mid-step, the drawn position is meant to lag the solver')

  resetStepper(stepper)
  assert.equal(stepper.alpha, 1)
  assert.equal(renderX(disc, stepper.alpha), disc.x, 'after the reset the two must agree exactly')
})

console.log('src/sim -- leaving the board (§2, trap 1)')

check('a disc leaves the moment its CENTRE crosses, within one step of the edge', () => {
  const config = gameConfig()
  const runner = disc(0, 'player', 1, 4)
  const state = createState([runner])
  applyImpulse(runner, 0, 1, config.maxSpeed)

  const outcome = runToRest(state, config)

  assert.equal(outcome.knockedOff.length, 1)
  const [off] = outcome.knockedOff
  assert.equal(off.edge, 'right')
  assert.equal(off.side, 'player')
  assert.equal(runner.alive, false)

  const oneStep = MAX_SPEED * FIXED_STEP_SECONDS
  assert.ok(off.x - config.boardW <= oneStep + 1e-9, `left the board ${(off.x - config.boardW).toFixed(3)} units past the edge, one step is ${oneStep.toFixed(3)}`)
  assert.ok(off.x >= config.boardW, 'the centre must actually have crossed')
})

check('a disc is still in play while half of it hangs over the edge', () => {
  const config = gameConfig()
  const hanging = createDisc({ id: 0, side: 'player', x: config.boardW - 1, y: 4 * CELL })
  const state = createState([hanging])
  step(state, config)
  assert.equal(hanging.alive, true, 'only the centre crossing takes a disc out of play')
})

check('a disc that has left exerts no further impulse', () => {
  // The bug trap 1 exists to prevent: a disc that already fell off knocking a live one away.
  const config = gameConfig()
  const ghost = createDisc({ id: 0, side: 'opponent', x: 4 * CELL, y: 4 * CELL, vx: 10 * CELL })
  const live = createDisc({ id: 1, side: 'player', x: 4 * CELL + DISC_RADIUS, y: 4 * CELL })
  ghost.alive = false
  const state = createState([ghost, live])

  const before = { x: live.x, y: live.y, vx: live.vx, vy: live.vy }
  stepTimes(state, config, 10)

  assert.deepEqual({ x: live.x, y: live.y, vx: live.vx, vy: live.vy }, before, 'an out-of-play disc overlapping a live one must do nothing at all')
})

check('an off-board disc keeps its velocity, for the renderer to throw it with', () => {
  const config = gameConfig()
  const runner = disc(0, 'player', 7, 4)
  const state = createState([runner])
  applyImpulse(runner, 0, 1, config.maxSpeed)
  const outcome = runToRest(state, config)

  assert.ok(outcome.knockedOff[0].vx > 0, 'the fall animation needs the speed it left with')
  assert.equal(isMoving(state), false, 'but a shot must not be held open by a disc already out of play')
})

console.log('src/sim -- bumper rim (§5)')

check('with bumperRim the disc turns at the wall and nothing is ever knocked off', () => {
  const config = gameConfig({ bumperRim: true })
  const runner = disc(0, 'player', 4, 4)
  const state = createState([runner])
  applyImpulse(runner, 0, 1, config.maxSpeed)

  const outcome = runToRest(state, config)

  assert.equal(outcome.knockedOff.length, 0, 'a bumper board loses no discs')
  assert.equal(runner.alive, true)
  assert.ok(runner.x <= config.boardW - runner.r + 1e-9, 'the disc must stay inside the wall')
  assert.ok(outcome.impacts.some((impact) => impact.b === null), 'a rim contact should be recorded like any other impact')
})

check('a rim bounce turns the disc at the rim restitution and loses no more than that', () => {
  const config = gameConfig({ bumperRim: true, frictionDecel: 0 })
  const runner = disc(0, 'player', 4, 4)
  const state = createState([runner])
  const speed = 8 * CELL
  runner.vx = speed

  for (let i = 0; i < 2000 && runner.vx > 0; i++) step(state, config)

  assert.ok(runner.vx < 0, 'the disc must have turned')
  assert.ok(Math.abs(-runner.vx - speed * config.rimRestitution) < 1e-9, `expected ${speed * config.rimRestitution}, got ${-runner.vx}`)
})

console.log('src/sim -- overlap, outcome, interpolation')

check('overlapping discs are separated, split by inverse mass', () => {
  const config = gameConfig()
  const heavy = createDisc({ id: 0, side: 'player', x: 4 * CELL, y: 4 * CELL, mass: 3 })
  const light = createDisc({ id: 1, side: 'opponent', x: 4 * CELL + DISC_RADIUS, y: 4 * CELL, mass: 1 })
  const state = createState([heavy, light])

  const heavyStart = heavy.x
  const lightStart = light.x
  step(state, config)

  const gap = Math.hypot(light.x - heavy.x, light.y - heavy.y)
  assert.ok(gap >= heavy.r + light.r - 1e-6, `discs still overlap after a step: ${gap} < ${heavy.r + light.r}`)
  assert.ok(Math.abs(light.x - lightStart) > Math.abs(heavy.x - heavyStart), 'the lighter disc should give way more')
})

check('the outcome answers the questions §3 and §5 ask of it', () => {
  const config = gameConfig()
  const shooter = disc(0, 'player', 4, 6)
  const victim = disc(1, 'opponent', 4, 1)
  const state = createState([shooter, victim])

  const outcome = runToRest(state, config, { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })

  assert.equal(outcome.shooterId, 0)
  assert.equal(outcome.shooterSide, 'player')
  assert.equal(outcome.touchedEnemy, true, 'mustTouchEnemy has to be answerable')
  assert.equal(enemyKnockouts(outcome), 1)
  assert.equal(ownKnockouts(outcome), 0)
  assert.ok(outcome.impacts.length >= 1)
  assert.ok(peakImpulseOn(outcome, 1) > 0, 'the struck disc must record an impulse, for §8 stack splitting')

  for (let i = 1; i < outcome.impacts.length; i++) {
    assert.ok(outcome.impacts[i].time >= outcome.impacts[i - 1].time, 'impacts must stay in the order they happened -- §5 trick shots read it')
  }
})

check('a shot that touches nothing reports touchedEnemy false', () => {
  const config = gameConfig()
  const shooter = disc(0, 'player', 1, 6)
  const bystander = disc(1, 'opponent', 7, 1)
  const state = createState([shooter, bystander])

  const outcome = runToRest(state, config, { shot: { discId: 0, angle: -Math.PI / 2, power: 0.35 } })

  assert.equal(outcome.touchedEnemy, false)
  assert.equal(outcome.impacts.length, 0)
})

check('a ricochet off your own disc into an enemy still counts as touching an enemy', () => {
  // §3's mustTouchEnemy must not punish a bank shot, which is the skilful version of the same move.
  const config = gameConfig()
  const shooter = disc(0, 'player', 4, 6)
  const own = disc(1, 'player', 4, 4)
  const enemy = disc(2, 'opponent', 4, 2)
  const state = createState([shooter, own, enemy])

  const outcome = runToRest(state, config, { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })

  assert.ok(outcome.impacts.length >= 2, 'the chain should be shooter->own->enemy')
  assert.equal(outcome.impacts[0].b, 1, 'the first contact is with the shooter’s own disc')
  assert.equal(outcome.touchedEnemy, true)
})

check('impact strength rises with shot power -- §9 scales the hit sound by it', () => {
  const config = gameConfig()
  const strengths = [0.4, 0.7, 1].map((power) => {
    const state = createState([disc(0, 'player', 4, 6), disc(1, 'opponent', 4, 3.5)])
    const outcome = runToRest(state, config, { shot: { discId: 0, angle: -Math.PI / 2, power } })
    const peak = peakImpact(outcome)
    assert.ok(peak, `power ${power} produced no contact at all`)
    return peak.impulse
  })

  assert.ok(strengths[1] > strengths[0] && strengths[2] > strengths[1], `impulses must rise with power, got ${strengths.join(', ')}`)
})

check('render position interpolates between the two steps around it', () => {
  const config = gameConfig()
  const moving = disc(0, 'player', 4, 4)
  const state = createState([moving])
  applyImpulse(moving, 0.4, 1, config.maxSpeed)
  step(state, config)

  assert.equal(renderX(moving, 0), moving.prevX)
  assert.equal(renderY(moving, 0), moving.prevY)
  assert.equal(renderX(moving, 1), moving.x)
  assert.equal(renderY(moving, 1), moving.y)
  assert.ok(Math.abs(renderX(moving, 0.5) - (moving.prevX + moving.x) / 2) < 1e-12)
})

console.log('src/sim -- failure modes')

check('a world that cannot come to rest times out loudly and is frozen, not left drifting', () => {
  // Frictionless and perfectly elastic inside walls: it never stops on its own. §2 asks this to
  // fail loudly; it does so by reporting, not by throwing -- a solver bug must not become a white
  // screen in a player's session.
  const config = gameConfig({ bumperRim: true, frictionDecel: 0, rimRestitution: 1 })
  const runner = disc(0, 'player', 4, 4, { restitution: 1 })
  const state = createState([runner])
  applyImpulse(runner, 0.3, 1, config.maxSpeed)

  let reported = null
  const outcome = runToRest(state, config, { onTimeout: (o) => (reported = o) })

  assert.equal(outcome.timedOut, true)
  assert.equal(reported, outcome, 'the caller has to be told, so it can reach platform health metrics')
  assert.ok(outcome.elapsed >= config.maxSimSeconds, 'it should have used the whole budget first')
  assert.equal(isMoving(state), false, 'the board must be left in a state the round can continue from')
})

check('a shot aimed at a disc that is already gone is a no-op, not a crash', () => {
  const config = gameConfig()
  const state = createState([disc(0, 'player', 4, 4)])
  state.discs[0].alive = false

  const outcome = runToRest(state, config, { shot: { discId: 0, angle: 0, power: 1 } })
  assert.equal(outcome.shooterId, null)
  assert.equal(outcome.steps, 0)

  const missing = runToRest(createState([]), config, { shot: { discId: 99, angle: 0, power: 1 } })
  assert.equal(missing.shooterId, null)
})

check('power is clamped to 0..1 rather than rejected', () => {
  // A drag past the cap is a perfectly sensible gesture and must read as "as hard as possible".
  const config = gameConfig()
  const over = disc(0, 'player', 4, 4)
  applyImpulse(over, 0, 5, config.maxSpeed)
  assert.ok(Math.abs(over.vx - config.maxSpeed) < 1e-9)

  const under = disc(1, 'player', 4, 4)
  applyImpulse(under, 0, -3, config.maxSpeed)
  assert.equal(under.vx, 0)
  assert.equal(under.vy, 0)
})

check('discs placed exactly touching do not shove each other apart before anyone shoots', () => {
  // A formation generator lays discs out on exact contact; a solver that "corrects" that overlap
  // would rearrange the board during the opening frame.
  const config = gameConfig()
  const a = createDisc({ id: 0, side: 'player', x: 3 * CELL, y: 4 * CELL })
  const b = createDisc({ id: 1, side: 'player', x: 3 * CELL + 2 * DISC_RADIUS, y: 4 * CELL })
  const state = createState([a, b])

  stepTimes(state, config, 60)

  assert.equal(a.vx, 0)
  assert.equal(b.vx, 0)
  assert.ok(Math.abs(b.x - (3 * CELL + 2 * DISC_RADIUS)) < 1e-9, 'a touching pair must stay put')
})

check('two discs at exactly the same point separate deterministically instead of producing NaN', () => {
  const config = gameConfig()
  const a = createDisc({ id: 0, side: 'player', x: 4 * CELL, y: 4 * CELL })
  const b = createDisc({ id: 1, side: 'opponent', x: 4 * CELL, y: 4 * CELL })
  const state = createState([a, b])

  step(state, config)

  for (const d of state.discs) {
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y), 'a degenerate contact must not produce NaN')
  }
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 0, 'they must be pushed apart')
})

check('findDisc and the live-disc helpers agree with the alive flag', () => {
  const config = gameConfig()
  const state = breakState()
  runToRest(state, config, { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })

  for (const d of state.discs) {
    assert.equal(findDisc(state, d.id), d)
  }
  const alive = state.discs.filter((d) => d.alive).length
  assert.equal(alive, state.discs.length - state.discs.filter((d) => !d.alive).length)
})

console.log(`${passed} checks passed`)
