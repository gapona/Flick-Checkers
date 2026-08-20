import * as Phaser from 'phaser'
import { activePieceSet } from '../game/wallet'
import { pieceSet } from '../game/skins'
import { discTextureKey, ensureDiscTextures } from '../board/discTextures'

/**
 * Discs drifting up the left and right edges of a menu.
 *
 * **The one thing about this game that a still image cannot say is that the discs MOVE**, and the
 * menu and the loading screen are the two places a player looks before ever flicking one. A painted
 * backdrop can suggest it; only motion states it. So this is code rather than art, and it is the
 * reason no amount of generated background was going to answer the question on its own.
 *
 * **They are drawn from the LIVE disc textures** (`board/discTextures.ts`, via the equipped
 * `PieceSet`), not from a menu-specific sprite. A player who has bought and equipped `ember` sees
 * ember discs on the menu, which makes the wardrobe visible where it is chosen rather than only
 * where it is used — and it costs nothing, because those textures are generated per set already.
 *
 * ## They cover the whole screen, and the first version did not
 *
 * They were originally confined to two bands down the edges, on the argument that a disc passing
 * behind a button competes with it. That argument was wrong about this screen for a simple reason:
 * the buttons are **opaque plates**, so a disc behind one is not competing, it is invisible. What
 * the bands actually produced was a menu with a conspicuously dead middle — the eye reads a hole in
 * the pattern faster than it reads the pattern.
 *
 * So the lanes span the full width now. The only thing still owed care is the TITLE, which is text
 * over open background rather than a plate; it carries `neonText`'s glow, which is what keeps it off
 * whatever passes behind it.
 *
 * They still travel vertically. Lanes across the height are what make an even spread hold (see
 * below), and a horizontal drift would have to leave and re-enter through the sides, which is a
 * different and busier effect.
 *
 * ## Why the placement is stratified rather than random
 *
 * The first version scattered every disc with `Math.random()` on both axes, and it clumped — which
 * is what uniform random does, not a bug in it: independent samples leave gaps and clusters, and the
 * eye reads both as a mistake. Each disc is instead given a LANE (an even slice of the height, with
 * a jitter so the result is not a visible ruler) and a fixed horizontal offset spaced by the golden
 * ratio, which covers a line more evenly than random does at these small counts.
 *
 * **The evenness then survives, and that is a property of the design rather than luck.** Discs on
 * the same plane share a speed, so their spacing is fixed forever; only the planes drift against
 * each other, and that drift is the parallax. Had speed varied per disc, an even start would have
 * decayed back into clumps within a minute.
 *
 * `Math.random` is used here and nowhere near `src/sim/`. The solver's determinism is what the bot,
 * the daily puzzle and every replay rest on; a menu decoration has no such contract.
 */

/** Kept clear of the very edge so a disc is never half-clipped by it — the discs are round and a
 * sliced one reads as a rendering fault rather than as depth. */
const EDGE_INSET = 0.04

/**
 * Disc diameter as a fraction of the viewport's SHORTER side, near and far.
 *
 * Against the shorter side and not against the band, which was the first version and was wrong: the
 * band is a fraction of the WIDTH, so on a 1568px desktop it is 408px and the discs came out 250px
 * across — bigger than the entire button stack. Perceived size has to hold steady from a 390px
 * phone to a wide desktop, and the short side is the dimension that carries it.
 *
 * The near ones are bigger AND faster AND brighter; all three together are what make it read as
 * depth rather than as two sizes of the same thing.
 */
const FAR_SIZE = 0.05
const NEAR_SIZE = 0.1
/**
 * Opacity at each plane.
 *
 * Raised from 0.22/0.5 after looking at it: the menu's ground is deep plum, the opponent's discs are
 * violet, and at a fifth of full opacity the thick dark contour that is supposed to hold a disc
 * legible washes out — the gold ones read and the violet ones vanished into the background
 * entirely. This is the same contrast argument `verify:contrast` makes about the board, arriving on
 * a screen that check does not cover.
 */
const FAR_ALPHA = 0.3
const NEAR_ALPHA = 0.68

/** Screen heights per second. Slow: this is ambience, and anything quick enough to track with the
 * eye is something the eye then has to ignore. */
const FAR_SPEED = 0.045
const NEAR_SPEED = 0.1

/** Degrees per second, signed per disc. A flicked disc spins; one that slid across without turning
 * reads as a bubble. */
