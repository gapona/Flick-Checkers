import * as Phaser from 'phaser'
import { ATLAS_KEY } from '../assets'
import { playPressSound } from './theme'
import { getDisplayFontStack } from './font'
import { fitScale } from './fit'
import { MIN_TOUCH_TARGET } from './uiScale'

/**
 * The game's one button.
 *
 * ## Why this exists next to `ui/theme.ts`'s `neonButton()`
 *
 * `neonButton` auto-sizes to its own label, which is the root of the problem it is replacing: a
 * stack of buttons built from it comes out RAGGED, because "New match" and "Continue" are
 * different lengths, and Spanish makes the spread worse rather than better. A menu whose buttons
 * disagree about their own width reads as unfinished no matter how each one is drawn.
 *
 * So the rule is inverted here: **the size is a token and the label fits into it**, never the
 * other way round. `neonButton` stays in the kit — it is shared template code, not this game's —
 * and this game simply never calls it.
 *
 * ## The thickness is the whole visual idea
 *
 * A flat rounded rectangle with a stroke reads as a region of the screen. The 6px darker band
 * along the bottom edge reads as an OBJECT with a side to it, and pressing collapses that band
 * while sinking the face into it — the button is depressed into its own body rather than merely
 * tinted. That is one constant and one tween, and it is most of why these feel like buttons.
 */

/** How much of an `icon`-token button's box its atlas frame fills. Short of the contour on every
 * side, which is what keeps a drawn icon from reading as a sticker over the button rather than as
 * the button's own face. */
const ICON_FRAME_FRACTION = 0.62
/** An icon standing beside a label is sized off the LABEL — this much of its font size — and set
 * this far from it, both in design units. */
const ICON_WITH_LABEL_FRACTION = 1.35
const ICON_LABEL_GAP = 6

export type ButtonSize = 'primary' | 'secondary' | 'compact' | 'icon'

/**
 * `gold` is the loudest call to action and there is **exactly one on any screen** — the moment
 * there are two, neither is the answer to "what am I meant to do here". `plum` is everything else.
 * `ghost` is only ever cancel/close/back: it is the one variant that must not look like a thing
 * you are being invited to press.
 */
export type ButtonVariant = 'gold' | 'plum' | 'ghost'

/** Base sizes in design units — multiplied by `uiScale()` at layout time. Two width classes on
 * purpose: full-width menu actions share 280 so a stack lines up, and `compact` is the in-row
 * action used by the shop and the gameplay HUD. */
const SIZES: Record<ButtonSize, { w: number; h: number }> = {
  primary: { w: 280, h: 72 },
  secondary: { w: 280, h: 64 },
  compact: { w: 168, h: 56 },
  icon: { w: 64, h: 64 },
}

/**
 * A token's width at a given scale, without needing a built button to ask.
 *
 * **Reading `button.width` before calling `button.layout()` gives the PREVIOUS scale's answer**, and
 * that is not a hypothetical: the button only learns its scale in `layout()`, so a caller that needs
 * the width in order to decide WHERE to lay it out — `ui/slider.ts`, placing a track beside its mute
 * button — gets `w * 1` on the first pass and a stale value on every resize after. Ask the token
 * instead.
 */
export function buttonWidth(size: ButtonSize, scale: number): number {
  return SIZES[size].w * scale
}

/** {@link buttonWidth}'s other half, and the same warning applies. Includes the side band, exactly as
 * the built button's own `height` getter does — a caller reserving vertical room needs the silhouette,
 * not the face. */
export function buttonHeight(size: ButtonSize, scale: number): number {
  return (SIZES[size].h + THICKNESS) * scale
}

const FONT_SIZES: Record<ButtonSize, number> = {
  primary: 26,
  secondary: 22,
  compact: 18,
  icon: 26,
}

/** How far a label may be squeezed before it is cut instead. Past this the text is small enough
 * that shrinking further trades one unreadable button for another. */
const LABEL_MIN_SCALE = 0.7
/** Horizontal padding the label must stay inside, per side, in design units. */
const LABEL_PADDING = 18

