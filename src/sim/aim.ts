/**
 * The slingshot: turning a finger position into a shot, and working out what that shot is pointed
 * at.
 *
 * **Pure TypeScript, no Phaser** — same rule as the rest of `src/sim/`, and for a sharper reason
 * than usual here. CHAPAEV-PLAN.md §10 puts the project's remaining risk in exactly this chunk:
 * everything else can be judged from a screenshot, but whether aiming FEELS right cannot, and the
 * numbers that decide it (how far a full-power pull is, where the cancel threshold sits) have to be
 * tunable in one place and checkable without a browser.
 *
 * ## Why a slingshot and not a real flick
 *
 * §3 makes the case and it is worth keeping: a genuine flick — a fast swipe whose speed becomes the
 * disc's — gives a spread of power the player does not control and, more damningly, cannot
 * REPEAT. A slingshot is readable while it is being made, cancellable, and identical under a mouse
 * and a thumb. §3 leaves the real flick as a settings option for people who want the board-game
 * gesture; that option is not built and is not part of this module's contract.
 */
import type { Disc, SimConfig, SimState } from './types'
import { CELL, DISC_RADIUS } from './types'

/**
 * Pull distance for full power, in cells.
 *
 * Measured in BOARD units rather than screen pixels, which is the whole point: the drag scales with
 * the board, so the same pull means the same shot on a 390px phone and a 1280px desktop. A pixel
 * threshold would make the game a different game on each.
 *
 * 2.5 cells is a comfortable thumb's travel — about 117px of a 390px portrait screen. **A number to
 * tune by feel**, per §11's first open question; it is the single most important one in the file.
 */
export const MAX_DRAG_CELLS = 2.5
export const MAX_DRAG = MAX_DRAG_CELLS * CELL

/**
 * The cancel: bring the finger back within half a disc radius of the centre and releasing does
 * nothing.
 *
 * §3's escape hatch, and the thing that makes the whole gesture safe to start — a player who
 * presses a disc and thinks better of it must be able to get out without firing.
 *
 * **Expressed as a DISTANCE, and that is the single source of truth.** It was previously a fraction
 * of the maximum drag (`0.08`), which happened to equal half a radius at the current
 * `MAX_DRAG_CELLS` — the two agreed by coincidence, not by construction, and tuning the drag length
 * (§11's first open question, the number most likely to change) would have silently moved the
 * cancel radius with it. Now the distance is fixed and the power fraction is derived from it.
 */
export const CANCEL_RADII = 0.5
export const CANCEL_DISTANCE = CANCEL_RADII * DISC_RADIUS

/** The power fraction that corresponds to {@link CANCEL_DISTANCE} at a given drag length. Derived,
 * never authored — that is the whole point of the constant above. */
export function minPowerFor(maxDrag: number): number {
  return CANCEL_DISTANCE / maxDrag
}

export const MIN_POWER = minPowerFor(MAX_DRAG)

/**
 * How far past a disc's CENTRE a press still counts as grabbing it, as a multiple of its radius.
 *
 * A disc is ~37px across on a phone, under the 44px touch-target minimum, so a press has to be
 * allowed some slop or the gate is technically correct and practically infuriating.
 *
 * **The regions of nearby discs DO overlap, and that is the normal case rather than an edge case.**
 * In the opening the discs stand a cell apart and 1.2 radii (0.48 cells) clears the 0.5-cell
 * half-gap — but after the first shot discs come to rest touching, where the half-gap is one radius
 * and any factor above 1.0 overlaps. So non-overlap is not the invariant and cannot be made one.
 *
 * The invariant is {@link discAt}'s: the NEAREST qualifying disc wins, deterministically, whatever
 * the array order. That is what `verify:sim` proves, over several layouts including a clump of four
 * touching discs.
 */
export const GRAB_RADIUS_FACTOR = 1.2

export interface Aim {
  /** Radians, board space — the direction the disc will travel. */
  angle: number
  /** `0..1`, ready to hand to `applyImpulse`. */
  power: number
  /** Raw pull length in board units, before the cap. Lets a view show that the player is pulling
   * past full power rather than silently ignoring it. */
  drag: number
  /** The pull is too short to fire: releasing now cancels. */
  cancelled: boolean
}

/**
 * The shot implied by a finger at `(pointerX, pointerY)` while holding `disc`.
 *
 * **The disc travels AWAY from the finger** — direction is measured from the pointer to the disc,
 * exactly like drawing a catapult back. Getting this backwards is the single easiest mistake here
 * and it produces a game that is playable but feels inside-out, so it has a test of its own.
 */
export function computeAim(disc: Disc, pointerX: number, pointerY: number, maxDrag: number = MAX_DRAG, minPower: number = minPowerFor(maxDrag)): Aim {
  const dx = disc.x - pointerX
  const dy = disc.y - pointerY
  const drag = Math.hypot(dx, dy)
  const power = Math.min(1, drag / maxDrag)

  return {
    // At zero drag the direction is undefined; 0 is as good as anything, and `cancelled` is true
    // there anyway so nothing will read it.
    angle: drag > 0 ? Math.atan2(dy, dx) : 0,
    power,
    drag,
    cancelled: power < minPower,
  }
}

