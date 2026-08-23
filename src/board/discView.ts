import * as Phaser from 'phaser'
import { renderX, renderY } from '../sim/step'
import type { Disc, SimState } from '../sim/types'
import { discTextureKey, DISC_TEXTURE_SHADOW, DISC_TEXTURE_SIZE, ensureDiscTextures, stackTopTexture, type BranchMark, type StackTop } from './discTextures'
import { DEFAULT_PIECE_SET, pieceSet, type PieceSetId } from '../game/skins'

/**
 * The discs on screen — the one place the solver's numbers become pixels.
 *
 * It owns a body sprite and a shadow sprite per live disc, and nothing else. It reads `SimState`
 * and never writes to it: the solver is the authority on where a disc is, and a view that could
 * nudge a position would put the bot and the daily-puzzle generator (which run the same solver with
 * no view attached at all) on a different board from the player.
 *
 * ## The two things this has to get right
 *
 * **Interpolation** (GAME-PLAN.md §2, trap 3). The solver runs at a fixed 240Hz and the display
 * does not. Drawing the raw solver position means that at 120Hz two consecutive frames can land on
 * the same step while the next covers two steps of travel — a fast disc shimmers. Every position
 * here therefore goes through `sim/step.ts`'s `renderX`/`renderY`, which blend between the disc's
 * position at the start of the current step and its position now. The caller supplies the blend
 * factor; see {@link DiscView.draw}.
 *
 * **A separate shadow** (§2). The shadow is its own sprite at its own offset, not part of the disc.
 * On a disc sliding across the board the difference is subtle; on one tumbling off the edge it is
 * the whole effect, because the shadow has to stay behind on the surface and die away while the
 * disc keeps going. A shadow baked into the disc sprite falls with it, and the disc reads as a
 * sticker rather than an object.
 */

/** Board units the shadow is pushed away from the light, i.e. down and to the right. Small: a disc
 * lies ON the board, it does not hover above it, and a long shadow would read as height. */
const SHADOW_OFFSET_X = 3.5
const SHADOW_OFFSET_Y = 5

/** The shadow's penumbra reaches a little past the disc's own silhouette. */
const SHADOW_SCALE = 1.1

/** Depths are in world space, below the HUD and above the baked board (-30 in `boardView.ts`).
 *
 * Discs share ONE depth rather than being sorted per frame, and that is a property of the top-down
 * view rather than an oversight: §2's move away from isometry removed the overlap that made
 * per-frame depth sorting necessary. Two discs cannot stack, so nothing needs to know which is in
 * front. A disc knocked off the board is the exception — it is leaving the surface, so it goes above
 * everything for the length of its fall. */
const SHADOW_DEPTH = -6
const DISC_DEPTH = -4
/** The piece riding on a stack, just above the disc carrying it. */
const FLOOR_DEPTH = -3
const FALLING_DEPTH = 100

/**
 * The second piece on a stack (§4's artillery and tanks), as a smaller copy of the same disc offset
 * toward the light.
 *
 * §2's trap 2 is that a stack must never become real verticality — so this is a decoration on one
 * disc, not a body of its own. It has no shadow: it is not resting on the board, it is resting on
 * the disc, and giving it one would say the opposite. S12b replaces it with the branch's real
 * silhouette (a gun, a turret); until then a smaller disc reads correctly as "there are two here".
 */
const FLOOR_SCALE = 0.58
/** A branch silhouette is drawn nearly disc-sized: it is a shape rather than a second disc, so
 * shrinking it to the same 0.58 would leave it unreadable at a phone's tile size. */
const FLOOR_BRANCH_SCALE = 0.86
const FLOOR_OFFSET_X = -2.5
const FLOOR_OFFSET_Y = -4

/** The fall, in ms. Long enough to read as a fall and short enough that it never delays the turn —
 * the round's logic follows the solver, which considers the disc gone the moment it crossed. */
const FALL_MS = 420

/** How far a falling disc carries past the edge, as a multiple of one second of its exit speed.
 * Clamped, so a disc that dribbled over the line still travels far enough to be seen leaving and a
 * disc blasted off does not shoot across the whole screen. */
const FALL_TRAVEL_SECONDS = 0.28
const FALL_TRAVEL_MIN = 16
const FALL_TRAVEL_MAX = 120

const FALL_END_SCALE = 0.5
const FALL_SPIN_DEGREES = 150

interface DiscSprites {
  body: Phaser.GameObjects.Image
  shadow: Phaser.GameObjects.Image
  /** Present only while the disc is a `'stack'`; destroyed the moment it splits. */
  floor?: Phaser.GameObjects.Image
}