const RADIUS = 16
const THICKNESS = 6
const CONTOUR = 3
const RIM = 2
const PRESS_DROP = 3
const DISABLED_LABEL_ALPHA = 0.45

interface Palette {
  /** Top stop of the face gradient. */
  top: number
  /** Bottom stop — the saturated end. */
  bottom: number
  /** The band under the face. Darker than `bottom`; this is the button's "side". */
  side: number
  /** The 2px highlight along the top edge. */
  rim: number
  contour: number
  label: number
}

const PALETTES: Record<ButtonVariant, Palette> = {
  gold: { top: 0xffd873, bottom: 0xe08a12, side: 0x8a4a08, rim: 0xfff0c0, contour: 0x2b1405, label: 0xfffaf0 },
  plum: { top: 0x8b52d8, bottom: 0x5a2394, side: 0x33104f, rim: 0xc9a3f5, contour: 0x1a0628, label: 0xf3e9ff },
  // Ghost keeps the same construction — face, rim, contour, side — and simply speaks quietly. A
  // variant built differently (no fill, no thickness) would read as a different KIND of control,
  // and "cancel" is not a different kind of control, it is a quieter one.
  ghost: { top: 0x3a1a55, bottom: 0x2a0f40, side: 0x180825, rim: 0x6b4a8f, contour: 0x120520, label: 0xc4aede },
}

/** Pushed toward black by this much for the label's outline. The outline is REQUIRED to be darker
 * than the darkest point of the button's own gradient — an outline lighter than the face it sits
 * on stops separating the label from the button and starts competing with the background. */
const LABEL_OUTLINE_DARKEN = 0.55

/** Strips used to fake the face's vertical gradient. Enough that no band is visible at the
 * tallest token (72px) and cheap enough that it does not matter — the face is redrawn on a press
 * and a resize, not per frame. */
const GRADIENT_STRIPS = 28

/**
 * A vertical gradient inside a rounded rectangle, drawn as horizontal strips inset to follow the
 * corner arcs.
 *
 * **`fillGradientStyle()` cannot do this**, and the reason is worth keeping: it colours per VERTEX,
 * and Phaser fills a rounded rect as a triangle fan, so the four colours are interpolated across
 * triangles rather than down the shape — which puts a bright diagonal seam across the face along
 * the triangulation. It was clearly visible on the first version of every button on the stand.
 * Separately, `fillGradientStyle` is a WebGL-only feature and this project ships `Phaser.AUTO`, so
 * a Canvas fallback would have lost the gradient entirely and nobody would have found out until a
 * machine without WebGL turned up.
 *
 * Strips cost one `fillRect` each, are exact in both renderers, and the horizontal inset is just
 * the circle equation at that row — the same arithmetic the rounded rect itself is made of.
 */
function fillVerticalGradientRounded(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  top: number,
  bottom: number,
): void {
  const r = Math.min(radius, w / 2, h / 2)
  const step = h / GRADIENT_STRIPS

  for (let i = 0; i < GRADIENT_STRIPS; i++) {
    const stripTop = i * step
    const stripBottom = stripTop + step
    // Sampled at the row where the strip is WIDEST — its top inside the upper arc, its bottom
    // inside the lower one — so a strip never pokes outside the silhouette it is filling.
    const sample = stripTop < r ? stripTop : stripBottom > h - r ? stripBottom : stripTop
    let inset = 0
    if (sample < r) {
      const dy = r - sample
      inset = r - Math.sqrt(Math.max(0, r * r - dy * dy))
    } else if (sample > h - r) {
      const dy = sample - (h - r)
      inset = r - Math.sqrt(Math.max(0, r * r - dy * dy))
    }

    graphics.fillStyle(shade(top, bottom, i / (GRADIENT_STRIPS - 1)), 1)
    // A half-pixel of overlap between strips: without it the seams show as hairlines once the
    // strip height stops landing on whole device pixels, which it does at every `uiScale` but 1.
    graphics.fillRect(x + inset, y + stripTop, w - inset * 2, step + 0.5)
  }
}

