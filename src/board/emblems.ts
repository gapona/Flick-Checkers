/**
 * Every branch emblem and stack rider, as geometry — and **no Phaser**, for the same reason
 * `board/layout.ts` and `src/sim/` have none.
 *
 * ## Why this is a module and not a hundred lines inside `discTextures.ts`
 *
 * It used to be exactly that, and the cost was found rather than predicted: `npm run sheet` renders
 * every board set against every piece set and **drew the discs bare** — no marks, no riders —
 * because `discTextures.ts` imports Phaser and a `node` script cannot execute it. So the one surface
 * this project uses to catch palette collisions could not see the emblems at all, and a rider drawn
 * in fixed gold on a gold disc shipped: `METAL.mid` is `ffc23c` against the player ramp's `f5b52e`,
 * which is the same colour twice, on three of the five piece sets (`classic`, `ember` and `bone`
 * all put the player near hue 40). Reported as "непонятно шото" with a screenshot, and it is not a
 * shape problem — it is a gold gun on a gold disc separated by one pixel of contour.
 *
 * With the shapes out here, `npm run sheet:branches` draws the SAME geometry the game rasterises,
 * so the sheet cannot flatter the product. That is the property `render-skin-sheet.mjs` explicitly
 * does not have for the disc body, and its header says so; this is that duplication not being made
 * a second time.
 *
 * ## The coordinate system
 *
 * Every shape is written in unit coordinates inside its own box: `(0,0)` top-left, `(1,1)`
 * bottom-right, `+v` DOWN, matching board space. The consumer maps that box onto pixels — the disc
 * face for a mark, the texture for a rider — so the same numbers serve a 26px emblem on a phone and
 * a contact sheet at four times that.
 *
 * ## What "recognisable at this size" means here
 *
 * A disc is ~37px on the target phone and the emblem inside it about 26px. The set is separated on
 * SILHOUETTE CLASS — open cross, open ring, thin arrow, bar-between-wheels, compact round — never on
 * interior detail, which does not survive the downscale and could not be tinted anyway. Two shapes
 * that are 95% the same at game size are one shape however different they look large.
 */

/**
 * The direction the light comes from, shared by every asset in the game — top-left, and steeper than
 * it is wide so a disc reads as domed rather than as lit from the side.
 */
export const LIGHT = { x: -0.55, y: -0.8 }

/** The near-black every disc, emblem and rider is contoured in. Dark enough to hold a shape against
 * any piece ramp, not black, which reads as a hole punched through. */
export const OUTLINE = 0x241033

/** The metal every branch top is drawn in — the same gold the atlas generator reserves for "the only
 * metal in the game", so a gun and a coin belong to the same world. */
export const METAL = { light: 0xffeaa8, mid: 0xffc23c, deep: 0xc87a18 }

/**
 * Side of the square a MARK is drawn in, as a multiple of the disc body's radius — so a branch with
 * a bigger radius gets a proportionally bigger emblem rather than the same one floating in more
 * space.
 *
 * The ceiling is set by the one emblem that reaches into its box's corners — the aircraft, whose
 * wingtips sit at (0.99, 0.99), i.e. 0.693 box-widths from the centre. Keeping that inside the body
 * needs `k <= 1.44`. 1.30 puts it at 0.90 of the body radius, clear of the contour.
 *
 * **Raised from 1.15 after looking at it.** At 1.15 the round emblem (the horseshoe) covered barely
 * half the disc's face while the diagonal one (the crossed rifles) looked full — a circle inscribed
 * in a square reads much smaller than a diagonal spanning the same square, and the arithmetic that
 * sized the box could not see that. Revisit this if a new emblem reads small.
 */
export const MARK_BOX = 1.3
export const MARK_ALPHA = 0.85