/**
 * How far a disc fired at `power` will travel over open board, in board units.
 *
 * The closed form Coulomb friction gives us — `d = v²/2a` — which is exactly why `types.ts` insists
 * on Coulomb rather than viscous damping. The solver's discrete steps land about 0.3% short of
 * this, which is far below anything visible.
 *
 * Used to end the aim line where the shot actually runs out, so a weak pull at a distant target
 * visibly falls short instead of drawing a confident line to something it cannot reach.
 */
export function reachOf(power: number, config: SimConfig, disc?: Disc): number {
  const clamped = Math.min(1, Math.max(0, power))
  // Exactly `shoot.ts`'s `applyImpulse`, and it has to stay exactly it: this is the number the aim
  // line's length is drawn from, so any divergence is the preview lying about the shot.
  const speed = (config.powerCurve === 1 ? clamped : Math.pow(clamped, config.powerCurve)) * config.maxSpeed
  const decel = config.frictionDecel * (disc?.frictionScale ?? 1)
  if (decel <= 0) return Number.POSITIVE_INFINITY
  return (speed * speed) / (2 * decel)
}

export interface Contact {
  /** The disc that would be hit, or `null` for the board's edge. */
  discId: number | null
  /** Distance from the shooter's centre to where its centre sits at the moment of contact. */
  distance: number
  /** That contact position, in board units. */
  x: number
  y: number
}

/**
 * What a shot fired along `angle` meets first: another disc, or the edge of the board.
 *
 * A ray test, NOT a simulation — one pass over the discs, no stepping. That matters twice over: it
 * runs on every pointer move without a budget worry, and it is structurally incapable of telling
 * the player anything past the first contact.
 *
 * **That limit is deliberate** (§5). A full predicted trajectory — bounce, second contact, where
 * everything ends up — solves the shot for the player and turns a game of touch into a game of
 * reading a line. The first segment is the aim itself; everything after it is the part they are
 * supposed to be judging. Same principle as a hint that checks rather than answers.
 *
 * Honours `bumperRim`: with walls the ray stops where the disc's EDGE meets the rim, without them
 * where its CENTRE leaves the board — the same asymmetry the solver uses, so the preview cannot
 * disagree with what then happens.
 */
export function firstContact(state: SimState, shooter: Disc, angle: number, config: SimConfig): Contact {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  let best = boundaryDistance(shooter, cos, sin, config)
  let hit: number | null = null

  for (const other of state.discs) {
    if (!other.alive || other.id === shooter.id) continue

    const dx = other.x - shooter.x
    const dy = other.y - shooter.y
    // Distance along the ray to the point nearest this disc. Negative means it is behind us.
    const along = dx * cos + dy * sin
    if (along <= 0) continue

    const contact = shooter.r + other.r
    const perpendicularSquared = dx * dx + dy * dy - along * along
    if (perpendicularSquared > contact * contact) continue

    // Where the two rims meet, which is short of the nearest-point distance by the half-chord.
    const distance = Math.max(0, along - Math.sqrt(contact * contact - perpendicularSquared))
    if (distance < best) {
      best = distance
      hit = other.id
    }
  }

  return { discId: hit, distance: best, x: shooter.x + cos * best, y: shooter.y + sin * best }
}

/** Distance along the ray until the disc leaves play — its centre crossing the board's edge, or its
 * rim meeting the wall in `bumperRim` mode. */
function boundaryDistance(shooter: Disc, cos: number, sin: number, config: SimConfig): number {
  const inset = config.bumperRim ? shooter.r : 0
  const minX = inset
  const maxX = config.boardW - inset
  const minY = inset
  const maxY = config.boardH - inset

  let best = Number.POSITIVE_INFINITY
  if (cos > 0) best = Math.min(best, (maxX - shooter.x) / cos)
  else if (cos < 0) best = Math.min(best, (minX - shooter.x) / cos)
  if (sin > 0) best = Math.min(best, (maxY - shooter.y) / sin)
  else if (sin < 0) best = Math.min(best, (minY - shooter.y) / sin)

  return Math.max(0, best)
}

/**
 * The player's disc under a press, or `null`.
 *
 * §2's trap 4 in one function: with the whole board a drag surface and no pan gesture to share it
 * with, "did this press land on one of your own live discs" is the ONLY thing separating an aim
 * from an idle tap. Nearest wins, so two discs whose slop circles overlap resolve to the one the
 * player was actually closest to rather than to whichever comes first in the array.
 */
export function discAt(state: SimState, x: number, y: number, side: Disc['side'], factor: number = GRAB_RADIUS_FACTOR): Disc | null {
  let found: Disc | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const disc of state.discs) {
    if (!disc.alive || disc.side !== side) continue
    const distance = Math.hypot(x - disc.x, y - disc.y)
    // Scaled by the disc's OWN radius, so a wide artillery stack is grabbable over a
    // proportionally wider area rather than by the same absolute margin as a plane.
    if (distance > disc.r * factor) continue
    if (distance < bestDistance) {
      bestDistance = distance
      found = disc
    }
  }

  return found
}
