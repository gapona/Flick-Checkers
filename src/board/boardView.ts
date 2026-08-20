import * as Phaser from 'phaser'
import { createBoardMetrics, isDarkSquare, isOnBoard, screenToGrid, tileRect, type BoardMetrics, type BoardSize, type Cell } from './layout'
import type { Pit } from '../sim/types'
import { boardSet, DEFAULT_BOARD_SET, type BoardSet, type BoardSetId } from '../game/skins'

/**
 * The Phaser half of the board: the baked playing surface, its gold rim, and the single
 * interactive layer every pointer gesture arrives through. All geometry comes from
 * `board/layout.ts` — this module decides nothing about the game, it only shows the field.
 *
 * It deliberately does NOT touch the camera. Fitting the board to the viewport is the scene's
 * business (`Game.ts` reads `board/layout.ts`'s `computeBoardFit` and drives `cameras.main`),
 * because the scene also owns `uiCamera` and the two must be set in one place.
 *
 * ## What this is not, yet
 *
 * There is no disc layer here. The draughts project's version of this file owned piece sprites and
 * their per-cell animations (`hop`, `promote`, `setTargets`, `setDimmed`) — all of it deleted with
 * the rules that drove it (CHAPAEV-PLAN.md §1). What replaces it is S3: discs at CONTINUOUS
 * positions, rendered at a state interpolated between two fixed simulation steps, with the shadow
 * as its own sprite rather than baked into the disc (§2 — a baked shadow flies along with a struck
 * disc, which is the one thing a top-down view cannot get away with). The bake below is the half of
 * the old file that survived intact, which is why it is here now rather than waiting for S3.
 *
 * ## Placeholder art
 *
 * The BOARD is drawn from flat fills, not stamped from the atlas: the committed atlas is still the
 * draughts one. S12b replaces {@link bakeBoard} with stamped art and a real nine-slice frame, and
 * this function is the only thing that has to change for that.
 */

/**
 * Board colours — two tones of ONE family, deliberately not black/white.
 *
 * **Darker and much closer together than the draughts pair they replace** (`#7ed2de` / `#286a85`),
 * and that inversion is the whole point rather than a taste change. In draughts the board is the
 * playfield: you count cells, a piece stands in the middle of one, and high square contrast helps.
 * In Chapaev, after the first shot **no disc ever stands on a cell again** — the grid stops being
 * a set of ARRIVAL squares and becomes a RULER, which only has to say how far. A ruler that
 * out-shouts the pieces measured against it is a ruler in the way, and the old pair had a bigger
 * luminance gap between its own two tones than between either tone and a disc.
 *
 * Dark also buys the discs their contrast back: gold `#f5b52e` and violet `#9b4dff` are both light
 * against this, where against `#7ed2de` only the violet was.
 *
 * The concrete pair now lives in `game/skins.ts` as the `default` set's recipe, alongside six
 * others — this module draws whatever set it is handed and owns no palette. What it still owns is
 * the RULE above: every set in that file is dark and low-chroma because of this reasoning, and a
 * bright set added later would break the discs on every piece palette at once.
 */

/** How much of a cell the `inset` style gives up to its gutter, per side. Small on purpose: the
 * grout is meant to read as a seam between tiles, not as a second grid competing with the first. */
const INSET_GUTTER = 0.05
/** Line width of the `ruled` style, and the size of a `dots` mark, both as a fraction of a cell.
 * A ruled line thicker than this stops reading as a ruling and starts reading as a wall. */
const RULE_WIDTH = 0.035
const DOT_SIZE = 0.1

/**
 * **There was a perimeter "danger band" here, and it is gone. Do not add it back.**
 *
 * It was 0.75 of a cell of darkening around the edge with a warm hairline (`#ff6a3d`) along its
 * inner boundary, meant to answer "am I about to lose this disc" to peripheral vision. Three
 * reasons it was removed, in the order they matter:
 *
 * - **It marked a threshold no rule uses.** A disc is lost when its CENTRE crosses the edge
 *   (`sim/step.ts`) — at zero, not at 0.75. The line was the most precise-looking thing on the
 *   board and it pointed at nothing, which is worse than pointing at nothing vaguely.
 * - **It was redundant with the projection.** §2 chose the top-down view precisely so that
 *   distance-to-edge reads correctly, and `board/layout.ts` fits the whole board on screen in both
 *   orientations — so the question was already answerable by looking. The band re-answered it
 *   louder.
 * - **Only half of it was ever visible.** The darkening was `voidColor` (the set's dark tile taken
 *   almost to black, `game/skins.ts`) at alpha 0.2 over an already dark board — imperceptible. So
 *   the hairline was left with no gradient to be the edge OF, and read as a stray debug rectangle
 *   floating over the playing surface. That is what it was reported as.
 *
 * The lesson generalises past this one band: an aid drawn at a position the simulation does not
 * recognise is misinformation with good intentions. If edge proximity ever does need help, it has
 * to be drawn at zero — the rim already is (see {@link RIM_THICKNESS}).
 */

