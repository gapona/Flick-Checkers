import type * as Phaser from 'phaser'
import type { VoiceMood } from '../audio/voiceRegistry'
import { opponent } from '../game/opponents'
import { logWarning } from '../platform/yt'

/**
 * **The opponents' portraits** — one atlas, one frame per character, drawn wherever a character
 * appears: the gallery card, the match HUD, and the result panel.
 *
 * The module is small on purpose. Every frame is the same box with the figure pushed to the bottom
 * of it, so there is exactly one placement rule and **no per-character offsets, no per-character
 * sizes, and nothing to keep in step with the art**. A portrait is positioned by one point (its
 * feet) and sized by one number (its height).
 *
 * Two rules that are easy to break and expensive to find:
 *
 * - **Uniform scale only.** `setScale(targetHeight / FRAME_HEIGHT)`, never `displayWidth` and
 *   `displayHeight` set separately — two axes set independently re-stretch an aspect ratio that is
 *   already correct, and the result is a cast whose heads are subtly different widths per screen.
 * - **No circular mask.** `setMask()` with a geometry mask is a silent no-op under this project's
 *   WebGL renderer (CLAUDE.md "Scroll Patterns"), and standing up a camera viewport per avatar is
 *   absurd. A portrait is a rectangle on a plate, which is what the rest of this game looks like.
 *
 * {@link reactPortrait} is the third thing it does, and the one that matters in a match — see its
 * own note on why the face reacts to moments the character does not always speak at.
 */

export const PORTRAIT_ATLAS_KEY = 'portraits'

/** Every frame's box, and the reference the single scale is taken against. */
export const PORTRAIT_FRAME_WIDTH = 200
export const PORTRAIT_FRAME_HEIGHT = 260

/**
 * The key of the drawn stand-in, generated once on demand.
 *
 * **It exists because the art is generated in a separate pass** (`ART-SOURCES.md`), and a build with
 * the cast wired up but the atlas not yet rendered has to be playable rather than blank. It is
 * deliberately plain — a flat plate with the character's initial — so that nobody mistakes it for the
 * finished thing, and every use of it puts a line in the health buffer. **Delete this function and
 * make a missing frame an outright error once the portraits ship**: a fallback that renders is a
 * fallback nobody notices, and it looks like a design choice for exactly as long as it takes to
 * submit.
 */
const FALLBACK_PREFIX = 'portrait-fallback-'
const FALLBACK_PLATE = 0x33195c
const FALLBACK_INK = '#a892c4'

function ensureFallback(scene: Phaser.Scene, id: string): string {
  const key = `${FALLBACK_PREFIX}${id}`
  if (scene.textures.exists(key)) return key

  const texture = scene.make.renderTexture({ width: PORTRAIT_FRAME_WIDTH, height: PORTRAIT_FRAME_HEIGHT }, false).setOrigin(0, 0)
  texture.fill(FALLBACK_PLATE, 1, 0, 0, PORTRAIT_FRAME_WIDTH, PORTRAIT_FRAME_HEIGHT)

  const initial = scene.make.text(
    { text: (id[0] ?? '?').toUpperCase(), style: { fontFamily: 'Arial', fontSize: '120px', color: FALLBACK_INK } },
    false,
  )
  initial.setOrigin(0.5)
  texture.draw(initial, PORTRAIT_FRAME_WIDTH / 2, PORTRAIT_FRAME_HEIGHT / 2)
  // Flushed BEFORE the source is destroyed — Phaser 4 buffers draw commands, and destroying first
  // makes the flush throw from inside the renderer. Fourth time this codebase has hit that gotcha.
  texture.render()
  initial.destroy()

  texture.saveTexture(key)
  return key
}

/** Width a portrait occupies at a given drawn height — for layout arithmetic done before anything
 * exists (reserving a column, deciding whether one fits at all). */
export function portraitWidthFor(targetHeight: number): number {
  return (targetHeight * PORTRAIT_FRAME_WIDTH) / PORTRAIT_FRAME_HEIGHT
}

