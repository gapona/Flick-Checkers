/**
 * One fixed step of the world: friction, motion, the board's edge, and disc-against-disc contact.
 *
 * **Pure TypeScript, no Phaser** — see `types.ts` for the full reason. Everything here mutates the
 * state in place and allocates nothing per step except the outcome records it is explicitly asked
 * for: §6's bot runs this ~480 times per candidate shot and hundreds of candidates per move, so a
 * per-step allocation is a per-move garbage collection.
 *
 * ## Why not Arcade Physics
 *
 * `config.ts` has no `physics` block and must never grow one (CHAPAEV-PLAN.md §2). Three reasons,
 * each on its own disqualifying:
 *
 * 1. **Tunnelling.** Arcade steps at the frame rate. At 60Hz a full-power flick moves 0.3 cells per
 *    frame against a 0.4-cell radius and walks straight through a contact — on precisely the shots
 *    the game exists for. The 240Hz step here is what makes that impossible without any continuous
 *    collision detection.
 * 2. **Separation instead of impulse.** Arcade pushes overlapping bodies apart along the axes of
 *    their bounding boxes. What a carrom game needs is a true elastic exchange along the line of
 *    centres — that IS the mechanic, not a refinement of it.
 * 3. **Determinism.** A solver that is a pure function of its state gives the bot, the daily
 *    puzzle's solvability proof, replays and `node`-run tests for free.
 *
 * ## Order within a step, and why it is that order
 *
 *   integrate → bounds → collide → bounds
 *
 * Bounds are checked BEFORE collisions so that §2's trap 1 holds: a disc must leave the simulation
 * in the same step its centre crosses the edge, or it spends the next step still colliding with
 * live discs while notionally out of play — a disc that has already fallen off knocking another one
 * away is the kind of bug that gets reported as "it cheated". Bounds are checked AGAIN after
 * collisions because the overlap correction moves discs, and a disc shoved over the line by a hit
 * has left on that hit, not a step later. The second pass is a no-op for almost every disc.
 */
import { createOutcome, type BoardEdge, type SimOutcome } from './outcome'
import { FIXED_STEP_SECONDS, type Disc, type SimConfig, type SimState } from './types'

/** Below this overlap, two discs are treated as merely touching. Without it, discs placed exactly
 * in contact by a starting formation would be "corrected" apart on the first step and the board
 * would shuffle itself before anyone shot. */
const CONTACT_EPSILON = 1e-6

/** Fallback normal for two discs at exactly the same point — a degenerate case a formation
 * generator can produce, where the real normal is undefined. Any fixed direction will do; what
 * matters is that it is FIXED, because a random one would break determinism. */
const DEGENERATE_NORMAL = { x: 1, y: 0 }

/** How much wider a stack is drawn than each of the halves it breaks into. A stack looks bigger
 * because it IS two pieces; its children are ordinary discs again. */
const STACK_RADIUS_RATIO = 1.15

/**
 * Advances the world by exactly one {@link FIXED_STEP_SECONDS}.
 *
 * `outcome` is optional: the bot's inner loop passes nothing, because it scores the resulting board
 * and does not care how it got there, and skipping the records is the difference between allocating
 * per contact and not.
 */
export function step(state: SimState, config: SimConfig, outcome?: SimOutcome): void {
  integrate(state, config)
  resolveBounds(state, config, outcome)

  // Stacks that took a hard enough hit are collected during the pass and broken apart after it —
  // appending to `state.discs` while iterating it would be a different bug every time the array
  // happened to grow.
  const splitting: Disc[] = []
  resolveCollisions(state, config, splitting, outcome)
  if (splitting.length > 0) applySplits(state, splitting, outcome)

  // Second pass: see the header. A hit can push a disc's centre over the edge, and that counts as
  // leaving on this step, not the next one.
  resolveBounds(state, config, outcome)
  state.time += FIXED_STEP_SECONDS
}

/**
 * Coulomb friction, then motion — semi-implicit Euler (the step's own end-of-step velocity carries
 * the position), which is stable here and is what the fixed step makes exactly reproducible.
 *
 * The friction is a fixed amount of SPEED removed per second along the velocity vector, zeroed when
 * it would overshoot. Not `v *= k`. See `types.ts`'s `FRICTION_DECEL_CELLS` for why that
 * distinction is the difference between a disc that stops and a disc that crawls forever.
 */
