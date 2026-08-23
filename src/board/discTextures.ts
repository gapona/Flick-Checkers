import * as Phaser from 'phaser'
import type { PieceSet, PieceSetId, Ramp } from '../game/skins'

/**
 * The disc art, generated once at runtime.
 *
 * **Why this is not in the atlas, and never will be.** A disc has to be recoloured per skin —
 * `game/skins.ts` sells seven board sets and five disc sets, worn independently — and a baked
 * colour sprite cannot take part in that. Everything here is drawn from a `Ramp` handed in by the
 * caller, which is what makes 35 combinations one code path instead of 35 assets. The atlas holds
 * what is genuinely fixed (the coin, the rim, the particles) and no disc frame at all.
 *
 * The shadow is a separate texture for the reason GAME-PLAN.md §2 gives: baked into the disc it
 * travels with it, so a disc tumbling off the edge takes its shadow along and reads as a sticker
 * rather than a solid object on a surface.
 *
 * **Textures rather than `add.circle()` shapes**, for one concrete reason: a texture can carry real
 * shading, an emblem and a milled rim, none of which a flat `Arc` can. It also keeps `discView.ts`
 * pointing at a texture key, so any future change of art is a change of key and not a rebuild of
 * the object graph.
 *
 * Everything is drawn to the same palette and the same light direction `scripts/make-atlas.mjs`
 * uses, so the discs and the coin belong to one world.
 */

/**
 * One light direction for every asset, from the top-left — the same constant
 * `scripts/make-atlas.mjs` opens with. Duplicated rather than imported because that file is a
 * dev-only `.mjs` generator with a `@napi-rs/canvas` dependency that must never reach the bundle.
 * If it changes there, change it here.
 */

/** The atlas generator's own ramps for the two sides of the default skin. Distinguished by HUE, so
 * the two sides stay apart for a player who cannot use colour alone — reinforced by the board being
 * a third, unrelated family (cyan). */
/** The authored pair now lives in `game/skins.ts` as `classic`, alongside every other set — this
 * module draws whatever ramp it is handed and owns no palette of its own. */

/** The thick dark contour that holds a disc readable at a ~37px tile on a phone. */

/**
 * The stencil a branch of arms wears on its face (GAME-PLAN.md §4).
 *
 * Named after the thing drawn rather than after the stroke that draws it (`'rifles'`, not
 * `'cross'`), because these stopped being strokes: each is a constructed silhouette chosen and
 * measured at the 26px it actually occupies. See {@link drawMark} for how they were arrived at and
 * why they are not rendered art.
 *
 * **`'none'` is not a gap.** Artillery and tanks are the two branches that field stacks, and a stack
 * already carries a second disc with a gun or a turret riding on it — which sits exactly where a
 * mark would go and would hide it. Those two are distinguished already; the three that are not are
 * the three that get a stencil. So every branch has a mark, and for two of them the mark is the
 * thing that was there all along.
 *
 * **What a mark is FOR is worth stating, because it is not identification.** A round is played
 * entirely by one branch, so the player already knows what they are holding. It is about weight: a
 * disc that looks like a tank reads heavy before it is flicked, and that reading happens to be
 * true — mass 2.5, friction x1.4.
 */
export type { BranchMark, StackTop } from './emblems'
import {
  LIGHT,
  MARK_ALPHA,
  MARK_BOX,
  MARK_DEEPEN,
  MARK_SHAPES,
  METAL,
  OUTLINE,
  RIDER_BOX,
  RIDER_SHADOW_ALPHA,
  RIDER_SHADOW_OFFSET,
  RIDER_SHAPES,
  SHADOW_INK,
  shapePoints,
  type BranchMark,
  type EmblemShape,
  type EmblemTone,
  type StackTop,
} from './emblems'