function shade(color: number, toward: number, amount: number): number {
  const mix = (shift: number): number => {
    const a = (color >> shift) & 0xff
    const b = (toward >> shift) & 0xff
    return Math.round(a + (b - a) * amount) << shift
  }
  return mix(16) | mix(8) | mix(0)
}

/** Desaturates toward its own luminance — a disabled button should read as the same object with
 * the life taken out of it, not as a different colour. */
function desaturate(color: number, amount: number): number {
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  const grey = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  return shade(color, (grey << 16) | (grey << 8) | grey, amount)
}

export interface GameButtonOptions {
  size: ButtonSize
  variant: ButtonVariant
  label?: string
  /** For the `icon` token: a single glyph drawn in place of a label. */
  icon?: string
  /**
   * An ATLAS FRAME drawn in place of a label — the safe form of {@link GameButtonOptions.icon}.
   *
   * A glyph icon depends on the device owning that codepoint, and a phone that does not renders a
   * tofu box where the control's whole meaning was. Prefer this for anything a player has to
   * recognise; `icon` remains for text-like marks (`⚙`, `←`) that live in ordinary font coverage.
   */
  iconFrame?: string
}

export interface GameButton {
  /** Everything the button draws. Position it from the owning scene's `layout()`, never
   * `create()` — and never make THIS interactive: `Container` hardcodes `originX/Y = 0.5` and
   * shifts the hit-test point, which is why {@link GameButton.hitArea} is a plain Rectangle. */
  readonly container: Phaser.GameObjects.Container
  /** `bindAction`'s `pointer` target. A separate `Rectangle`, always at least 44x44 after
   * `uiScale()` even when the button itself is smaller. */
  readonly hitArea: Phaser.GameObjects.Rectangle
  /** Current drawn footprint, in screen px — for a caller stacking buttons or sizing a panel. */
  readonly width: number
  readonly height: number
  /** What the button currently says — for the platform tests, which cannot otherwise read a `Text`
   * that lives inside a widget without reaching into its display list by index. Same reason
   * `ui/playerBlock.ts` exposes its own. */
  readonly text: string
  setLabel(text: string): void
  /** Swaps the atlas frame of a button built with {@link GameButtonOptions.iconFrame}. */
  setIconFrame(frame: string): void
  setEnabled(enabled: boolean): void
  setVariant(variant: ButtonVariant): void
  /** All positioning and sizing. `scale` is `uiScale(viewportWidth)`. */
  layout(x: number, y: number, scale: number): void
  destroy(): void
}