/**
 * How far a mark is pushed from the disc's ramp toward the contour.
 *
 * Needed because `deep` alone does not give every set the same contrast: the gold ramp drops a long
 * way from `mid` to `deep`, the violet one much less, so the identical formula printed a crisp mark
 * on one side of the board and a faint one on the other. Pushing toward the outline closes that gap
 * proportionally — it moves the short ramp further than the long one.
 *
 * The riders needed the same treatment and never got it, which is the whole of the bug this module's
 * header describes. Theirs is {@link RIDER_SHADOW_ALPHA}, because a rider sits ON the disc rather
 * than being printed into it and cannot be recoloured toward it without ceasing to be metal.
 */
export const MARK_DEEPEN = 0.3

/** The box a RIDER is drawn in, as a fraction of the whole texture. Riders sit ON the disc rather
 * than in its face, so they are sized against the texture and not against the body. */
export const RIDER_BOX = 0.68

/**
 * A rider's own cast shadow — offset as a fraction of its box, and the contrast fix.
 *
 * See this module's header for the measurement. Briefly: the metal is fixed gold whatever the disc
 * under it is wearing, three of the five piece sets put the player's discs at the same hue, and the
 * only thing separating them was a contour that is a hairline once a 128px texture is drawn at the
 * 37px a disc occupies on a phone.
 *
 * A cast shadow fixes every palette at once and says the right thing while doing it: a rider IS a
 * separate piece sitting on top (§2's trap 2 forbids modelling that in the solver, so the sprite has
 * to carry the whole message), and a shadow is how a flat picture says one thing is above another.
 * Thrown away from {@link LIGHT}, like every other shadow in the game.
 */
export const RIDER_SHADOW_OFFSET = 0.055
export const RIDER_SHADOW_ALPHA = 0.42
export const SHADOW_INK = 0x000000

/** Which tone a shape is painted in. The consumer owns the actual colours: a mark resolves all four
 * to one ink (it is printed into the disc's face), a rider resolves them to a dark contour and the
 * three stops of the metal. */
export type EmblemTone = 'ink' | 'deep' | 'mid' | 'light'

interface Common {
  tone: EmblemTone
  /** Widens the shape by this fraction of the box before filling — how the dark contour is laid
   * down, as the same shape drawn once grown in `ink` and again at zero in the metal. */
  grow?: number
  alpha?: number
}

export type EmblemShape =
  | (Common & { kind: 'rect'; u0: number; v0: number; u1: number; v1: number })
  | (Common & { kind: 'circle'; u: number; v: number; r: number })
  /** A rotated rectangle given its centre, length, width and angle in degrees — the one primitive
   * neither Phaser's nor Canvas's fill helpers provide, and the one most of these shapes are made
   * of. Emitted as a polygon by {@link shapePoints} so a consumer only ever needs `fillPoints`. */
  | (Common & { kind: 'bar'; cu: number; cv: number; len: number; wid: number; deg: number })
  | (Common & { kind: 'poly'; points: readonly (readonly [number, number])[] })
  /** A stroked arc — the only shape here that is a line rather than a fill, and the horseshoe needs
   * it: the ring must not paint the disc's face, or it flattens the ramp's highlight exactly where
   * the dome reads. */
  | (Common & { kind: 'arc'; u: number; v: number; r: number; fromDeg: number; toDeg: number; width: number })

/** The emblem printed across a disc's face. `'none'` is a branch whose stacks wear a rider instead —
 * a rider sits exactly where a mark would go and would hide it. */
export type BranchMark = 'none' | 'rifles' | 'horseshoe' | 'aircraft'

/** The piece riding on a stack (§4's artillery and tanks), one silhouette each. */
export type StackTop = 'gun' | 'turret' | null

/**
 * Crossed pair. The game's infantry mark was already an X, and at 26px a rifle IS an X — stock,
 * bolt and sight are all sub-pixel, and the crossed pair is the heraldic answer anyway (it is the
 * infantry insignia precisely because a single rifle does not read small).
 */
const RIFLES: EmblemShape[] = [
  { kind: 'bar', cu: 0.5, cv: 0.5, len: 0.94, wid: 0.155, deg: 55, tone: 'ink' },
  { kind: 'bar', cu: 0.5, cv: 0.5, len: 0.94, wid: 0.155, deg: -55, tone: 'ink' },
]

