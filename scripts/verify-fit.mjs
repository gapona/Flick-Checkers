#!/usr/bin/env node
// Logic check for src/board/layout.ts -- the square-board geometry and the fit that puts it on a
// screen. Replaces the draughts project's `verify:iso`, which tested an isometric projection this
// game cancelled (CHAPAEV-PLAN.md §2); the module is deliberately Phaser-free so this can run as
// plain assertions with no framework, no bundler and no browser, via the register-ts-loader.mjs +
// ts-extensionless-loader.mjs Node-native-TS setup.
//
// What it is actually defending. §2 makes exactly one load-bearing claim about layout -- that a
// SQUARE board binds on the viewport's shorter side and therefore always fits whole, in both
// orientations, with no zoom floor and no pan. Everything downstream leans on it: with no pan
// gesture to disambiguate against, a single-finger drag can belong to aiming outright (§2, trap 4),
// and with the whole board visible, "how close is that disc to the edge" is a question the player
// can answer by looking (§2, reason 2). If the claim is false on some viewport, both of those quietly
// stop being true -- so it is checked here, on real numbers, rather than asserted in a comment.
import assert from 'node:assert/strict'
import {
  BASE_TILE,
  BOARD_SCREEN_MARGIN_PX,
  AIM_APRON_CELLS,
  bandCenter,
  computeAimZoom,
  computeBoardFit,
  computeHudBands,
  createBoardMetrics,
  gridToScreen,
  isDarkSquare,
  isOnBoard,
  screenToGrid,
  tileRect,
  computeSidePanel,
  PANEL_GAP,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
} from '../src/board/layout.ts'
import { MAX_DRAG_CELLS } from '../src/sim/aim.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** 8x8 is every rule set in `game/rules.ts`; 10x10 is the variant `BoardSize` still admits. */
const SIZES = [8, 10]

/** The viewports every layout claim in this project is made against. The first two are the same
 * phone held two ways -- the pair the "identical tile size in both orientations" claim is about. */
const VIEWPORTS = [
  { name: '390x844 portrait', w: 390, h: 844 },
  { name: '844x390 landscape', w: 844, h: 390 },
  { name: '1280x720 desktop', w: 1280, h: 720 },
  { name: '768x1024 tablet portrait', w: 768, h: 1024 },
]

console.log('src/board/layout.ts -- geometry')

check('the board is square, and its box is exactly size x tile on both axes', () => {
  for (const size of SIZES) {
    const m = createBoardMetrics(size)
    assert.equal(m.tile, BASE_TILE)
    assert.equal(m.boardW, size * BASE_TILE)
    assert.equal(m.boardH, m.boardW, `a ${size}x${size} board must be square`)
  }
})

check('gridToScreen -> screenToGrid round-trips on every cell of every size', () => {
  for (const size of SIZES) {
    const m = createBoardMetrics(size)
    for (let col = 0; col < size; col++) {
      for (let row = 0; row < size; row++) {
        const center = gridToScreen(m, col, row)
        const back = screenToGrid(m, center.x, center.y)
        assert.deepEqual(back, { col, row })
      }
    }
  }
})

check('every point inside a cell maps to that cell, corners included', () => {
  const m = createBoardMetrics(8)
  const eps = 1e-9
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < 8; row++) {
      const r = tileRect(m, col, row)
      // Top-left corner is inclusive; the far edges belong to the NEXT cell, so probe just inside.
      for (const [x, y] of [
        [r.x, r.y],
        [r.x + r.width - eps, r.y],
        [r.x, r.y + r.height - eps],
        [r.x + r.width - eps, r.y + r.height - eps],
      ]) {
        assert.deepEqual(screenToGrid(m, x, y), { col, row }, `(${x}, ${y}) should be in cell ${col},${row}`)
      }
    }
  }
})