export function gameButton(scene: Phaser.Scene, options: GameButtonOptions): GameButton {
  const size = SIZES[options.size]
  let variant = options.variant
  let enabled = true
  let pressed = false
  let scale = 1

  const face = scene.add.graphics()
  const label = scene.add
    .text(0, 0, (options.iconFrame ? options.label : options.icon ?? options.label) ?? '', {
      fontFamily: getDisplayFontStack(),
      fontSize: FONT_SIZES[options.size],
      color: '#ffffff',
    })
    .setOrigin(0.5)

  // Interactive from the start and never resized to zero, so the `setInteractive()`-on-a-0x0-object
  // trap (CLAUDE.md "Responsive Layout", gotcha #1) cannot happen: it is created at its design
  // size and only ever scaled from there.
  const hitArea = scene.add
    .rectangle(0, 0, Math.max(size.w, MIN_TOUCH_TARGET), Math.max(size.h, MIN_TOUCH_TARGET), 0x000000, 0)
    .setInteractive({ useHandCursor: true })

  // Face and label ride in their own container so the press can be a transform on `body` rather
  // than an offset baked into every redraw. That split is what makes the release tweenable: a
  // redraw cannot ease, and a tween cannot re-run the drawing.
  // Drawn at 1x1 and sized in `refit()`, like every other piece of this widget: a button learns its
  // scale from `layout()`, not from `create()`.
  const iconImage = options.iconFrame
    ? scene.add.image(0, 0, ATLAS_KEY, options.iconFrame).setOrigin(0.5)
    : undefined

  // Three shapes, not two: a label, an icon, or an icon standing BESIDE a label — which is what the
  // two consumables wear, a mark and the price it costs.
  const body = scene.add.container(0, 0, iconImage ? [face, iconImage, label] : [face, label])
  const container = scene.add.container(0, 0, [body, hitArea])

  function palette(): Palette {
    const p = PALETTES[variant]
    if (enabled) return p
    return {
      ...p,
      top: desaturate(p.top, 0.75),
      bottom: desaturate(p.bottom, 0.75),
      // The side band does NOT desaturate: a disabled button is still a physical object, and
      // flattening it would read as "this control vanished" rather than "this control is off".
      rim: desaturate(p.rim, 0.75),
    }
  }

  function redraw(): void {
    const p = palette()
    const w = size.w * scale
    const h = size.h * scale
    const thickness = THICKNESS * scale
    const radius = RADIUS * scale
    // The side band collapses under a press while `body` sinks into it, so the button's outer
    // silhouette barely moves and the face clearly does — depressed into its own body rather than
    // merely tinted.
    const side = pressed ? 0 : thickness

    face.clear()

    if (side > 0) {
      face.fillStyle(p.side, 1)
      face.fillRoundedRect(-w / 2, -h / 2, w, h + side, radius)
    }

    fillVerticalGradientRounded(face, -w / 2, -h / 2, w, h, radius, p.top, p.bottom)

    // A straight highlight along the top edge, stopping short of both corner radii. The first
    // version drew an arc round the top-left corner and then a line to the right edge, which put a
    // bright DIAGONAL across the face — the path from the arc's end point to the line's start is
    // still part of the path, and Graphics strokes it.
    face.lineStyle(RIM * scale, p.rim, 0.75)
    face.lineBetween(-w / 2 + radius, -h / 2 + RIM * scale, w / 2 - radius, -h / 2 + RIM * scale)

    face.lineStyle(CONTOUR * scale, p.contour, 1)
    face.strokeRoundedRect(-w / 2, -h / 2, w, h + side, radius)

    label.setColor(`#${p.label.toString(16).padStart(6, '0')}`)
    label.setAlpha(enabled ? 1 : DISABLED_LABEL_ALPHA)
    iconImage?.setAlpha(enabled ? 1 : DISABLED_LABEL_ALPHA)
  }

  function refit(): void {
    if (iconImage && !options.label) {
      // Icon alone: a square drawn inside the button's own box, so it grows and shrinks with the
      // button and never reaches the contour.
      const drawn = Math.min(size.w, size.h) * ICON_FRAME_FRACTION * scale
      iconImage.setDisplaySize(drawn, drawn)
      label.setVisible(false)
      return
    }
    const fontSize = FONT_SIZES[options.size] * scale
    if (iconImage) {
      /**
       * Icon beside label. Both are centred as ONE group rather than each on its own centre — a
       * mark pinned to the left edge and a number in the middle reads as two separate things that
       * happen to share a button.
       *
       * The icon is sized off the FONT rather than off the button, so it stays the height of the
       * text it stands next to at every scale; sized off the box it would swell past the digits on
       * a wide button and shrink under them on a narrow one.
       */
      label.setFontSize(fontSize)
      label.setStroke(`#${shade(PALETTES[variant].bottom, 0x000000, LABEL_OUTLINE_DARKEN).toString(16).padStart(6, '0')}`, Math.max(2, 4 * scale))
      label.setShadow(0, 2 * scale, 'rgba(0,0,0,0.45)', 4 * scale, false, true)

      const available = (size.w - LABEL_PADDING * 2) * scale
      const gap = ICON_LABEL_GAP * scale
      let iconSize = fontSize * ICON_WITH_LABEL_FRACTION
      const factor = fitScale(iconSize + gap + label.width, available, 1)
      if (factor < 1) {
        label.setFontSize(fontSize * Math.max(factor, LABEL_MIN_SCALE))
        iconSize *= Math.max(factor, LABEL_MIN_SCALE)
      }

      const total = iconSize + gap + label.width
      iconImage.setDisplaySize(iconSize, iconSize)
      iconImage.setPosition(-total / 2 + iconSize / 2, 0)
      label.setPosition(total / 2 - label.width / 2, 0)
      return
    }
    label.setFontSize(fontSize)
    label.setStroke(`#${shade(PALETTES[variant].bottom, 0x000000, LABEL_OUTLINE_DARKEN).toString(16).padStart(6, '0')}`, Math.max(2, 4 * scale))
    label.setShadow(0, 2 * scale, 'rgba(0,0,0,0.45)', 4 * scale, false, true)

    const available = (size.w - LABEL_PADDING * 2) * scale
    // `fitScale` never grows, so a short label keeps the token's own font size and only a long one
    // is squeezed — which is the whole point of fixing the width.
    const factor = fitScale(label.width, available, 1)
    if (factor >= LABEL_MIN_SCALE) {
      if (factor < 1) label.setFontSize(fontSize * factor)
      return
    }

    // Past the floor the button still does not grow: the label is cut instead. Losing the tail of
    // one word is a smaller failure than a stack of buttons that no longer line up.
    label.setFontSize(fontSize * LABEL_MIN_SCALE)
    let text = label.text
    while (text.length > 1 && label.width > available) {
      text = text.slice(0, -1)
      label.setText(`${text}…`)
    }
  }

  hitArea.on(Phaser.Input.Events.POINTER_DOWN, () => {
    // Every button in the game clicks, from one place rather than from fifteen call sites — see
    // `theme.ts`'s `setPressSound`. A button that clicks on one screen and not on another is the kind
    // of inconsistency nobody files and everybody feels.
    playPressSound()
    if (!enabled) return
    pressed = true
    scene.tweens.killTweensOf(body)
    body.setY(PRESS_DROP * scale)
    redraw()
  })
  const release = (): void => {
    if (!pressed) return
    pressed = false
    redraw()
    // Springs back past its resting point and settles. The overshoot is what sells the release as
    // physical rather than as a state flip, and it is why `body` exists as its own container.
    scene.tweens.killTweensOf(body)
    scene.tweens.add({ targets: body, y: 0, duration: 160, ease: 'Back.easeOut' })
  }
  hitArea.on(Phaser.Input.Events.POINTER_UP, release)
  hitArea.on(Phaser.Input.Events.POINTER_OUT, release)

  refit()
  redraw()

  return {
    container,
    hitArea,
    get width() {
      return size.w * scale
    },
    get height() {
      return size.h * scale + THICKNESS * scale
    },
    get text() {
      return label.text
    },
    setLabel(text: string) {
      label.setText(text)
      refit()
      redraw()
    },
    setIconFrame(frame: string) {
      iconImage?.setFrame(frame)
      refit()
    },
    setEnabled(next: boolean) {
      enabled = next
      hitArea.input!.enabled = next
      redraw()
    },
    setVariant(next: ButtonVariant) {
      variant = next
      refit()
      redraw()
    },
    layout(x: number, y: number, nextScale: number) {
      scale = nextScale
      container.setPosition(x, y)
      // A resize mid-press would otherwise leave the body stuck at the old scale's drop.
      if (!pressed) body.setY(0)
      // The tap target is padded back out to 44 AFTER the shrink, so a `compact` button on a
      // narrow phone stays tappable even though it renders smaller than the threshold.
      hitArea.setSize(Math.max(size.w * scale, MIN_TOUCH_TARGET), Math.max(size.h * scale, MIN_TOUCH_TARGET))
      // Phaser does not recompute a hit area when the object resizes, and calling setInteractive()
      // again only re-enables it (CLAUDE.md "Responsive Layout", gotcha #2).
      const area = hitArea.input?.hitArea as Phaser.Geom.Rectangle | undefined
      area?.setTo(0, 0, hitArea.width, hitArea.height)
      refit()
      redraw()
    },
    destroy() {
      container.destroy()
    },
  }
}