/**
 * Disc textures are keyed **per piece set and per mark**, not per side.
 *
 * A combination is generated the first time it is worn and then cached in Phaser's texture manager
 * for the rest of the session, so switching sets in the shop costs one rasterise and switching back
 * costs nothing. Keying by combination is what makes that safe: a single `'disc-player'` key would
 * have to be destroyed and rebuilt on every change, and any sprite still holding it — a disc
 * mid-fall, say — would be pointing at a texture that no longer exists.
 *
 * The mark is BAKED INTO the disc rather than ridden on top of it as its own sprite, which is the
 * opposite of what the stacks do. A stack's rider has to be a sprite because it splits away from
 * its parent mid-round; a mark never moves relative to its disc, and a sprite for it would be 16
 * more display-list entries on exactly the frames the solver and the bot search want. The price is
 * a few more texture keys, built lazily — a round touches one branch and one set, so two.
 */
export function discTextureKey(side: 'player' | 'opponent', set: PieceSetId, mark: BranchMark = 'none'): string {
  return `disc-${side}-${set}-${mark}`
}

export const DISC_TEXTURE_SHADOW = 'disc-shadow'

/**
 * The piece riding on a stack (§4's artillery and tanks), one silhouette each.
 *
 * §2's trap 2 forbids real verticality, so a stack has to say "there are two of us here" in one
 * flat sprite. A smaller disc says it, but says nothing about WHICH branch — and the two play very
 * differently (1.8 mass and wide, against 2.5 mass and draggy), so a player who cannot tell them
 * apart at a glance is being asked to remember rather than to look.
 */
export const DISC_TEXTURE_GUN = 'disc-top-gun'
export const DISC_TEXTURE_TURRET = 'disc-top-turret'

/** Which top a branch's stacks wear. `null` for a branch that fields no stacks. */
/** {@link StackTop} lives in `emblems.ts` with the geometry it names, and is re-exported above so
 * `discView.ts` and `formations.ts` keep importing both types from one place. */

export function stackTopTexture(top: StackTop): string | null {
  if (top === 'gun') return DISC_TEXTURE_GUN
  if (top === 'turret') return DISC_TEXTURE_TURRET
  return null
}

/**
 * Source resolution of one disc texture, in pixels.
 *
 * A disc is 0.8 of a cell across, i.e. ~37px on a 390px phone and ~70px on a 1280px desktop, so
 * 128 is comfortably above the largest size it is ever drawn at — a texture is only ever scaled
 * DOWN, never up, and the same file serves both.
 */
export const DISC_TEXTURE_SIZE = 128

/** Margin inside the texture, so the outline is never clipped by the texture's own edge. */
const TEXTURE_MARGIN = 3

/** Rings used to fake a radial ramp. `Graphics.generateTexture()` renders through the Canvas API,
 * where `fillGradientStyle` is unsupported (Phaser says so in its own docs), so the shading is a
 * stack of offset circles instead. Twenty-four is past the point where banding is visible at the
 * sizes above. */
const SHADE_RINGS = 24

/** How far the ramp's centre is pushed toward the light, as a fraction of the disc's radius. This
 * is the entire reason the disc reads as domed rather than as a flat counter. */
const SHADE_OFFSET = 0.3

const OUTLINE_WIDTH = 7

/**
 * The player's discs are MILLED; the opponent's are smooth.
 *
 * **This is chunk 11's blocker remedy, and it is a remedy for a real measurement.** Gold against
 * violet is a hue distinction, and greyscale is where a hue distinction goes to die — `verify:contrast`
 * measures the gap and the weakest set (`ember`, warm against warm) sits at 1.45:1 through the mass
 * of the disc. That is above the threshold, not comfortably above it, and it is the same number a
 * colour-blind player has to work with all the time rather than only in a screenshot.
 *
 * So the sides differ by FORM as well: twelve shallow scallops around the player's contour, like the
 * milled edge of a coin, against a plain circle. Chunk 11's own argument for why this is cheap here
 * and was not in the isometric draughts project is exactly right — seen from straight above, the rim
 * is a full circle on screen rather than a foreshortened ellipse, so a shape cut into it reads at any
 * angle and at any position on the board.
 *
 * Cut into the CONTOUR, never the body: the body is what the ramp and the gloss are drawn on, and it
 * is also what the player reads as the disc's size when judging a gap. A polygonal body would make a
 * disc look smaller than the radius the solver actually uses.
 */