check('a point off the board yields an off-board cell rather than being clamped', () => {
  // Not pedantry: the aim gate of §3 ("a drag only starts on one of your own live discs") is a
  // decision made about where the pointer landed, and a miss silently clamped to the nearest cell
  // is a miss that reads as a hit on the edge column.
  const m = createBoardMetrics(8)
  const off = [
    [-1, m.boardH / 2],
    [m.boardW + 1, m.boardH / 2],
    [m.boardW / 2, -1],
    [m.boardW / 2, m.boardH + 1],
  ]
  for (const [x, y] of off) {
    assert.equal(isOnBoard(m, screenToGrid(m, x, y)), false, `(${x}, ${y}) must not report as on-board`)
  }
  assert.equal(isOnBoard(m, screenToGrid(m, 0, 0)), true)
  assert.equal(isOnBoard(m, screenToGrid(m, m.boardW - 1e-9, m.boardH - 1e-9)), true)
})

check('tileRect tiles the whole board with no gap and no overlap', () => {
  for (const size of SIZES) {
    const m = createBoardMetrics(size)
    let area = 0
    for (let col = 0; col < size; col++) {
      for (let row = 0; row < size; row++) {
        const r = tileRect(m, col, row)
        assert.equal(r.width, m.tile)
        assert.equal(r.height, m.tile)
        // Its own centre must be its own cell -- which, over every cell, is what rules out both a
        // gap (some point in no rect) and an overlap (some point in two).
        assert.deepEqual(screenToGrid(m, r.x + r.width / 2, r.y + r.height / 2), { col, row })
        area += r.width * r.height
      }
    }
    assert.equal(area, m.boardW * m.boardH)
  }
})

check('dark squares are half of every row -- the cavalry formation of §4 depends on it', () => {
  for (const size of SIZES) {
    for (let row = 0; row < size; row++) {
      let dark = 0
      for (let col = 0; col < size; col++) if (isDarkSquare(col, row)) dark++
      assert.equal(dark, size / 2, `row ${row} of a ${size}-wide board should hold ${size / 2} dark squares`)
    }
  }
  // Two rows of an 8x8 board therefore offer exactly the 8 dark cells the branch places on.
  assert.equal((8 / 2) * 2, 8)
})

console.log('src/board/layout.ts -- fit')

check('the whole board fits inside every viewport, on both axes', () => {
  // The claim §2 rests on. No zoom floor exists to violate it, but the arithmetic is checked
  // rather than trusted: this is the property that makes pan unnecessary.
  for (const size of SIZES) {
    const m = createBoardMetrics(size)
    for (const v of VIEWPORTS) {
      const fit = computeBoardFit(m, v.w, v.h)
      const onScreen = m.boardW * fit.zoom
      assert.ok(onScreen <= v.w + 1e-9, `${size}x${size} at ${v.name}: ${onScreen}px wide overflows ${v.w}px`)
      assert.ok(onScreen <= v.h + 1e-9, `${size}x${size} at ${v.name}: ${onScreen}px tall overflows ${v.h}px`)
    }
  }
})

check('boardPx is the shorter side less both margins, and zoom maps board units onto it', () => {
  for (const size of SIZES) {
    const m = createBoardMetrics(size)
    for (const v of VIEWPORTS) {
      const fit = computeBoardFit(m, v.w, v.h)
      assert.equal(fit.boardPx, Math.min(v.w, v.h) - BOARD_SCREEN_MARGIN_PX * 2)
      assert.ok(Math.abs(fit.zoom * m.boardW - fit.boardPx) < 1e-9)
      assert.ok(Math.abs(fit.tileOnScreen * size - fit.boardPx) < 1e-9)
    }
  }
})

