#!/usr/bin/env node
// Renders every board set against every piece set as one contact sheet (`npm run sheet`).
//
// WHY THIS EXISTS: the two wardrobe slots are independent, so 7 boards x 5 disc palettes is 35
// combinations the player can assemble and nobody is going to check by hand. `src/game/skins.ts`
// makes them legible by construction — boards dark and low-chroma, pieces light and chromatic —
// but "by construction" is a claim, and the draughts project caught its one real palette collision
// on a contact sheet rather than by reading hue numbers. This is that sheet.
//
// It imports the REAL palettes from `src/game/skins.ts` through the repo's Node-native-TS loader,
// so it cannot drift from the game: a set added there appears here with no edit, and a sheet that
// looks wrong means the game looks wrong.
//
// The board drawing mirrors `src/board/boardView.ts` and the discs mirror
// `src/board/discTextures.ts`. Those are Phaser modules and cannot be imported under plain node,
// so the shapes are reproduced here — deliberately the ONLY duplication in this script, and the
// reason both originals keep their drawing in small functions with the numbers named.
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BOARD_SET_IDS, PIECE_SET_IDS, boardSet, pieceSet } from '../src/game/skins.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'build')

const SIZE = 8
const CELL = 22
const BOARD = SIZE * CELL
const PAD = 12
const LABEL = 18
const HEADER = 26

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`

/** `board/boardView.ts`'s constants, by the same names. (The `DANGER_*` perimeter band that used to
 * be mirrored here is gone from the game — see that file's own note on why it must not come back.) */
const INSET_GUTTER = 0.05
const RULE_WIDTH = 0.035
const DOT_SIZE = 0.1
const OUTLINE = '#241033'

const isDark = (col, row) => (col + row) % 2 === 1

function drawTiles(ctx, x, y, set) {
  if (set.style === 'checker' || set.style === 'inset') {
    const g = set.style === 'inset' ? CELL * INSET_GUTTER : 0
    ctx.fillStyle = hex(set.grout)
    ctx.fillRect(x, y, BOARD, BOARD)
    for (let col = 0; col < SIZE; col++) {
      for (let row = 0; row < SIZE; row++) {
        ctx.fillStyle = hex(isDark(col, row) ? set.dark : set.light)
        ctx.fillRect(x + col * CELL + g, y + row * CELL + g, CELL - g * 2, CELL - g * 2)
      }
    }
    return
  }

  ctx.fillStyle = hex(set.dark)
  ctx.fillRect(x, y, BOARD, BOARD)

  if (set.style === 'ruled') {
    const w = Math.max(1, CELL * RULE_WIDTH)
    ctx.fillStyle = hex(set.light)
    for (let i = 1; i < SIZE; i++) {
      ctx.fillRect(x + i * CELL - w / 2, y, w, BOARD)
      ctx.fillRect(x, y + i * CELL - w / 2, BOARD, w)
    }
    return
  }

  const d = Math.max(1, CELL * DOT_SIZE)
  ctx.fillStyle = hex(set.light)
  for (let col = 1; col < SIZE; col++) {
    for (let row = 1; row < SIZE; row++) {
      ctx.fillRect(x + col * CELL - d / 2, y + row * CELL - d / 2, d, d)
    }
  }
}

/**
 * `board/boardView.ts`'s `bakeRim`: the set's void tone outside, its dark tile as the lip inboard.
 *
 * **Both colours come from the set rather than from a constant here**, and that is the fix for a
 * real drift: this file hard-coded the old gold pair, so when chunk 11 turned the rim dark the sheet
 * went on advertising a board the game no longer draws. A contact sheet that disagrees with the
 * product is worse than no contact sheet — it is the thing you check the product against.
 */
function drawRim(ctx, x, y, set) {
  const t = Math.max(2, BOARD * 0.018)
  ctx.fillStyle = hex(set.voidColor)
  ctx.fillRect(x, y, BOARD, t)
  ctx.fillRect(x, y + BOARD - t, BOARD, t)
  ctx.fillRect(x, y, t, BOARD)
  ctx.fillRect(x + BOARD - t, y, t, BOARD)
  const i = Math.max(1, t / 3)
  ctx.fillStyle = hex(set.dark)
  ctx.fillRect(x + t, y + t, BOARD - t * 2, i)
  ctx.fillRect(x + t, y + BOARD - t - i, BOARD - t * 2, i)
}

/** `board/discTextures.ts`'s disc: an offset radial ramp, a thick contour, a soft gloss — and, for
 * the player's side, the twelve scallops that make the two sides tellable apart with no colour at
 * all (see `RIM_SCALLOPS` there for why they exist). */
function drawDisc(ctx, cx, cy, r, ramp, milled) {
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

  ctx.fillStyle = 'rgba(255,255,255,0.26)'
  ctx.beginPath()
  ctx.ellipse(gx, gy, body * 0.32, body * 0.22, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// A middlegame position rather than the opening: the opening puts every disc on its own back rank,
// i.e. all eight over two tones out of the style's whole repertoire, which is the least a contact
// sheet could tell you about a palette. Scattered discs cross light and dark tiles both.
const DEMO = [
  { c: 0.9, r: 1.4, side: 'p' },
  { c: 3.5, r: 2.6, side: 'o' },
  { c: 5.6, r: 1.8, side: 'p' },
  { c: 2.2, r: 4.9, side: 'o' },
  { c: 6.4, r: 5.4, side: 'p' },
  { c: 4.3, r: 6.7, side: 'o' },
  { c: 7.1, r: 3.3, side: 'o' },
  { c: 1.6, r: 6.2, side: 'p' },
]

const boards = BOARD_SET_IDS.map(boardSet)
const pieces = PIECE_SET_IDS.map(pieceSet)

const cellW = BOARD + PAD
const cellH = BOARD + PAD + LABEL
const W = HEADER + PAD + pieces.length * cellW + PAD
const H = HEADER + PAD + boards.length * cellH + PAD

const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#150726'
ctx.fillRect(0, 0, W, H)

ctx.font = '11px sans-serif'
ctx.textBaseline = 'middle'

pieces.forEach((p, i) => {
  ctx.fillStyle = '#f5b52e'
  ctx.textAlign = 'center'
  ctx.fillText(p.id, HEADER + PAD + i * cellW + BOARD / 2, HEADER / 2 + 6)
})

boards.forEach((b, row) => {
  const y = HEADER + PAD + row * cellH
  ctx.save()
  ctx.translate(HEADER / 2 + 4, y + BOARD / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = '#a892c4'
  ctx.textAlign = 'center'
  ctx.fillText(b.id, 0, 0)
  ctx.restore()

  pieces.forEach((p, col) => {
    const x = HEADER + PAD + col * cellW
    drawTiles(ctx, x, y, b)
    drawRim(ctx, x, y, b)
    for (const d of DEMO) {
      drawDisc(ctx, x + d.c * CELL + CELL / 2, y + d.r * CELL + CELL / 2, CELL * 0.4, d.side === 'p' ? p.player : p.opponent, d.side === 'p')
    }
    ctx.fillStyle = '#6d5a86'
    ctx.textAlign = 'left'
    ctx.fillText(`${b.style}`, x + 2, y + BOARD + LABEL / 2 + 2)
  })
})

mkdirSync(OUT_DIR, { recursive: true })
const out = path.join(OUT_DIR, 'skin-sheet.png')
writeFileSync(out, canvas.toBuffer('image/png'))
console.log(`[skin-sheet] ${boards.length} boards x ${pieces.length} piece sets -> ${out} (${W}x${H})`)