/**
 * The only open ring in the set, and the second attempt: a sabre measured fine and read as a *fin*,
 * because two near-equal ellipses make a fat crescent and a crescent at 26px has neither blade nor
 * guard. An open ring survives where a taper cannot — the downscale always closes a taper and never
 * closes a hole. The heel calks are what stop it being an arch, a magnet or a letter C.
 */
const HORSESHOE: EmblemShape[] = [
  // Anticlockwise=false takes the long way round — up over the toe — leaving the heels open.
  { kind: 'arc', u: 0.5, v: 0.5, r: 0.38, fromDeg: 145, toDeg: 35, width: 0.2, tone: 'ink' },
  { kind: 'circle', u: 0.5 + 0.38 * Math.cos((145 * Math.PI) / 180) + 0.02, v: 0.5 + 0.38 * Math.sin((145 * Math.PI) / 180), r: 0.125, tone: 'ink' },
  { kind: 'circle', u: 0.5 - 0.38 * Math.cos((145 * Math.PI) / 180) - 0.02, v: 0.5 + 0.38 * Math.sin((145 * Math.PI) / 180), r: 0.125, tone: 'ink' },
]

/**
 * A swept-wing aircraft from above, apex up-board. The only arrow in the set, and thin on purpose:
 * a filled delta measured as one shape against the tank rider at 26px. The deep rear notch and the
 * separated fuselage stem are what buy the distinction.
 */
const AIRCRAFT: EmblemShape[] = [
  {
    kind: 'poly',
    tone: 'ink',
    points: [
      [0.5, 0.02],
      [0.99, 0.86],
      [0.99, 0.99],
      [0.57, 0.34],
      [0.565, 0.86],
      [0.5, 0.99],
      [0.435, 0.86],
      [0.43, 0.34],
      [0.01, 0.99],
      [0.01, 0.86],
    ],
  },
]

export const MARK_SHAPES: Record<Exclude<BranchMark, 'none'>, readonly EmblemShape[]> = {
  rifles: RIFLES,
  horseshoe: HORSESHOE,
  aircraft: AIRCRAFT,
}

/** How far a rider's dark contour is grown, in box fractions. Generous, and it is the contrast fix:
 * the old value was 4px of a 128px texture, which is 1.2px once a disc is drawn at 37px on a phone —
 * a hairline, and a hairline was the ONLY thing separating a gold rider from a gold disc. */
const RIDER_GROW = 0.08

/**
 * §4's artillery rider: **a field gun in profile — barrel, wheel, trail.**
 *
 * The fourth attempt, and every earlier one is why this is not drawn from above. It was authored
 * with a muzzle brake and read as a hammer; the crossbar came off and the bar-on-a-block that was
 * left read as an anvil, which is how the live game reported it; a barrel between two wheels, seen
 * from above, put the barrel and the trail on ONE vertical line and read as a plumb bob with two
 * dots. Checked on the 1x block of `npm run sheet:branches` each time, which is the only size that
 * decides anything.
 *
 * **A gun from directly above has no silhouette.** That is the finding, and it is not a failure of
 * the three shapes: from above a field piece is a stick with symmetrical furniture, and everything
 * that says "gun" — the barrel's length against its mount, the wheel standing beside it, the trail
 * raking back — is exactly what the top-down view collapses. The tank survives the same view because
 * a turret from above genuinely IS a circle with a barrel; artillery is not so lucky.
 *
 * So this one is in profile, and the set can carry that: the marks beside it are heraldic already
 * (crossed rifles are the infantry insignia, not a picture of a rifle from above), so the emblems
 * were never a consistent projection to break. The silhouette class is a bold diagonal crossing a
 * circle, which nothing else here occupies — the tank's circle is centred under a short VERTICAL
 * stub, and the aircraft's diagonal has no circle anywhere near it.
 */
