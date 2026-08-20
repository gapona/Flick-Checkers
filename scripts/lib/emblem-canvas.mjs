// Drawing a disc, and the branch emblems on it, into a `@napi-rs/canvas` context.
//
// WHY THIS FILE EXISTS. `src/board/discTextures.ts` rasterises the real thing, and it imports Phaser,
// so no `node` script can execute it. `render-skin-sheet.mjs` therefore reproduced the disc body by
// hand and said so in its own header — the deliberate, single duplication in that script. The
// emblems were never reproduced at all, which is why `npm run sheet` drew every disc BARE and could
// not have caught the gold-rider-on-gold-disc collision that shipped (see `src/board/emblems.ts`).
//
// So the split is: the SHAPES live in `src/board/emblems.ts` with no Phaser in them and are imported
// here unchanged, and only the disc BODY — a ramp, a contour, a gloss, twelve scallops — is
// reproduced. A sheet can now be wrong about the shading and can no longer be wrong about an emblem.
import { shapePoints, OUTLINE as OUTLINE_INT } from '../../src/board/emblems.ts'

/** The game's own contour colour, imported rather than retyped — `render-skin-sheet.mjs` had
 * its own copy at `#180a24` against the game's `0x241033`, which is the drift this whole split
 * exists to stop. */
export const OUTLINE = `#${OUTLINE_INT.toString(16).padStart(6, '0')}`

export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`

/**
 * `board/discTextures.ts`'s disc: an offset radial ramp, a thick contour, a soft gloss — and, for
 * the player's side, the twelve scallops that make the two sides tellable apart with no colour at
 * all (see `RIM_SCALLOPS` there for why they exist).
 *
 * The shading is a real radial gradient where the game stacks 24 offset circles, because
 * `Graphics.generateTexture()` renders through a Canvas API that has no gradient fill and this one
 * does. The result is the same ramp; only the banding differs, and the game has none visible either.
 */
export function drawDiscBody(ctx, cx, cy, r, ramp, milled) {
  ctx.save()
  ctx.fillStyle = 'rgba(6,2,14,0.4)'
  ctx.beginPath()
  ctx.ellipse(cx + 0.16 * r, cy + 0.22 * r, r * 0.98, r * 0.92, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = OUTLINE
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  const body = r * 0.86
  const gx = cx - 0.55 * body * 0.42
  const gy = cy - 0.8 * body * 0.42
  const grad = ctx.createRadialGradient(gx, gy, body * 0.06, cx, cy, body)
  grad.addColorStop(0, hex(ramp.light))
  grad.addColorStop(0.5, hex(ramp.mid))
  grad.addColorStop(1, hex(ramp.deep))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, body, 0, Math.PI * 2)
  ctx.fill()

  if (milled) {
    ctx.fillStyle = OUTLINE
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * body, cy + Math.sin(a) * body, r * 0.13, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
  return body
}

/** The specular kick, drawn AFTER a face mark so the highlight passes over it — the mark reads as
 * printed under the varnish rather than stuck on afterwards, exactly as in the game. */
export function drawGloss(ctx, cx, cy, body) {
  const gx = cx - 0.55 * body * 0.42
  const gy = cy - 0.8 * body * 0.42
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.26)'
  ctx.beginPath()
  ctx.ellipse(gx, gy, body * 0.32, body * 0.22, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const rgba = (colour, alpha) => {
  const r = (colour >> 16) & 0xff
  const g = (colour >> 8) & 0xff
  const b = colour & 0xff
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * Runs a list of `EmblemShape` into a canvas context — the mirror of `discTextures.ts`'s own
 * `paintShapes`, over the SAME shape list, so the two cannot disagree about an emblem.
 *
 * Circles and arcs are drawn natively rather than through `shapePoints`, for the reason that
 * function gives: approximating a 26px circle with a polygon is how a contact sheet starts
 * flattering the product.
 */
export function paintShapes(ctx, shapes, box, originX, originY, tones, defaultAlpha = 1) {
  const ux = (u) => originX + u * box
  const uy = (v) => originY + v * box
  const us = (size) => size * box

  ctx.save()
  for (const shape of shapes) {
    const colour = tones[shape.tone]
    const alpha = shape.alpha ?? defaultAlpha

    if (shape.kind === 'arc') {
      ctx.strokeStyle = rgba(colour, alpha)
      ctx.lineWidth = us(shape.width)
      ctx.beginPath()
      // Canvas measures angles the same way Phaser does (+x at 0, clockwise on a y-down axis), and
      // `false` is anticlockwise=false in both — so the arc takes the same long way round.
      ctx.arc(ux(shape.u), uy(shape.v), us(shape.r), (shape.fromDeg * Math.PI) / 180, (shape.toDeg * Math.PI) / 180, false)
      ctx.stroke()
      continue
    }

    ctx.fillStyle = rgba(colour, alpha)
    if (shape.kind === 'circle') {
      ctx.beginPath()
      ctx.arc(ux(shape.u), uy(shape.v), us(shape.r + (shape.grow ?? 0)), 0, Math.PI * 2)
      ctx.fill()
      continue
    }

    const points = shapePoints(shape)
    if (!points) continue
    ctx.beginPath()
    points.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(ux(u), uy(v)) : ctx.lineTo(ux(u), uy(v))))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}
