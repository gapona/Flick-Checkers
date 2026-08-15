#!/usr/bin/env node
// Logic check for src/ui/scrollMomentum.ts -- the flick-momentum physics shared by any
// scrollable list/strip a game builds on top of scrollableCameraRegion() (velocity-from-
// samples, frame-rate-independent decay, soft edge stop). Plain assertions, no framework,
// via the register-ts-loader.mjs + ts-extensionless-loader.mjs Node-native-TS setup.
import assert from 'node:assert/strict'
import { createScrollMomentumState, pushDragSample, computeReleaseVelocity, stepMomentum } from '../src/ui/scrollMomentum.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

console.log('src/ui/scrollMomentum.ts checks')

check('computeReleaseVelocity: 0 with fewer than 2 samples', () => {
  const state = createScrollMomentumState()
  assert.equal(computeReleaseVelocity(state), 0)
  pushDragSample(state, 100, 1000)
  assert.equal(computeReleaseVelocity(state), 0)
})

check('computeReleaseVelocity: (last.pos - first.pos) / (last.time - first.time) across the retained samples', () => {
  const state = createScrollMomentumState()
  pushDragSample(state, 0, 0)
  pushDragSample(state, 50, 10)
  pushDragSample(state, 120, 20)
  // Only the last 3 samples are retained (VELOCITY_SAMPLE_COUNT) -- here all 3 pushed fit,
  // so velocity spans the full 0->120 over 0->20.
  assert.equal(computeReleaseVelocity(state), (120 - 0) / (20 - 0))
})

check('pushDragSample: only the most recent 3 samples are retained', () => {
  const state = createScrollMomentumState()
  pushDragSample(state, 0, 0)
  pushDragSample(state, 10, 10)
  pushDragSample(state, 20, 20)
  pushDragSample(state, 1000, 30) // pushes the (0,0) sample out
  assert.equal(state.samples.length, 3)
  assert.equal(computeReleaseVelocity(state), (1000 - 10) / (30 - 10))
})

check('computeReleaseVelocity: 0 if the retained samples span zero time (defensive against a divide-by-zero)', () => {
  const state = createScrollMomentumState()
  pushDragSample(state, 0, 5)
  pushDragSample(state, 40, 5)
  assert.equal(computeReleaseVelocity(state), 0)
})

check('stepMomentum: a no-op (returns position unchanged) once velocity is already 0', () => {
  const state = createScrollMomentumState()
  const result = stepMomentum(state, 500, 16.667, 0, 1000, 0)
  assert.equal(result, 500)
})

check('stepMomentum: in-bounds fling decays velocity and advances position by the EXACT integral of the decaying velocity (not a plain velocity*delta Euler step)', () => {
  const state = createScrollMomentumState()
  state.velocity = 1 // px/ms
  const delta = 1000 / 60 // exactly one reference (60fps) frame
  const before = state.velocity
  const next = stepMomentum(state, 100, delta, 0, 10000, 0)
  const decayFactor = 0.95 // exactly one reference frame's worth of decay
  const decayRatePerMs = -Math.log(0.95) / (1000 / 60)
  const expectedDistance = (before * (1 - decayFactor)) / decayRatePerMs
  assert.ok(Math.abs(next - 100 - expectedDistance) < 1e-9, `expected distance ~${expectedDistance}, got ${next - 100}`)
  // A plain Euler step would have been exactly `before * delta` (~16.667) -- the exact
  // integral must land measurably short of that, since velocity was decaying the whole way.
  assert.ok(next - 100 < before * delta, 'exact integral must be less than the naive Euler distance for a decaying velocity')
  // Decayed by the per-reference-frame factor (0.95) after exactly one reference frame.
  assert.ok(Math.abs(state.velocity - before * 0.95) < 1e-9, `expected ~${before * 0.95}, got ${state.velocity}`)
})

