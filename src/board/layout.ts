/**
 * Flat square-grid geometry: where the board sits, how big a tile is, and which cell a point is
 * in. **Pure TypeScript — this module must never import Phaser** (GAME-PLAN.md §2), so it stays
 * runnable and testable under plain `node` (`npm run verify:fit`), with no bundler, canvas or
 * browser involved.
 *
 * ## Cells on a game that has none
 *
 * This game's discs live at CONTINUOUS positions — a disc is wherever the last shot left it, and the
 * simulation (`src/sim/`) never rounds one to a square. So why a grid at all? Because the board is
 * still drawn as a checkerboard, and because the grid is the unit the rest of the game is written
 * in: the starting formations of §4 are placed on cells, the disc radius and the impulse ceiling of
 * §2 are quoted in cells, and "how close is that disc to the edge" — the game's main tactical
 * quantity — is only legible if the squares behind it are a ruler. {@link isDarkSquare} exists for
 * exactly one caller: the cavalry formation, which sets up on the dark squares of two rows.
 *
 * What is NOT here is a hit test that snaps to a cell. Aiming reads world coordinates directly.
 *
 * ## Why the projection is orthogonal
 *
 * GAME-PLAN.md §2 cancels the isometry inherited from the draughts project, and the first
 * reason is the one that matters here: in a diamond the relationship between a drag on screen and a
 * direction on the board is non-linear across the field, and in this game the player's entire skill
 * IS that direction. Second, distance-to-edge — the thing every shot is judged by — reads
 * differently at the far rim than the near one for the same real distance, so discs are lost with
 * no visible reason. Third, a diamond fills about half its own bounding box.
 *
 * Top-down costs volume and buys everything else: simulation space and render space become the same
 * space (no vector to un-project, no depth sort per frame), and the board is a SQUARE, so it meets
 * the viewport's SHORTER side in both orientations — one calibration covers portrait and landscape.
 *
 * ## Coordinate spaces
 *
 * - **grid**: integer `(col, row)`, both `0..size-1`. `col` increases to the right, `row`
 *   downward; row 0 is the top — the opponent's back rank.
 * - **board space**: continuous `(x, y)` with `(0, 0)` at the board's TOP-LEFT corner and
 *   `(boardW, boardH)` at its bottom-right. This is the space `src/sim/` integrates in.
 *
 * Board space IS the Phaser world space — `board/boardView.ts` places every object it owns at
 * board coordinates with no offset — so a pointer's `camera.getWorldPoint()` result feeds straight
 * into {@link screenToGrid} or into an aim vector, and the fit zoom is inverted by Phaser rather
 * than by this module.
 */

/**
 * Tile size in board-space units. The board is authored ONCE at this size and never re-laid out:
 * meeting a viewport is purely a camera-zoom decision ({@link computeBoardFit}), so a resize or an
 * orientation change costs a zoom assignment, not a re-bake of the board texture or a repositioning
 * of every piece. The specific number is arbitrary — it only sets how board units map to screen px
 * at zoom 1.
 */
export const BASE_TILE = 64

/** Cells per side. 8×8 is the board game and every rule set in `game/rules.ts`; 10×10 is kept
 * typed because §2's note on panning ("only needed for larger boards — there may not be one at
 * all") is the only thing standing between this and a wider variant. */
export type BoardSize = 8 | 10

export interface Point {
  x: number
  y: number
}