check('the same phone gives the same tile size in portrait and landscape', () => {
  // The whole reason the projection is orthogonal and the board is square: one calibration covers
  // both orientations, so a disc is the same size in the hand either way.
  for (const size of SIZES) {
    const m = createBoardMetrics(size)
    const portrait = computeBoardFit(m, 390, 844)
    const landscape = computeBoardFit(m, 844, 390)
    assert.equal(portrait.tileOnScreen, landscape.tileOnScreen)
    assert.equal(portrait.zoom, landscape.zoom)
  }
  // The number quoted in board/layout.ts's own docstring, on the target device.
  assert.equal(computeBoardFit(createBoardMetrics(8), 390, 844).tileOnScreen, 46.75)
})

check('a viewport smaller than its own margins still yields a positive zoom', () => {
  // Degenerate, but reachable: a browser reports 0x0 for a frame during some resize/orientation
  // transitions, and a zero or negative zoom is a division by zero downstream, not a small board.
  const m = createBoardMetrics(8)
  for (const [w, h] of [[0, 0], [1, 1], [BOARD_SCREEN_MARGIN_PX, BOARD_SCREEN_MARGIN_PX]]) {
    const fit = computeBoardFit(m, w, h)
    assert.ok(fit.boardPx > 0 && fit.zoom > 0 && fit.tileOnScreen > 0, `${w}x${h} produced ${JSON.stringify(fit)}`)
  }
})

check('margin is honoured on the binding axis -- the disc knocked off has somewhere to fall', () => {
  const m = createBoardMetrics(8)
  for (const v of VIEWPORTS) {
    const fit = computeBoardFit(m, v.w, v.h)
    const slack = Math.min(v.w, v.h) - fit.boardPx
    assert.equal(slack, BOARD_SCREEN_MARGIN_PX * 2)
  }
})

console.log('src/board/layout.ts -- HUD bands')

check('bands sit on the axis the board does not fill, and flip with the orientation', () => {
  const m = createBoardMetrics(8)
  for (const v of VIEWPORTS) {
    const fit = computeBoardFit(m, v.w, v.h)
    const bands = computeHudBands(v.w, v.h, fit.boardPx)
    const portrait = v.h > v.w
    assert.equal(bands.orientation, portrait ? 'portrait' : 'landscape', v.name)

    if (portrait) {
      // Full-width strips above and below; together with the board they account for the height.
      assert.equal(bands.leading.width, v.w)
      assert.equal(bands.trailing.width, v.w)
      assert.ok(Math.abs(bands.leading.height + fit.boardPx + bands.trailing.height - v.h) < 1e-9, v.name)
      assert.equal(bands.trailing.y + bands.trailing.height, v.h)
    } else {
      assert.equal(bands.leading.height, v.h)
      assert.equal(bands.trailing.height, v.h)
      assert.ok(Math.abs(bands.leading.width + fit.boardPx + bands.trailing.width - v.w) < 1e-9, v.name)
      assert.equal(bands.trailing.x + bands.trailing.width, v.w)
    }
  }
})

check('bands are symmetric, because the board is centred', () => {
  const m = createBoardMetrics(8)
  for (const v of VIEWPORTS) {
    const bands = computeHudBands(v.w, v.h, computeBoardFit(m, v.w, v.h).boardPx)
    assert.equal(bands.leading.width, bands.trailing.width, v.name)
    assert.equal(bands.leading.height, bands.trailing.height, v.name)
  }
})

check('no band overlaps the board -- an aim drag can never start on a HUD control', () => {
  // §2's trap 4 in layout form. The board is the drag surface; a control drawn over it is a control
  // the player's own aim can begin on top of.
  const m = createBoardMetrics(8)
  for (const v of VIEWPORTS) {
    const fit = computeBoardFit(m, v.w, v.h)
    const bands = computeHudBands(v.w, v.h, fit.boardPx)
    if (bands.orientation === 'portrait') {
      const boardTop = (v.h - fit.boardPx) / 2
      assert.ok(bands.leading.y + bands.leading.height <= boardTop + 1e-9, v.name)
      assert.ok(bands.trailing.y >= boardTop + fit.boardPx - 1e-9, v.name)
    } else {
      const boardLeft = (v.w - fit.boardPx) / 2
      assert.ok(bands.leading.x + bands.leading.width <= boardLeft + 1e-9, v.name)
      assert.ok(bands.trailing.x >= boardLeft + fit.boardPx - 1e-9, v.name)
    }
  }
})

