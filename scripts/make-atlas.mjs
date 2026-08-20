#!/usr/bin/env node
// Generates the game's sprite atlas and background from code (`npm run assets`).
//
// WHY A GENERATOR AND NOT PAINTED FILES: CONCEPT.md §6 fixes an art direction (baked volume, one
// light direction from the top-left, a thick dark contour, gold as the only metal) but the first
// asset set had to come from somewhere before a painter is involved. Expressing it as code makes
// every rule of §6 literally enforceable in one place -- the light direction is one constant, the
// outline width is one constant, and no sprite can drift from the others. The output is an
// ordinary WebP atlas: replacing it later with hand-painted art is a file swap plus the same
// frame names, not a code change.
//
// The output is COMMITTED (`public/assets/`). This script is dev-only tooling; `@napi-rs/canvas`
// is a devDependency and never reaches the bundle. A fresh clone does not need to run it.
//
// Everything here is deterministic (seeded PRNG, no Date/Math.random) so regenerating produces a
// byte-identical file and does not churn git.
import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ATLAS_DIR = path.join(ROOT, 'public/assets/atlas')
const BG_DIR = path.join(ROOT, 'public/assets/bg')

// -- style constants (CONCEPT.md §6) ---------------------------------------------------------

/** One light direction for every asset, from the top-left. Not a per-sprite decision. */
const LIGHT = { x: -0.55, y: -0.8 }

/** The thick dark contour that holds readability at a 28px tile. Drawn heavier on the shadow
 * side than the lit side (§6: "толще снизу и по теневой стороне, тоньше сверху"). */
const OUTLINE = '#241033'
const OUTLINE_W = 6
const OUTLINE_W_SHADOW = 8

/** Gold is the only metal in the game. Every metallic surface uses this one ramp — and it is the
 * one thing a skin never recolours (CONCEPT.md §6: gold is the only metal, in every set). */
const GOLD = { light: '#ffeaa8', mid: '#ffc23c', deep: '#c87a18', dark: '#8a4a08' }

/** The two sides. Distinguished by HUE for colour vision, and by SHAPE by the rim treatment
 * below — CONCEPT.md §6 requires both, since at a 28px tile colour alone is not enough and some
 * players cannot use it at all. These are the DEFAULT skin's; every other skin is these exact
 * ramps with the hue replaced (see {@link SKINS}). */
const SIDE_LIGHT = { light: '#ffe6a0', mid: '#f5b52e', deep: '#b86a10', gem: '#ffd873' }
const SIDE_DARK = { light: '#e2b6ff', mid: '#9b4dff', deep: '#5a1c9c', gem: '#c98cff' }

/** Board squares: two saturated tones of ONE family, deliberately not black/white, and a family
 * that is neither of the two side colours so both sides read against either square. */
const TILE_LIGHT = { top: '#9fe8f0', bottom: '#5cbdd2' }
const TILE_DARK = { top: '#347e98', bottom: '#1c5670' }

/** The scene behind the board, as one recolourable ramp (CONCEPT.md §6.4: one background per
 * skin). `glow` stays warm in every skin — it reads as the light the board is lit by, not as a
 * theme colour. */
const BG = { skyTop: '#4d1780', skyMid: '#341059', skyDeep: '#1b0730', hillFar: '#602c96', hillNear: '#2a0c4a', star: '#ffebbe' }

const TILE_W = 128
const TILE_H = 80
const PIECE_SIZE = 128
/** The disc's centre inside a piece frame, as a fraction of the frame — the frame reserves room
 * above the disc for a crown so men and kings share one frame size and one anchor. Exported to
 * the atlas meta so the game never hardcodes it. */
const PIECE_ANCHOR_Y = 76 / PIECE_SIZE

// -- skins (CONCEPT.md §7) ----------------------------------------------------------------------

/**
 * A themed set is the SAME art with the hue replaced, never a separately authored palette.
 *
 * CONCEPT.md §7 promises that the sets differ in theme and palette but "никогда не читаемостью
 * доски" — the square contrast and the difference between the two sides must be identical in
 * every set. Replacing only the hue and keeping saturation/lightness makes that true BY
 * CONSTRUCTION rather than by four palettes eyeballed to look about equally readable: the whole
 * light/dark relationship (and with it the greyscale test S4.5 passed) is carried over unchanged.
 * The shape difference between the sides — faceted rim vs smooth ring — is a `drawPiece` argument,
 * not a palette value, so it cannot vary per skin at all.
 *
 * `id` is permanent: it is stored in `SaveState.skins` and is also the shop item's id, so
 * renaming one orphans everyone who bought it.
 */