/**
 * The character's portrait, ready to be positioned with {@link placePortrait}.
 *
 * Origin `(0.5, 1)`: the anchor is the middle of the figure's feet, which is the one point every
 * frame genuinely shares. Anchoring by centre would make a short character and a tall one sit at
 * different heights from the same `y`.
 */
export function makePortrait(scene: Phaser.Scene, opponentId: string, targetHeight: number): Phaser.GameObjects.Image {
  const frame = opponent(opponentId)?.portrait ?? null
  const atlas = scene.textures.exists(PORTRAIT_ATLAS_KEY)
  const ok = frame !== null && atlas && scene.textures.get(PORTRAIT_ATLAS_KEY).has(frame)

  if (!ok) {
    // One ping per session per cause, not per card: `logWarning` is not deduped (see CLAUDE.md
    // "Save Layer" on why), and a gallery of eight would otherwise send eight identical warnings
    // every time the screen opens.
    warnOnce(!atlas ? `portraits: the "${PORTRAIT_ATLAS_KEY}" atlas is not loaded` : `portraits: no frame "${frame}" for "${opponentId}"`)
  }

  const image = ok
    ? scene.add.image(0, 0, PORTRAIT_ATLAS_KEY, frame as string)
    : scene.add.image(0, 0, ensureFallback(scene, opponentId))
  image.setOrigin(0.5, 1)
  placePortrait(image, 0, 0, targetHeight)
  return image
}

const warned = new Set<string>()

function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
  logWarning()
}

/** Where a portrait was last placed. {@link reactPortrait} animates as an OFFSET from this rather
 * than from wherever the image happens to be, which is what lets a reaction and a re-layout happen
 * in the same frame without fighting. */
const ANCHOR_X = 'portraitAnchorX'
const ANCHOR_Y = 'portraitAnchorY'
const ANCHOR_SCALE = 'portraitAnchorScale'

/** Positions a portrait: `x` is its centre, `bottomY` the line its feet stand on. */
export function placePortrait(image: Phaser.GameObjects.Image, x: number, bottomY: number, targetHeight: number): void {
  const scale = targetHeight / PORTRAIT_FRAME_HEIGHT
  image.setData(ANCHOR_X, Math.round(x))
  image.setData(ANCHOR_Y, Math.round(bottomY))
  image.setData(ANCHOR_SCALE, scale)
  image.setScale(scale)
  image.setPosition(Math.round(x), Math.round(bottomY))
}

// -- the face reacts ---------------------------------------------------------------------------

/**
 * **A one-shot reaction on a portrait: it flinches, it gloats, it nods.**
 *
 * The art is eight static renders and there is no second frame per character, so the emotion has to
 * live in MOTION and TINT rather than in a different face. That turns out to be the right trade
 * anyway: movement is what catches the eye at the edge of the screen, and a HUD portrait is always
 * at the edge of the screen.
 *
 * **Why this is separate from the speech and not part of it.** `game/speech.ts` rate-limits the
 * WORDS, deliberately hard — a character that remarks on every knockout is a stream of text over the
 * board. But the player still has to see that its disc going over the edge *landed*, every single
 * time, or the character reads as not having noticed. So the face reacts on every trigger and the
 * mouth only sometimes: that is the whole reason the cooldown can afford to be as tight as it is.
 *
 * **It animates as an OFFSET from the anchor {@link placePortrait} recorded, re-read every frame,
 * and that is load-bearing rather than tidy.** The first version tweened `x`/`y`/`scale` directly
 * and captured a "home" to settle back to; a `layout()` in the same frame — and `Game.refreshStatus`
 * runs one after every shot, which is exactly when a reaction fires — either killed the tween
 * outright or left it settling the face onto an anchor the viewport no longer had. Reading the
 * anchor per frame makes the two independent: layout owns where the face IS, this owns how far it
 * is currently displaced from there.
 */
const REACT_MS = 320
/** Cold violet for a flinch, warm gold for a gloat — the two colours the result panel already uses
 * for a loss and a win, so a face and a panel can never disagree about which just happened. */
const TINT_ALARM = 0x9b7ad6
const TINT_TRIUMPH = 0xffd873