check('stepMomentum: frame-rate independence -- two half-length ticks decay velocity the same total amount as one full tick', () => {
  const full = 1000 / 60 // one 60Hz frame
  const half = full / 2 // one 120Hz frame

  const oneTick = createScrollMomentumState()
  oneTick.velocity = 2
  stepMomentum(oneTick, 0, full, -1e9, 1e9, 0)

  const twoTicks = createScrollMomentumState()
  twoTicks.velocity = 2
  stepMomentum(twoTicks, 0, half, -1e9, 1e9, 0)
  stepMomentum(twoTicks, 0, half, -1e9, 1e9, half)

  assert.ok(Math.abs(oneTick.velocity - twoTicks.velocity) < 1e-9, `60Hz velocity ${oneTick.velocity} should match 120Hz-equivalent velocity ${twoTicks.velocity}`)
})

check('stepMomentum: velocity below the stop threshold snaps to exactly 0', () => {
  const state = createScrollMomentumState()
  state.velocity = 0.031 // just above MIN_VELOCITY_PX_PER_MS (0.03)
  stepMomentum(state, 0, 16.667, -1e9, 1e9, 0)
  assert.ok(state.velocity < 0.031) // decayed at least a little
  // Run it down across several frames -- it must reach exactly 0, never asymptote forever.
  let position = 0
  for (let i = 0; i < 50 && state.velocity !== 0; i++) {
    position = stepMomentum(state, position, 16.667, -1e9, 1e9, i * 16.667)
  }
  assert.equal(state.velocity, 0)
})

check('stepMomentum: position never exceeds the given bounds, even the very first out-of-bounds frame', () => {
  const state = createScrollMomentumState()
  state.velocity = 5 // fast enough to overshoot the bound in one frame
  const next = stepMomentum(state, 995, 16.667, 0, 1000, 0)
  assert.ok(next <= 1000, `position ${next} exceeded max bound 1000`)
})

check('stepMomentum: soft edge stop ramps velocity to 0 over ~EDGE_STOP_MS, not an instant stop', () => {
  const state = createScrollMomentumState()
  state.velocity = 5
  // First frame carries it out of bounds -- edge-stop STARTS here (t=0 within the ramp), so
  // velocity is captured but not yet reduced; position is still clamped immediately.
  const firstStop = stepMomentum(state, 995, 16.667, 0, 1000, 0)
  assert.equal(state.velocity, 5, 'velocity should be captured, unreduced, on the very first edge-stop frame (t=0 of the ramp)')
  assert.ok(firstStop <= 1000, 'position must already be clamped on the first edge-stop frame')

  // Halfway through the EDGE_STOP_MS window, velocity should be roughly half its starting value.
  stepMomentum(state, firstStop, 16.667, 0, 1000, 50)
  assert.ok(state.velocity > 0 && state.velocity < 5, `expected a partial ramp-down, got ${state.velocity}`)

  // After the full EDGE_STOP_MS window has elapsed, velocity must reach exactly 0.
  stepMomentum(state, 1000, 16.667, 0, 1000, 100)
  assert.equal(state.velocity, 0)
})

check('stepMomentum: edge-stop velocity ramp never reverses sign (no spring/bounce-back)', () => {
  const state = createScrollMomentumState()
  state.velocity = 5
  let position = 995
  for (let i = 0; i < 20; i++) {
    position = stepMomentum(state, position, 16.667, 0, 1000, i * 16.667)
    assert.ok(state.velocity >= 0, `velocity went negative (${state.velocity}) -- that would read as a bounce-back`)
    assert.ok(position <= 1000, `position ${position} overshot the bound`)
  }
})

