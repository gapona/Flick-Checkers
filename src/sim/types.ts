/**
 * The disc, the world it lives in, and every number that describes how it moves.
 *
 * **Pure TypeScript — nothing under `src/sim/` may ever import Phaser** (CHAPAEV-PLAN.md §2).
 * This is the single largest technical risk in the project, so it stays runnable and testable under
 * plain `node` (`npm run verify:sim`) with no bundler, canvas or browser involved — and that same
 * property is what makes the bot (§6), the daily-puzzle solvability proof (§7) and replays fall out
 * for free instead of each being a project of its own.
 *
 * ## Units
 *
 * Everything here is in **board-space units** — the same space `board/layout.ts` defines and the
 * same space Phaser renders in, with no offset and no projection between them. A disc's `x`/`y` goes
 * straight onto a sprite. That is the whole prize for dropping the isometry (§2): simulation space
 * and render space are one space, so there is no vector to un-project and no place for the two to
 * disagree.
 *
 * The plan quotes its numbers in CELLS, because that is the unit a human can reason about ("radius
 * ~0.4 of a cell", "a flick reaches ~18 cells/s"). Both forms are below: the `*_CELLS` constant is
 * the number from the plan, and the one next to it is that number in board units. Change the cell
 * value, never the derived one.
 */
import { BASE_TILE, type BoardMetrics } from '../board/layout'

/** Board units per cell. One definition, imported rather than repeated. */
export const CELL = BASE_TILE

/**
 * The fixed integration step: 240Hz, regardless of what the display is doing.
 *
 * §2's tunnelling argument in full: at {@link MAX_SPEED_CELLS} a disc covers `18 / 240 = 0.075`
 * cells per step, against a radius of {@link DISC_RADIUS_CELLS}. Contact is therefore sampled
 * roughly ten times over the width of a disc — a ×5 margin on the worst shot in the game, which is
 * what buys the right to have no continuous collision detection at all. At 60Hz the same shot moves
 * 0.3 cells per frame and steps clean through a contact, which is why the frame rate cannot be the
 * step rate here even though it can in most games.
 */
export const FIXED_STEP_SECONDS = 1 / 240

/** Disc radius. 0.8 of a cell across, so a disc sits inside its square with a little air. */
export const DISC_RADIUS_CELLS = 0.4
export const DISC_RADIUS = DISC_RADIUS_CELLS * CELL

/**
 * The speed a full-power flick produces. The cap exists for two reasons at once: it is what the
 * step size is justified against (above), and it is what makes the power slider mean something —
 * an uncapped drag would let a long swipe reach speeds where aiming stops mattering.
 *
 * §8's power-shot consumable raises it for a single shot; that is why it lives in `SimConfig` as
 * well as here, rather than being read directly from this constant at the call site.
 */
export const MAX_SPEED_CELLS = 18
export const MAX_SPEED = MAX_SPEED_CELLS * CELL

/**
 * Friction as a CONSTANT DECELERATION along the velocity vector (Coulomb), never a per-step
 * multiplier (`v *= 0.98`, viscous).
 *
 * §2 calls this out as the most common mistake in this kind of game and it is worth restating:
 * viscous drag decays exponentially, so a disc's speed approaches zero without reaching it. What
 * that looks like on screen is a disc that crawls for several seconds after the interesting part of
 * the shot is over, and what it costs is every player's patience plus a `runToRest()` that never
 * terminates. Coulomb friction removes a fixed amount of speed per second and therefore stops in
 * finite, predictable time: `t = v / a`, `d = v² / 2a`.
 *
 * The value: a full-power shot travels `18² / (2 × 14) ≈ 11.6` cells and stops in ~1.3s. That is
 * "crosses the whole board and keeps going", which is correct — full power SHOULD be dangerous, it
 * is how you knock your own disc off. Distance falls off with the square of power, so half power is
 * a quarter of the distance; that steep curve is what makes the drag length expressive.
 *
 * **This number is a starting point to be tuned by feel in S5, not a derived truth.** §11's first
 * open question is exactly whether the friction feels right, and it cannot be answered on paper.
 */