const RIM_SCALLOPS = 12
/** Each scallop's radius, as a fraction of the contour's. Sized so the notch reads at the ~18px
 * on-screen radius of a disc on a 390px phone, which is the only size that matters. */
const RIM_SCALLOP_RADIUS = 0.13

/**
 * Side of the square the emblem is drawn in, as a multiple of the disc BODY's radius — so a branch
 * with a bigger radius gets a proportionally bigger emblem rather than the same one floating in
 * more space.
 *
 * The ceiling is set by the one emblem that actually reaches into its box's corners — the aircraft,
 * whose wingtips sit at (0.99, 0.99), i.e. 0.693 box-widths from the centre. Keeping that inside the
 * body needs `k ≤ 1.44`. 1.30 puts it at 0.90 of the body radius, clear of the contour with room to
 * spare, and every other shape here stays well inside that.
 *
 * **Raised from 1.15 after looking at it.** At 1.15 the round emblem (the horseshoe) covered barely
 * half the disc's face while the diagonal one (the crossed rifles) looked full — a circle inscribed
 * in a square reads much smaller than a diagonal spanning the same square, and the arithmetic that
 * sized the box could not see that. This is the constant to revisit if a new emblem reads small.
 */
/**
 * How far the mark is pushed from the ramp toward the contour.
 *
 * Needed because `deep` alone does not give every set the same contrast: the gold ramp drops a long
 * way from `mid` to `deep`, the violet one much less, so the identical formula printed a crisp mark
 * on one side of the board and a faint one on the other. Pushing toward the outline closes that gap
 * proportionally — it moves the short ramp further than the long one — without going all the way to
 * the contour, which would read as a hole punched through the disc.
 */

const SHADOW_RINGS = 14

function lerpChannel(from: number, to: number, t: number, shift: number): number {
  const a = (from >> shift) & 0xff
  const b = (to >> shift) & 0xff
  return Math.round(a + (b - a) * t) << shift
}

function lerpColor(from: number, to: number, t: number): number {
  return lerpChannel(from, to, t, 16) | lerpChannel(from, to, t, 8) | lerpChannel(from, to, t, 0)
}

/** `deep` at the rim through `mid` to `light` at the lit centre — a two-stop ramp, because a
 * straight deep-to-light interpolation washes the mid tone out and the disc loses its hue. */
function rampColor(ramp: Ramp, t: number): number {
  return t < 0.5 ? lerpColor(ramp.deep, ramp.mid, t * 2) : lerpColor(ramp.mid, ramp.light, (t - 0.5) * 2)
}

function drawDisc(graphics: Phaser.GameObjects.Graphics, ramp: Ramp, mark: BranchMark = 'none', milled = false): void {
  const centre = DISC_TEXTURE_SIZE / 2
  const outer = centre - TEXTURE_MARGIN
  const body = outer - OUTLINE_WIDTH

  graphics.fillStyle(OUTLINE, 1)
  graphics.fillCircle(centre, centre, outer)

  for (let i = 0; i < SHADE_RINGS; i++) {
    const t = i / (SHADE_RINGS - 1)
    // Each ring is smaller than the last and sits a little further toward the light, so the
    // brightest point ends up off-centre rather than in the middle.
    const radius = body * (1 - t * 0.92)
    const offset = body * SHADE_OFFSET * t
    graphics.fillStyle(rampColor(ramp, t), 1)
    graphics.fillCircle(centre + LIGHT.x * offset, centre + LIGHT.y * offset, radius)
  }

  // AFTER the body rings, so the scallops bite into the coloured face rather than being covered by
  // it. Each sits astride the face/contour boundary: its outer half lands on the contour and is
  // invisible there, its inner half is the notch. The texture box is unchanged, so a milled disc and
  // a smooth one are interchangeable to `discView`.
  if (milled) {
    graphics.fillStyle(OUTLINE, 1)
    const bump = outer * RIM_SCALLOP_RADIUS
    for (let i = 0; i < RIM_SCALLOPS; i++) {
      const angle = (i / RIM_SCALLOPS) * Math.PI * 2
      graphics.fillCircle(centre + Math.cos(angle) * body, centre + Math.sin(angle) * body, bump)
    }
  }

  // The mark goes on BEFORE the gloss, so the highlight passes over it and it reads as printed
  // under the varnish rather than stuck on afterwards.
  drawMark(graphics, mark, ramp)

  // The specular kick. Small, high and soft-edged in two passes — a single hard white dot reads as
  // a hole punched in the disc.
  const glossX = centre + LIGHT.x * body * 0.46
  const glossY = centre + LIGHT.y * body * 0.46
  graphics.fillStyle(0xffffff, 0.22)
  graphics.fillEllipse(glossX, glossY, body * 0.62, body * 0.42)
  graphics.fillStyle(0xffffff, 0.3)
  graphics.fillEllipse(glossX, glossY, body * 0.34, body * 0.22)
}