export interface DiscView {
  /** Every object this view renders through the WORLD camera — hand to `uiCamera.ignore()` so the
   * UI camera never draws discs over the HUD at 1:1. Recomputed on read: the set changes every time
   * a disc is created or leaves the board, and an object in NEITHER camera's ignore list renders in
   * BOTH. {@link createDiscView}'s `onSpritesChanged` fires whenever it changes, so a scene does not
   * have to poll it. */
  readonly worldObjects: Phaser.GameObjects.GameObject[]

  /**
   * Draws the current state.
   *
   * `alpha` is how far this frame sits between the last solver step and the next — take it from
   * `sim/step.ts`'s `Stepper.alpha` while the board is moving, and pass **1 when it is at rest**,
   * so the drawn position is the authoritative one every other system reads rather than one
   * fractionally behind it.
   *
   * Also picks up both kinds of change since the last call: a disc in the state with no sprite yet
   * gets one, and a sprite whose disc has left the board is handed to the fall animation.
   */
  draw(state: SimState, alpha: number): void

  /** Throws away every sprite, including any mid-fall, and rebuilds from the state. For starting a
   * fresh round rather than continuing one. */
  reset(state: SimState): void

  destroy(): void
}

export interface DiscViewOptions {
  /** Which silhouette this round's stacks wear (§4). `null`, or absent, for a branch with none. */
  stackTop?: StackTop
  /** The equipped disc palette (`game/skins.ts`). Absent means the free set, so a caller that does
   * not care about skins — a test, a preview — needs no extra argument. */
  pieces?: PieceSetId
  /** The stencil this round's branch is printed with (§4). Absent means an unmarked disc, which is
   * what the two stacked branches want — their rider is their mark. */
  mark?: BranchMark
}