export const FRICTION_DECEL_CELLS = 14
export const FRICTION_DECEL = FRICTION_DECEL_CELLS * CELL

/** Below this, a disc is stopped outright. Belt-and-braces next to the Coulomb zeroing above, which
 * already terminates on its own — it only bites for a disc with a very low `frictionScale`, i.e. the
 * slipperiest branch of arms (§4's cavalry, at ×0.70). */
/**
 * The exponent the slingshot's `power` is raised to before it becomes a speed:
 * `speed = maxSpeed * power ** POWER_CURVE`.
 *
 * **`1` is the identity and is what the game shipped with** — the drag maps linearly to SPEED, and
 * therefore (Coulomb, `d = v^2/2a`) quadratically to DISTANCE. That curve was authored as "the steep
 * falloff is what makes the drag expressive", and §11's threshold section measures the claim rather
 * than repeating it: on the opening rank the near enemy is 6.2 cells away out of an 11.57-cell full
 * reach, so `sqrt(6.2/11.57)` = 0.73 of the pull buys nothing but arriving, and the bottom two thirds
 * of the gesture is decoration.
 *
 * `0.5` is the other end of the same knob: distance becomes LINEAR in the pull. The ceiling and the
 * floor are untouched — only the middle moves, which is the part that did not exist.
 *
 * **0.6 is what shipped, and it is the mildest value that clears §11's threshold.** Measured, not
 * chosen: at 0.6 the pull that just reaches the nearest enemy from the opening rank goes from 0.734
 * to 0.597 for infantry and 0.729 to 0.590 for artillery, against a 0.60 allowance — 0.7 leaves both
 * above it. Full power is a FIXED POINT of the curve, so §11's other threshold (what a full-power
 * miss costs the shooter) is untouched on every branch: 23.8% for infantry before and after. That is
 * the whole reason this knob was preferred over `MAX_SPEED` and `FRICTION_DECEL`, which move the two
 * thresholds together and were proved unable to satisfy both — see §11.
 *
 * It cost one companion edit: `game/formations.ts`'s tanks went from ×1.40 friction to ×1.15,
 * because ×1.40 was tuned against the OLD curve. Read that line before touching either number; they
 * are now a pair.
 *
 * It lives in `SimConfig` rather than being read here at the call site for the same reason
 * {@link MAX_SPEED} does: `verify:feel` and `verify:balance` override it from the command line, so
 * both arms of an A/B are measured by ONE build (§4's rule) instead of by two working trees.
 */
export const POWER_CURVE = 0.6

export const REST_SPEED_CELLS = 0.02
export const REST_SPEED = REST_SPEED_CELLS * CELL

/** Disc against disc. High, because two lacquered discs really do barely lose anything on contact;
 * the energy that leaves a rally leaves through friction with the board, not through the hits. */
export const DISC_RESTITUTION = 0.92

/** Disc against the rim, in `bumperRim` mode (§5). A wall absorbs noticeably more than another
 * disc does. Guessed rather than derived — there is no real rim to measure, and the mode it serves
 * does not land until S12. */
export const RIM_RESTITUTION = 0.85

/**
 * The hard ceiling on one `runToRest()`, in simulated seconds.
 *
 * §2: "if something has not stopped, that is a bug and not gameplay — fail loudly." A full-power
 * shot rests in ~1.3s and the longest plausible chain of collisions does not approach this, so
 * hitting it means something is wrong with the solver, not with the shot. It exists so that the
 * failure is a reported, bounded event rather than the browser tab locking up — see
 * `shoot.ts`'s `runToRest`.
 */
export const MAX_SIM_SECONDS = 6

export type Side = 'player' | 'opponent'

export function opposite(side: Side): Side {
  return side === 'player' ? 'opponent' : 'player'
}