check('a viewport with no slack at all yields zero-sized bands rather than negative ones', () => {
  // A perfectly square viewport: the board fills the binding axis and there is nothing left over.
  const bands = computeHudBands(600, 600, computeBoardFit(createBoardMetrics(8), 600, 600).boardPx)
  assert.ok(bands.leading.width >= 0 && bands.leading.height >= 0)
  assert.ok(bands.trailing.width >= 0 && bands.trailing.height >= 0)
})

check('bandCenter is the middle of the band on both axes', () => {
  const center = bandCenter({ x: 10, y: 20, width: 100, height: 40 })
  assert.deepEqual(center, { x: 60, y: 40 })
})

console.log('src/board/layout.ts -- aim apron')

/** Every viewport the game is expected to meet, plus the square one that showed the bug worst. */
const AIM_VIEWPORTS = [...VIEWPORTS, { name: '954x954 square', w: 954, h: 954 }]

/**
 * Share of full power a disc sitting ON the rim can reach, pulling straight out of the board.
 *
 * The disc's centre is half a tile inside the edge, so the pull has that much plus whatever slack
 * lies between the board and the viewport. Reported per axis because the board binds on the
 * viewport's SHORTER side — the slack is never symmetric, and the axis that has none is the whole
 * bug this section guards.
 */
function rimPower(zoom, viewport) {
  const metrics = createBoardMetrics(8)
  const tile = metrics.tile * zoom
  const slack = (viewport - metrics.boardW * zoom) / 2
  return Math.min(1, (0.5 * tile + slack) / (MAX_DRAG_CELLS * tile))
}

check('the resting fit leaves no room to aim on the binding axis -- this is why the aim zoom exists', () => {
  // Not a wish: the guard below is only meaningful if the thing it guards against is real. Every
  // viewport must have an axis where a rim disc is badly short of full power at the resting zoom.
  for (const { name, w, h } of AIM_VIEWPORTS) {
    const zoom = computeBoardFit(createBoardMetrics(8), w, h).zoom
    const worst = Math.min(rimPower(zoom, w), rimPower(zoom, h))
    assert.ok(worst < 0.5, `${name}: expected a starved axis at rest, got ${(worst * 100).toFixed(0)}%`)
  }
})

check('the aim zoom restores full power on BOTH axes, in every viewport', () => {
  for (const { name, w, h } of AIM_VIEWPORTS) {
    const zoom = computeAimZoom(createBoardMetrics(8), w, h)
    for (const [axis, v] of [['vertical', h], ['horizontal', w]]) {
      const power = rimPower(zoom, v)
      assert.ok(power >= 0.999, `${name} ${axis}: only ${(power * 100).toFixed(0)}% of full power`)
    }
  }
})

check('the aim zoom never zooms IN past the resting fit', () => {
  // It exists to make room. A viewport roomy enough already must be left alone, or pressing a disc
  // would magnify the board for no reason.
  for (const { w, h } of AIM_VIEWPORTS.concat([{ name: 'tall', w: 300, h: 4000 }])) {
    const metrics = createBoardMetrics(8)
    assert.ok(computeAimZoom(metrics, w, h) <= computeBoardFit(metrics, w, h).zoom + 1e-9)
  }
})

check('the apron is what MAX_DRAG_CELLS needs, measured from a rim disc centre', () => {
  // AIM_APRON_CELLS is derived, not chosen: a rim disc's centre is half a cell inside the edge.
  assert.equal(AIM_APRON_CELLS, MAX_DRAG_CELLS - 0.5)
})