const SPIN_MIN = 8
const SPIN_MAX = 26

/**
 * Depth planes. Three, because two read as "two sizes" and four is more parallax than a background
 * has any business asking for. Discs are dealt round-robin across them, so each plane keeps an even
 * share of the lanes.
 */
const PLANES = 3

/** How far a disc may sit from the centre of its lane, as a fraction of the lane. Enough that the
 * column does not read as a ruler, small enough that it cannot open a gap. */
const LANE_JITTER = 0.45

/** Irrational step for the horizontal offsets. The golden ratio's conjugate distributes a sequence
 * over `0..1` more evenly than random sampling at these counts, which is the whole point here. */
const GOLDEN = 0.6180339887

export interface FlyingDiscs {
  /** For the camera-membership lists every scene here keeps — see CLAUDE.md "Responsive Layout". */
  readonly objects: Phaser.GameObjects.GameObject[]
  layout(width: number, height: number): void
  update(deltaMs: number): void
  destroy(): void
}

interface Drifter {
  sprite: Phaser.GameObjects.Image
  /** 0 at the far plane, 1 at the near one. Drives size, speed and alpha together. */
  depth: number
  /** Position across the screen and down it, both `0..1`, so a resize is a re-read rather than a
   * re-scatter — a menu that reshuffled its decoration on every orientation change would draw the
   * eye to the one thing that should never ask for it. */
  u: number
  v: number
  spin: number
}

export interface FlyingDiscOptions {
  /** How many discs. Twenty-four sprites on a screen that is otherwise idle — nothing next to the
   * sixteen the board carries while a solver runs under them. Raised from twenty when the lanes
   * stopped being two narrow bands and became the whole width: the same count over twice the area
   * is half the density. */
  count?: number
  /** Rendered below this. The menus put their backgrounds at -1000. */
  depth?: number
}

export function createFlyingDiscs(scene: Phaser.Scene, options: FlyingDiscOptions = {}): FlyingDiscs {
  const count = options.count ?? 24
  const set = pieceSet(activePieceSet())
  ensureDiscTextures(scene, set)

  const drifters: Drifter[] = []
  let width = scene.scale.width
  let height = scene.scale.height

  for (let i = 0; i < count; i++) {
    // Alternating COLOURS so the menu shows both players rather than one side's victory lap.
    const key = discTextureKey(i % 2 === 0 ? 'player' : 'opponent', set.id)
    const sprite = scene.add.image(0, 0, key).setDepth(options.depth ?? -900)
    drifters.push({
      sprite,
      depth: PLANES > 1 ? (i % PLANES) / (PLANES - 1) : 0.5,
      u: (i * GOLDEN) % 1,
      v: (i + 0.5) / count + ((Math.random() - 0.5) * LANE_JITTER) / count,
      spin: (SPIN_MIN + Math.random() * (SPIN_MAX - SPIN_MIN)) * (Math.random() < 0.5 ? -1 : 1),
    })
  }

  function place(d: Drifter): void {
    const size = Math.min(width, height) * (FAR_SIZE + (NEAR_SIZE - FAR_SIZE) * d.depth)
    const x = width * (EDGE_INSET + d.u * (1 - EDGE_INSET * 2))
    d.sprite.setPosition(x, d.v * height)
    d.sprite.setDisplaySize(size, size)
    d.sprite.setAlpha(FAR_ALPHA + (NEAR_ALPHA - FAR_ALPHA) * d.depth)
  }

  return {
    objects: drifters.map((d) => d.sprite),

    layout(w: number, h: number): void {
      width = w
      height = h
      for (const d of drifters) place(d)
    },

    update(deltaMs: number): void {
      const seconds = deltaMs / 1000
      for (const d of drifters) {
        const speed = FAR_SPEED + (NEAR_SPEED - FAR_SPEED) * d.depth
        // Upward, and wrapping BELOW the screen rather than at its edge, so a disc fades in from
        // off-stage instead of appearing at the boundary.
        d.v -= speed * seconds
        // Wraps by exactly the distance it travelled, so a disc keeps its lane and the spacing set
        // up above is preserved. Re-randomising `u` here — the first version did — would undo the
        // even horizontal spread on the first wrap.
        if (d.v < -0.15) d.v += 1.3
        d.sprite.angle += d.spin * seconds
        place(d)
      }
    },

    destroy(): void {
      for (const d of drifters) d.sprite.destroy()
      drifters.length = 0
    },
  }
}