function integrate(state: SimState, config: SimConfig): void {
  const dt = FIXED_STEP_SECONDS

  for (const disc of state.discs) {
    if (!disc.alive) continue

    disc.prevX = disc.x
    disc.prevY = disc.y

    const speed = Math.hypot(disc.vx, disc.vy)
    if (speed > 0) {
      const drop = config.frictionDecel * disc.frictionScale * dt
      if (speed <= drop || speed < config.restSpeed) {
        disc.vx = 0
        disc.vy = 0
      } else {
        const scale = (speed - drop) / speed
        disc.vx *= scale
        disc.vy *= scale
      }
    }

    disc.x += disc.vx * dt
    disc.y += disc.vy * dt
  }
}

function resolveBounds(state: SimState, config: SimConfig, outcome?: SimOutcome): void {
  for (const disc of state.discs) {
    if (!disc.alive) continue

    // Pits before the rim: a disc can be over a pit and past the edge in the same step only in a
    // corner case nobody will ever build, and losing it to the pit reads better than losing it to a
    // boundary it never visibly reached.
    if (swallowedByPit(disc, config, state, outcome)) continue

    if (config.bumperRim) bounceOffRim(disc, config, state, outcome)
    else checkKnockedOff(disc, config, state, outcome)
  }
}

/**
 * §5's pits, on exactly the same rule as the board's edge: the CENTRE going in is what counts.
 *
 * Deliberately identical to `checkKnockedOff` so that "how close is that disc to being lost" is one
 * question with one answer, whether the danger is the rim or a hole in the middle of the board.
 */
function swallowedByPit(disc: Disc, config: SimConfig, state: SimState, outcome?: SimOutcome): boolean {
  for (const pit of config.pits) {
    if (Math.hypot(disc.x - pit.x, disc.y - pit.y) > pit.r) continue

    disc.alive = false
    outcome?.knockedOff.push({
      time: state.time,
      id: disc.id,
      side: disc.side,
      x: disc.x,
      y: disc.y,
      edge: 'pit',
      vx: disc.vx,
      vy: disc.vy,
    })
    return true
  }
  return false
}

/**
 * The default board: no walls. A disc is out the moment its CENTRE passes the edge — the classic
 * rule, and the one that makes the tense half-over-the-line position readable, since a disc is
 * still in play while up to half of it hangs over nothing.
 *
 * Its velocity is deliberately NOT zeroed. The renderer throws the falling disc with it (S3), so a
 * disc blasted off the board flies and one that dribbles over the line tips over the edge. Every
 * loop in this module skips it from this step onward, and `isMoving()` ignores it, so a shot is not
 * held open by a disc that is already gone.
 */
function checkKnockedOff(disc: Disc, config: SimConfig, state: SimState, outcome?: SimOutcome): void {
  let edge: BoardEdge | null = null
  // Ordered so that a corner exit reports the axis it crossed by the larger margin, which is the
  // one a viewer would name.
  const over = [
    { edge: 'left' as const, depth: -disc.x },
    { edge: 'right' as const, depth: disc.x - config.boardW },
    { edge: 'top' as const, depth: -disc.y },
    { edge: 'bottom' as const, depth: disc.y - config.boardH },
  ]
  let deepest = 0
  for (const candidate of over) {
    if (candidate.depth > 0 && candidate.depth >= deepest) {
      deepest = candidate.depth
      edge = candidate.edge
    }
  }
  if (!edge) return

  disc.alive = false
  outcome?.knockedOff.push({
    time: state.time,
    id: disc.id,
    side: disc.side,
    x: disc.x,
    y: disc.y,
    edge,
    vx: disc.vx,
    vy: disc.vy,
  })
}

/**
 * `bumperRim` mode: the board has walls, and a disc turns when its EDGE reaches one — a wall is a
 * physical thing the disc's rim touches, unlike the invisible line its centre crosses in the
 * default mode.
 *
 * Position is clamped whether or not the disc is moving inward (an overlap correction can leave it
 * inside the wall while already travelling out), but the velocity is only reflected when it is
 * actually heading into the wall. Reflecting unconditionally would trap a disc against the rim,
 * flipping its velocity every step forever.
 */