const GUN: EmblemShape[] = [
  // Contour first, every piece grown, so the dark edge is continuous under the whole assembly.
  { kind: 'bar', cu: 0.165, cv: 0.845, len: 0.34, wid: 0.1, deg: 142, tone: 'ink', grow: RIDER_GROW },
  { kind: 'circle', u: 0.32, v: 0.72, r: 0.235, tone: 'ink', grow: RIDER_GROW },
  { kind: 'bar', cu: 0.58, cv: 0.42, len: 0.8, wid: 0.21, deg: -29, tone: 'ink', grow: RIDER_GROW },

  { kind: 'bar', cu: 0.165, cv: 0.845, len: 0.34, wid: 0.1, tone: 'deep', deg: 142 },
  { kind: 'circle', u: 0.32, v: 0.72, r: 0.235, tone: 'deep' },
  { kind: 'bar', cu: 0.58, cv: 0.42, len: 0.8, wid: 0.21, deg: -29, tone: 'deep' },

  // The lit half, from the same top-left light every other asset in the game uses: a thinner bar
  // riding the barrel's upper edge, and the wheel's hub.
  { kind: 'bar', cu: 0.553, cv: 0.372, len: 0.78, wid: 0.085, deg: -29, tone: 'mid' },
  { kind: 'circle', u: 0.3, v: 0.7, r: 0.105, tone: 'mid' },
]

/**
 * §4's tank rider, seen from above: a squat turret with a stub barrel. The compact round one, and
 * the highest solidity in the set by design, so it cannot be confused with the open shapes even once
 * the metal flattens it.
 */
const TURRET: EmblemShape[] = [
  { kind: 'circle', u: 0.5, v: 0.6, r: 0.37, tone: 'ink', grow: RIDER_GROW },
  { kind: 'rect', u0: 0.42, v0: 0.03, u1: 0.58, v1: 0.62, tone: 'ink', grow: RIDER_GROW },

  { kind: 'circle', u: 0.5, v: 0.6, r: 0.37, tone: 'deep' },
  { kind: 'rect', u0: 0.42, v0: 0.03, u1: 0.58, v1: 0.62, tone: 'deep' },

  { kind: 'circle', u: 0.45, v: 0.55, r: 0.27, tone: 'mid' },
  { kind: 'circle', u: 0.4, v: 0.5, r: 0.13, tone: 'light', alpha: 0.75 },
]

export const RIDER_SHAPES: Record<Exclude<StackTop, null>, readonly EmblemShape[]> = {
  gun: GUN,
  turret: TURRET,
}

/**
 * A shape's outline as unit-coordinate points, for a consumer that only wants to fill polygons.
 *
 * `'circle'` and `'arc'` are NOT expressible this way and are returned as `null` — a caller must
 * handle those two natively, because approximating a 26px circle with a polygon is exactly the kind
 * of thing that makes a contact sheet disagree with the product.
 */
export function shapePoints(shape: EmblemShape): (readonly [number, number])[] | null {
  if (shape.kind === 'poly') return shape.points.map((p) => p)
  if (shape.kind === 'rect') {
    const g = shape.grow ?? 0
    return [
      [shape.u0 - g, shape.v0 - g],
      [shape.u1 + g, shape.v0 - g],
      [shape.u1 + g, shape.v1 + g],
      [shape.u0 - g, shape.v1 + g],
    ]
  }
  if (shape.kind === 'bar') {
    const a = (shape.deg * Math.PI) / 180
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const hl = shape.len / 2
    const hw = shape.wid / 2
    return [
      [shape.cu + dx * hl - dy * hw, shape.cv + dy * hl + dx * hw],
      [shape.cu + dx * hl + dy * hw, shape.cv + dy * hl - dx * hw],
      [shape.cu - dx * hl + dy * hw, shape.cv - dy * hl - dx * hw],
      [shape.cu - dx * hl - dy * hw, shape.cv - dy * hl + dx * hw],
    ]
  }
  return null
}