const SKINS = [
  // The default set, at the source palettes' own hues — a no-op recolour, so it stays exactly
  // the art S4.5 verified.
  { id: 'default', tile: 193, sideLight: 40, sideDark: 270, background: 275 },
  { id: 'emerald', tile: 150, sideLight: 45, sideDark: 338, background: 158 },
  { id: 'sunset', tile: 25, sideLight: 52, sideDark: 250, background: 12 },
  // The one set that also drops saturation: at full saturation its dark side landed a few degrees
  // from the default set's violet and the two read as the same piece on a different board (caught
  // on a contact sheet of all four, not by looking at the palette numbers). Graphite is both
  // further from every other set and the more frost-like answer.
  { id: 'frost', tile: 205, sideLight: 186, sideDark: 225, sideDarkSat: 0.4, background: 212 },
]

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`
}

function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return [h, s, l]
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]
}

/**
 * One colour, moved to `hue` with its saturation and lightness untouched — the single operation
 * every skin is built from. A hue rotation in HSL preserves lightness exactly, which is precisely
 * the property that makes the readability promise above mechanical.
 *
 * A greyscale source (S ≈ 0, e.g. the neutral shard) is returned unchanged: giving it a hue would
 * tint an asset that is deliberately colourless and tinted at runtime instead.
 */
function recolor(hex, hue, satMul = 1) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex))
  void h
  if (s < 0.02) return hex
  return rgbToHex(...hslToRgb(hue, Math.max(0, Math.min(1, s * satMul)), l))
}

/**
 * The same, over an object of hex strings — a whole ramp at once. `satMul` scales saturation
 * uniformly across the ramp, which (unlike a hue change) does move perceived contrast slightly;
 * it is used for exactly one ramp, and the greyscale check is what keeps that honest.
 */
function recolorRamp(ramp, hue, satMul = 1) {
  return Object.fromEntries(Object.entries(ramp).map(([key, value]) => [key, recolor(value, hue, satMul)]))
}

// -- tiny deterministic helpers ---------------------------------------------------------------

function mulberry32(seed) {
  return function random() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function diamondPath(ctx, x, y, w, h) {
  ctx.beginPath()
  ctx.moveTo(x + w / 2, y)
  ctx.lineTo(x + w, y + h / 2)
  ctx.lineTo(x + w / 2, y + h)
  ctx.lineTo(x, y + h / 2)
  ctx.closePath()
}

function verticalGradient(ctx, x, y, w, h, top, bottom) {
  const gradient = ctx.createLinearGradient(x, y, x + w * 0.25, y + h)
  gradient.addColorStop(0, top)
  gradient.addColorStop(1, bottom)
  return gradient
}

/** The soft white specular blob that sells "this is a 3D render baked into 2D". Always in the
 * upper third, offset along LIGHT. */
function specular(ctx, cx, cy, rx, ry, strength = 0.5) {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry))
  gradient.addColorStop(0, `rgba(255,255,255,${strength})`)
  gradient.addColorStop(0.55, `rgba(255,255,255,${strength * 0.35})`)
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.save()
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Contact shadow under an object — what stops a sprite from looking pasted onto the board. */
function contactShadow(ctx, cx, cy, rx, ry, alpha = 0.42) {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry))
  gradient.addColorStop(0, `rgba(15,4,28,${alpha})`)
  gradient.addColorStop(0.6, `rgba(15,4,28,${alpha * 0.5})`)
  gradient.addColorStop(1, 'rgba(15,4,28,0)')
  ctx.save()
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function ellipsePath(ctx, cx, cy, rx, ry) {
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.closePath()
}

// -- sprites ----------------------------------------------------------------------------------

/** A board square. The noise keeps a large flat fill from reading as plastic (§6). */
function drawTile(ctx, w, h, tone, seed) {
  const random = mulberry32(seed)

  // Bleed the fill one pixel past the diamond: two anti-aliased edges laid side by side on the
  // baked board would otherwise sum to slightly less than full coverage and draw a hairline
  // seam along every square.
  diamondPath(ctx, -1, -1, w + 2, h + 2)
  ctx.save()
  ctx.clip()

  ctx.fillStyle = verticalGradient(ctx, 0, 0, w, h, tone.top, tone.bottom)
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < 900; i++) {
    const x = random() * w
    const y = random() * h
    const a = 0.02 + random() * 0.05
    ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  // A soft sheen following the light, so even an empty square has a direction.
  specular(ctx, w * 0.34, h * 0.3, w * 0.42, h * 0.42, 0.16)
  ctx.restore()

  // Edge definition: lit on the two upper edges, shadowed on the two lower ones.
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w / 2, 0)
  ctx.lineTo(w, h / 2)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(20,6,36,0.3)'
  ctx.beginPath()
  ctx.moveTo(w, h / 2)
  ctx.lineTo(w / 2, h)
  ctx.lineTo(0, h / 2)
  ctx.stroke()
}

/**
 * One segment of the decorative gold border, drawn as a straight horizontal band. The board
 * stamps it along each of the four diamond edges, always traversed left-to-right on screen, so
 * this single texture serves every edge with the lit side still facing up — and serves 8×8 and
 * 10×10 alike, which is what CONCEPT.md §6 asks a nine-slice frame for.
 */
function drawRimStrip(ctx, w, h) {
  const gradient = ctx.createLinearGradient(0, 0, 0, h)
  gradient.addColorStop(0, GOLD.light)
  gradient.addColorStop(0.35, GOLD.mid)
  gradient.addColorStop(0.75, GOLD.deep)
  gradient.addColorStop(1, GOLD.dark)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillRect(0, 2, w, 3)
  ctx.fillStyle = 'rgba(36,16,51,0.55)'
  ctx.fillRect(0, h - 4, w, 4)

  // Two thin engraved lines: cheap, and they read as tooled metal at any size.
  ctx.fillStyle = 'rgba(36,16,51,0.28)'
  ctx.fillRect(0, h * 0.42, w, 2)
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.fillRect(0, h * 0.42 + 2, w, 1)
}

/** A cap for the four diamond tips, hiding the mitre where two rim strips meet. */
function drawRimCorner(ctx, size) {
  const cx = size / 2
  const cy = size / 2
  contactShadow(ctx, cx, cy + size * 0.1, size * 0.36, size * 0.26, 0.35)

  const gradient = ctx.createRadialGradient(cx - size * 0.12, cy - size * 0.14, size * 0.05, cx, cy, size * 0.42)
  gradient.addColorStop(0, GOLD.light)
  gradient.addColorStop(0.5, GOLD.mid)
  gradient.addColorStop(1, GOLD.deep)

  ellipsePath(ctx, cx, cy, size * 0.34, size * 0.24)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  specular(ctx, cx - size * 0.1, cy - size * 0.09, size * 0.16, size * 0.1, 0.7)
}

/**
 * A man or a king. The two sides differ in hue AND in rim treatment — the light side is faceted,
 * the dark side smooth with a raised concentric ring — so the sides stay distinguishable in
 * greyscale, which `npm run assets` cannot check but the S4.5 screenshot gate does.
 *
 * `faceted` is a parameter rather than a `side === SIDE_LIGHT` test precisely because a skin
 * recolours the palettes: identity would stop matching the moment the ramp was hue-shifted, and
 * the shape half of the side difference — the half that survives greyscale — would silently
 * vanish from every non-default skin.
 */
function drawPiece(ctx, size, side, { king, faceted }) {
  const cx = size / 2
  const cy = size * PIECE_ANCHOR_Y
  const rx = size * 0.39
  const ry = rx / 1.6
  const thickness = size * 0.078

  contactShadow(ctx, cx + size * 0.02, cy + thickness + ry * 0.55, rx * 1.02, ry * 0.62)

  // Side wall: the same disc pushed down, so the silhouette outline covers both and the piece
  // reads as a solid object rather than two stacked ellipses.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy + thickness, rx, ry, 0, 0, Math.PI * 2)
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.rect(cx - rx, cy, rx * 2, thickness)
  ctx.fillStyle = side.deep
  ctx.fill('nonzero')
  ctx.restore()

  // Silhouette contour, heavier on the shadow side.
  ctx.lineJoin = 'round'
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = OUTLINE_W_SHADOW
  ellipsePath(ctx, cx, cy + thickness, rx, ry)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - rx, cy)
  ctx.lineTo(cx - rx, cy + thickness)
  ctx.moveTo(cx + rx, cy)
  ctx.lineTo(cx + rx, cy + thickness)
  ctx.stroke()

  // Top face.
  const face = ctx.createLinearGradient(cx - rx * LIGHT.x, cy - ry, cx + rx * 0.4, cy + ry)
  face.addColorStop(0, side.light)
  face.addColorStop(0.45, side.mid)
  face.addColorStop(1, side.deep)
  ellipsePath(ctx, cx, cy, rx, ry)
  ctx.fillStyle = face
  ctx.fill()
  ctx.lineWidth = OUTLINE_W
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  ctx.save()
  ellipsePath(ctx, cx, cy, rx, ry)
  ctx.clip()

  if (faceted) {
    // Faceted rim: radial notches around the edge.
    const facets = 16
    for (let i = 0; i < facets; i++) {
      const a = (i / facets) * Math.PI * 2
      ctx.strokeStyle = 'rgba(36,16,51,0.3)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
      ctx.lineTo(cx + Math.cos(a) * rx * 0.74, cy + Math.sin(a) * ry * 0.74)
      ctx.stroke()
    }
    ellipsePath(ctx, cx, cy, rx * 0.72, ry * 0.72)
    ctx.strokeStyle = 'rgba(36,16,51,0.45)'
    ctx.lineWidth = 4
    ctx.stroke()
  } else {
    // Smooth rim with a raised concentric ring: lit above, shadowed below.
    ellipsePath(ctx, cx, cy, rx * 0.76, ry * 0.76)
    ctx.strokeStyle = 'rgba(36,16,51,0.5)'
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx * 0.76, ry * 0.76, 0, Math.PI, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 3
    ctx.stroke()
  }

  specular(ctx, cx + rx * LIGHT.x * 0.45, cy + ry * LIGHT.y * 0.5, rx * 0.46, ry * 0.5, 0.6)

  // Reflected bounce along the shadow edge — the second light §6 asks for.
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx * 0.93, ry * 0.93, 0, Math.PI * 0.1, Math.PI * 0.9)
  ctx.strokeStyle = 'rgba(255,235,190,0.3)'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.restore()

  if (king) drawCrown(ctx, cx, cy - ry * 0.55, size * 0.52, side)
}

/** The king's crown: gold for BOTH sides with a coloured gem, per CONCEPT.md §6 — the shape says
 * "king", the gem says "whose". */
function drawCrown(ctx, cx, baseY, width, side) {
  const w = width
  const h = w * 0.62
  const left = cx - w / 2
  const top = baseY - h

  ctx.beginPath()
  ctx.moveTo(left, baseY)
  ctx.lineTo(left + w * 0.06, top + h * 0.28)
  ctx.lineTo(left + w * 0.28, baseY - h * 0.42)
  ctx.lineTo(cx, top)
  ctx.lineTo(left + w * 0.72, baseY - h * 0.42)
  ctx.lineTo(left + w * 0.94, top + h * 0.28)
  ctx.lineTo(left + w, baseY)
  ctx.closePath()

  const gradient = ctx.createLinearGradient(left, top, left + w * 0.3, baseY)
  gradient.addColorStop(0, GOLD.light)
  gradient.addColorStop(0.5, GOLD.mid)
  gradient.addColorStop(1, GOLD.deep)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = OUTLINE_W - 1
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  // Band across the base, then the gem.
  ctx.fillStyle = 'rgba(36,16,51,0.25)'
  ctx.fillRect(left + w * 0.04, baseY - h * 0.2, w * 0.92, h * 0.12)

  ellipsePath(ctx, cx, baseY - h * 0.14, w * 0.13, w * 0.11)
  ctx.fillStyle = side.gem
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  specular(ctx, cx - w * 0.16, top + h * 0.34, w * 0.14, h * 0.16, 0.75)
}

/** The pulsing highlight over a selected square (§6: "пульсирующий ромб с мягким внутренним
 * свечением"), drawn as a soft inner glow so a tween only has to animate alpha/scale. */
function drawCellSelect(ctx, w, h) {
  const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,0.05)')
  gradient.addColorStop(0.72, 'rgba(255,240,190,0.32)')
  gradient.addColorStop(1, 'rgba(255,210,110,0.62)')

  diamondPath(ctx, 3, 2, w - 6, h - 4)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = GOLD.light
  ctx.stroke()
}

/** The marker on a legal destination — a small raised gold dot, readable even under a piece. */
function drawCellTarget(ctx, w, h) {
  const cx = w / 2
  const cy = h / 2
  contactShadow(ctx, cx, cy + h * 0.14, w * 0.2, h * 0.16, 0.4)
  ellipsePath(ctx, cx, cy, w * 0.19, h * 0.19)
  const gradient = ctx.createRadialGradient(cx - w * 0.06, cy - h * 0.07, 1, cx, cy, w * 0.2)
  gradient.addColorStop(0, '#fffbe8')
  gradient.addColorStop(1, GOLD.mid)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = OUTLINE
  ctx.stroke()
}

function drawSpark(ctx, size) {
  const cx = size / 2
  const gradient = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,220,130,0.9)')
  gradient.addColorStop(1, 'rgba(255,180,60,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(cx, cx, cx, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(cx, 2)
  ctx.lineTo(cx, size - 2)
  ctx.moveTo(2, cx)
  ctx.lineTo(size - 2, cx)
  ctx.stroke()
}

/** A shard of a shattered piece — tinted at runtime per side, so it is drawn neutral here. */
function drawShard(ctx, size) {
  ctx.beginPath()
  ctx.moveTo(size * 0.5, size * 0.08)
  ctx.lineTo(size * 0.92, size * 0.55)
  ctx.lineTo(size * 0.42, size * 0.94)
  ctx.lineTo(size * 0.08, size * 0.44)
  ctx.closePath()
  const gradient = ctx.createLinearGradient(0, 0, size * 0.4, size)
  gradient.addColorStop(0, '#ffffff')
  gradient.addColorStop(1, '#c9c0d8')
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = OUTLINE
  ctx.stroke()
}

/** Nine-slice panel: deep plum, two-tone gold border, inner shadow along the top edge (§6). */
function drawPanel(ctx, size) {
  const r = 26
  roundedRect(ctx, 4, 4, size - 8, size - 8, r)
  ctx.fillStyle = '#33125a'
  ctx.fill()

  ctx.save()
  roundedRect(ctx, 4, 4, size - 8, size - 8, r)
  ctx.clip()
  const inner = ctx.createLinearGradient(0, 4, 0, 4 + size * 0.35)
  inner.addColorStop(0, 'rgba(12,3,22,0.55)')
  inner.addColorStop(1, 'rgba(12,3,22,0)')
  ctx.fillStyle = inner
  ctx.fillRect(0, 0, size, size)
  ctx.restore()

  ctx.lineWidth = 7
  ctx.strokeStyle = GOLD.deep
  roundedRect(ctx, 4, 4, size - 8, size - 8, r)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.strokeStyle = GOLD.light
  roundedRect(ctx, 6, 6, size - 12, size - 14, r - 2)
  ctx.stroke()
}

/** Nine-slice pill button with a visible bottom thickness — the object a press can push down. */
function drawButton(ctx, w, h) {
  const r = h / 2 - 2
  roundedRect(ctx, 4, 10, w - 8, h - 14, r)
  ctx.fillStyle = GOLD.dark
  ctx.fill()

  roundedRect(ctx, 4, 4, w - 8, h - 16, r)
  const gradient = ctx.createLinearGradient(0, 4, 0, h - 12)
  gradient.addColorStop(0, GOLD.light)
  gradient.addColorStop(0.5, GOLD.mid)
  gradient.addColorStop(1, GOLD.deep)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  roundedRect(ctx, 12, 9, w - 24, (h - 16) * 0.34, r * 0.5)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fill()
}

/**
 * The opponent's avatar, shown while the bot thinks (CONCEPT.md §6: "«Бот думает» — маскот с
 * идл-анимацией"). Deliberately built from the game's own vocabulary — a crowned disc with a face
 * — rather than an invented character: it costs two frames, it cannot clash with any skin, and it
 * is unmistakably this game's rather than a mascot borrowed from the genre.
 *
 * NOT skinned. It is the opponent, not a board piece: recolouring it per set would make it read as
 * a piece that wandered off the board, and it sits on the HUD where no skin's palette applies.
 */
function drawMascot(ctx, size, { blink }) {
  const cx = size / 2
  const cy = size * 0.62
  const rx = size * 0.36
  const ry = rx * 0.86

  contactShadow(ctx, cx, cy + ry * 0.9, rx * 0.9, ry * 0.3, 0.4)

  const body = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.4, cy + ry)
  body.addColorStop(0, SIDE_DARK.light)
  body.addColorStop(0.45, SIDE_DARK.mid)
  body.addColorStop(1, SIDE_DARK.deep)
  ellipsePath(ctx, cx, cy, rx, ry)
  ctx.fillStyle = body
  ctx.fill()
  ctx.lineWidth = OUTLINE_W - 1
  ctx.lineJoin = 'round'
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  // Eyes. The blink frame is the same geometry flattened to a line, so the two frames register
  // exactly — a blink that shifts the face by a pixel reads as a twitch.
  const eyeDx = rx * 0.38
  const eyeY = cy - ry * 0.12
  for (const side of [-1, 1]) {
    const ex = cx + eyeDx * side
    if (blink) {
      ctx.strokeStyle = OUTLINE
      ctx.lineWidth = size * 0.035
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(ex - size * 0.06, eyeY)
      ctx.lineTo(ex + size * 0.06, eyeY)
      ctx.stroke()
      continue
    }
    ellipsePath(ctx, ex, eyeY, size * 0.072, size * 0.086)
    ctx.fillStyle = '#fdf6ff'
    ctx.fill()
    ctx.lineWidth = size * 0.022
    ctx.strokeStyle = OUTLINE
    ctx.stroke()
    // Pupils look slightly inward and up: a face reads as thinking, not staring.
    ellipsePath(ctx, ex + size * 0.012 * -side, eyeY - size * 0.012, size * 0.032, size * 0.038)
    ctx.fillStyle = OUTLINE
    ctx.fill()
    specular(ctx, ex - size * 0.02, eyeY - size * 0.035, size * 0.024, size * 0.02, 0.9)
  }

  specular(ctx, cx - rx * 0.32, cy - ry * 0.5, rx * 0.34, ry * 0.26, 0.45)
  drawCrown(ctx, cx, cy - ry * 0.72, size * 0.44, SIDE_DARK)
}

function drawCoin(ctx, size) {
  const cx = size / 2
  contactShadow(ctx, cx, cx + size * 0.3, size * 0.3, size * 0.12, 0.35)
  ctx.beginPath()
  ctx.arc(cx, cx, size * 0.38, 0, Math.PI * 2)
  const gradient = ctx.createLinearGradient(cx - size * 0.3, cx - size * 0.3, cx + size * 0.2, cx + size * 0.38)
  gradient.addColorStop(0, GOLD.light)
  gradient.addColorStop(0.5, GOLD.mid)
  gradient.addColorStop(1, GOLD.deep)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = OUTLINE
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cx, size * 0.24, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(36,16,51,0.35)'
  ctx.lineWidth = 4
  ctx.stroke()
  specular(ctx, cx - size * 0.12, cx - size * 0.14, size * 0.14, size * 0.1, 0.8)
}

/**
 * The speaker on the settings mute buttons, in three states.
 *
 * **It is drawn rather than typed, and that is the whole point of it existing.** The three states
 * used to be the emoji U+1F507 / U+1F508 / U+1F50A, set in a `Text` object — which makes a
 * control's meaning depend on whether the device happens to own that glyph. Reported from a phone:
 * both mute buttons came up as tofu boxes, so the only thing telling "sound" from "music" was the
 * word beside it and nothing at all said whether either was muted. The coin in this same atlas had
 * had the right answer all along.
 *
 * `waves` is 0, 1 or 2 — the same three levels the glyphs carried, because a speaker with no waves
 * reads as "quiet" rather than "off"; the cross is what says off.
 *
 * Drawn in the game's own contour style (light body, thick dark outline) rather than as a flat
 * silhouette, so it sits on a plum button beside the drawn coin without looking like it came from a
 * different set.
 */
function drawSpeaker(ctx, size, waves) {
  const u = size / 64
  const px = (x, y) => [x * u, y * u]

  const body = () => {
    ctx.beginPath()
    ctx.moveTo(...px(12, 26))
    ctx.lineTo(...px(22, 26))
    ctx.lineTo(...px(35, 13))
    ctx.lineTo(...px(35, 51))
    ctx.lineTo(...px(22, 38))
    ctx.lineTo(...px(12, 38))
    ctx.closePath()
  }

  // The outline is stroked UNDER the fill rather than over it, so the contour reads as a thick edge
  // instead of a line eating half the shape's own width — the order every sprite here uses.
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  body()
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 9 * u
  ctx.stroke()

  body()
  const gradient = ctx.createLinearGradient(...px(12, 13), ...px(35, 51))
  gradient.addColorStop(0, '#ffffff')
  gradient.addColorStop(1, '#d8ccea')
  ctx.fillStyle = gradient
  ctx.fill()

  if (waves === 0) {
    for (const [x1, y1, x2, y2] of [[43, 22, 56, 35], [56, 22, 43, 35]]) {
      ctx.beginPath()
      ctx.moveTo(...px(x1, y1))
      ctx.lineTo(...px(x2, y2))
      ctx.strokeStyle = OUTLINE
      ctx.lineWidth = 10 * u
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(...px(x1, y1))
      ctx.lineTo(...px(x2, y2))
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 5 * u
      ctx.stroke()
    }
    return
  }

  const arc = (radius) => {
    ctx.beginPath()
    ctx.arc(...px(36, 32), radius * u, -Math.PI / 3, Math.PI / 3)
  }
  for (const radius of waves === 1 ? [11] : [11, 19]) {
    arc(radius)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 10 * u
    ctx.stroke()
    arc(radius)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 5 * u
    ctx.stroke()
  }
}

/**
 * The chrome icons: the three navigation tabs and the settings gear.
 *
 * Same reason as `drawSpeaker` — a glyph icon is an icon the device can decline to draw, and this
 * game had its navigation and its only way into settings resting on `U+1F3E0`, `U+1F6D2`, `U+1F3AF`
 * and `U+2699`. The nav tabs each carry their own word underneath, so a tofu there cost less than
 * the mute buttons did; it still put four boxes on the two bars a player looks at most.
 *
 * **Drawn WHITE on purpose.** A sprite can be tinted and an emoji cannot: the nav bar tints its
 * icons gold when a tab is active and lilac when it is not, so the icon now carries the same state
 * its label does. That was not available at all before — an emoji is whatever colour its font says.
 *
 * The body is drawn as a white shape over a thick dark stroke of the same path, which is what gives
 * every sprite in this atlas its contour; a tint multiplies, so the contour stays dark while the
 * body takes the colour.
 */
function outlined(ctx, path, { outline = 9, fill = '#ffffff', gradient = null, size = 64 } = {}) {
  const u = size / 64
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  path()
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = outline * u
  ctx.stroke()
  path()
  ctx.fillStyle = gradient ?? fill
  ctx.fill()
}

function drawHome(ctx, size) {
  const u = size / 64
  const px = (x, y) => [x * u, y * u]
  outlined(ctx, () => {
    ctx.beginPath()
    ctx.moveTo(...px(32, 8))
    ctx.lineTo(...px(57, 30))
    ctx.lineTo(...px(50, 30))
    ctx.lineTo(...px(50, 54))
    ctx.lineTo(...px(14, 54))
    ctx.lineTo(...px(14, 30))
    ctx.lineTo(...px(7, 30))
    ctx.closePath()
  }, { size })
  // The door, punched as a dark shape rather than left as a hole: a hole would take the tint too
  // and the icon would read as a solid blob wherever the bar behind it is light.
  ctx.beginPath()
  ctx.moveTo(...px(26, 54))
  ctx.lineTo(...px(26, 38))
  ctx.lineTo(...px(38, 38))
  ctx.lineTo(...px(38, 54))
  ctx.closePath()
  ctx.fillStyle = OUTLINE
  ctx.fill()
}

function drawCart(ctx, size) {
  const u = size / 64
  const px = (x, y) => [x * u, y * u]
  // The handle first, so the basket's contour sits over its end rather than beside it.
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(...px(6, 12))
  ctx.lineTo(...px(15, 12))
  ctx.lineTo(...px(20, 24))
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 11 * u
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(...px(6, 12))
  ctx.lineTo(...px(15, 12))
  ctx.lineTo(...px(20, 24))
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 5 * u
  ctx.stroke()

  outlined(ctx, () => {
    ctx.beginPath()
    ctx.moveTo(...px(18, 22))
    ctx.lineTo(...px(58, 22))
    ctx.lineTo(...px(50, 42))
    ctx.lineTo(...px(25, 42))
    ctx.closePath()
  }, { size })

  for (const cx of [30, 47]) {
    ctx.beginPath()
    ctx.arc(...px(cx, 52), 6 * u, 0, Math.PI * 2)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 8 * u
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(...px(cx, 52), 6 * u, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
}

function drawTarget(ctx, size) {
  const u = size / 64
  const cx = 32 * u
  // Rings from the outside in, each stroked dark then re-stroked white, so the gaps between them
  // stay dark at every size instead of closing up into a disc at 26px.
  for (const [radius, width] of [[24, 8], [14, 8]]) {
    for (const [style, w] of [[OUTLINE, width + 6], ['#ffffff', width]]) {
      ctx.beginPath()
      ctx.arc(cx, cx, radius * u, 0, Math.PI * 2)
      ctx.strokeStyle = style
      ctx.lineWidth = w * u
      ctx.stroke()
    }
  }
  ctx.beginPath()
  ctx.arc(cx, cx, 6 * u, 0, Math.PI * 2)
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 7 * u
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cx, 6 * u, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

function drawGear(ctx, size) {
  const u = size / 64
  const cx = 32 * u
  const teeth = 8
  const outer = 26 * u
  const inner = 19 * u
  const path = () => {
    ctx.beginPath()
    for (let i = 0; i < teeth * 2; i++) {
      const radius = i % 2 === 0 ? outer : inner
      // Half a step of lead-in, so a tooth is centred on the vertical rather than straddling it.
      const from = ((i - 0.5) / (teeth * 2)) * Math.PI * 2
      const to = ((i + 0.5) / (teeth * 2)) * Math.PI * 2
      ctx.arc(cx, cx, radius, from, to)
    }
    ctx.closePath()
  }
  outlined(ctx, path, { outline: 8, size })
  // The hub, dark for the same reason the door is: a transparent hole takes the button's face
  // colour, and on a plum face a plum hub reads as a smudge rather than as a hole.
  ctx.beginPath()
  ctx.arc(cx, cx, 8 * u, 0, Math.PI * 2)
  ctx.fillStyle = OUTLINE
  ctx.fill()
}

/**
 * The two consumables: the retake and the power shot.
 *
 * The last two glyphs in the UI, and the hardest of the set to draw, because they are the smallest:
 * these ride on a `compact` button beside their own price, so they are read at roughly 20px rather
 * than the nav bar's 30. Both are therefore built from ONE shape with no interior detail — a fat
 * arc with a head, and a burst — since anything finer closes up into a blob at that size.
 */
function drawRetake(ctx, size) {
  const u = size / 64
  /**
   * Drawn 1.2x about the centre, and the reason is a measurement rather than an eye: the ink of
   * this shape filled a 48x48 box where every other icon in the atlas fills 54 to 64, and it sits
   * on the button DIRECTLY BESIDE the power burst, which fills the box completely. Two icons of the
   * same nominal size reading as two different sizes is what a player actually sees.
   */
  const ZOOM = 1.2
  const px = (x, y) => [(32 + (x - 32) * ZOOM) * u, (32 + (y - 32) * ZOOM) * u]

  /**
   * The shape of the glyph it replaces, `U+21A9` — a shaft running left with the tail hooked down
   * on the right — rather than the circular arrow tried first.
   *
   * That one was geometrically correct and unreadable: at the ~20px this button is actually drawn
   * at, a 270-degree arc plus a head on its end merges into a blob with a notch. Two straight runs
   * and a corner survive the size, and they are also what the player has already been looking at.
   */
  const shaft = () => {
    ctx.beginPath()
    ctx.moveTo(...px(46, 50))
    ctx.lineTo(...px(46, 28))
    ctx.lineTo(...px(26, 28))
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const [style, width] of [[OUTLINE, 20], ['#ffffff', 11]]) {
    shaft()
    ctx.strokeStyle = style
    ctx.lineWidth = width * ZOOM * u
    ctx.stroke()
  }

  // The head sits at the shaft's left end and points along it, so the two read as one stroke.
  const head = (length, halfWidth, back) => {
    ctx.beginPath()
    ctx.moveTo(...px(26 - length, 28))
    ctx.lineTo(...px(26 + back, 28 - halfWidth))
    ctx.lineTo(...px(26 + back, 28 + halfWidth))
    ctx.closePath()
  }
  head(18, 16, 5)
  ctx.fillStyle = OUTLINE
  ctx.fill()
  head(13, 11, 3)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

function drawPower(ctx, size) {
  const u = size / 64
  const cx = 32 * u
  const spikes = 8
  const path = (outer, inner) => {
    ctx.beginPath()
    for (let i = 0; i < spikes * 2; i++) {
      const radius = (i % 2 === 0 ? outer : inner) * u
      const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(angle) * radius
      const y = cx + Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  // Alternating long and short spikes rather than a regular star: an even star reads as a decorative
  // asterisk, an uneven one as something that went off.
  // 27 rather than 29: with a 9-unit outline the tips reached 33.5 of a 32-unit half-frame and the
  // atlas cut them off square. Measured on the packed sheet — the ink box came back as the full
  // 0..64, which is what a clipped sprite looks like from the outside.
  ctx.lineJoin = 'round'
  path(27, 11)
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 9 * u
  ctx.stroke()
  path(27, 11)
  const gradient = ctx.createLinearGradient(cx, 4 * u, cx, 60 * u)
  gradient.addColorStop(0, '#ffffff')
  gradient.addColorStop(1, '#ded2ef')
  ctx.fillStyle = gradient
  ctx.fill()
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// -- the frame list ----------------------------------------------------------------------------

/**
 * Per-skin frames: the board squares and the four piece frames, once per set. Everything else in
 * the atlas is shared — the gold rim, the markers, the particles and the UI, none of which a skin
 * touches (gold is the only metal in every set, and a marker that changed colour per skin would
 * have to be re-verified against every board palette).
 *
 * The names are `<base>-<skinId>`, matched by `src/assets.ts`'s `skinFrames()` — the one place the
 * strings this script writes and the strings the game reads are allowed to meet.
 */
/**
 * ## Why there are no piece frames here any more (S12b)
 *
 * This file used to emit 24 of them — `man`/`king`/`tile` in four skins — and every one was a
 * DRAUGHTS sprite: an ellipse squashed 1.6:1 for an isometric board, with headroom reserved above
 * it for a crown. CHAPAEV-PLAN.md §2 cancelled the isometry and the game has no kings, so nothing
 * had loaded a single one of them for a long time; they were 90 KB of a 0.67 MB bundle describing
 * a game that is not this one.
 *
 * They are **not replaced by round ones**, and that is the substantive decision. The discs are
 * generated at runtime by `src/board/discTextures.ts`, because a disc is not one sprite: it is one
 * per (piece set x branch mark x side), and `src/game/skins.ts` ships five palettes and four marks.
 * Baking that is 40 frames, it grows multiplicatively with every set added, and it would still be
 * wrong for a set added after the atlas was last regenerated. Everything §2 asks of the art — round
 * discs, a SEPARATE shadow sprite at its own offset, a gloss, the branch silhouettes — exists and is
 * tested; it simply lives in code, which is the same argument this generator makes for itself in
 * its own header.
 *
 * What belongs here is art with exactly one version: the coin, the impact particles, the rim.
 */

/**
 * Everything the atlas still ships, and nothing else.
 *
 * The dropped frames were all speaking about a different game or a different UI: the draughts
 * pieces and tiles (see above), `cell-select`/`cell-target` (Chapaev never selects a CELL — its
 * gate is a disc under the finger, `sim/aim.ts`), the draughts mascot, and `ui-panel`/`ui-button`,
 * which were the neon widget kit's and are superseded by `src/ui/button.ts` drawing its own.
 *
 * `icon-coin` is the one the shop and the top bar both point at, so a price and a balance can never
 * be marked with different currencies. The particles are for §5's impact and combo cues.
 */
const SPRITES = [
  { name: 'icon-coin', w: 64, h: 64, draw: (ctx, w) => drawCoin(ctx, w) },
  { name: 'icon-sound-on', w: 64, h: 64, draw: (ctx, w) => drawSpeaker(ctx, w, 2) },
  { name: 'icon-sound-low', w: 64, h: 64, draw: (ctx, w) => drawSpeaker(ctx, w, 1) },
  { name: 'icon-sound-off', w: 64, h: 64, draw: (ctx, w) => drawSpeaker(ctx, w, 0) },
  { name: 'icon-home', w: 64, h: 64, draw: (ctx, w) => drawHome(ctx, w) },
  { name: 'icon-shop', w: 64, h: 64, draw: (ctx, w) => drawCart(ctx, w) },
  { name: 'icon-modes', w: 64, h: 64, draw: (ctx, w) => drawTarget(ctx, w) },
  { name: 'icon-gear', w: 64, h: 64, draw: (ctx, w) => drawGear(ctx, w) },
  { name: 'icon-retake', w: 64, h: 64, draw: (ctx, w) => drawRetake(ctx, w) },
  { name: 'icon-power', w: 64, h: 64, draw: (ctx, w) => drawPower(ctx, w) },
  { name: 'particle-spark', w: 32, h: 32, draw: (ctx, w) => drawSpark(ctx, w) },
  { name: 'particle-shard', w: 32, h: 32, draw: (ctx, w) => drawShard(ctx, w) },
  { name: 'rim-strip', w: 128, h: 28, draw: drawRimStrip },
  { name: 'rim-corner', w: 64, h: 64, draw: (ctx, w) => drawRimCorner(ctx, w) },
]

// -- packing -----------------------------------------------------------------------------------

/** Atlas ceiling from CONCEPT.md §6.2. The packer picks the smallest power of two that fits the
 * current set and grows toward this as skins land — a 2048² sheet holding 130k px² of art would
 * be pure upload and VRAM cost. */
const MAX_ATLAS = 2048
const PADDING = 2

function pack(sprites, size) {
  const placed = []
  let shelfY = PADDING
  let shelfH = 0
  let x = PADDING

  for (const sprite of [...sprites].sort((a, b) => b.h - a.h)) {
    if (x + sprite.w + PADDING > size) {
      shelfY += shelfH + PADDING
      shelfH = 0
      x = PADDING
    }
    if (shelfY + sprite.h + PADDING > size) return null
    placed.push({ ...sprite, x, y: shelfY })
    x += sprite.w + PADDING
    shelfH = Math.max(shelfH, sprite.h)
  }
  return placed
}

let atlasSize = 128
let placed = null
while (atlasSize <= MAX_ATLAS) {
  placed = pack(SPRITES, atlasSize)
  if (placed) break
  atlasSize *= 2
}
if (!placed) {
  console.error(`[make-atlas] the sprite set no longer fits ${MAX_ATLAS}x${MAX_ATLAS}`)
  process.exit(1)
}

const canvas = createCanvas(atlasSize, atlasSize)
const ctx = canvas.getContext('2d')
for (const sprite of placed) {
  ctx.save()
  ctx.translate(sprite.x, sprite.y)
  ctx.beginPath()
  ctx.rect(0, 0, sprite.w, sprite.h)
  ctx.clip()
  sprite.draw(ctx, sprite.w, sprite.h)
  ctx.restore()
}

const frames = {}
for (const sprite of placed) {
  frames[sprite.name] = {
    frame: { x: sprite.x, y: sprite.y, w: sprite.w, h: sprite.h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: sprite.w, h: sprite.h },
    sourceSize: { w: sprite.w, h: sprite.h },
  }
}

const atlasJson = {
  frames,
  meta: {
    app: 'scripts/make-atlas.mjs',
    image: 'game.webp',
    format: 'RGBA8888',
    size: { w: atlasSize, h: atlasSize },
    scale: '1',
    // Consumed by src/board/boardView.ts so the disc's centre inside a piece frame lives in ONE
    // place — the generator that drew it.
    pieceAnchorY: PIECE_ANCHOR_Y,
  },
}

// -- background --------------------------------------------------------------------------------

/**
 * One background per skin (CONCEPT.md §6.4): a blurred cartoon scene, deliberately out of focus
 * so it never competes with the pieces — which also happens to compress far better than a sharp
 * image, making the heaviest asset in the game the cheapest one to blur.
 */
function drawBackground(ctx, w, h, palette) {
  const random = mulberry32(90210)
  const rgba = (hex, alpha) => {
    const [r, g, b] = hexToRgb(hex)
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`
  }

  const sky = ctx.createLinearGradient(0, 0, w * 0.2, h)
  sky.addColorStop(0, palette.skyTop)
  sky.addColorStop(0.55, palette.skyMid)
  sky.addColorStop(1, palette.skyDeep)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // Far layer: soft hills.
  for (let i = 0; i < 6; i++) {
    const cx = (i / 5) * w + (random() - 0.5) * w * 0.16
    const cy = h * (0.62 + random() * 0.12)
    const rx = w * (0.22 + random() * 0.16)
    const ry = h * (0.2 + random() * 0.16)
    ctx.fillStyle = rgba(palette.hillFar, (0.5 + random() * 0.2).toFixed(3))
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Near layer: darker, larger, lower — the second parallax plane.
  for (let i = 0; i < 5; i++) {
    const cx = (i / 4) * w + (random() - 0.5) * w * 0.2
    const cy = h * (0.92 + random() * 0.12)
    ctx.fillStyle = rgba(palette.hillNear, (0.75 + random() * 0.2).toFixed(3))
    ctx.beginPath()
    ctx.ellipse(cx, cy, w * (0.26 + random() * 0.14), h * (0.24 + random() * 0.12), 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Warm glow behind where the board sits, so the board reads as lit from the scene.
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.44, 0, w * 0.5, h * 0.44, w * 0.42)
  glow.addColorStop(0, 'rgba(255,196,90,0.22)')
  glow.addColorStop(1, 'rgba(255,196,90,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < 60; i++) {
    const x = random() * w
    const y = random() * h * 0.6
    const r = 1 + random() * 3
    ctx.fillStyle = rgba(palette.star, (0.15 + random() * 0.35).toFixed(3))
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

const BG_W = 1280
const BG_H = 720

/** One blurred background per skin, from the same scene and the same seed with only the hue
 * moved — the same construction (and the same reasoning) as the skinned atlas frames above. */
function renderBackground(hue) {
  const source = createCanvas(BG_W, BG_H)
  drawBackground(source.getContext('2d'), BG_W, BG_H, recolorRamp(BG, hue))

  const canvas = createCanvas(BG_W, BG_H)
  const ctx = canvas.getContext('2d')
  ctx.filter = 'blur(26px)'
  ctx.drawImage(source, 0, 0)
  ctx.filter = 'none'
  // Vignette, applied after the blur so its edge stays crisp.
  const vignette = ctx.createRadialGradient(BG_W / 2, BG_H / 2, BG_H * 0.2, BG_W / 2, BG_H / 2, BG_W * 0.72)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(8,2,16,0.62)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, BG_W, BG_H)
  return canvas
}

// -- write --------------------------------------------------------------------------------------

mkdirSync(ATLAS_DIR, { recursive: true })
mkdirSync(BG_DIR, { recursive: true })

const atlasWebp = await canvas.encode('webp', 92)
writeFileSync(path.join(ATLAS_DIR, 'game.webp'), atlasWebp)
writeFileSync(path.join(ATLAS_DIR, 'game.json'), `${JSON.stringify(atlasJson, null, 2)}\n`)

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
console.log(`[make-atlas] atlas ${atlasSize}x${atlasSize}, ${placed.length} frames, ${kb(atlasWebp.length)}`)

/**
 * Backgrounds are OPT-IN (`npm run assets -- --backgrounds`), and everything else here is not.
 *
 * The shipped `public/assets/bg/*.webp` are no longer this script's output: they are diffusion
 * renders, listed in `ART-SOURCES.md`. This loop still produces a complete, correct, procedural set
 * — it is kept precisely because it is the fallback and the record of how the palette was derived —
 * but running it by ACCIDENT would silently overwrite four shipped files with placeholder art, and
 * `npm run assets` is a command anybody would reasonably run just to refresh the atlas.
 *
 * So the safe thing is the default. This is the one place in the repo where "prefer extending a
 * generator over adding a file" (CLAUDE.md, Build Guards) does not hold, and the flag is the seam.
 */
if (!process.argv.includes('--backgrounds')) {
  console.log(`[make-atlas] total ${kb(atlasWebp.length)}`)
  console.log('[make-atlas] backgrounds SKIPPED — the shipped set is external art (see ART-SOURCES.md).')
  console.log('[make-atlas] pass --backgrounds to regenerate the procedural fallback set instead.')
} else {
  let bgBytes = 0
  for (const skin of SKINS) {
    const bgWebp = await renderBackground(skin.background).encode('webp', 82)
    writeFileSync(path.join(BG_DIR, `${skin.id}.webp`), bgWebp)
    bgBytes += bgWebp.length
    console.log(`[make-atlas] background ${skin.id} ${BG_W}x${BG_H}, ${kb(bgWebp.length)}`)
  }
  console.log(`[make-atlas] total ${kb(atlasWebp.length + bgBytes)}`)
  console.log('[make-atlas] NOTE: the shipped backgrounds have just been REPLACED by the procedural set.')
}