/**
 * The branch emblem, drawn across the disc's face.
 *
 * ## Why these are constructed shapes and not rendered art
 *
 * The obvious way to get seven recognisable emblems is to render them. That was tried, on the
 * project's own SDXL pipeline, and measured: of 21 renders, **none** produced the right object in a
 * form that survives the size a disc is actually drawn at. Two of the four failure modes cannot be
 * post-processed away — the model does not hold "one object" (component counts to 45, one render
 * came back a contact sheet of 19 guns), and it draws the SUBJECT rather than the subject's SHAPE,
 * returning a correctly isolated tank rendered as three-quarter line art. The evidence and all four
 * modes are recorded in `Remotion/src/scripts/gen_chapaev_emblems.py`, which is kept for that
 * reason; `gen_bauhaus_icon.py` in the same repo hit the same wall and reached the same conclusion
 * before it.
 *
 * A happy consequence: nothing is shipped, so `ART-SOURCES.md`'s rule that everything a player
 * looks AT is computed stays true, and the build's provenance gate has nothing new to check.
 *
 * ## What "recognisable at this size" actually means
 *
 * A disc is ~37px on the target phone and the emblem inside it about 26px, so every shape was
 * chosen and checked at 26px, never at its drawing resolution. The set is separated on SILHOUETTE
 * CLASS — open cross, open ring, diagonal-plus-blob, wide low mass, thin arrow, vertical
 * bar-and-block, compact round — and never on interior detail, which does not survive the downscale
 * and could not be tinted anyway. A gate measures coverage, solidity, component count and, most
 * usefully, the pairwise Hamming distance between every pair of emblems rendered at 26px: two
 * shapes that are 95% the same at game size are one shape however different they look large. All 21
 * pairs clear it, the closest at 0.259.
 *
 * The horseshoe is worth one line of its own, because it is the second attempt: a sabre measured
 * fine and read as a *fin*, since two near-equal ellipses make a fat crescent and a crescent at
 * 26px has neither blade nor guard. An open ring survives where a taper cannot — the downscale
 * always closes a taper and never closes a hole.
 *
 * Drawn in the ramp's own `deep` stop pushed toward the contour, for the reason the strokes these
 * replaced used: the contour's near-black reads as a hole punched through the disc, the ramp's
 * darkest tone reads as something printed on it. Still drawn BEFORE the gloss, so the highlight
 * passes over the emblem and it sits under the varnish rather than on top of it.
 */
function drawMark(graphics: Phaser.GameObjects.Graphics, mark: BranchMark, ramp: Ramp): void {
  if (mark === 'none') return

  const centre = DISC_TEXTURE_SIZE / 2
  const body = centre - TEXTURE_MARGIN - OUTLINE_WIDTH
  const box = body * MARK_BOX
  const ink = lerpColor(ramp.deep, OUTLINE, MARK_DEEPEN)

  // One ink for all four tones: a mark is PRINTED into the disc's face, so it has no lit side. The
  // tone field exists for the riders, which do.
  paintShapes(graphics, MARK_SHAPES[mark], box, centre - box / 2, centre - box / 2, { ink, deep: ink, mid: ink, light: ink }, MARK_ALPHA)
}