export interface Cell {
  col: number
  row: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface BoardMetrics {
  /** Cells per side (`size × size` board). */
  size: number
  /** One tile's side, in board-space units. */
  tile: number
  /** Board width in board-space units — `size * tile`. Equal to {@link BoardMetrics.boardH}: the
   * board is square, which is the property §3's whole layout argument rests on. */
  boardW: number
  boardH: number
}

export function createBoardMetrics(size: number, tile: number = BASE_TILE): BoardMetrics {
  return { size, tile, boardW: size * tile, boardH: size * tile }
}

/** Grid cell -> the board-space position of that tile's CENTER. */
export function gridToScreen(metrics: BoardMetrics, col: number, row: number): Point {
  return { x: (col + 0.5) * metrics.tile, y: (row + 0.5) * metrics.tile }
}

/**
 * Board space -> grid cell: one division, no inverse projection to derive and no coefficients to
 * fit. This is what the orthogonal view buys.
 *
 * The result is NOT range-checked — a point off the board returns an off-board cell (a negative
 * coordinate or one ≥ `size`). Callers decide what a miss means; use {@link isOnBoard}. A tap on
 * empty space has to be DELIVERED rather than swallowed: §3's aim gate ("a drag only starts on one
 * of your own live discs") is a decision made about where the tap landed, and it cannot be made
 * about a tap that never arrived.
 *
 * Cells are not interactive objects — one invisible rectangle covers the whole board. Partly the
 * `Container` hit-area gotcha of CLAUDE.md's "UI Kit" (on 64 cells that would be 64 copies of one
 * bug), and partly that there is nothing to hit-test against: what the player aims at is a disc at
 * a continuous position, not the square underneath it.
 */
export function screenToGrid(metrics: BoardMetrics, x: number, y: number): Cell {
  return { col: Math.floor(x / metrics.tile), row: Math.floor(y / metrics.tile) }
}

export function isOnBoard(metrics: BoardMetrics, cell: Cell): boolean {
  return cell.col >= 0 && cell.col < metrics.size && cell.row >= 0 && cell.row < metrics.size
}

/**
 * The dark squares of the checkerboard. Nothing about play depends on square colour here — this is
 * a painting rule and a placement rule, not a legality rule.
 *
 * Its one gameplay caller is §4's cavalry formation, which sets up on the dark squares of two rows:
 * with `size` even, `(col + row) % 2 === 1` gives exactly `size / 2` of them per row, i.e. the
 * 8-per-side the branch asks for out of two rows of an 8×8 board with nothing to hand-place.
 */
export function isDarkSquare(col: number, row: number): boolean {
  return (col + row) % 2 === 1
}

/** One tile's board-space rectangle (top-left corner plus side) — for baking the board and for
 * drawing a marker over a single cell. */
export function tileRect(metrics: BoardMetrics, col: number, row: number): Rect {
  return { x: col * metrics.tile, y: row * metrics.tile, width: metrics.tile, height: metrics.tile }
}

/** Breathing room between the board and the viewport edge, per side. Small on purpose — every px
 * here comes off the tile size on the axis the board is bound by. It is not decoration either: a
 * disc knocked off the board falls into this margin before it is gone, and a board flush against
 * the screen edge would cut that off mid-animation. */
export const BOARD_SCREEN_MARGIN_PX = 8

export interface BoardFit {
  /** The board's on-screen side in CSS px — `min(vw, vh) - 2 * margin`. */
  boardPx: number
  /** Camera zoom that renders {@link BoardMetrics.boardW} board units at {@link BoardFit.boardPx}
   * screen px. */
  zoom: number
  /** On-screen tile side in CSS px. A disc is ~0.8 of this, so it is also what says whether a disc
   * is big enough to put a thumb on. */
  tileOnScreen: number
}

/**
 * Fit the board into `viewportW × viewportH`.
 *
 * There is no zoom floor, no overflow mode and no pan (GAME-PLAN.md §2, trap 4): a square board
 * binds on the viewport's SHORTER side, which on the target phone is 390px in both orientations, so
 * 8×8 lands at a 46.75px tile in portrait AND landscape and always fits whole. That is what lets
 * the aim gesture own the single-finger drag outright — with no pan to disambiguate it from, a drag
 * starting on one of your own discs can only mean aiming.
 */
export function computeBoardFit(metrics: BoardMetrics, viewportW: number, viewportH: number, margin: number = BOARD_SCREEN_MARGIN_PX): BoardFit {
  // A viewport smaller than the margins would otherwise produce a zero/negative zoom.
  const boardPx = Math.max(1, Math.min(viewportW, viewportH) - margin * 2)
  return { boardPx, zoom: boardPx / metrics.boardW, tileOnScreen: boardPx / metrics.size }
}

/**
 * Cells of empty board-space the slingshot needs OUTSIDE the rim, per side.
 *
 * `sim/aim.ts`'s `MAX_DRAG_CELLS` is 2.5 measured from the disc's CENTRE, and a disc sitting on the
 * home rank has its centre half a cell inside the edge — so 2 cells is exactly what has to exist
 * beyond the rim for that disc to reach full power pulling straight out.
 */
export const AIM_APRON_CELLS = 2

/**
 * The zoom at which the aim apron fits on screen.
 *
 * **Why this is needed at all.** `computeBoardFit` binds the board to the viewport's SHORTER side
 * with an 8px margin, so on that axis there is no room to pull a slingshot back — and every
 * viewport has such an axis, just a different one. Measured, as the share of full power a disc on
 * the rim could reach pulling straight out: a 390x844 phone gets 100% vertically and **27%**
 * horizontally, the same phone in landscape the reverse, and a square desktop window **23% both
 * ways**. Since the pull is deliberately measured in board cells rather than screen pixels so that
 * "the same pull is the same shot everywhere" (§3), an apron that exists on one axis and not the
 * other breaks the property the cell-based pull was chosen for.
 *
 * Solving `viewport >= (board + 2 * apron) * zoom` for zoom gives this. It is never allowed to
 * exceed the resting fit — this zooms OUT to make room and must never zoom in.
 */
export function computeAimZoom(
  metrics: BoardMetrics,
  viewportW: number,
  viewportH: number,
  apronCells: number = AIM_APRON_CELLS,
  margin: number = BOARD_SCREEN_MARGIN_PX,
): number {
  const needed = metrics.boardW + 2 * apronCells * metrics.tile
  const zoom = Math.max(1, Math.min(viewportW, viewportH) - margin * 2) / needed
  return Math.min(zoom, computeBoardFit(metrics, viewportW, viewportH, margin).zoom)
}

export interface HudBands {
  /** Which side of the viewport the leftover space is on. Portrait when the viewport is taller
   * than wide — i.e. when the board is bound by the WIDTH and the slack is vertical. */
  orientation: 'portrait' | 'landscape'
  /** The band above the board (portrait) or to its left (landscape). */
  leading: Rect
  /** The band below the board (portrait) or to its right (landscape). */
  trailing: Rect
}

/**
 * The two leftover strips the HUD lives in, on the axis the board does NOT fill.
 *
 * They swap with the orientation, and that is not a cosmetic choice: in landscape there is no
 * vertical slack at all (the board is height-bound, so a top bar would eat exactly the pixels that
 * limit the board), so the HUD moves to side panels. In portrait the reverse — 844 − 390 = 454px of
 * vertical room going spare, and no horizontal room at all.
 *
 * The HUD keeping strictly to these bands matters more here than it did in draughts: the whole
 * board is a drag surface now, so a control overlapping it is a control the player's aim can start
 * on top of.
 *
 * Both bands are symmetric because the board is centred, which is also what makes them fall out of
 * one subtraction rather than needing a layout pass.
 */
export function computeHudBands(viewportW: number, viewportH: number, boardPx: number): HudBands {
  if (viewportH > viewportW) {
    const band = Math.max(0, (viewportH - boardPx) / 2)
    return {
      orientation: 'portrait',
      leading: { x: 0, y: 0, width: viewportW, height: band },
      trailing: { x: 0, y: viewportH - band, width: viewportW, height: band },
    }
  }
  const band = Math.max(0, (viewportW - boardPx) / 2)
  return {
    orientation: 'landscape',
    leading: { x: 0, y: 0, width: band, height: viewportH },
    trailing: { x: viewportW - band, y: 0, width: band, height: viewportH },
  }
}

/** Centre of a HUD band — the anchor most HUD elements want, since a band is a strip with one
 * generous axis and one tight one. */
export function bandCenter(band: Rect): Point {
  return { x: band.x + band.width / 2, y: band.y + band.height / 2 }
}

/**
 * The side panel of the landscape HUD, and where the board sits once it has one.
 *
 * Modelled on `../Checkers`' `PROMPT-GAME-SIDEPANEL.md` chunk 1, and the thing worth taking from it
 * is not the panel — it is **what gets centred**. Centre the BOARD and stick a panel to the right
 * edge and the layout has a hole in it the width of the panel on the left; centre the GROUP and the
 * two margins come out equal. That defect is what the brief was written against, and this game's
 * landscape HUD has exactly the same shape of leftover space, so it would have arrived at it too.
 *
 * ```
 * groupW = boardPx + GAP + panelW
 * groupX = (viewportW - groupW) / 2
 * ```
 *
 * **The board never gives up a pixel for the panel.** It is still bound by the viewport's shorter
 * side, exactly as `computeBoardFit` decides; the panel is drawn in space the board was never going
 * to use. When there is not enough of that space left the panel is dropped rather than squeezed and
 * the HUD falls back to {@link computeHudBands}' two strips — a panel narrower than
 * {@link PANEL_MIN_WIDTH} stops being able to hold a name beside a face, which is all it is for.
 */
export const PANEL_GAP = 24
export const PANEL_MIN_WIDTH = 280
export const PANEL_MAX_WIDTH = 380
/**
 * Of the viewport's width. Between the two bounds above, so a wide desktop gets a panel in
 * proportion rather than a fixed strip lost in the middle of the screen.
 *
 * **0.29 rather than the reference's 0.26, and the difference is our buttons.** That project's table
 * gives 332 at 1280x720, which fits two of ITS action buttons side by side; two of this kit's
 * `compact` buttons come to 342 with their gap, so at 332 every pair split into its own row and the
 * four actions became a column. 0.29 gives 371 there — still inside {@link PANEL_MAX_WIDTH}, still
 * taken entirely from the side margins, and the board is untouched because it is bound by the
 * viewport's HEIGHT in landscape. Borrowing a layout's proportions without re-checking them against
 * your own furniture is how a copied design ends up subtly wrong everywhere.
 */
export const PANEL_WIDTH_FRACTION = 0.29

export interface SidePanelFit {
  /** `'panel'` only in landscape and only with room for one; `'bands'` is the fallback everywhere
   * else, and portrait is always `'bands'` — a column beside a board that already fills the width
   * has nowhere to be. */
  mode: 'panel' | 'bands'
  /** The board's box on screen, in CSS px. In `'bands'` mode this is the centred board
   * {@link computeHudBands} already assumes; in `'panel'` mode it has moved left. */
  board: Rect
  /** Aligned to the board's own top and bottom — the panel is exactly as tall as the board, which
   * is half of why the reference reads as tidy. `null` in `'bands'` mode. */
  panel: Rect | null
  /** How far the board's centre moved from the viewport's, in CSS px. Negative is left. The camera
   * needs it: the world camera stays full-viewport (a clipped one would cut the full-bleed
   * background to the board's rectangle), so the shift is applied to what it centres ON. */
  boardOffsetX: number
}

export function computeSidePanel(viewportW: number, viewportH: number, boardPx: number): SidePanelFit {
  const centred: Rect = {
    x: (viewportW - boardPx) / 2,
    y: (viewportH - boardPx) / 2,
    width: boardPx,
    height: boardPx,
  }

  const landscape = viewportW > viewportH
  const panelW = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, viewportW * PANEL_WIDTH_FRACTION))
  if (!landscape || boardPx + PANEL_GAP + PANEL_MIN_WIDTH > viewportW) {
    return { mode: 'bands', board: centred, panel: null, boardOffsetX: 0 }
  }

  const groupW = boardPx + PANEL_GAP + panelW
  const groupX = (viewportW - groupW) / 2
  const board: Rect = { x: groupX, y: centred.y, width: boardPx, height: boardPx }

  return {
    mode: 'panel',
    board,
    panel: { x: groupX + boardPx + PANEL_GAP, y: centred.y, width: panelW, height: boardPx },
    boardOffsetX: board.x - centred.x,
  }
}