function bounceOffRim(disc: Disc, config: SimConfig, state: SimState, outcome?: SimOutcome): void {
  const e = config.rimRestitution

  if (disc.x < disc.r) {
    disc.x = disc.r
    if (disc.vx < 0) {
      recordRimImpact(disc, -disc.vx, e, disc.r, disc.y, state, outcome)
      disc.vx = -disc.vx * e
    }
  } else if (disc.x > config.boardW - disc.r) {
    disc.x = config.boardW - disc.r
    if (disc.vx > 0) {
      recordRimImpact(disc, disc.vx, e, config.boardW, disc.y, state, outcome)
      disc.vx = -disc.vx * e
    }
  }

  if (disc.y < disc.r) {
    disc.y = disc.r
    if (disc.vy < 0) {
      recordRimImpact(disc, -disc.vy, e, disc.x, disc.r, state, outcome)
      disc.vy = -disc.vy * e
    }
  } else if (disc.y > config.boardH - disc.r) {
    disc.y = config.boardH - disc.r
    if (disc.vy > 0) {
      recordRimImpact(disc, disc.vy, e, disc.x, config.boardH, state, outcome)
      disc.vy = -disc.vy * e
    }
  }
}

function recordRimImpact(disc: Disc, closingSpeed: number, restitution: number, x: number, y: number, state: SimState, outcome?: SimOutcome): void {
  if (!outcome) return
  outcome.impacts.push({
    time: state.time,
    a: disc.id,
    b: null,
    x,
    y,
    // The rim is immovable — it has infinite mass, so the pair impulse `-(1+e)·v / (1/m + 0)`
    // collapses to the disc's own momentum change. Same quantity as a disc-disc impact, comparable
    // against it, which is what lets §9 drive one impact sound off both.
    impulse: (1 + restitution) * closingSpeed * disc.mass,
    speed: closingSpeed,
  })
}

/**
 * Every live pair, in index order, one pass per step.
 *
 * One pass rather than an iterative solver: at 240Hz a contact chain propagates one link per step,
 * i.e. within a twenty-fourth of a rendered frame at 60Hz, which no player can perceive as anything
 * but simultaneous. An iterative solver would buy nothing here — there is no gravity, so there are
 * no resting stacks for penetration to accumulate in — and would cost the exact reproducibility
 * that comes from a fixed traversal order.
 *
 * Momentum is conserved regardless of the order pairs are visited in, because every impulse is
 * applied equal and opposite; only the distribution of the *rounding* depends on order, and that is
 * fixed by the ids being fixed.
 */
function resolveCollisions(state: SimState, config: SimConfig, splitting: Disc[], outcome?: SimOutcome): void {
  const discs = state.discs
  // Snapshot the length: a split appends to the array, and a disc created by this step must not be
  // collided in the same step it came into existence.
  const count = discs.length

  for (let i = 0; i < count; i++) {
    const a = discs[i]
    if (!a.alive) continue

    for (let j = i + 1; j < count; j++) {
      const b = discs[j]
      if (!b.alive) continue

      const dx = b.x - a.x
      const dy = b.y - a.y
      const contact = a.r + b.r
      const distanceSquared = dx * dx + dy * dy
      if (distanceSquared >= contact * contact - CONTACT_EPSILON) continue

      const distance = Math.sqrt(distanceSquared)
      const nx = distance > 0 ? dx / distance : DEGENERATE_NORMAL.x
      const ny = distance > 0 ? dy / distance : DEGENERATE_NORMAL.y

      separate(a, b, nx, ny, contact - distance)
      const impulse = exchangeImpulse(a, b, nx, ny, state, outcome)
      if (impulse > 0) {
        if (a.splitImpulse > 0 && impulse >= a.splitImpulse && !splitting.includes(a)) splitting.push(a)
        if (b.splitImpulse > 0 && impulse >= b.splitImpulse && !splitting.includes(b)) splitting.push(b)
      }
    }
  }
}