/**
 * Runs a list of {@link EmblemShape} into a `Graphics`, mapping the unit box onto pixels.
 *
 * The whole reason `emblems.ts` exists: this executor and the canvas one in
 * `scripts/render-branch-sheet.mjs` consume the SAME shape list, so the contact sheet cannot draw an
 * emblem the game does not have. Circles and arcs are drawn natively rather than through
 * {@link shapePoints}, because approximating a 26px circle with a polygon is exactly how a sheet
 * starts disagreeing with the product.
 */
function paintShapes(
  graphics: Phaser.GameObjects.Graphics,
  shapes: readonly EmblemShape[],
  box: number,
  originX: number,
  originY: number,
  tones: Record<EmblemTone, number>,
  defaultAlpha = 1,
): void {
  const ux = (u: number): number => originX + u * box
  const uy = (v: number): number => originY + v * box
  const us = (size: number): number => size * box

  for (const shape of shapes) {
    const colour = tones[shape.tone]
    const alpha = shape.alpha ?? defaultAlpha

    if (shape.kind === 'arc') {
      graphics.lineStyle(us(shape.width), colour, alpha)
      graphics.beginPath()
      graphics.arc(ux(shape.u), uy(shape.v), us(shape.r), Phaser.Math.DegToRad(shape.fromDeg), Phaser.Math.DegToRad(shape.toDeg), false)
      graphics.strokePath()
      continue
    }

    graphics.fillStyle(colour, alpha)
    if (shape.kind === 'circle') {
      graphics.fillCircle(ux(shape.u), uy(shape.v), us(shape.r + (shape.grow ?? 0)))
      continue
    }

    const points = shapePoints(shape)
    if (points) graphics.fillPoints(points.map(([u, v]) => new Phaser.Math.Vector2(ux(u), uy(v))), true)
  }
}

/**
 * The contact shadow, as its own texture.
 *
 * Soft-edged by stacking translucent circles from the outside in, since there is no blur available
 * here. It is drawn at the same source size as the disc and scaled up slightly by the view, so the
 * penumbra reaches past the disc's own silhouette.
 */
function drawShadow(graphics: Phaser.GameObjects.Graphics): void {
  const centre = DISC_TEXTURE_SIZE / 2
  const outer = centre - TEXTURE_MARGIN

  for (let i = 0; i < SHADOW_RINGS; i++) {
    const t = i / (SHADOW_RINGS - 1)
    graphics.fillStyle(SHADOW_INK, 0.05 + t * 0.055)
    graphics.fillCircle(centre, centre, outer * (1 - t * 0.72))
  }
}

/** The metal every branch top is drawn in — the same gold ramp the atlas generator reserves for
 * "the only metal in the game", so a gun and a coin belong to the same world. */

/**
 * The box a rider is drawn in, as a fraction of the whole texture. Riders sit ON the disc rather
 * than in its face, so they are sized against the texture and not against the body.
 */

/**
 * How far a rider's own shadow is thrown, as a fraction of its box — and this is the contrast fix.
 *
 * A rider is drawn in fixed gold `METAL` whatever the disc under it is wearing, and three of the
 * five piece sets put the player's own discs at hue 40, i.e. the same gold. The only thing
 * separating the two was the contour, which is a hairline once a 128px texture is drawn at the 37px
 * a disc occupies on a phone — so on `classic`, `ember` and `bone` the artillery gun was gold on
 * gold and read, in the words of the report, as "непонятно шото".
 *
 * A drop shadow fixes it on every palette at once and says the right thing while doing it: a rider
 * is a SEPARATE piece sitting on top of the disc (§2's trap 2 forbids modelling that in the solver,
 * so the sprite has to carry the whole message), and a cast shadow is how a flat picture says one
 * thing is above another. Thrown away from the same top-left light every other asset uses.
 *
 * The alternative — recolouring the metal per piece set — was rejected: gold is the only metal in
 * this game, a second one would make a stack read as a different material rather than a different
 * branch, and it would still need a value check against seven board sets underneath.
 */

