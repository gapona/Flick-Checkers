/**
 * Shared flick-momentum physics for any single-axis scrollable list/strip (a vertical card
 * grid, a horizontal strip, ...) — pure, framework-agnostic (no Phaser import), so it's
 * testable with plain objects/values, no scene or DOM required (see
 * `scripts/verify-scroll-momentum.mjs`, run via `npm run verify:scroll`).
 *
 * Exists to get two things right that a naive "drive position from raw pointermove deltas,
 * glide via a tween seeded from the pointer's own built-in velocity" approach tends to get
 * wrong in ways that only surface on specific hardware:
 * - **Release velocity** should come from a short trailing window of real drag samples (not
 *   a single last-delta, which overreacts to one noisy final sample — the same reasoning
 *   real touch-scroll implementations, e.g. iOS's own UIScrollView, already use their own
 *   short trailing window for).
 * - **Frame-rate independence**: both the velocity DECAY and the distance TRAVELED per
 *   `update()` tick must land on the same trajectory regardless of how a fling's wall-clock
 *   duration happens to get chopped into ticks — a 120Hz device firing `update()` roughly
 *   twice as often as a 60Hz one must decay/travel the same total amount over the same
 *   wall-clock span, not twice as fast or twice as far. See `stepMomentum()`'s own doc
 *   comment for the exact math (an integral of the decaying velocity, not a plain Euler
 *   step) and why a plain Euler step provably fails this for a decaying velocity.
 *
 * Usage: a scene owns one `ScrollMomentumState` per scroll axis, calls `pushDragSample()`
 * from its (cheap, no repositioning) `pointermove` handler using the pointer event's own real
 * timestamp (not a scene/frame clock — see this module's own regression test for why that
 * distinction matters: multiple raw events landing within the same `update()` tick would
 * otherwise share one timestamp and corrupt the velocity computation in a way that depends on
 * how the render rate lines up with the input rate), calls `computeReleaseVelocity()` +
 * assigns the result to `state.velocity` from its `pointerup` handler, and calls
 * `stepMomentum()` once per `update(time, delta)` tick while `state.velocity !== 0` — never
 * from an event handler directly.
 */

/** How many recent (position, time) samples `computeReleaseVelocity()` averages over. */
const VELOCITY_SAMPLE_COUNT = 3

/** Decay/velocity constants are expressed per this reference frame duration (60fps), then
 * scaled by `delta / REFERENCE_FRAME_MS` wherever they're applied — see `stepMomentum()`'s
 * own doc comment for why this is what actually keeps 120Hz and 60Hz devices decaying at the
 * same WALL-CLOCK rate instead of 120Hz decaying twice as fast. */
const REFERENCE_FRAME_MS = 1000 / 60

/** Multiplies velocity by this factor every REFERENCE_FRAME_MS of wall-clock time (not every
 * `update()` call) — e.g. after 500ms, velocity has been reduced to `0.95^(500/16.667)` of
 * its release value regardless of framerate. Draft tuning — revisit against real feel/
 * telemetry once a game has both; chosen to read as a moderate, controllable coast, not a
 * long drift. */
const FLING_DECAY_PER_FRAME = 0.95

/** Below this speed (px/ms), momentum is considered finished and snaps to exactly 0 —
 * without a floor, exponential decay approaches but never truly reaches zero, leaving a
 * cosmetically-moving (but imperceptible) scroll forever and never letting callers know the
 * "movement frame" has ended. Draft tuning. */
const MIN_VELOCITY_PX_PER_MS = 0.03

/** How long the soft edge-stop takes to fully decelerate an in-bounds fling down to 0 once
 * continuing would carry it past a bound — no bounce/overshoot (position is still
 * hard-clamped to the bound every frame), just a smoother final deceleration than an instant
 * velocity=0 the frame it would have crossed. */
const EDGE_STOP_MS = 100

/** The exponential decay rate expressed per MILLISECOND (not per reference frame) —
 * `velocity(t) = velocity0 * exp(-DECAY_RATE_PER_MS * t)` is the exact same curve as
 * `velocity0 * FLING_DECAY_PER_FRAME^(t/REFERENCE_FRAME_MS)`, just reparameterized so its
 * antiderivative (used by `stepMomentum()` below to get an exact, step-size-invariant
 * integral instead of an Euler approximation) doesn't need to re-derive this constant inline
 * every call. */
const DECAY_RATE_PER_MS = -Math.log(FLING_DECAY_PER_FRAME) / REFERENCE_FRAME_MS

export interface DragSample {
  pos: number
  time: number
}

export interface ScrollMomentumState {
  /** px/ms. Signed — same direction convention as the position axis it drives (increasing
   * position = positive velocity continues moving in that same direction post-release). */
  velocity: number
  samples: DragSample[]
  /** Set the first frame a fling would carry the position out of bounds — `null` while still
   * in-bounds or not currently flinging. Captures the velocity AT that moment so the
   * ramp-to-zero below has a fixed starting point to ease from, regardless of how many frames
   * the edge-stop has already been running. */
  edgeStopStartTime: number | null
  edgeStopStartVelocity: number
}

export function createScrollMomentumState(): ScrollMomentumState {
  return { velocity: 0, samples: [], edgeStopStartTime: null, edgeStopStartVelocity: 0 }
}

/** Called whenever a new drag gesture starts, and whenever one ends (whether it resolved to
 * a tap, a scroll, or was cancelled) — clears any in-flight momentum and sample history so a
 * stale velocity/edge-stop state can never leak into the next gesture. */