// -- the landscape side panel ------------------------------------------------------------------
//
// The one property worth guarding is the one the reference brief was written against: it is the
// GROUP that is centred, not the board. Everything else here follows from that.

check('the side panel appears only in landscape, and only with room for it', () => {
  // Portrait never gets one: the board already fills the width, so a column beside it has nowhere
  // to be.
  assert.equal(computeSidePanel(390, 844, 374).mode, 'bands')
  // Landscape with room.
  assert.equal(computeSidePanel(1280, 720, 704).mode, 'panel')
  // Landscape too narrow: the panel is DROPPED rather than squeezed under its minimum, and the HUD
  // falls back to the two strips. A 640-wide board leaves 296 either side of a 344 board, which is
  // 16 short of the gap plus the minimum.
  assert.equal(computeSidePanel(640, 360, 344).mode, 'bands')
})

check('the group is centred, so the margins either side of it are equal', () => {
  for (const [vw, vh, boardPx] of [
    [1920, 945, 929],
    [1280, 720, 704],
    [844, 390, 374],
  ]) {
    const fit = computeSidePanel(vw, vh, boardPx)
    assert.equal(fit.mode, 'panel', `${vw}x${vh} should get a panel`)
    const left = fit.board.x
    const right = vw - (fit.panel.x + fit.panel.width)
    assert.ok(Math.abs(left - right) < 0.001, `${vw}x${vh}: margins ${left} vs ${right}`)
    assert.ok(left > 0, `${vw}x${vh}: the group overflows the viewport`)
  }
})

check('the board keeps every pixel it had before the panel existed', () => {
  for (const [vw, vh] of [
    [1920, 945],
    [1280, 720],
    [844, 390],
  ]) {
    const metrics = createBoardMetrics(8)
    const boardPx = computeBoardFit(metrics, vw, vh).boardPx
    const fit = computeSidePanel(vw, vh, boardPx)
    // Same size as the plain fit decided — the panel is drawn in space the board was never going to
    // use, and a board that shrank to make room would be the panel costing the game something.
    assert.equal(fit.board.width, boardPx)
    assert.equal(fit.board.height, boardPx)
  }
})

check('the panel is exactly as tall as the board and shares its top and bottom', () => {
  const fit = computeSidePanel(1280, 720, 704)
  assert.equal(fit.panel.y, fit.board.y)
  assert.equal(fit.panel.height, fit.board.height)
})

check('the panel never crosses the board, and the gap between them is exact', () => {
  for (const [vw, vh, boardPx] of [
    [1920, 945, 929],
    [1280, 720, 704],
    [844, 390, 374],
  ]) {
    const fit = computeSidePanel(vw, vh, boardPx)
    assert.equal(fit.panel.x - (fit.board.x + fit.board.width), PANEL_GAP)
  }
})

check('the panel width stays inside its bounds at every viewport', () => {
  for (let vw = 700; vw <= 2600; vw += 37) {
    const boardPx = Math.min(vw, 700) - 16
    const fit = computeSidePanel(vw, 700, boardPx)
    if (fit.mode !== 'panel') continue
    assert.ok(fit.panel.width >= PANEL_MIN_WIDTH - 0.001, `${vw}: panel ${fit.panel.width} under the minimum`)
    assert.ok(fit.panel.width <= PANEL_MAX_WIDTH + 0.001, `${vw}: panel ${fit.panel.width} over the maximum`)
  }
})

check('boardOffsetX is what the camera has to undo, and it is zero without a panel', () => {
  const bands = computeSidePanel(390, 844, 374)
  assert.equal(bands.boardOffsetX, 0)

  const fit = computeSidePanel(1280, 720, 704)
  // The board moved LEFT of the viewport centre, so the offset is negative and equals the distance
  // between where the board is and where a centred one would have been.
  assert.ok(fit.boardOffsetX < 0)
  assert.equal(fit.board.x - (1280 - 704) / 2, fit.boardOffsetX)
})

console.log(`${passed} checks passed`)