/** The metal every branch top is drawn in — the same gold ramp the atlas generator reserves for
 * "the only metal in the game", so a gun and a coin belong to the same world. */
const RIDER_TONES: Record<EmblemTone, number> = { ink: OUTLINE, deep: METAL.deep, mid: METAL.mid, light: METAL.light }
const SHADOW_TONES: Record<EmblemTone, number> = { ink: SHADOW_INK, deep: SHADOW_INK, mid: SHADOW_INK, light: SHADOW_INK }

/**
 * One stack rider, shadow and all.
 *
 * The shapes themselves are in `emblems.ts` — see {@link RIDER_SHAPES} for why the artillery gun is
 * a barrel between two wheels rather than the bar-on-a-block it used to be.
 */
function drawRider(graphics: Phaser.GameObjects.Graphics, top: Exclude<StackTop, null>): void {
  const box = DISC_TEXTURE_SIZE * RIDER_BOX
  const origin = (DISC_TEXTURE_SIZE - box) / 2
  const shapes = RIDER_SHAPES[top]

  // The shadow is the CONTOUR pass only — the lit and mid passes sit inside it, so re-casting them
  // would only darken the middle of a shape that is already solid.
  const contour = shapes.filter((shape) => shape.tone === 'ink')
  const throwBy = box * RIDER_SHADOW_OFFSET
  paintShapes(graphics, contour, box, origin - LIGHT.x * throwBy, origin - LIGHT.y * throwBy, SHADOW_TONES, RIDER_SHADOW_ALPHA)

  paintShapes(graphics, shapes, box, origin, origin, RIDER_TONES)
}

/**
 * Creates the disc textures if this game does not already have them.
 *
 * Safe to call from every scene that draws discs: the Texture Manager is game-wide, so the second
 * call is a lookup. Call it in `create()`, before the first disc sprite is made.
 *
 * The generator itself is thrown away immediately — a `Graphics` object is only needed for the few
 * milliseconds it takes to rasterise, and `make.graphics({}, false)` keeps it off the display list
 * so it never renders a frame of its own on the way past.
 */
export function ensureDiscTextures(scene: Phaser.Scene, set: PieceSet, mark: BranchMark = 'none'): void {
  const playerKey = discTextureKey('player', set.id, mark)
  const graphics = scene.make.graphics({}, false)

  // The two disc textures are per (set, mark); everything below is neither, so it is generated once
  // and then skipped for every later combination.
  if (!scene.textures.exists(playerKey)) {
    drawDisc(graphics, set.player, mark, true)
    graphics.generateTexture(playerKey, DISC_TEXTURE_SIZE, DISC_TEXTURE_SIZE)

    graphics.clear()
    drawDisc(graphics, set.opponent, mark, false)
    graphics.generateTexture(discTextureKey('opponent', set.id, mark), DISC_TEXTURE_SIZE, DISC_TEXTURE_SIZE)
    graphics.clear()
  }

  if (scene.textures.exists(DISC_TEXTURE_SHADOW)) {
    graphics.destroy()
    return
  }

  drawShadow(graphics)
  graphics.generateTexture(DISC_TEXTURE_SHADOW, DISC_TEXTURE_SIZE, DISC_TEXTURE_SIZE)

  graphics.clear()
  drawRider(graphics, 'gun')
  graphics.generateTexture(DISC_TEXTURE_GUN, DISC_TEXTURE_SIZE, DISC_TEXTURE_SIZE)

  graphics.clear()
  drawRider(graphics, 'turret')
  graphics.generateTexture(DISC_TEXTURE_TURRET, DISC_TEXTURE_SIZE, DISC_TEXTURE_SIZE)

  graphics.destroy()
}