/**
 * `'stack'` is §4's artillery/tank piece: a disc with a second sprite riding on top of it, which
 * above an impulse threshold breaks into two discs.
 *
 * It is ONE disc with more mass, and §2's trap 2 is unambiguous that it must stay that way —
 * a real second body stacked in Z is not a thing this solver has, or should ever grow. S8 adds the
 * splitting; the field is here now because it is part of the disc's identity, not a late addition,
 * and because `outcome.ts` already records the impulse that will drive the threshold.
 */
export type DiscKind = 'single' | 'stack'

export interface Disc {
  /** Stable across the whole round. Discs are never spliced out of the array (removal is the
   * {@link Disc.alive} flag), but the bot clones states constantly and an explicit id means a
   * reference survives that without depending on array position. */
  id: number
  side: Side
  kind: DiscKind
  x: number
  y: number
  vx: number
  vy: number
  /** Position at the START of the current step. The renderer draws between this and the current
   * position (§2, trap 3): the solver runs at 240Hz and the screen at 60 or 120, and drawing the
   * raw solver state at 120Hz visibly judders because two frames in a row can land on the same
   * step. See `step.ts`'s `renderX`/`renderY`. */
  prevX: number
  prevY: number
  r: number
  mass: number
  /** Cached `1 / mass`. §6's search runs ~35M pair checks for one Hard-difficulty move; a division
   * per pair per step is exactly the kind of thing that turns a 0.2s budget into a 0.4s one. Kept
   * in step with `mass` by {@link createDisc} — do not assign `mass` directly. */
  invMass: number
  /** Per-branch friction multiplier (§4: cavalry −15%, tanks +30%). `1` is the standard disc. */
  frictionScale: number
  /** This disc's own restitution (§4: planes 0.98). A COLLIDING PAIR uses the larger of the two —
   * see `step.ts` for why. */
  restitution: number
  /**
   * Impulse this disc has to absorb in one contact before it comes apart into two, or `0` for a
   * disc that never does.
   *
   * Only ever non-zero on a `'stack'`. The children are ordinary singles, so a stack breaks once and
   * the pieces stay broken — §2's trap 2 allows exactly one level and no real vertical axis.
   */
  splitImpulse: number
  /** `false` once the disc has left the board. It is not removed from the array: the renderer still
   * needs it for the fall animation, and its final velocity is what that animation is thrown with.
   * Every solver loop skips it from the step it dies. */
  alive: boolean
}

export interface DiscOptions {
  id: number
  side: Side
  x: number
  y: number
  kind?: DiscKind
  vx?: number
  vy?: number
  r?: number
  mass?: number
  frictionScale?: number
  restitution?: number
  splitImpulse?: number
}

export function createDisc(options: DiscOptions): Disc {
  const mass = options.mass ?? 1
  return {
    id: options.id,
    side: options.side,
    kind: options.kind ?? 'single',
    x: options.x,
    y: options.y,
    vx: options.vx ?? 0,
    vy: options.vy ?? 0,
    prevX: options.x,
    prevY: options.y,
    r: options.r ?? DISC_RADIUS,
    mass,
    invMass: mass > 0 ? 1 / mass : 0,
    frictionScale: options.frictionScale ?? 1,
    restitution: options.restitution ?? DISC_RESTITUTION,
    splitImpulse: options.splitImpulse ?? 0,
    alive: true,
  }
}

export interface SimState {
  discs: Disc[]
  /** Simulated seconds since the state was created. Advances by exactly
   * {@link FIXED_STEP_SECONDS} per step and is never read from a wall clock — determinism (§2)
   * means nothing in here may consult `Date` or `Math.random`. */
  time: number
  /**
   * The id the next disc created mid-round will take.
   *
   * Only a splitting stack (§4) creates discs after the opening position, and its child needs an id
   * that has never been used — ids are what fix the solver's traversal order, so reusing one would
   * make two different boards indistinguishable to a replay.
   */
  nextId: number
}

export function createState(discs: Disc[]): SimState {
  return { discs, time: 0, nextId: discs.reduce((highest, disc) => Math.max(highest, disc.id + 1), 0) }
}