export function resetScrollMomentum(state: ScrollMomentumState): void {
  state.velocity = 0
  state.samples = []
  state.edgeStopStartTime = null
  state.edgeStopStartVelocity = 0
}

/** Cheap bookkeeping only — called from a scene's own `pointermove` handler on every raw
 * event (see this module's own top doc comment for why that handler must otherwise stay
 * cheap: no repositioning/culling here, just recording where the drag currently is). Pass the
 * pointer event's own real timestamp (e.g. `pointer.moveTime`), not a scene/frame clock. */
export function pushDragSample(state: ScrollMomentumState, pos: number, time: number): void {
  state.samples.push({ pos, time })
  if (state.samples.length > VELOCITY_SAMPLE_COUNT) state.samples.shift()
}

/** Release velocity (px/ms) from the last few drag samples — 0 if fewer than two samples were
 * ever recorded (e.g. a drag that crossed the tap threshold on its very last event,
 * immediately followed by release). */
export function computeReleaseVelocity(state: ScrollMomentumState): number {
  const s = state.samples
  if (s.length < 2) return 0
  const first = s[0]
  const last = s[s.length - 1]
  const dt = last.time - first.time
  if (dt <= 0) return 0
  return (last.pos - first.pos) / dt
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Advances one momentum step. Returns the new position; mutates `state.velocity` (and its
 * edge-stop bookkeeping) in place. Caller checks `state.velocity === 0` afterward to know
 * whether momentum has ended.
 *
 * Frame-rate independence: `delta` (ms since the last `update()` call) drives both the
 * velocity DECAY and the distance TRAVELED this step, and both must land on the exact same
 * trajectory regardless of how the SAME wall-clock span gets chopped into `update()` ticks —
 *   - velocity decay: raising the per-reference-frame decay factor to the power of
 *     `delta / REFERENCE_FRAME_MS` makes it shrink by the same PROPORTION per unit of
 *     wall-clock time no matter how many ticks happened within it (two 8.33ms ticks at 120Hz:
 *     `0.95^0.5 * 0.95^0.5 = 0.95^1.0`, identical to one 16.667ms tick at 60Hz).
 *   - distance traveled: even with decay correctly delta-normalized, a plain Euler step
 *     (`position + velocity * delta`, using the velocity from the START of the step for its
 *     WHOLE duration) does NOT give the same total distance for a fling chopped into
 *     few-large vs many-small steps — since velocity is decaying THROUGHOUT the step,
 *     evaluating it only at the start systematically overestimates distance, and more so the
 *     larger the step (a 60Hz coast measurably out-travels the identical 120Hz one). Fixed by
 *     using the EXACT integral of the exponential decay over the step instead:
 *     `distance = velocity0 * (1 - decayFactor) / DECAY_RATE_PER_MS`. This is provably
 *     step-size-invariant — for two chained sub-steps of length h1/h2 summing to H, their
 *     decay factors r1*r2 always equal the single-step decay factor R for the full span H
 *     (since `r^(h1/T) * r^(h2/T) = r^((h1+h2)/T)`), and algebraically
 *     `v0*(1-r1)/λ + v0*r1*(1-r2)/λ` simplifies to exactly `v0*(1-r1*r2)/λ = v0*(1-R)/λ` — the
 *     same total regardless of how many sub-steps the span is divided into. See
 *     `scripts/verify-scroll-momentum.mjs`, which catches this discrepancy directly (a
 *     coast-to-zero from the same release velocity ending at measurably different final
 *     positions at simulated dt=8.33 vs dt=16.67 without this fix).
 */
export function stepMomentum(state: ScrollMomentumState, position: number, delta: number, min: number, max: number, now: number): number {
  if (state.velocity === 0) return position

  const dtFrames = delta / REFERENCE_FRAME_MS
  const naiveCandidate = position + state.velocity * delta
  const outOfBounds = naiveCandidate < min || naiveCandidate > max

  if (outOfBounds) {
    if (state.edgeStopStartTime === null) {
      state.edgeStopStartTime = now
      state.edgeStopStartVelocity = state.velocity
    }
    // Linear ramp (not exponential), so its exact integral over the step is just the
    // trapezoidal average of the ramp's value at the step's start and end times — for a
    // straight line, that average composes exactly across any sub-step split, the same
    // invariance argument as the exponential case above, just simpler algebra.
    const rampStart = clamp((now - delta - state.edgeStopStartTime) / EDGE_STOP_MS, 0, 1)
    const rampEnd = clamp((now - state.edgeStopStartTime) / EDGE_STOP_MS, 0, 1)
    const velocityStart = state.edgeStopStartVelocity * (1 - rampStart)
    const velocityEnd = rampEnd >= 1 ? 0 : state.edgeStopStartVelocity * (1 - rampEnd)
    state.velocity = velocityEnd
    const softenedCandidate = position + ((velocityStart + velocityEnd) / 2) * delta
    // Position can never visibly overscroll even for a single frame, regardless of how far
    // `naiveCandidate` above overshot before the edge-stop kicked in.
    return clamp(softenedCandidate, min, max)
  }

  state.edgeStopStartTime = null
  const decayFactor = Math.pow(FLING_DECAY_PER_FRAME, dtFrames)
  const distance = (state.velocity * (1 - decayFactor)) / DECAY_RATE_PER_MS
  state.velocity *= decayFactor
  if (Math.abs(state.velocity) < MIN_VELOCITY_PX_PER_MS) state.velocity = 0
  return position + distance
}
