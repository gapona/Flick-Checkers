/**
 * Firing a disc, and running the world until it settles.
 *
 * **Pure TypeScript, no Phaser** — see `types.ts`. `runToRest` in particular is the function three
 * later chunks are built on: §6's bot scores candidate shots by running them on cloned states,
 * §7's daily generator proves a puzzle is solvable in one shot by finding a run that clears the
 * board, and S9's replay does nothing but repeat the shots. All three depend on it being a pure
 * function of `(state, config, shot)` with no clock and no randomness anywhere inside it.
 */
import { createOutcome, type SimOutcome } from './outcome'
import { step } from './step'
import { FIXED_STEP_SECONDS, isMoving, MAX_SPEED, POWER_CURVE, type Disc, type SimConfig, type SimState, type Side } from './types'

/**
 * Sets a disc moving: `angle` in radians (board space — `+x` right, `+y` DOWN, as everywhere else
 * in this project), `power` in `0..1`.
 *
 * Power is the drag length as a fraction of its cap, which is why it is normalised rather than a
 * raw speed: §3's slingshot means the player is choosing a proportion of the maximum, and pulling
 * further than the cap should read as "as hard as possible", never as an error. It is clamped
 * rather than rejected for that reason — a drag past the cap is a perfectly sensible gesture.
 *
 * `maxSpeed` comes from the config so §8's power-shot consumable can raise it for a single shot
 * without anything else in the chain knowing that happened. `curve` comes from the config for a
 * different reason — see {@link import('./types').POWER_CURVE} — but the same rule applies to both:
 * the mapping from a gesture to a speed is decided in ONE place, and `sim/aim.ts`'s `reachOf` has to
 * be given the identical numbers or the aim preview promises a distance the shot does not deliver.
 */
export function applyImpulse(disc: Disc, angle: number, power: number, maxSpeed: number = MAX_SPEED, curve: number = POWER_CURVE): void {
  const clamped = Math.min(1, Math.max(0, power))
  // `curve` is 1 in the shipped game, so this is `clamped * maxSpeed` and `Math.pow` is not on the
  // hot path for anything that has not deliberately asked for it. See `types.ts`'s POWER_CURVE.
  const speed = (curve === 1 ? clamped : Math.pow(clamped, curve)) * maxSpeed
  disc.vx = Math.cos(angle) * speed
  disc.vy = Math.sin(angle) * speed
}

export interface Shot {
  discId: number
  /** Radians, board space. */
  angle: number
  /** `0..1`; clamped. */
  power: number
}

/** Fixed steps one shot is allowed before the ceiling of `types.ts`'s `MAX_SIM_SECONDS` bites. */
export function maxStepsFor(config: SimConfig): number {
  return Math.ceil(config.maxSimSeconds / FIXED_STEP_SECONDS)
}

/**
 * Freezes the board if this shot has run past the ceiling, and reports whether it had to.
 *
 * Shared by {@link runToRest} and by a scene stepping the same shot live one frame at a time
 * (`scenes/Game.ts`), because both need the identical rule and a second copy of it would be a
 * second copy to get wrong. Freezing is not an attempt to hide the bug — `SimOutcome.timedOut` is
 * set and the caller is expected to report it — it is so the round is left in a state the game can
 * carry on from, rather than one where discs drift forever and the turn never ends.
 */
export function freezeIfStalled(state: SimState, config: SimConfig, outcome: SimOutcome): boolean {
  if (outcome.timedOut) return true
  if (outcome.steps < maxStepsFor(config)) return false

  outcome.timedOut = true
  for (const disc of state.discs) {
    if (!disc.alive) continue
    disc.vx = 0
    disc.vy = 0
  }
  return true
}

export interface RunOptions {
  /** The shot to fire before the first step. Omit to just settle a board that is already moving
   * (or already still), which is what an opening scatter or a restored save wants. */
  shot?: Shot
  /**
   * Called once with the outcome when the 6-second ceiling is hit.
   *
   * The ceiling is always a bug (`types.ts`'s `MAX_SIM_SECONDS`), and §2 asks for it to fail
   * loudly. It cannot fail loudly by throwing: this runs inside a player's session, and a solver
   * bug turning into a white screen mid-match is a worse outcome than the stuck shot it is
   * reporting. So it is loud in the two ways that survive: `SimOutcome.timedOut`, which a caller
   * has to look at, and this hook.
   *
   * **The scene that fires shots must pass it, wired to `platform/health.ts`'s `logError()`** — a
   * timeout that reaches only a console nobody is reading is not loud at all. Nothing fires shots
   * yet (that is S5); this is the contract it has to meet when it does.
   */
  onTimeout?: (outcome: SimOutcome) => void
}

/**
 * Runs the world forward until nothing on the board is moving, and reports what happened.
 *
 * Mutates `state` — a caller that needs to keep the original (the bot, always) passes a
 * `cloneState()`. The step count is bounded by the config's `maxSimSeconds`; a normal full-power
 * shot rests in ~1.3 simulated seconds, i.e. a little over 300 steps.
 *
 * On timeout every live disc is frozen. That is not an attempt to hide the bug — the outcome says
 * `timedOut` and `onTimeout` has already fired — it is so that the round is left in a state the
 * game can carry on from, rather than one where discs are still drifting and the turn never ends.
 */
export function runToRest(state: SimState, config: SimConfig, options: RunOptions = {}): SimOutcome {
  const { shot, onTimeout } = options

  let shooterId: number | null = null
  let shooterSide: Side | null = null

  if (shot) {
    const disc = state.discs.find((candidate) => candidate.id === shot.discId)
    // A shot at a disc that is gone is a caller bug, but returning an empty outcome is a better
    // answer than a crash: the turn ends having achieved nothing, which is recoverable.
    if (disc && disc.alive) {
      applyImpulse(disc, shot.angle, shot.power, config.maxSpeed, config.powerCurve)
      shooterId = disc.id
      shooterSide = disc.side
    }
  }

  const outcome = createOutcome(shooterId, shooterSide)

  while (isMoving(state)) {
    if (freezeIfStalled(state, config, outcome)) break
    step(state, config, outcome)
    outcome.steps++
  }

  // Every step is exactly one fixed step long, so the shot's duration is a multiplication rather
  // than a difference of two `state.time` readings — same derivation `advance()` uses.
  outcome.elapsed = outcome.steps * FIXED_STEP_SECONDS
  if (outcome.timedOut) onTimeout?.(outcome)
  return outcome
}