check('drag-sample timestamps must come from the real event clock, not a frame-locked one -- a synthetic 60Hz-vs-120Hz trajectory replay', () => {
  // Regression test for a real bug this module was written to prevent: a scene's
  // pointermove handler using its own scene/frame clock (which only advances once per
  // `update()` step) as the drag-sample timestamp instead of the pointer event's own real
  // timestamp. Multiple raw pointermove events landing within the same step (more likely at
  // a high input-sampling rate, or whenever a step runs long) would then all get stamped
  // with one identical clock value, corrupting computeReleaseVelocity()'s dt in a way that
  // depends on how the render/step rate lines up with the input rate.
  //
  // A steady real-world drag, sampled at a realistic (irregular, like a real touch
  // digitizer) ~3-8ms cadence, constant real velocity of exactly 2 px/ms -- the correct
  // release velocity is unambiguous, so any discrepancy is easy to see. Irregular spacing
  // (rather than a spacing that happens to divide evenly into 60Hz/120Hz frame periods) is
  // deliberate: real touch events never line up neatly with a render clock's grid, and a
  // too-regular trajectory can accidentally cancel out the very bucketing error this test
  // exists to catch.
  const REAL_VELOCITY = 2 // px/ms
  const eventTimes = [0, 3, 7, 9, 14, 16, 21, 24, 28, 31, 37, 40, 44, 49, 53]
  const events = eventTimes.map((time) => ({ time, pos: time * REAL_VELOCITY }))

  // The correct approach: pushDragSample() is fed each event's own real timestamp -- this
  // has no frame-rate concept in it at all, which is the point: sampling correctness must
  // not depend on how often update() happens to be called in between.
  function sampleWithRealTimestamps() {
    const state = createScrollMomentumState()
    for (const e of events) pushDragSample(state, e.pos, e.time)
    return computeReleaseVelocity(state)
  }

  // The BUG, reproduced directly: every event processed before the next simulated frame
  // boundary shares that boundary's single timestamp (a scene/frame clock only advancing
  // once per step) -- `frameMs` stands in for the step's own period.
  function sampleWithFrameLockedTimestamps(frameMs) {
    const state = createScrollMomentumState()
    for (const e of events) {
      const frameTime = Math.floor(e.time / frameMs) * frameMs
      pushDragSample(state, e.pos, frameTime)
    }
    return computeReleaseVelocity(state)
  }

  const fixedVelocity = sampleWithRealTimestamps()
  assert.ok(Math.abs(fixedVelocity - REAL_VELOCITY) < 1e-9, `fixed sampler should recover the real ${REAL_VELOCITY} px/ms, got ${fixedVelocity}`)
  // The fixed sampler has no frame-rate input at all -- calling it again is the same
  // trajectory, proving the result can't vary with step rate by construction.
  assert.equal(fixedVelocity, sampleWithRealTimestamps())

  const buggy60 = sampleWithFrameLockedTimestamps(1000 / 60)
  const buggy120 = sampleWithFrameLockedTimestamps(1000 / 120)
  assert.notEqual(buggy60, buggy120, 'sanity check: the frame-locked-timestamp bug must reproduce a real 60-vs-120Hz discrepancy here, or this test is not exercising the actual bug')
  console.log(`    (regression check) buggy scene-clock sampler: 60Hz-sim=${buggy60.toFixed(4)} px/ms vs 120Hz-sim=${buggy120.toFixed(4)} px/ms -- confirms the bug this module's contract prevents`)

  // End-to-end: feed the (framerate-independent) release velocity into a full coast-to-zero
  // at both a 120Hz and a 60Hz tick rate, on the SAME trajectory -- total distance traveled
  // must match to rounding precision.
  function coastToZero(delta) {
    const state = createScrollMomentumState()
    state.velocity = fixedVelocity
    let position = 0
    let now = 0
    for (let i = 0; i < 100000 && state.velocity !== 0; i++) {
      position = stepMomentum(state, position, delta, -1e9, 1e9, now)
      now += delta
    }
    return position
  }

  const finalAt120Hz = coastToZero(1000 / 120)
  const finalAt60Hz = coastToZero(1000 / 60)
  assert.ok(Math.abs(finalAt120Hz - finalAt60Hz) < 0.5, `120Hz final position ${finalAt120Hz} and 60Hz final position ${finalAt60Hz} should match to rounding precision, differ by ${Math.abs(finalAt120Hz - finalAt60Hz)}`)
  console.log(`    coast-to-zero final position: 120Hz=${finalAt120Hz.toFixed(3)}px, 60Hz=${finalAt60Hz.toFixed(3)}px (diff ${Math.abs(finalAt120Hz - finalAt60Hz).toFixed(4)}px)`)
})

console.log(`${passed} checks passed`)