export function cloneDisc(disc: Disc): Disc {
  return { ...disc }
}

/**
 * A deep copy, for running a candidate shot without touching the real board.
 *
 * This is §6's inner loop — the bot evaluates hundreds of candidates against copies — so it is a
 * plain object spread per disc rather than anything structured. `Disc` is deliberately flat (no
 * nested objects, no arrays) precisely so that this stays one allocation per disc.
 */
export function cloneState(state: SimState): SimState {
  return { discs: state.discs.map(cloneDisc), time: state.time, nextId: state.nextId }
}

export interface SimConfig {
  boardW: number
  boardH: number
  /**
   * The rim bounces instead of letting a disc fall off (§5, `game/rules.ts`'s `bumperRim`).
   *
   * The wall is the board's exact edge — the gold rim `board/boardView.ts` bakes is decoration
   * drawn INSIDE that edge and has nothing to do with this. Note also the asymmetry with the
   * default mode: a bouncing disc turns when its EDGE reaches the wall, while a falling disc leaves
   * when its CENTRE crosses it. Both are what they look like, and neither is a rounding choice.
   */
  bumperRim: boolean
  /** Board units per second squared, before {@link Disc.frictionScale}. */
  frictionDecel: number
  rimRestitution: number
  /** The ceiling {@link import('./shoot').applyImpulse} scales full power to. */
  maxSpeed: number
  /** See {@link POWER_CURVE}. `1` is the shipped identity; the whole point of the field is that a
   * harness can move it without editing this file. */
  powerCurve: number
  maxSimSeconds: number
  restSpeed: number
  /**
   * §5's pits: a disc whose CENTRE enters one is gone, exactly as if it had crossed the edge.
   *
   * Same rule as the board's rim on purpose, so "am I about to lose this disc" is one question with
   * one answer rather than two that behave subtly differently.
   */
  pits: readonly Pit[]
}

/** **`IceZone` was here and is gone**, with the friction-zone test in `step.ts`'s `integrate` that
 * was its only reader — see `game/rules.ts`'s `RULES_IDS` for why the mode went. Nothing else in the
 * solver ever varied friction by POSITION; a disc's own `frictionScale` (the branch of arms) is the
 * only remaining modifier, and it is constant for the whole round. */
export interface Pit {
  x: number
  y: number
  r: number
}

export const DEFAULT_SIM_CONFIG: Omit<SimConfig, 'boardW' | 'boardH'> = {
  bumperRim: false,
  frictionDecel: FRICTION_DECEL,
  rimRestitution: RIM_RESTITUTION,
  maxSpeed: MAX_SPEED,
  powerCurve: POWER_CURVE,
  maxSimSeconds: MAX_SIM_SECONDS,
  restSpeed: REST_SPEED,
  pits: [],
}

/**
 * The solver's view of the board, from the geometry module's own metrics.
 *
 * Takes `BoardMetrics` rather than two numbers so there is exactly one place the board's size is
 * decided (`board/layout.ts`), and so a variant board size can never be right in the renderer and
 * stale in the physics.
 */
export function createSimConfig(metrics: Pick<BoardMetrics, 'boardW' | 'boardH'>, overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    ...DEFAULT_SIM_CONFIG,
    boardW: metrics.boardW,
    boardH: metrics.boardH,
    ...overrides,
  }
}

/** True while any disc still on the board is moving. Dead discs are ignored on purpose: they keep
 * their velocity so the renderer can throw them off the edge with it, and a shot must not be
 * considered unfinished because of a disc that is already out of play. */
export function isMoving(state: SimState): boolean {
  for (const disc of state.discs) {
    if (disc.alive && (disc.vx !== 0 || disc.vy !== 0)) return true
  }
  return false
}

export function liveDiscs(state: SimState, side?: Side): Disc[] {
  return state.discs.filter((disc) => disc.alive && (side === undefined || disc.side === side))
}

export function findDisc(state: SimState, id: number): Disc | undefined {
  return state.discs.find((disc) => disc.id === id)
}