/**
 * The rim, in board units, drawn INSIDE the board's own box.
 *
 * Inside rather than around it: the playing surface is fixed at `min(vw, vh) - 16`
 * (`board/layout.ts`), so the 8px margin is all the room a frame has — and a rim authored in board
 * units scales with the fit zoom, which on a 1280×720 desktop is nearly twice the phone's. Any rim
 * wide enough to look like a frame at 390px would therefore overflow the screen edge on desktop if
 * it sat outside the box. Overlapping the outermost squares by a few units instead costs 6% of one
 * square's width, changes no geometry, and cannot overflow at any zoom.
 *
 * **It is decoration, not a wall.** The rim in `game/rules.ts`'s `bumperRim` mode is a rule about
 * what the simulation does at `x = 0` and `x = boardW`, and it has nothing to do with these
 * pixels; a mode that bounces still bounces off the board's exact edge, not off the inside of this
 * stripe.
 */
const RIM_THICKNESS = 4

/**
 * **The rim is the lip of a drop, and it used to be a gold fence.**
 *
 * Chunk 11's measurement is what settled it. Sampled off the real render, the gold rim came back at
 * a relative luminance of **0.60** — five times the light tile (0.114) and level with the specular
 * highlight on a violet disc (0.68). It was by a wide margin the brightest thing on the playing
 * surface, which is to say the board's most dangerous line was drawn as its most inviting one.
 *
 * This is the same mistake the perimeter band was already corrected for once, one layer further
 * out: a lighter edge ADVANCES, and an edge that advances reads as a wall you are safe against
 * rather than the drop that actually decides the game. Fixing the band and leaving a bright stripe
 * painted on top of it fixed the reasoning and not the picture.
 *
 * So the rim is now the darkest thing on the board rather than the brightest, and it is taken from
 * the set's own `voidColor` — the tone the perimeter band already fades toward — so tile, band, lip
 * and rim are one monotone descent into the void instead of a descent with a bright line across it.
 * The lip inboard of it is the set's dark tile, which keeps the edge from being a single flat black
 * bar and gives it a bevel.
 *
 */

/**
 * **There was a "turn light" here — a coloured band just inside the rim on the active side's own
 * edge — and it is gone. Do not add it back in this form.**
 *
 * It was meant to say two things with one pixel: whose go it is, and (by going out during a
 * simulation) that taps are being ignored. It failed at the first, and the way it failed is the
 * lesson: a band drawn ALONG the board's edge is read as a description of the EDGE, not as a
 * statement about the turn. Reported as "the yellow strip at the bottom is not needed, it is obvious
 * that this is the edge" — which is not a complaint about the colour, it is the signal arriving as
 * decoration.
 *
 * Both jobs already have a better home. Whose go it is, `scenes/Game.ts`'s `refreshStatus()` says in
 * words ("Your shot" / "Opponent's shot" / an animated "Thinking..." while the bot searches), which
 * cannot be mistaken for scenery. That the board is busy, the moving discs say themselves — and
 * `beginAim` refuses on `isMoving` regardless, so nothing depended on the light being visible.
 *
 * If the turn ever needs a graphical signal again, it must not be drawn on the perimeter — that
 * surface already means "the drop", and this is the second thing removed from it for saying
 * something else there (see the danger-band note above).
 */

const BOARD_DEPTH = -30

/**
 * §5's hazard, baked in with the board because it never moves.
 *
 * §5's requirement — not a description — is that a modifier "reads immediately": one the player
 * cannot see is not a modifier, it is the game behaving strangely. A pit is therefore a black hole
 * with a lighter rim, so it never reads as merely a dark square.
 */
/** Exported because `board/modeIcon.ts` draws the same pit as a schema on a mode card, and a card
 * that advertises a hazard in colours the board does not use is the same class of drift the shop
 * swatch is built to avoid. Two copies of a colour is one copy that can go stale. */
export const PIT_COLOR = 0x0a0714
export const PIT_RIM_COLOR = 0x4b3a6b
const PIT_RIM_WIDTH = 3