export function createDiscView(scene: Phaser.Scene, onSpritesChanged?: () => void, options: DiscViewOptions = {}): DiscView {
  const set = pieceSet(options.pieces ?? DEFAULT_PIECE_SET)
  const mark = options.mark ?? 'none'
  ensureDiscTextures(scene, set, mark)
  const topTexture = stackTopTexture(options.stackTop ?? null)

  /** Disc id -> its sprites. Only holds discs still in play; a disc that leaves is moved out of
   * here and into `falling`, which is what stops `draw` from trying to position a sprite that a
   * tween now owns. */
  const sprites = new Map<number, DiscSprites>()
  /** Sprites mid-fall, kept only so `destroy()`/`reset()` can clean them up if the scene ends
   * before the tween does. */
  const falling = new Set<DiscSprites>()

  function textureFor(disc: Disc): string {
    return discTextureKey(disc.side === 'player' ? 'player' : 'opponent', set.id, mark)
  }

  function create(disc: Disc): DiscSprites {
    // The texture is authored at DISC_TEXTURE_SIZE and the solver works in board units, so the
    // sprite scale is the ratio between them — one number, derived from the disc's own radius, so
    // §4's differently-sized branch pieces need no special case here.
    const scale = (disc.r * 2) / DISC_TEXTURE_SIZE

    const shadow = scene.add.image(disc.x, disc.y, DISC_TEXTURE_SHADOW).setDepth(SHADOW_DEPTH).setScale(scale * SHADOW_SCALE)
    const body = scene.add.image(disc.x, disc.y, textureFor(disc)).setDepth(DISC_DEPTH).setScale(scale)

    const entry: DiscSprites = { body, shadow }
    if (disc.kind === 'stack') addFloor(entry, disc)
    sprites.set(disc.id, entry)
    return entry
  }

  function addFloor(entry: DiscSprites, disc: Disc): void {
    // The branch's own silhouette when this round has one, and a smaller copy of the disc when it
    // does not — either way the stack reads as two pieces rather than one.
    const scale = ((disc.r * 2) / DISC_TEXTURE_SIZE) * (topTexture ? FLOOR_BRANCH_SCALE : FLOOR_SCALE)
    entry.floor = scene.add.image(disc.x, disc.y, topTexture ?? textureFor(disc)).setDepth(FLOOR_DEPTH).setScale(scale)
  }

  /**
   * Keeps the stack decoration in step with the disc's own kind.
   *
   * A stack becomes an ordinary disc the instant the solver splits it, mid-shot and mid-flight, so
   * this is reconciled on every draw rather than only at creation — the alternative is a disc that
   * has already burst still carrying a piece on its back.
   */
  function syncFloor(entry: DiscSprites, disc: Disc): boolean {
    if (disc.kind === 'stack' && !entry.floor) {
      addFloor(entry, disc)
      return true
    }
    if (disc.kind !== 'stack' && entry.floor) {
      entry.floor.destroy()
      entry.floor = undefined
      return true
    }
    return false
  }

  /**
   * Hands a disc that has left the board to a tween and forgets about it.
   *
   * It keeps going in the direction it left in, decelerating, while shrinking and fading — a disc
   * dropping past the edge of the surface. The shadow goes separately and faster: it is cast on a
   * board the disc is no longer on, so it has to be gone well before the disc is.
   *
   * The travel distance comes from the disc's exit velocity, which is exactly why `sim/step.ts`
   * does NOT zero the velocity of a disc it removes. A disc blasted off flies; one that dribbled
   * over the line tips.
   */
  function fall(disc: Disc, entry: DiscSprites): void {
    sprites.delete(disc.id)
    falling.add(entry)

    const speed = Math.hypot(disc.vx, disc.vy)
    const travel = Math.min(FALL_TRAVEL_MAX, Math.max(FALL_TRAVEL_MIN, speed * FALL_TRAVEL_SECONDS))
    const nx = speed > 0 ? disc.vx / speed : 0
    const ny = speed > 0 ? disc.vy / speed : 0

    entry.body.setDepth(FALLING_DEPTH)
    entry.shadow.setDepth(FALLING_DEPTH - 1)
    // A stack knocked off the board goes over the edge whole, carrying its passenger with it.
    entry.floor?.setDepth(FALLING_DEPTH + 1)

    // A spin that is not tied to the physics — the solver has no angular state at all (a disc
    // sliding on a board does not visibly roll), and this is the one moment where a tumble reads
    // as motion rather than as a bug. Its direction follows the exit, so it never looks arbitrary.
    const spin = nx >= 0 ? FALL_SPIN_DEGREES : -FALL_SPIN_DEGREES

    scene.tweens.add({
      targets: entry.body,
      x: entry.body.x + nx * travel,
      y: entry.body.y + ny * travel,
      scale: entry.body.scale * FALL_END_SCALE,
      angle: spin,
      alpha: 0,
      duration: FALL_MS,
      ease: 'Quad.Out',
      onComplete: () => {
        falling.delete(entry)
        entry.body.destroy()
        entry.shadow.destroy()
        entry.floor?.destroy()
        onSpritesChanged?.()
      },
    })

    if (entry.floor) {
      scene.tweens.add({
        targets: entry.floor,
        x: entry.floor.x + nx * travel,
        y: entry.floor.y + ny * travel,
        scale: entry.floor.scale * FALL_END_SCALE,
        angle: spin,
        alpha: 0,
        duration: FALL_MS,
        ease: 'Quad.Out',
      })
    }

    scene.tweens.add({
      targets: entry.shadow,
      x: entry.shadow.x + nx * travel * 0.6,
      y: entry.shadow.y + ny * travel * 0.6,
      scale: entry.shadow.scale * 0.45,
      alpha: 0,
      duration: FALL_MS * 0.55,
      ease: 'Quad.Out',
    })
  }

  function destroyEntry(entry: DiscSprites): void {
    scene.tweens.killTweensOf(entry.body)
    scene.tweens.killTweensOf(entry.shadow)
    entry.body.destroy()
    entry.shadow.destroy()
    if (entry.floor) {
      scene.tweens.killTweensOf(entry.floor)
      entry.floor.destroy()
    }
  }

  return {
    get worldObjects() {
      const objects: Phaser.GameObjects.GameObject[] = []
      for (const entry of sprites.values()) {
        objects.push(entry.shadow, entry.body)
        if (entry.floor) objects.push(entry.floor)
      }
      for (const entry of falling) {
        objects.push(entry.shadow, entry.body)
        if (entry.floor) objects.push(entry.floor)
      }
      return objects
    },

    draw(state: SimState, alpha: number): void {
      let changed = false

      for (const disc of state.discs) {
        const entry = sprites.get(disc.id)

        if (!disc.alive) {
          if (entry) {
            fall(disc, entry)
            changed = true
          }
          continue
        }

        const live = entry ?? create(disc)
        if (!entry) changed = true
        else if (syncFloor(live, disc)) changed = true

        const x = renderX(disc, alpha)
        const y = renderY(disc, alpha)
        live.body.setPosition(x, y)
        live.shadow.setPosition(x + SHADOW_OFFSET_X, y + SHADOW_OFFSET_Y)
        live.floor?.setPosition(x + FLOOR_OFFSET_X, y + FLOOR_OFFSET_Y)

        // A split halves the disc's radius as well as its mass, so the sprite has to follow — this
        // is the only thing on the board whose size changes mid-round.
        const scale = (disc.r * 2) / DISC_TEXTURE_SIZE
        if (Math.abs(live.body.scale - scale) > 1e-6) {
          live.body.setScale(scale)
          live.shadow.setScale(scale * SHADOW_SCALE)
        }
      }

      if (changed) onSpritesChanged?.()
    },

    reset(state: SimState): void {
      for (const entry of sprites.values()) destroyEntry(entry)
      sprites.clear()
      for (const entry of falling) destroyEntry(entry)
      falling.clear()
      this.draw(state, 1)
    },

    destroy(): void {
      for (const entry of sprites.values()) destroyEntry(entry)
      sprites.clear()
      for (const entry of falling) destroyEntry(entry)
      falling.clear()
    },
  }
}