/**
 * Breaks the stacks that took a hard enough hit (§4, and §2's trap 2).
 *
 * A stack is one disc worth two pieces, so it becomes two discs of half its mass — and **both
 * inherit the parent's velocity unchanged**, which is exactly what conserves momentum: `2m·v`
 * before, `m·v + m·v` after. Nothing is added, so a split cannot manufacture the energy to fling its
 * own halves across the board.
 *
 * They are placed a radius apart along the direction of travel, overlapping. That is deliberate and
 * costs nothing: the next step's overlap correction pushes them apart, which is both free of energy
 * and exactly what a stack bursting looks like.
 */
function applySplits(state: SimState, splitting: Disc[], outcome?: SimOutcome): void {
  for (const parent of splitting) {
    if (!parent.alive) continue

    const speed = Math.hypot(parent.vx, parent.vy)
    const nx = speed > 0 ? parent.vx / speed : DEGENERATE_NORMAL.x
    const ny = speed > 0 ? parent.vy / speed : DEGENERATE_NORMAL.y

    const half = parent.mass / 2
    const childRadius = parent.r / STACK_RADIUS_RATIO

    const child: Disc = {
      ...parent,
      id: state.nextId++,
      kind: 'single',
      mass: half,
      invMass: half > 0 ? 1 / half : 0,
      r: childRadius,
      splitImpulse: 0,
      x: parent.x + nx * childRadius,
      y: parent.y + ny * childRadius,
      prevX: parent.x,
      prevY: parent.y,
    }

    parent.kind = 'single'
    parent.mass = half
    parent.invMass = half > 0 ? 1 / half : 0
    parent.r = childRadius
    parent.splitImpulse = 0
    parent.x -= nx * childRadius
    parent.y -= ny * childRadius

    state.discs.push(child)
    outcome?.splits.push({ time: state.time, id: parent.id, into: child.id })
  }
}

/**
 * Push two overlapping discs apart along the line of centres, splitting the correction by inverse
 * mass so the heavier one barely moves.
 *
 * The whole overlap is corrected, not the fraction a Baumgarte-style solver would use. That would
 * be wrong here: partial correction exists to keep bodies from jittering under a constant force
 * pressing them together, and nothing on this board presses. Left uncorrected, discs sink into each
 * other and a dense cluster locks up — §2's "a stack of discs sticks together".
 */
function separate(a: Disc, b: Disc, nx: number, ny: number, overlap: number): void {
  const totalInvMass = a.invMass + b.invMass
  if (totalInvMass <= 0) return

  const correction = overlap / totalInvMass
  a.x -= nx * correction * a.invMass
  a.y -= ny * correction * a.invMass
  b.x += nx * correction * b.invMass
  b.y += ny * correction * b.invMass
}

/**
 * The elastic exchange along the line of centres — the core of the whole game.
 *
 * The pair's restitution is the LARGER of the two discs', which is the convention Box2D and most
 * 2D engines use and is the right one for §4: a plane at 0.98 should ricochet off anything it
 * touches, which is exactly what makes that branch feel unpredictable. Averaging would let a heavy
 * tank quietly damp the plane's defining property away.
 */
function exchangeImpulse(a: Disc, b: Disc, nx: number, ny: number, state: SimState, outcome?: SimOutcome): number {
  const relativeVx = b.vx - a.vx
  const relativeVy = b.vy - a.vy
  const alongNormal = relativeVx * nx + relativeVy * ny

  // Already separating: they overlap, but the previous step's impulse (or the correction above) has
  // them on their way apart. Hitting them again would add energy from nothing.
  if (alongNormal > 0) return 0

  const totalInvMass = a.invMass + b.invMass
  if (totalInvMass <= 0) return 0

  const e = Math.max(a.restitution, b.restitution)
  const magnitude = (-(1 + e) * alongNormal) / totalInvMass

  a.vx -= nx * magnitude * a.invMass
  a.vy -= ny * magnitude * a.invMass
  b.vx += nx * magnitude * b.invMass
  b.vy += ny * magnitude * b.invMass

  if (outcome) {
    outcome.impacts.push({
      time: state.time,
      a: a.id,
      b: b.id,
      // On the line of centres, a's radius out from a's centre — where the two rims meet.
      x: a.x + nx * a.r,
      y: a.y + ny * a.r,
      impulse: magnitude,
      speed: -alongNormal,
    })
    if (outcome.shooterSide && (a.side !== outcome.shooterSide || b.side !== outcome.shooterSide)) {
      outcome.touchedEnemy = true
    }
  }

  return magnitude
}