export interface BoardView {
  readonly metrics: BoardMetrics
  readonly size: BoardSize
  /** Every object this view renders through the WORLD camera — pass to `uiCamera.ignore()` so the
   * UI camera never draws the board on top of the HUD at 1:1. */
  readonly worldObjects: Phaser.GameObjects.GameObject[]
  /** The board's one and only interactive object: a single invisible `Zone` covering the whole
   * board layer, for `bindAction`'s `pointer` source and for the aim drag of S5. Cells are NOT
   * interactive objects — see `board/layout.ts`'s `screenToGrid`. */
  readonly hitTarget: Phaser.GameObjects.Zone
  /** World point -> the cell containing it, or `null` if the point is off the board. For placing
   * and debugging formations; aiming reads world coordinates directly and never comes through
   * here. */
  cellAt(worldX: number, worldY: number): Cell | null
  /** Grows the interactive layer to cover at least the given world rectangle (the camera's
   * `worldView`). Call from the owning scene's `layout()`. */
  coverWorldView(view: Phaser.Geom.Rectangle): void

  destroy(): void
}

/**
 * Bakes the static board — every square plus the rim — into a single `RenderTexture`.
 *
 * 64 squares as live objects would be 64 display-list entries re-submitted every frame for content
 * that never changes; baked, the whole board costs one textured quad. That headroom is not spare
 * change here: the frames this saves are the frames the fixed-step solver and the frame-sliced bot
 * search (§6) spend. `fill()` writes axis-aligned rectangles straight into the texture's command
 * buffer, so every edge is pixel-crisp by construction.
 */
/**
 * Paints the grid in whichever of `game/skins.ts`'s four styles the set asks for.
 *
 * All four are expressible as axis-aligned rectangles, which is not a coincidence —
 * `RenderTexture.fill()` writes them straight into the command buffer with no `Graphics` and no
 * second flush, so every style costs the same one-off bake and every edge is pixel-crisp. A style
 * needing a circle or a diagonal would need the `Graphics` dance `bakeHazards` does, and would be
 * paying for it on every board rather than only on the two hazard modes.
 *
 * `dots` marks the interior cell CORNERS rather than the cell centres. A centre mark sits exactly
 * where a disc comes to rest and reads as a smudge under it; a corner mark is always in the gap
 * between four discs, which is the one place on this board nothing ever occupies.
 */
export function bakeTiles(texture: Phaser.GameObjects.RenderTexture, metrics: BoardMetrics, set: BoardSet): void {
  const { tile, boardW, boardH } = metrics
  // Loop bounds come from the texture's own box, not from `metrics.size`. On the real board those
  // agree exactly (it is square and `boardW === size * tile`); the difference is what lets the shop
  // swatch call this with a short, wide strip and get a board drawn by THIS code rather than by a
  // second copy of it that can disagree with the product it is advertising.
  const cols = Math.ceil(boardW / tile)
  const rows = Math.ceil(boardH / tile)

  if (set.style === 'checker' || set.style === 'inset') {
    const gutter = set.style === 'inset' ? tile * INSET_GUTTER : 0
    // The grout the inset tiles sit on. `checker` fills the same ground and then covers all of it,
    // which costs one rectangle and keeps the two branches a single code path.
    texture.fill(set.grout, 1, 0, 0, boardW, boardH)

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const rect = tileRect(metrics, col, row)
        texture.fill(
          isDarkSquare(col, row) ? set.dark : set.light,
          1,
          rect.x + gutter,
          rect.y + gutter,
          rect.width - gutter * 2,
          rect.height - gutter * 2,
        )
      }
    }
    return
  }

  // `ruled` and `dots` are ONE flat field plus a mark — the chequerboard is not painted at all.
  // `game/formations.ts`'s cavalry still reads `isDarkSquare()` for its opening, so the dark
  // squares continue to exist as geometry; these two styles simply decline to show them.
  texture.fill(set.dark, 1, 0, 0, boardW, boardH)

  if (set.style === 'ruled') {
    const w = Math.max(1, tile * RULE_WIDTH)
    for (let i = 1; i < cols; i++) texture.fill(set.light, 1, i * tile - w / 2, 0, w, boardH)
    for (let i = 1; i < rows; i++) texture.fill(set.light, 1, 0, i * tile - w / 2, boardW, w)
    return
  }

  const d = Math.max(1, tile * DOT_SIZE)
  for (let col = 1; col < cols; col++) {
    for (let row = 1; row < rows; row++) {
      texture.fill(set.light, 1, col * tile - d / 2, row * tile - d / 2, d, d)
    }
  }
}

function bakeBoard(scene: Phaser.Scene, metrics: BoardMetrics, hazards: BoardHazards, set: BoardSet): Phaser.GameObjects.RenderTexture {
  const texture = scene.add.renderTexture(0, 0, metrics.boardW, metrics.boardH).setOrigin(0, 0).setDepth(BOARD_DEPTH)

  bakeTiles(texture, metrics, set)

  bakeHazards(scene, texture, hazards)
  bakeRim(texture, metrics, set)

  // Phaser 4 buffers draw commands — without this the texture stays empty (see the
  // render-textures skill's gotcha #1).
  texture.render()
  return texture
}

