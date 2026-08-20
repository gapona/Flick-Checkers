/**
 * What happened during one shot.
 *
 * The solver produces this as it runs, and four separate later chunks read it — which is why it
 * records raw events rather than conclusions. §5's combo counter needs how many enemies one shot
 * removed; §3's `mustTouchEnemy` needs whether any enemy was touched at all; §5's trick points need
 * the ORDER of contacts (a ricochet off your own disc before hitting is a different thing from
 * hitting first and rebounding); §9 needs the ENERGY of each contact, because the impact sound's
 * volume and pitch scale with it and a weak tap that sounds like a hammer is how physics stops
 * being believable; and §8's stack splitting needs the largest impulse a disc absorbed.
 *
 * Deriving any of those from a final board state afterwards is impossible — the information only
 * exists while the step is being taken. So it is collected here, once, and interpreted by whoever
 * needs it.
 *
 * **Pure TypeScript, no Phaser** — same rule as the rest of `src/sim/`.
 */
import type { Side } from './types'

/** One contact, at the moment it was resolved. */
export interface Impact {
  /** Simulated seconds since the shot began. */
  time: number
  /**
   * One of the two discs involved.
   *
   * **`a` and `b` are the pair in the solver's traversal order — NOT shooter and target.** The
   * collision pass walks `i < j`, so `a` is simply whichever disc sits earlier in the array, and a
   * shot fired by a high-id disc appears in `b`. Asking "did my shot hit disc X" means checking
   * both fields; {@link involves} does it. Reading `b` as "the one that was hit" is right half the
   * time, which is the worst kind of wrong.
   */
  a: number
  /** The other disc, or `null` when `a` hit the rim (`bumperRim` mode only). */
  b: number | null
  /** Contact point in board units — where a spark burst or a dust puff goes. */
  x: number
  y: number
  /** Magnitude of the impulse exchanged. The physical measure of "how hard", and what §8's stack
   * threshold is compared against. */
  impulse: number
  /** Closing speed along the line of centres just before the hit, in board units/s. The measure
   * §9's audio wants: it maps to loudness far more directly than impulse does, because it does not
   * also scale with the masses involved. */
  speed: number
}

/** Where a disc left play. `'pit'` is §5's hole in the board, which takes a disc on exactly the
 * same rule as the rim does — its centre going in. */
export type BoardEdge = 'left' | 'right' | 'top' | 'bottom' | 'pit'

export interface KnockedOff {
  time: number
  id: number
  side: Side
  /** Where the centre was when it crossed — within one step's travel of the edge. */
  x: number
  y: number
  edge: BoardEdge
  /** Velocity at the moment it left play. The renderer throws the falling disc with it, so a disc
   * blasted off the board flies and one that dribbles over the line tips. */
  vx: number
  vy: number
}

/** A stack breaking apart under a hard enough hit (§4, §2's trap 2). */
export interface Split {
  time: number
  /** The stack that broke — still on the board, now an ordinary disc of half the mass. */
  id: number
  /** The disc it became two of. */
  into: number
}

export interface SimOutcome {
  /** The disc that was flicked, when this run was a shot. `null` for a run that just settles a
   * board (the opening scatter, a state restored from a save). */
  shooterId: number | null
  shooterSide: Side | null
  /** Fixed steps taken, and the simulated seconds they add up to. */
  steps: number
  elapsed: number
  /**
   * The 6-second ceiling was hit (see `types.ts`'s `MAX_SIM_SECONDS`). **Always a bug, never
   * gameplay** — the caller must treat it as one; `shoot.ts`'s `runToRest` says what it does about
   * it.
   */
  timedOut: boolean
  /** In the order they were resolved. */
  impacts: Impact[]
  knockedOff: KnockedOff[]
  /** Stacks that came apart during this shot. Empty for every branch that fields no stacks. */
  splits: Split[]
  /**
   * Any contact in this shot involved a disc of the side opposing the shooter — including one
   * reached after bouncing off one of the shooter's own discs, which is what "the shot touched an
   * enemy" means in §3's `mustTouchEnemy` and what makes a bank shot legal rather than a penalty.
   * Always `false` for a run with no shooter.
   */
  touchedEnemy: boolean
}

export function createOutcome(shooterId: number | null = null, shooterSide: Side | null = null): SimOutcome {
  return {
    shooterId,
    shooterSide,
    steps: 0,
    elapsed: 0,
    timedOut: false,
    impacts: [],
    knockedOff: [],
    splits: [],
    touchedEnemy: false,
  }
}

/** Whether a given disc took part in a contact, without the caller having to know which side of the
 * pair it landed on — see {@link Impact.a}. */
export function involves(impact: Impact, discId: number): boolean {
  return impact.a === discId || impact.b === discId
}

/** The other disc in a contact, from the point of view of `discId`. `null` for the rim, or if this
 * impact does not involve that disc at all. */
export function otherIn(impact: Impact, discId: number): number | null {
  if (impact.a === discId) return impact.b
  if (impact.b === discId) return impact.a
  return null
}

/** Discs of one side that left the board during this shot. */
export function knockedOffOf(outcome: SimOutcome, side: Side): KnockedOff[] {
  return outcome.knockedOff.filter((entry) => entry.side === side)
}

/**
 * Enemy discs removed by this shot — the number §3's `extraShotOnKnockout` and §5's combo counter
 * both key off. Zero when there is no shooter, since without a side there is no enemy.
 */
export function enemyKnockouts(outcome: SimOutcome): number {
  if (!outcome.shooterSide) return 0
  return outcome.knockedOff.reduce((total, entry) => (entry.side === outcome.shooterSide ? total : total + 1), 0)
}

/** The shooter's own losses — §3's `ownOffIsPenalty`, and the −4 in §6's bot evaluation. */
export function ownKnockouts(outcome: SimOutcome): number {
  if (!outcome.shooterSide) return 0
  return outcome.knockedOff.reduce((total, entry) => (entry.side === outcome.shooterSide ? total + 1 : total), 0)
}

/** The hardest single contact a given disc took, for §8's stack-splitting threshold. */
export function peakImpulseOn(outcome: SimOutcome, discId: number): number {
  let peak = 0
  for (const impact of outcome.impacts) {
    if (impact.a !== discId && impact.b !== discId) continue
    if (impact.impulse > peak) peak = impact.impulse
  }
  return peak
}

/** The hardest contact of the whole shot — what §9 scales the headline impact sound by, and what
 * §5's screen response keys off. `0` for a shot that touched nothing. */
export function peakImpact(outcome: SimOutcome): Impact | null {
  let peak: Impact | null = null
  for (const impact of outcome.impacts) {
    if (!peak || impact.impulse > peak.impulse) peak = impact
  }
  return peak
}