interface ReactionShape {
  tint: number | null
  /** Sideways displacement, as a fraction of the drawn width. */
  shake: number
  /** Upward displacement, as a fraction of the drawn height. Negative dips. */
  hop: number
  /** Peak growth, as a fraction of the anchored scale. */
  swell: number
  /** Peak rotation, in degrees. */
  tilt: number
  /** Shake/tilt oscillations over the whole reaction. `0` for the ones that only rise and fall. */
  wobbles: number
}

const REACTIONS: Record<VoiceMood, ReactionShape> = {
  // A shudder: side to side, fast, around the anchor.
  alarm: { tint: TINT_ALARM, shake: 0.09, hop: 0, swell: 0, tilt: 4, wobbles: 3 },
  // A hop, and it grows on the way up — a gloat is a character getting bigger for a moment.
  triumph: { tint: TINT_TRIUMPH, shake: 0, hop: 0.09, swell: 0.08, tilt: 0, wobbles: 0 },
  // A nod. **No tint**: an ordinary shot is not an event, and a face that changed colour on every
  // one of them would spend the round flashing.
  calm: { tint: null, shake: 0, hop: -0.03, swell: 0, tilt: 0, wobbles: 0 },
}

/**
 * The reaction currently running on each portrait.
 *
 * **Not `scene.tweens.killTweensOf(image)`, which is what this was and which silently did nothing.**
 * The tween's target is the progress object, not the image — the image is only written from
 * `onUpdate` — so a kill by image matched no tween at all and every reaction stacked on the last
 * one. The symptom was a portrait that never came back to rest: the tween that eventually completed
 * restored the anchor and an older one that was still running immediately displaced it again.
 */
const running = new WeakMap<Phaser.GameObjects.Image, Phaser.Tweens.Tween>()

export function reactPortrait(scene: Phaser.Scene, image: Phaser.GameObjects.Image, mood: VoiceMood): void {
  // `active`, not a truthiness check: a destroyed Game Object is still a truthy reference and
  // tweening one throws from inside the TweenManager. A round ends by tearing the scene down while a
  // reaction is in flight often enough for this to matter.
  if (!image.active) return

  // Two reactions a second apart must not compose into a face drifting away from its own anchor.
  running.get(image)?.stop()
  const shape = REACTIONS[mood]
  if (shape.tint === null) image.clearTint()
  else image.setTint(shape.tint)

  const settle = (): void => {
    if (!image.active) return
    const scale = (image.getData(ANCHOR_SCALE) as number | undefined) ?? image.scaleX
    image.setPosition(image.getData(ANCHOR_X) ?? image.x, image.getData(ANCHOR_Y) ?? image.y)
    image.setScale(scale).setAngle(0).clearTint()
  }

  const step = { t: 0 }
  const tween = scene.tweens.add({
    targets: step,
    t: 1,
    duration: REACT_MS,
    onUpdate: () => {
      if (!image.active) return
      const anchorX = (image.getData(ANCHOR_X) as number | undefined) ?? image.x
      const anchorY = (image.getData(ANCHOR_Y) as number | undefined) ?? image.y
      const anchorScale = (image.getData(ANCHOR_SCALE) as number | undefined) ?? image.scaleX
      // Drawn size from the ANCHOR rather than from `displayWidth`, which this very tween is in the
      // middle of changing — otherwise the swell feeds back into its own amplitude.
      const width = PORTRAIT_FRAME_WIDTH * anchorScale
      const height = PORTRAIT_FRAME_HEIGHT * anchorScale

      // One arch over the whole reaction for the rise-and-fall parts, and a decaying oscillation
      // for the shake, so a shudder dies down rather than stopping mid-swing.
      const arch = Math.sin(step.t * Math.PI)
      const swing = shape.wobbles > 0 ? Math.sin(step.t * Math.PI * 2 * shape.wobbles) * (1 - step.t) : 0

      image.setPosition(anchorX + width * shape.shake * swing, anchorY - height * shape.hop * arch)
      image.setScale(anchorScale * (1 + shape.swell * arch))
      image.setAngle(shape.tilt * swing)
    },
    onComplete: settle,
    onStop: settle,
  })
  running.set(image, tween)
}