/**
 * Stamps the pits into the board texture.
 *
 * Circles and strokes need a `Graphics` — `RenderTexture.fill()` only writes axis-aligned rectangles
 * — so one is drawn, stamped and thrown away. It never joins the display list, so it costs a few
 * milliseconds at round start and nothing per frame.
 */
function bakeHazards(scene: Phaser.Scene, texture: Phaser.GameObjects.RenderTexture, hazards: BoardHazards): void {
  if (hazards.pits.length === 0) return

  const graphics = scene.make.graphics({}, false)

  for (const pit of hazards.pits) {
    graphics.fillStyle(PIT_COLOR, 1)
    graphics.fillCircle(pit.x, pit.y, pit.r)
    graphics.lineStyle(PIT_RIM_WIDTH, PIT_RIM_COLOR, 1)
    graphics.strokeCircle(pit.x, pit.y, pit.r)
  }

  texture.draw(graphics)
  // Flushed BEFORE the Graphics is thrown away. Phaser 4 buffers draw commands (the same gotcha the
  // board bake itself has), so destroying the source first leaves the command pointing at nothing
  // and the hazards simply do not appear — which is exactly what happened the first time.
  texture.render()
  graphics.destroy()
}

export interface BoardHazards {
  pits: readonly Pit[]
}

/** Four bars along the inside edge in the set's void tone, plus a thinner bar of its dark tile
 * inboard of them for the lip — see {@link RIM_THICKNESS}'s note for why both are dark. */
function bakeRim(texture: Phaser.GameObjects.RenderTexture, metrics: BoardMetrics, set: BoardSet): void {
  const { boardW, boardH } = metrics
  const t = RIM_THICKNESS

  texture.fill(set.voidColor, 1, 0, 0, boardW, t)
  texture.fill(set.voidColor, 1, 0, boardH - t, boardW, t)
  texture.fill(set.voidColor, 1, 0, 0, t, boardH)
  texture.fill(set.voidColor, 1, boardW - t, 0, t, boardH)

  const inner = Math.max(1, t / 3)
  texture.fill(set.dark, 1, t, t, boardW - t * 2, inner)
  texture.fill(set.dark, 1, t, boardH - t - inner, boardW - t * 2, inner)
  texture.fill(set.dark, 1, t, t, inner, boardH - t * 2)
  texture.fill(set.dark, 1, boardW - t - inner, t, inner, boardH - t * 2)
}

export function createBoardView(scene: Phaser.Scene, size: BoardSize, hazards: BoardHazards = { pits: [] }, board: BoardSetId = DEFAULT_BOARD_SET): BoardView {
  const metrics = createBoardMetrics(size)
  const boardTexture = bakeBoard(scene, metrics, hazards, boardSet(board))
  const hitTarget = scene.add.zone(metrics.boardW / 2, metrics.boardH / 2, metrics.boardW, metrics.boardH).setInteractive()

  /**
   * The layer must cover the whole visible world, not just the board's box. A drag that starts on
   * a disc near the edge and pulls the slingshot BACK past the rim — which is exactly how you aim
   * at something on the far side — leaves the board's own rectangle while still being the same
   * gesture, and a zone sized to the board alone would drop the rest of it.
   */
  function coverWorldView(view: Phaser.Geom.Rectangle): void {
    const left = Math.min(0, view.x)
    const top = Math.min(0, view.y)
    const width = Math.max(metrics.boardW, view.right) - left
    const height = Math.max(metrics.boardH, view.bottom) - top

    hitTarget.setPosition(left + width / 2, top + height / 2)
    hitTarget.setSize(width, height)
    // Phaser does NOT recompute a hit area when the object resizes, and re-calling
    // setInteractive() only re-enables the existing one (CLAUDE.md "Responsive Layout", gotcha #2)
    // — the Rectangle has to be mutated directly or clicks keep testing the original box.
    const hitArea = hitTarget.input?.hitArea as Phaser.Geom.Rectangle | undefined
    hitArea?.setTo(0, 0, width, height)
  }

  function cellAt(worldX: number, worldY: number): Cell | null {
    const cell = screenToGrid(metrics, worldX, worldY)
    return isOnBoard(metrics, cell) ? cell : null
  }

  const staticObjects: Phaser.GameObjects.GameObject[] = [boardTexture, hitTarget]

  return {
    metrics,
    size,
    // Recomputed on read rather than captured: S3's disc sprites come and go with every round, and
    // the scene needs the CURRENT set to hand to `uiCamera.ignore()`.
    get worldObjects() {
      return [...staticObjects]
    },
    hitTarget,
    cellAt,
    coverWorldView,
    destroy() {
      for (const obj of staticObjects) obj.destroy()
    },
  }
}
