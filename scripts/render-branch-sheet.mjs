#!/usr/bin/env node
// Renders every branch emblem on every piece set, at the size a disc is actually drawn
// (`npm run sheet:branches`).
//
// WHY THIS EXISTS. `npm run sheet` renders 7 board sets against 5 piece sets and draws every disc
// BARE — no branch mark, no stack rider — because those live in `src/board/discTextures.ts`, which
// imports Phaser and cannot run under node. So the surface this project uses to catch palette
// collisions has never been able to see the emblems, and one shipped: the artillery rider is drawn
// in a fixed gold, three of the five piece sets put the PLAYER's own discs at the same hue, and the
// only thing separating them was a contour that is a hairline at the 37px a disc occupies on a
// phone. It was reported from the live game as "непонятно шото" with a screenshot.
//
// The shapes now live in `src/board/emblems.ts` with no Phaser in them, and both this sheet and the
// game rasterise the SAME list — so a sheet can be wrong about the shading and can no longer be
// wrong about an emblem.
//
// WHAT TO LOOK AT. The 1x block, and only the 1x block, decides anything. The 3x block is there to
// see WHY something failed, never to judge whether it did: every emblem in this game has at some
// point looked excellent at four times its size and vanished at its own (the sabre that read as a
// fin, the muzzle brake that read as a hammer). If a shape is unclear at 1x it is unclear.
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PIECE_SET_IDS, pieceSet, boardSet } from '../src/game/skins.ts'
import { BRANCH_PROFILES, FORMATION_ORDER } from '../src/game/formations.ts'
import {
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
  LIGHT,
} from '../src/board/emblems.ts'
import { drawDiscBody, drawGloss, paintShapes, hex } from './lib/emblem-canvas.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'build')

/**
 * The disc's on-screen diameter on the target phone.
 *
 * `board/layout.ts` fits an 8-cell board to the shorter side of a 390px viewport, which is a 46.75px
 * tile, and a disc is 0.8 of one. This is THE size — every judgement about an emblem is made here
 * and nowhere else.
 */
const GAME_DISC_PX = 37
const ZOOMS = [
  { label: 'game size (390px phone)', scale: 1, pad: 8 },
  { label: '3x — for diagnosis only, never for judgement', scale: 3, pad: 16 },
]

const LABEL_W = 92
const HEADER_H = 30
const SET_HEADER_H = 22

const lerpChannel = (from, to, t, shift) => {
  const a = (from >> shift) & 0xff
  const b = (to >> shift) & 0xff
  return Math.round(a + (b - a) * t) << shift
}
const lerpColor = (from, to, t) => lerpChannel(from, to, t, 16) | lerpChannel(from, to, t, 8) | lerpChannel(from, to, t, 0)

/** One disc, composed in the game's own order: body, then the mark UNDER the gloss, then the rider
 * on top of everything — a rider is a separate sprite in the game and is drawn over the disc. */
function drawBranchDisc(ctx, cx, cy, r, ramp, milled, branch) {
  const profile = BRANCH_PROFILES[branch]
  const body = drawDiscBody(ctx, cx, cy, r, ramp, milled)

  if (profile.mark !== 'none') {
    const box = body * MARK_BOX
    const ink = lerpColor(ramp.deep, OUTLINE, MARK_DEEPEN)
    paintShapes(ctx, MARK_SHAPES[profile.mark], box, cx - box / 2, cy - box / 2, { ink, deep: ink, mid: ink, light: ink }, MARK_ALPHA)
  }

  drawGloss(ctx, cx, cy, body)

  if (profile.top) {
    const box = r * 2 * RIDER_BOX
    const origin = { x: cx - box / 2, y: cy - box / 2 }
    const shapes = RIDER_SHAPES[profile.top]
    const contour = shapes.filter((shape) => shape.tone === 'ink')
    const throwBy = box * RIDER_SHADOW_OFFSET
    const ink = { ink: SHADOW_INK, deep: SHADOW_INK, mid: SHADOW_INK, light: SHADOW_INK }
    paintShapes(ctx, contour, box, origin.x - LIGHT.x * throwBy, origin.y - LIGHT.y * throwBy, ink, RIDER_SHADOW_ALPHA)
    paintShapes(ctx, shapes, box, origin.x, origin.y, { ink: OUTLINE, deep: METAL.deep, mid: METAL.mid, light: METAL.light })
  }
}

// -- the sheet -----------------------------------------------------------------------------------

const COLUMNS = PIECE_SET_IDS.flatMap((id) => [
  { set: id, side: 'player' },
  { set: id, side: 'opponent' },
])

/** Discs sit on a board, so they are judged on one. The default set's two tones alternate down the
 * column: a disc that separates from the light tile and not the dark one has not separated. */
const BOARD = boardSet('default')

function cellSize(zoom) {
  return Math.round(GAME_DISC_PX * zoom.scale) + zoom.pad * 2
}

function blockHeight(zoom) {
  return SET_HEADER_H + FORMATION_ORDER.length * cellSize(zoom)
}

const width = LABEL_W + COLUMNS.length * cellSize(ZOOMS[1])
const height = ZOOMS.reduce((sum, zoom) => sum + HEADER_H + blockHeight(zoom) + 14, 20)

const canvas = createCanvas(width, height)
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#150723'
ctx.fillRect(0, 0, width, height)

let y = 12
for (const zoom of ZOOMS) {
  const cell = cellSize(zoom)

  ctx.fillStyle = '#e8dcff'
  ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(zoom.label, 10, y + 18)
  y += HEADER_H

  // Column headers: the piece set, spanning its two sides.
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  COLUMNS.forEach((column, i) => {
    if (column.side !== 'player') return
    ctx.fillStyle = '#a892c4'
    ctx.fillText(column.set, LABEL_W + i * cell + cell, y + 14)
  })
  y += SET_HEADER_H

  FORMATION_ORDER.forEach((branch, row) => {
    const top = y + row * cell
    const profile = BRANCH_PROFILES[branch]

    ctx.fillStyle = '#c9b6e8'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(branch, LABEL_W - 10, top + cell / 2 - 4)
    ctx.fillStyle = '#7a6a93'
    ctx.font = '10px sans-serif'
    ctx.fillText(profile.top ? `rider: ${profile.top}` : `mark: ${profile.mark}`, LABEL_W - 10, top + cell / 2 + 10)

    COLUMNS.forEach((column, i) => {
      const x = LABEL_W + i * cell
      // The board tone alternates per cell, so every emblem is seen on both tiles of the board.
      ctx.fillStyle = hex((row + i) % 2 === 0 ? BOARD.light : BOARD.dark)
      ctx.fillRect(x, top, cell, cell)

      const ramp = pieceSet(column.set)[column.side]
      const r = (GAME_DISC_PX * zoom.scale * (profile.radiusScale ?? 1)) / 2
      drawBranchDisc(ctx, x + cell / 2, top + cell / 2, r, ramp, column.side === 'player', branch)
    })
  })

  y += blockHeight(zoom) - SET_HEADER_H + 14
}

mkdirSync(OUT_DIR, { recursive: true })
const file = path.join(OUT_DIR, 'branch-sheet.png')
writeFileSync(file, canvas.toBuffer('image/png'))
console.log(`[branches] wrote ${path.relative(ROOT, file)} — ${width}x${height}`)
console.log('[branches] judge the 1x block only; the 3x block is for diagnosing a failure, not for finding one')