/**
 * The bridge between the solver's fixed 240Hz step and a display running at whatever it likes.
 *
 * A frame delivers a variable delta; this consumes it in whole fixed steps and keeps the remainder,
 * so the same elapsed time always produces the same number of steps regardless of how it was
 * chopped up. That is what makes a 120Hz machine and a 60Hz one play the same game rather than
 * merely look similar — the same property `ui/scrollMomentum.ts` had to be given for scrolling, and
 * the same reason: a frame-rate-dependent simulation is a bug you cannot see on your own machine.
 */
export interface Stepper {
  /** Unconsumed seconds, always less than one fixed step. */
  accumulator: number
  /** `accumulator / FIXED_STEP_SECONDS`, `0..1` — how far the display is between the last step and
   * the next. Feed to {@link renderX}/{@link renderY}. */
  alpha: number
  /** Fixed steps taken over this stepper's whole life. */
  steps: number
}

/**
 * Largest frame delta honoured, in seconds. A tab restored after being backgrounded reports a delta
 * of however long it was away, and consuming that faithfully means thousands of steps in one frame
 * — which is slower than real time, so the next frame's delta is larger still: the classic spiral
 * of death. Time is dropped instead. The platform pauses gameplay on background anyway
 * (`platform/lifecycle.ts`), so this is the backstop, not the mechanism.
 */
export const MAX_FRAME_SECONDS = 0.25

export function createStepper(): Stepper {
  return { accumulator: 0, alpha: 0, steps: 0 }
}

/**
 * Drops any unconsumed time and puts the blend factor back at "exactly on a step".
 *
 * Call it when the board goes still and again before a new shot. Without it, the leftover fraction
 * of a step from the end of one shot is spent at the start of the next — harmless for the physics
 * (the step is fixed either way) but not for the drawing: `alpha` would keep its stale mid-step
 * value while nothing is moving, and every disc would be drawn a fraction short of where the solver
 * says it is. Aiming, the bot and the save all read the solver, so that gap is a lie on screen.
 */
export function resetStepper(stepper: Stepper): void {
  stepper.accumulator = 0
  stepper.alpha = 1
}

/** Runs whole fixed steps for `deltaSeconds` of real time, and returns how many it took. */
export function advance(stepper: Stepper, state: SimState, config: SimConfig, deltaSeconds: number, outcome?: SimOutcome): number {
  stepper.accumulator += Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_SECONDS)

  let taken = 0
  while (stepper.accumulator >= FIXED_STEP_SECONDS) {
    step(state, config, outcome)
    stepper.accumulator -= FIXED_STEP_SECONDS
    taken++
  }

  stepper.steps += taken
  stepper.alpha = stepper.accumulator / FIXED_STEP_SECONDS
  if (outcome) {
    outcome.steps += taken
    // Every step is exactly one fixed step long, so this is the simulated time THIS outcome covers
    // — not `state.time`, which is the age of the whole round and would make a shot fired late in a
    // round look like it took minutes. `runToRest` derives it the same way.
    outcome.elapsed = outcome.steps * FIXED_STEP_SECONDS
  }
  return taken
}

/**
 * Where to DRAW a disc, given how far the frame sits between two solver steps.
 *
 * §2's trap 3: the solver runs at 240Hz and the screen does not. Drawing the raw solver position
 * means two consecutive 120Hz frames can show the same step while the next shows two steps of
 * travel, which reads as a fast disc shimmering. Interpolating removes it completely and costs one
 * multiply.
 */
export function renderX(disc: Disc, alpha: number): number {
  return disc.prevX + (disc.x - disc.prevX) * alpha
}

export function renderY(disc: Disc, alpha: number): number {
  return disc.prevY + (disc.y - disc.prevY) * alpha
}

/** A one-off settle with no shot attached — the opening scatter, or a board restored from a save.
 * Named for what it does; `shoot.ts`'s `runToRest` is the one to use for an actual shot. */
export function emptyOutcome(): SimOutcome {
  return createOutcome()
}
