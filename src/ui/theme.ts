import * as Phaser from 'phaser'
import { getDisplayFontStack } from './font'
import { MIN_TOUCH_TARGET } from './uiScale'

/**
 * Themeable widget kit: a palette-driven set of reusable Phaser 4 UI factories (buttons, rows,
 * badges, panels, progress bars, backgrounds) sharing one visual language — a dark fill, a
 * crisp colored stroke, and (where noted) two wider/fainter strokes behind it standing in for a
 * glow. That "layered-alpha-strokes glow" technique needs no shader/Bloom postFX pass (works
 * identically under the Canvas fallback too) and is reused everywhere below instead of being
 * reinvented per widget.
 *
 * Every widget takes its accent color as a parameter (or falls back to `getTheme()`'s current
 * palette) — nothing in this file hardcodes a specific game's colors. A new game reskins the
 * whole kit with one `setTheme({ colors: { ... } })` call, ideally before any scene creates its
 * first widget. See CLAUDE.md's "UI Kit" section for the full theming guide.
 */

// -- THEME -------------------------------------------------------------------------------

export interface ThemeColors {
  /** Main accent — primary CTAs, headings, the "loudest" interactive color. */
  primary: number
  /** Secondary accent — icons, back buttons, secondary actions. */
  secondary: number
  /** Reserved for reward/currency iconography (stars, coins, unlocks, ...) — `valueBadge()`
   * defaults to this. Avoid reusing it for plain UI chrome; if every accent color means
   * something, "reward" stops being visually distinct at a glance. */
  accent: number
  /** Full-bleed scene background gradient, top stop — see `createSceneBackground()`. */
  backgroundTop: number
  /** Full-bleed scene background gradient, bottom stop. */
  backgroundBottom: number
  /** Dark fill shared by buttons/rows/panels/badges (the "surface" every accent stroke sits on). */
  surface: number
}

export interface ThemeConfig {
  colors: ThemeColors
  /** Canonical corner radius for the rounded-panel visual language (buttons, rows, pills,
   * panels all default to this — see `UI_RADIUS`'s own history: several of these converged on
   * the same 8-10px independently before being unified into one named value). */
  radius: number
}

export const DEFAULT_THEME: ThemeConfig = {
  colors: {
    primary: 0xff2975,
    secondary: 0x00fff9,
    accent: 0xf9f871,
    backgroundTop: 0x1a0533,
    backgroundBottom: 0x2d1b69,
    surface: 0x0a0118,
  },
  radius: 10,
}

let theme: ThemeConfig = DEFAULT_THEME

/** Overrides the active theme (deep-merged over the current one, not `DEFAULT_THEME` — safe to
 * call more than once with partial updates). Call once at boot, before scenes start creating
 * widgets: every factory below reads `getTheme()` at CREATION time, not reactively, so a widget
 * already on screen won't retint itself if the theme changes later. */
export function setTheme(overrides: Partial<ThemeConfig> & { colors?: Partial<ThemeColors> }): void {
  theme = {
    ...theme,
    ...overrides,
    colors: { ...theme.colors, ...overrides.colors },
  }
}

/** The active theme (`DEFAULT_THEME` until `setTheme()` is called). */
export function getTheme(): ThemeConfig {
  return theme
}

let pressSound: (() => void) | null = null

/**
 * Registers the click every widget in this kit plays when it is pressed. Same
 * "register a config once at boot" shape as {@link setTheme} — and deliberately a CALLBACK, not a
 * sound key: the kit stays unaware of `src/audio/`, of which cue is the click, and of whether the
 * game has audio at all. Nothing registered means nothing plays.
 *
 * It lives here rather than at ~15 call sites because a button that clicks in one menu and not in
 * another is the kind of inconsistency nobody files a bug about and everybody feels. Fired on
 * POINTER_DOWN, next to the press animation — the press is what the player did; whether the
 * action then succeeds is the caller's business.
 */
export function setPressSound(play: (() => void) | null): void {
  pressSound = play
}

/**
 * Plays whatever `setPressSound` registered.
 *
 * **Exported for `ui/button.ts`**, and that is the fix for a whole silent game rather than a tidy-up:
 * the three widgets in THIS file called it and `gameButton` — which every screen in the game is
 * actually built from — never did. So the click existed, was wired in `main.ts`, was documented, and
 * could only be heard on widgets the game had stopped using.
 */
export function playPressSound(): void {
  pressSound?.()
}

/** Numeric `0xRRGGBB` -> CSS `'#rrggbb'`, for Phaser `Text` styles (which want a CSS string,
 * unlike `Graphics`' numeric colors). */
export function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

// -- createSceneBackground ----------------------------------------------------------------

const BACKGROUND_COVER_OVERSCAN = 1.02

export interface SceneBackground {
  /** The single underlying GameObject (an `Image` if a texture was available, a `Graphics`
   * otherwise) — for `setDepth()`/scene lifecycle only, not for direct manipulation. */
  gameObject: Phaser.GameObjects.GameObject
  /** Call from the owning scene's `layout()` on every resize. */
  resize(width: number, height: number): void
}

/**
 * Full-bleed scene background: uses `textureKey` if it's already loaded, otherwise falls back
 * to a vertical gradient between `gradientTop`/`gradientBottom` (defaulting to the active
 * theme's `backgroundTop`/`backgroundBottom`). Create once in `create()` (immediately after
 * anything meant to render behind everything else, since insertion order is draw order) and
 * call `.resize(width, height)` from the scene's own `layout()`.
 *
 * The texture branch is a "cover" fit (CSS `background-size: cover`), not a stretch:
 * `image.width`/`.height` stay the *native*, unscaled texture-frame size (Phaser's Size
 * component never mutates these on `setDisplaySize()`/scale changes — only
 * `displayWidth`/`displayHeight` move — so reading them fresh on every `resize()` call is safe,
 * not compounding). Scaling by `max(viewportW/imgW, viewportH/imgH)` and centering (origin 0.5)
 * fills the viewport with no letterboxing; the parts that overflow the canvas on the
 * non-fitting axis are simply clipped by Phaser at the canvas bounds — no explicit crop/mask
 * needed.
 */
export function createSceneBackground(
  scene: Phaser.Scene,
  textureKey: string,
  gradientTop: number = getTheme().colors.backgroundTop,
  gradientBottom: number = getTheme().colors.backgroundBottom,
  /** Optional darkening multiply-tint on the texture branch only. */
  tint?: number,
): SceneBackground {
  if (scene.textures.exists(textureKey)) {
    const image = scene.add.image(0, 0, textureKey).setOrigin(0.5).setDepth(-1000)
    if (tint !== undefined) image.setTint(tint)
    return {
      gameObject: image,
      resize(width: number, height: number) {
        // A small deliberate overscan (>1, not the exact cover-fit minimum) swallows a
        // hairline sub-pixel rounding gap at the viewport edge that the exact cover ratio can
        // leave during a resize/zoom event — costs nothing visually (the image already
        // fills/overflows the viewport either way).
        const scale = Math.max(width / image.width, height / image.height) * BACKGROUND_COVER_OVERSCAN
        image.setDisplaySize(image.width * scale, image.height * scale)
        image.setPosition(width / 2, height / 2)
      },
    }
  }

  const graphics = scene.add.graphics().setDepth(-1000)
  return {
    gameObject: graphics,
    resize(width: number, height: number) {
      graphics.clear()
      graphics.fillGradientStyle(gradientTop, gradientTop, gradientBottom, gradientBottom, 1)
      graphics.fillRect(0, 0, width, height)
    },
  }
}

// -- neonButton --------------------------------------------------------------------------

const BUTTON_BG_ALPHA = 0.92
const BUTTON_PADDING_X = 20
const BUTTON_PADDING_Y = 12
// The outer glow ring (see `redraw()`'s `glowOuter.strokeRoundedRect` call below — offset 7px,
// 8px line width) is visually part of the button but sits outside a hit area that only covered
// the solid core box would use — taps landing on the bright glow rim would silently miss. This
// margin is that same offset + half the line width, so the hit area always matches what
// `glowOuter` actually draws. Exported so a caller aligning a `neonButton`'s *visible* edge
// against a plain icon/text object (which has no glow) can compensate for the bleed.
export const NEON_BUTTON_GLOW_MARGIN = 11
const HIT_AREA_GLOW_MARGIN = NEON_BUTTON_GLOW_MARGIN

export interface NeonButton {
  /** `bindAction`'s `pointer` target — see the hover/press comment below for why raw pointer events are still used internally. */
  container: Phaser.GameObjects.Container
  label: Phaser.GameObjects.Text
  /** Native, unscaled footprint (the solid core box, not the glow-padded hit area) — for a
   * caller sizing another object (e.g. a backdrop panel) around this button's actual current
   * footprint. */
  readonly width: number
  readonly height: number
  setText(text: string): void
  setFontSize(size: number): void
  /** Forces the button's core box to at least `width` wide, growing past its own
   * label-driven auto-size if needed (never shrinks below it) — for a button that must
   * visibly read as wider than some other element it sits near (e.g. a reward/top-up action
   * next to narrower catalog rows), when the caller only knows that width at `layout()` time
   * (responsive), not at creation time. */
  setMinWidth(width: number): void
}

export interface NeonButtonOptions {
  /** Skips both glow layers and dims the core stroke — for a "less important than the primary
   * action" button (a Cancel/Close next to a loud CTA) that shouldn't glow as bright, while
   * keeping every other `neonButton` behavior (hover/press feel, hit-area sizing) identical. */
  muted?: boolean
  /** Suppresses ONLY the glow halo (glowInner/glowOuter never drawn) while keeping the border
   * at its normal full alpha — distinct from `muted` (which ALSO dims the border/stroke). For
   * a button that must sit flush inside a shared-height row alongside non-glowing neighbors
   * (e.g. plain badges) — the glow halo extending past the button's own core box is what
   * makes it look taller/bigger than neighbors despite an identical core box height. */
  noGlow?: boolean
  /** Swaps the stroke/glow (never the white label) to this color while hovered OR pressed,
   * reverting the instant neither is true — for a button that should read as secondary at rest
   * but "light up" once engaged. Omitted by default, which keeps `color` fixed regardless of
   * hover/press state. */
  hoverColor?: number
  /** Overrides the label's font (defaults to plain Arial, matching every other widget in this
   * file) — for a caller that wants a single button (e.g. the primary CTA) rendered in the
   * game's own display font (`ui/font.ts`'s `getDisplayFontStack()`) while every other button
   * stays plain system sans. */
  fontFamily?: string
  /** Fills the button's core box with a top-to-bottom color gradient instead of the usual flat
   * dark fill + colored stroke — makes the button read as filled/solid rather than outlined,
   * for a single "loudest" CTA that should look different from every other button on screen.
   * Pairs a thin light rim for edge definition instead of the usual colored stroke, since a
   * bright gradient fill has no dark core left for a colored stroke to stand out against. */
  gradientFill?: { top: number; bottom: number }
  /** Adds a soft black drop-shadow behind the label — for a `gradientFill` button sitting on a
   * busy multi-color fill, where a plain white label can read as washed-out even at full
   * alpha. A flat dark-fill button already has enough contrast without this. */
  textShadow?: boolean
}

/**
 * Rounded-rect neon-outlined button: a dark fill, a crisp colored stroke, two wider/fainter
 * strokes behind it standing in for a glow. White label text (not tinted to `color`) for
 * maximum legibility against the dark fill — only the outline/glow carry the accent color.
 */
export function neonButton(scene: Phaser.Scene, text: string, color: number, fontSize = 22, options?: NeonButtonOptions): NeonButton {
  const muted = options?.muted ?? false
  const noGlow = options?.noGlow ?? false
  const hoverColor = options?.hoverColor
  const gradientFill = options?.gradientFill
  const radius = getTheme().radius
  const bgColor = getTheme().colors.surface
  const label = scene.add.text(0, 0, text, { fontFamily: options?.fontFamily ?? 'Arial', fontSize, color: '#ffffff' }).setOrigin(0.5)
  if (options?.textShadow) label.setShadow(0, 2, 'rgba(0,0,0,0.6)', 4, false, true)
  const glowOuter = scene.add.graphics()
  const glowInner = scene.add.graphics()
  const bg = scene.add.graphics()
  const container = scene.add.container(0, 0, [glowOuter, glowInner, bg, label])

  let hovered = false
  let pressed = false
  let minWidth = 0

  function redraw(): void {
    // hoverColor swaps the accent color while hovered OR pressed (a touch device never fires
    // POINTER_OVER before POINTER_DOWN, so gating on hover alone would leave a tap-only
    // interaction permanently on `color`) — the label itself stays white regardless.
    const activeColor = hoverColor && (hovered || pressed) ? hoverColor : color

    const w = Math.max(label.width + BUTTON_PADDING_X * 2, MIN_TOUCH_TARGET, minWidth)
    const h = Math.max(label.height + BUTTON_PADDING_Y * 2, MIN_TOUCH_TARGET)
    const halfW = w / 2
    const halfH = h / 2

    bg.clear()
    if (gradientFill) {
      // A filled, solid action reads differently from every other outlined button — a
      // top-to-bottom color fill instead of the usual dark-fill-plus-stroke, plus a thin
      // light rim for edge definition (a bright fill has no dark core left for a colored
      // stroke to stand out against).
      bg.fillGradientStyle(gradientFill.top, gradientFill.top, gradientFill.bottom, gradientFill.bottom, 1)
      bg.fillRoundedRect(-halfW, -halfH, w, h, radius)
      bg.lineStyle(2, 0xffffff, hovered ? 0.85 : 0.55)
      bg.strokeRoundedRect(-halfW, -halfH, w, h, radius)
    } else {
      bg.fillStyle(bgColor, BUTTON_BG_ALPHA)
      bg.fillRoundedRect(-halfW, -halfH, w, h, radius)
      bg.lineStyle(2, activeColor, muted ? (hovered ? 0.7 : 0.5) : hovered ? 1 : 0.85)
      bg.strokeRoundedRect(-halfW, -halfH, w, h, radius)
    }

    glowInner.clear()
    glowOuter.clear()
    if (!muted && !noGlow) {
      glowInner.lineStyle(4, activeColor, hovered ? 0.5 : 0.3)
      glowInner.strokeRoundedRect(-halfW - 3, -halfH - 3, w + 6, h + 6, radius + 3)

      glowOuter.lineStyle(8, activeColor, hovered ? 0.22 : 0.12)
      glowOuter.strokeRoundedRect(-halfW - 7, -halfH - 7, w + 14, h + 14, radius + 6)
    }

    // Container doesn't auto-size to its children — .width/.height stay 0 unless set
    // explicitly. Callers positioning *other* objects relative to this button's footprint
    // (e.g. right-aligning it against a moving edge) read these, so they have to actually
    // reflect the current size — deliberately the solid core box, not the glow-padded hit area
    // below, so layout math elsewhere doesn't shift.
    container.setSize(w, h)

    // Non-obvious Phaser fact, confirmed against Phaser's own source
    // (InputManager#pointWithinHitArea): Container.originX/Y are hardcoded to 0.5 (its own
    // source comment: "do not change, it has no effect other than to break things"), so once
    // `setSize(w, h)` is called above, `displayOriginX/Y` become `w/2, h/2` — and
    // `pointWithinHitArea` *unconditionally* adds `displayOriginX/Y` to the local hit-test
    // point before calling `hitAreaCallback`, for every interactive object, Container or not.
    // A hitArea built in the natural "container-center-relative" frame (-halfW..halfW) is
    // therefore silently tested against a point already shifted by (+halfW, +halfH) — the
    // *true* effective clickable region ends up shifted left/up by a full halfW/halfH from
    // where it looks like it should be. Solving "hitArea must contain (trueLocalX + halfW,
    // trueLocalY + halfH) exactly when trueLocalX/Y are within the intended glow-padded box"
    // gives the offset hitArea below: it starts near (0, 0) instead of (-halfW, -halfH), *not*
    // a typo. Center clicks work fine even with the naive (wrong) placement purely by
    // accident — only off-center taps expose it.
    const hitX = -HIT_AREA_GLOW_MARGIN
    const hitY = -HIT_AREA_GLOW_MARGIN
    const hitW = w + HIT_AREA_GLOW_MARGIN * 2
    const hitH = h + HIT_AREA_GLOW_MARGIN * 2

    if (!container.input) {
      container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(hitX, hitY, hitW, hitH),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      })
    } else {
      ;(container.input.hitArea as Phaser.Geom.Rectangle).setTo(hitX, hitY, hitW, hitH)
    }
  }

  redraw()

  // Hover/press here are purely this widget's own cosmetic state, not a game action — the
  // rule "subscribe to actions, never raw input events" governs how *scenes* wire up
  // gameplay/UI behavior via bindAction; it doesn't forbid a reusable widget from managing its
  // own internal visual feedback the same way Phaser's built-in `useHandCursor` already does.
  // The actual click still only ever fires through `bindAction(scene, action, { pointer:
  // button.container }, ...)` at each call site.
  container.on(Phaser.Input.Events.POINTER_OVER, () => {
    hovered = true
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_OUT, () => {
    hovered = false
    pressed = false
    container.setScale(1)
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_DOWN, () => {
    pressed = true
    container.setScale(0.96)
    playPressSound()
    if (hoverColor) redraw()
  })
  container.on(Phaser.Input.Events.POINTER_UP, () => {
    pressed = false
    container.setScale(1)
    if (hoverColor) redraw()
  })

  return {
    container,
    label,
    get width() {
      return container.width
    },
    get height() {
      return container.height
    },
    setText(newText: string) {
      label.setText(newText)
      redraw()
    },
    setFontSize(size: number) {
      label.setFontSize(size)
      redraw()
    },
    setMinWidth(width: number) {
      minWidth = width
      redraw()
    },
  }
}

// -- rowButton -----------------------------------------------------------------------

const ROW_BG_ALPHA = 0.85

export type RowColumnAlign = 'left' | 'center' | 'right'

/**
 * One column's position within a `rowButton` row, defined as a FRACTION (0..1) of the row's
 * own *width* — so every row built from the same columns array lines up pixel-for-pixel
 * regardless of each row's individual content length. Recomputed against the row's live width
 * on every redraw (including a later `setSize()`), not baked in once.
 */
export interface RowColumn {
  x: number
  align: RowColumnAlign
  /** Fraction (0..1) of the row's width this column reserves. Informational for `rowButton`'s
   * own three managed columns (it never truncates/wraps text) — load-bearing for a column a
   * caller positions its OWN object into outside `rowButton` (an icon slot present only in some
   * rows, say): that object's reserved space then comes from the exact same source of truth as
   * every column `rowButton` itself renders, not a second independently-guessed number. */
  width: number
}

/**
 * `[left, result, reserved, accent]` — `rowButton` only renders columns 0/1/3 (its three
 * managed texts); column 2 is deliberately left unused by `rowButton` itself, reserved for a
 * caller's own object (an icon that's present only in some rows) so that slot and the row's own
 * accent column both come from one shared constant — neither column's position depends on
 * whether the other slot is actually occupied.
 */
export type RowColumns = readonly [RowColumn, RowColumn, RowColumn, RowColumn]

function originXForAlign(align: RowColumnAlign): number {
  return align === 'left' ? 0 : align === 'right' ? 1 : 0.5
}

export interface RowButton {
  /** `bindAction`'s `pointer` target — the whole row is one tap zone. */
  container: Phaser.GameObjects.Container
  /** `alpha` defaults to 0.75 — pass a lower value for a deliberately muted/placeholder result. */
  setResultText(text: string, alpha?: number): void
  /** Changes the accent (right-hand) label text — e.g. `"Buy"` -> `"Owned"` once a one-time purchase completes. */
  setAccentText(text: string): void
  /** Repaints the border/accent in a new color without rebuilding the row — both texts and border share one `color` variable, so a single call keeps them in sync. */
  setColor(color: number): void
  setSize(width: number, height: number): void
  setFontSize(size: number): void
  /**
   * Parents a caller-owned object into the row's RESERVED (third) column and keeps it positioned
   * there through every later `setSize()`.
   *
   * That column has always been reserved and unrendered — the row skips it precisely so a caller
   * can put something of its own there — but until this existed the caller also had to re-derive
   * the column geometry itself, from a `width` only the row knows and a `-halfW` origin only the
   * row's `redraw()` understands. Two places computing one position is how they drift.
   *
   * The object is added to the row's container, so it inherits the press-scale and is destroyed
   * with the row. Call once, at creation.
   */
  setSlot(object: Phaser.GameObjects.Image): void
}

/**
 * Full-width row button: e.g. a settings/list row reading "Label   result          Accent" as
 * ONE tap zone (the whole row is the button; the accent text is a visual highlight, not a
 * separate nested button) — three `Text` children (left label, middle result, right accent)
 * inside the same dark-fill-plus-neon-stroke shell as `neonButton`, sharing its
 * hover-brighten/press-scale feel and its hit-area-matches-visible-bounds guarantee. Unlike
 * `neonButton` (auto-sized to its own label), a row's width/height are caller-driven via
 * `setSize()` — it has to span its container's width, not size itself to its text. Each managed
 * column's text `origin` is fixed once at creation from that column's own `align`
 * (left/center/right never change for a given `rowButton` instance), not recomputed every
 * redraw.
 */
export function rowButton(scene: Phaser.Scene, leftLabel: string, resultLabel: string, accentLabel: string, columns: RowColumns, initialColor: number, fontSize = 18): RowButton {
  const [leftCol, resultCol, slotCol, accentCol] = columns
  const radius = getTheme().radius
  const bgColor = getTheme().colors.surface

  const leftText = scene.add.text(0, 0, leftLabel, { fontFamily: 'Arial', fontSize, color: '#ffffff' }).setOrigin(originXForAlign(leftCol.align), 0.5)
  const resultText = scene.add
    .text(0, 0, resultLabel, { fontFamily: 'Arial', fontSize: fontSize - 2, color: '#ffffff' })
    .setOrigin(originXForAlign(resultCol.align), 0.5)
    .setAlpha(0.75)
  const accentText = scene.add
    .text(0, 0, accentLabel, { fontFamily: 'Arial', fontSize, color: toCssColor(initialColor), fontStyle: 'bold' })
    .setOrigin(originXForAlign(accentCol.align), 0.5)
  const bg = scene.add.graphics()
  const border = scene.add.graphics()
  const container = scene.add.container(0, 0, [bg, border, leftText, resultText, accentText])

  let hovered = false
  let slot: Phaser.GameObjects.Image | null = null
  let color = initialColor
  let width = MIN_TOUCH_TARGET * 3
  let height = MIN_TOUCH_TARGET

  function redraw(): void {
    const halfW = width / 2
    const halfH = height / 2

    bg.clear()
    bg.fillStyle(bgColor, ROW_BG_ALPHA)
    bg.fillRoundedRect(-halfW, -halfH, width, height, radius)

    border.clear()
    border.lineStyle(2, color, hovered ? 1 : 0.7)
    border.strokeRoundedRect(-halfW, -halfH, width, height, radius)

    // Column x is a fraction of the row's own width, measured from its left edge — converted
    // to the row-local (-halfW..halfW) coordinate space every redraw, since `width` can change
    // (setSize()). All three sit on the same vertical center — y is always 0.
    leftText.setPosition(-halfW + leftCol.x * width, 0)
    resultText.setPosition(-halfW + resultCol.x * width, 0)
    accentText.setPosition(-halfW + accentCol.x * width, 0)
    // The reserved column, if the caller filled it. Same conversion as the three managed texts,
    // for the same reason — the object must move when the row is resized.
    slot?.setPosition(-halfW + slotCol.x * width, 0)

    // Same footprint-vs-hit-area split as neonButton — .width/.height reflect the row's
    // caller-set box exactly (there's no glow padding here to differ from it).
    container.setSize(width, height)

    // Same Container-origin-shift hit-area fix neonButton needs (see its own derivation
    // above): .setSize() shifts displayOriginX/Y to (halfW, halfH), so the hitArea has to
    // start near (0, 0), not (-halfW, -halfH), to actually test against the row's true visual
    // bounds.
    if (!container.input) {
      container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      })
    } else {
      ;(container.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)
    }
  }

  redraw()

  // Same "purely cosmetic internal state" reasoning as neonButton's identical block above.
  container.on(Phaser.Input.Events.POINTER_OVER, () => {
    hovered = true
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_OUT, () => {
    hovered = false
    container.setScale(1)
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_DOWN, () => {
    container.setScale(0.98)
    playPressSound()
  })
  container.on(Phaser.Input.Events.POINTER_UP, () => container.setScale(1))

  return {
    container,
    setResultText(text: string, alpha = 0.75) {
      resultText.setText(text).setAlpha(alpha)
      redraw()
    },
    setAccentText(text: string) {
      accentText.setText(text)
      redraw()
    },
    setColor(newColor: number) {
      color = newColor
      accentText.setColor(toCssColor(newColor))
      redraw()
    },
    setSlot(object: Phaser.GameObjects.Image) {
      slot = object
      container.add(object)
      redraw()
    },
    setSize(newWidth: number, newHeight: number) {
      width = newWidth
      height = newHeight
      redraw()
    },
    setFontSize(size: number) {
      leftText.setFontSize(size)
      resultText.setFontSize(Math.max(10, size - 2))
      accentText.setFontSize(size)
      redraw()
    },
  }
}

// -- valueBadge ----------------------------------------------------------------------------

const VALUE_BADGE_PADDING_X = 14
const VALUE_BADGE_PADDING_Y = 8
const VALUE_BADGE_BG_ALPHA = 0.85

export interface ValueBadge {
  container: Phaser.GameObjects.Container
  setValue(value: number | string): void
  setFontSize(size: number): void
}

/**
 * A small, static (non-interactive — a readout, not a button) `"icon value"` pill, e.g. a
 * currency/score/lives display sitting in a HUD corner. Same layered dark-fill-plus-neon-stroke
 * technique as `neonButton`/`circleBackButton`. Defaults to `getTheme()`'s `accent` color,
 * since that's the palette slot reserved for reward/currency iconography.
 */
export function valueBadge(scene: Phaser.Scene, icon: string, value: number | string, color: number = getTheme().colors.accent, fontSize = 20): ValueBadge {
  const radius = getTheme().radius
  const bgColor = getTheme().colors.surface
  const label = scene.add.text(0, 0, `${icon} ${value}`, { fontFamily: 'Arial', fontSize, color: toCssColor(color) }).setOrigin(0.5)
  const bg = scene.add.graphics()
  const container = scene.add.container(0, 0, [bg, label])

  function redraw(): void {
    const w = Math.max(label.width + VALUE_BADGE_PADDING_X * 2, MIN_TOUCH_TARGET)
    const h = Math.max(label.height + VALUE_BADGE_PADDING_Y * 2, MIN_TOUCH_TARGET)
    const halfW = w / 2
    const halfH = h / 2

    bg.clear()
    bg.fillStyle(bgColor, VALUE_BADGE_BG_ALPHA)
    bg.fillRoundedRect(-halfW, -halfH, w, h, radius)
    bg.lineStyle(2, color, 0.85)
    bg.strokeRoundedRect(-halfW, -halfH, w, h, radius)

    // Purely for callers' layout math (e.g. positioning it left of another HUD element) — no
    // setInteractive() call anywhere in this widget, so the Container-origin-shift hitArea
    // gotcha (see neonButton's own comment) never applies here.
    container.setSize(w, h)
  }

  redraw()

  return {
    container,
    setValue(newValue: number | string) {
      label.setText(`${icon} ${newValue}`)
      redraw()
    },
    setFontSize(size: number) {
      label.setFontSize(size)
      redraw()
    },
  }
}

// -- circleBackButton -------------------------------------------------------------------

const BACK_BUTTON_DEFAULT_SIZE = MIN_TOUCH_TARGET
// Semi-transparent, unlike neonButton's near-opaque BUTTON_BG_ALPHA (0.92) — a back affordance
// is meant to recede against whatever scene it sits over, not compete with it.
const BACK_BUTTON_BG_ALPHA = 0.55
// The "←" glyph's own ink is not centered in its font metrics box — a naive origin(0.5, 0.5)
// text reads as visually off-center against a perfectly-centered circle. Measured via a
// pixel-mass-centroid pass (near-white pixel center of mass) against the circle's true
// geometric center (the container's own local (0,0), since bg/glow are always drawn as
// `strokeCircle(0, 0, r)`): the centroid sits left/below the circle's true center, expressed as
// a fraction of the button's own radius (not a fixed px value) so it scales at any size.
const ARROW_OFFSET_X_FRACTION = 0.06
const ARROW_OFFSET_Y_FRACTION = -0.105

export interface CircleButton {
  container: Phaser.GameObjects.Container
  setSize(diameter: number): void
}

/**
 * Circular, semi-transparent "back" affordance. Same layered-stroke glow technique as
 * `neonButton`, circular instead of rounded-rect. `size` is the circle's diameter, floored at
 * `MIN_TOUCH_TARGET`.
 */
export function circleBackButton(scene: Phaser.Scene, color: number = getTheme().colors.secondary, size = BACK_BUTTON_DEFAULT_SIZE): CircleButton {
  const bgColor = getTheme().colors.surface
  const label = scene.add.text(0, 0, '←', { fontFamily: 'Arial', fontSize: Math.round(size * 0.5), color: '#ffffff' }).setOrigin(0.5)
  const glowOuter = scene.add.graphics()
  const glowInner = scene.add.graphics()
  const bg = scene.add.graphics()
  const container = scene.add.container(0, 0, [glowOuter, glowInner, bg, label])

  let hovered = false
  let currentSize = size

  function redraw(): void {
    const diameter = Math.max(currentSize, MIN_TOUCH_TARGET)
    const radius = diameter / 2
    label.setFontSize(Math.round(radius))
    label.setPosition(radius * ARROW_OFFSET_X_FRACTION, radius * ARROW_OFFSET_Y_FRACTION)

    bg.clear()
    bg.fillStyle(bgColor, BACK_BUTTON_BG_ALPHA)
    bg.fillCircle(0, 0, radius)
    bg.lineStyle(2, color, hovered ? 1 : 0.85)
    bg.strokeCircle(0, 0, radius)

    glowInner.clear()
    glowInner.lineStyle(4, color, hovered ? 0.5 : 0.3)
    glowInner.strokeCircle(0, 0, radius + 3)

    glowOuter.clear()
    glowOuter.lineStyle(8, color, hovered ? 0.22 : 0.12)
    glowOuter.strokeCircle(0, 0, radius + 7)

    // Same footprint-vs-hit-area split as neonButton (see its own comment): .width/.height
    // stay the solid core diameter for callers positioning against this button, while the hit
    // area (below) is padded by the glow margin separately.
    container.setSize(diameter, diameter)

    // Same Container-origin-shift correction neonButton needs — container.setSize() above
    // makes displayOriginX/Y = radius, which Phaser's pointWithinHitArea unconditionally adds
    // to the local hit-test point before calling hitAreaCallback, so a circle hitArea must
    // already be built shifted to center (radius, radius), not (0, 0).
    const hitRadius = radius + HIT_AREA_GLOW_MARGIN
    if (!container.input) {
      container.setInteractive({
        hitArea: new Phaser.Geom.Circle(radius, radius, hitRadius),
        hitAreaCallback: Phaser.Geom.Circle.Contains,
        useHandCursor: true,
      })
    } else {
      const circle = container.input.hitArea as Phaser.Geom.Circle
      circle.setTo(radius, radius, hitRadius)
    }
  }

  redraw()

  container.on(Phaser.Input.Events.POINTER_OVER, () => {
    hovered = true
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_OUT, () => {
    hovered = false
    container.setScale(1)
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_DOWN, () => {
    container.setScale(0.96)
    playPressSound()
  })
  container.on(Phaser.Input.Events.POINTER_UP, () => container.setScale(1))

  return {
    container,
    setSize(diameter: number) {
      currentSize = diameter
      redraw()
    },
  }
}

// -- neonText -----------------------------------------------------------------------------

const NEON_TEXT_GLOW_ALPHA = 0.55
const NEON_TEXT_GLOW_BLUR = 10

export interface NeonText {
  /** `bindAction`'s `pointer` target, if a caller ever needs this tappable. */
  container: Phaser.GameObjects.Container
  /** The crisp top copy — read `.width`/`.height` on the `NeonText` itself, not this, for layout math. */
  main: Phaser.GameObjects.Text
  /** `Container.setSize()` is never called here (this widget isn't interactive) — .width/.height
   * proxy straight to `main`'s own native size, since `glow`/`main` are both drawn at (0,0) in
   * the same font/size and always match. */
  readonly width: number
  readonly height: number
  setText(text: string): void
  setFontSize(size: number): void
  setColor(color: number): void
  /** A one-shot "glow pulse": the glow layer's alpha spikes toward full opacity and the whole
   * widget bumps up in scale, both yoyo-ing back to resting over `duration`. Kills any prior
   * in-flight pulse on this widget first, so a caller that (mis)fires this twice in quick
   * succession can't leave two competing tweens fighting over the same glow alpha/scale. */
  pulse(peakScale?: number, duration?: number): void
}

/**
 * A "soft neon" header/title text: a colored copy sits behind a crisp full-alpha copy, using
 * Phaser `Text`'s own `setShadow()` (a real canvas `shadowBlur`, not a postFX shader) at
 * partial alpha to read as a soft glow halo — same "no Bloom pipeline, works under the Canvas
 * fallback too" reasoning as `neonButton`'s layered strokes, applied to text instead of a
 * stroked rect. Both copies render in `getDisplayFontStack()` (see `ui/font.ts`) — a game's own
 * display font if `initDisplayFont()` was called, plain system sans otherwise.
 * `originX`/`originY` apply to both copies identically (always co-located at local (0,0) inside
 * the container).
 */
export function neonText(scene: Phaser.Scene, text: string, color: number, fontSize: number, originX = 0.5, originY = 0.5): NeonText {
  let css = toCssColor(color)
  const fontStack = getDisplayFontStack()
  const glow = scene.add
    .text(0, 0, text, { fontFamily: fontStack, fontSize, color: css })
    .setOrigin(originX, originY)
    .setAlpha(NEON_TEXT_GLOW_ALPHA)
    .setShadow(0, 0, css, NEON_TEXT_GLOW_BLUR, false, true)
  const main = scene.add.text(0, 0, text, { fontFamily: fontStack, fontSize, color: css }).setOrigin(originX, originY)
  const container = scene.add.container(0, 0, [glow, main])

  return {
    container,
    main,
    get width() {
      return main.width
    },
    get height() {
      return main.height
    },
    setText(newText: string) {
      glow.setText(newText)
      main.setText(newText)
    },
    setFontSize(size: number) {
      glow.setFontSize(size)
      main.setFontSize(size)
    },
    setColor(newColor: number) {
      css = toCssColor(newColor)
      glow.setColor(css).setShadow(0, 0, css, NEON_TEXT_GLOW_BLUR, false, true)
      main.setColor(css)
    },
    pulse(peakScale = 1.15, duration = 300) {
      scene.tweens.killTweensOf([container, glow])
      container.setScale(1)
      glow.setAlpha(NEON_TEXT_GLOW_ALPHA)
      scene.tweens.add({ targets: container, scale: peakScale, duration: duration / 2, yoyo: true, ease: 'Sine.Out' })
      scene.tweens.add({ targets: glow, alpha: 1, duration: duration / 2, yoyo: true, ease: 'Sine.Out' })
    },
  }
}

// -- neonProgressBar ------------------------------------------------------------------

const PROGRESS_BAR_TRACK_ALPHA = 0.7

export interface NeonProgressBar {
  graphics: Phaser.GameObjects.Graphics
  /** Redraws the whole bar at an explicit box + 0..1 fraction — this widget owns no
   * position/size state of its own; the caller passes fresh geometry every call. */
  draw(x: number, y: number, width: number, height: number, fraction: number, color: number): void
}

/**
 * A thin rounded track (dark fill + a faint stroke in `color`) with a filled, brighter portion
 * showing `fraction` (0..1) of the way across, plus one soft glow stroke around the filled
 * portion. Deliberately stateless/no container — see `draw()`'s own doc comment.
 */
export function neonProgressBar(scene: Phaser.Scene): NeonProgressBar {
  const graphics = scene.add.graphics()
  const trackColor = getTheme().colors.surface
  return {
    graphics,
    draw(x: number, y: number, width: number, height: number, fraction: number, color: number) {
      const f = Phaser.Math.Clamp(fraction, 0, 1)
      const radius = height / 2

      graphics.clear()
      graphics.fillStyle(trackColor, PROGRESS_BAR_TRACK_ALPHA)
      graphics.fillRoundedRect(x, y, width, height, radius)
      graphics.lineStyle(1, color, 0.4)
      graphics.strokeRoundedRect(x, y, width, height, radius)

      if (f <= 0) return
      // Never narrower than its own rounded cap (a razor-thin sliver at a tiny fraction would
      // render as a barely-visible dot, not a readable "some progress" signal).
      const fillWidth = Math.max(height, width * f)
      graphics.fillStyle(color, 0.9)
      graphics.fillRoundedRect(x, y, fillWidth, height, radius)
      graphics.lineStyle(3, color, 0.3)
      graphics.strokeRoundedRect(x, y, fillWidth, height, radius)
    },
  }
}

// -- roundedPanel -------------------------------------------------------------------------

const PANEL_BG_ALPHA = 0.92

export interface RoundedPanel {
  graphics: Phaser.GameObjects.Graphics
  /** Draws centered at (x, y) — same "caller passes fresh geometry every call, no owned
   * position state" convention as `neonProgressBar`. `glow` (default true) skips the two outer
   * layered strokes for a flatter look. `radius` defaults to `getTheme().radius`. */
  draw(x: number, y: number, width: number, height: number, color: number, glow?: boolean, radius?: number): void
}

/**
 * Dark-fill rounded rect + neon stroke + optional soft glow — the "panel" analogue of
 * `neonButton`'s own bg/stroke/glow technique, for a modal/card/panel background. Purely a
 * drawing helper, like `neonProgressBar` — the caller owns position/interactivity itself. A
 * panel that needs to stay clickable pairs this with a separate, invisible interactive
 * `Rectangle` sized to match, rather than teaching this drawing helper about input at all.
 */
export function roundedPanel(scene: Phaser.Scene): RoundedPanel {
  const graphics = scene.add.graphics()
  const bgColor = getTheme().colors.surface
  return {
    graphics,
    draw(x: number, y: number, width: number, height: number, color: number, glow = true, radius = getTheme().radius) {
      const halfW = width / 2
      const halfH = height / 2

      graphics.clear()
      if (glow) {
        graphics.lineStyle(8, color, 0.12)
        graphics.strokeRoundedRect(x - halfW - 7, y - halfH - 7, width + 14, height + 14, radius + 6)
        graphics.lineStyle(4, color, 0.3)
        graphics.strokeRoundedRect(x - halfW - 3, y - halfH - 3, width + 6, height + 6, radius + 3)
      }
      graphics.fillStyle(bgColor, PANEL_BG_ALPHA)
      graphics.fillRoundedRect(x - halfW, y - halfH, width, height, radius)
      graphics.lineStyle(2, color, 0.85)
      graphics.strokeRoundedRect(x - halfW, y - halfH, width, height, radius)
    },
  }
}

// -- pillBadge ----------------------------------------------------------------------------

const PILL_BADGE_PADDING_X = 10
const PILL_BADGE_PADDING_Y = 6
const PILL_BADGE_ICON_GAP = 4
const PILL_BADGE_BG_ALPHA = 0.85
/** Whole-pill dim when `earned` is exactly 0, so a zero doesn't compete for attention with whatever it sits next to. */
const PILL_BADGE_ZERO_ALPHA = 0.6
const PILL_BADGE_MAX_COLOR = '#888888'

export interface PillBadge {
  container: Phaser.GameObjects.Container
  setFontSize(size: number): void
}

/**
 * A compact `[icon current/max]` stat chip (e.g. `[🧩 3/6]`). Dark fill + a thin stroke in
 * `color` at reduced alpha (quieter than a card border or `neonButton`'s own stroke — a stat
 * chip, not another action). `earned > 0` colors just the current number in `color` — the max
 * number, and the whole pill when `earned` is exactly 0, stay dim gray: only what's actually
 * been earned glows. `suffix` (default `''`) appends after the max number, e.g. for a trailing
 * unit glyph.
 *
 * `earnedText`/`maxText` are plain Arial, NOT the display font — `earned`/`max` are ordinary
 * data digits that can legitimately be `0` (a fresh, first-run `[⭐ 0/N]` pill is a completely
 * mainstream case, not an edge case), and a stylized display font's own `'0'` glyph can easily
 * read as an empty box at small HUD sizes — confirmed by rendering it directly.
 */
export function pillBadge(scene: Phaser.Scene, icon: string, earned: number, max: number, color: number, fontSize = 14, suffix = ''): PillBadge {
  const radius = getTheme().radius
  const bgColor = getTheme().colors.surface
  const hasProgress = earned > 0
  const earnedCss = hasProgress ? toCssColor(color) : PILL_BADGE_MAX_COLOR

  const iconText = scene.add.text(0, 0, icon, { fontFamily: 'Arial', fontSize: fontSize + 2 }).setOrigin(0, 0.5)
  const earnedText = scene.add.text(0, 0, `${earned}`, { fontFamily: 'Arial', fontSize, color: earnedCss }).setOrigin(0, 0.5)
  const maxText = scene.add.text(0, 0, `/${max}${suffix}`, { fontFamily: 'Arial', fontSize, color: PILL_BADGE_MAX_COLOR }).setOrigin(0, 0.5)
  const bg = scene.add.graphics()
  const container = scene.add.container(0, 0, [bg, iconText, earnedText, maxText])
  if (!hasProgress) container.setAlpha(PILL_BADGE_ZERO_ALPHA)

  function redraw(): void {
    const contentWidth = iconText.width + PILL_BADGE_ICON_GAP + earnedText.width + maxText.width
    const w = contentWidth + PILL_BADGE_PADDING_X * 2
    const h = Math.max(iconText.height, earnedText.height, maxText.height) + PILL_BADGE_PADDING_Y * 2
    const halfW = w / 2
    const halfH = h / 2

    let x = -halfW + PILL_BADGE_PADDING_X
    iconText.setPosition(x, 0)
    x += iconText.width + PILL_BADGE_ICON_GAP
    earnedText.setPosition(x, 0)
    x += earnedText.width
    maxText.setPosition(x, 0)

    bg.clear()
    bg.fillStyle(bgColor, PILL_BADGE_BG_ALPHA)
    bg.fillRoundedRect(-halfW, -halfH, w, h, radius)
    bg.lineStyle(1.5, color, 0.5)
    bg.strokeRoundedRect(-halfW, -halfH, w, h, radius)

    container.setSize(w, h)
  }

  redraw()

  return {
    container,
    setFontSize(size: number) {
      iconText.setFontSize(size + 2)
      earnedText.setFontSize(size)
      maxText.setFontSize(size)
      redraw()
    },
  }
}

// -- scanlineOverlay --------------------------------------------------------------------

const SCANLINE_TEXTURE_KEY = 'ui-scanline-overlay'
// A faint enough alpha to read as a subtle texture, not a visible striped pattern.
const SCANLINE_ALPHA = 0.03

export interface ScanlineOverlay {
  gameObject: Phaser.GameObjects.TileSprite
  /** Call from the owning scene's `layout()` on every resize, same convention as `SceneBackground.resize()`. */
  resize(width: number, height: number): void
}

/**
 * A faint repeating horizontal-line texture tiled across the full viewport — a cheap, static
 * "CRT scanline" texture (generated once via `Graphics.generateTexture`, reused across scene
 * restarts by checking `textures.exists()` first), not a per-pixel shader pass. Depth sits just
 * above a scene's own `createSceneBackground()` (-1000) and below everything else. Entirely
 * optional decoration — most games won't need this widget at all.
 */
export function scanlineOverlay(scene: Phaser.Scene): ScanlineOverlay {
  if (!scene.textures.exists(SCANLINE_TEXTURE_KEY)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0x000000, 1)
    g.fillRect(0, 0, 4, 4)
    g.fillStyle(0xffffff, 1)
    g.fillRect(0, 0, 4, 2)
    g.generateTexture(SCANLINE_TEXTURE_KEY, 4, 4)
    g.destroy()
  }
  const tile = scene.add.tileSprite(0, 0, 0, 0, SCANLINE_TEXTURE_KEY).setOrigin(0, 0).setAlpha(SCANLINE_ALPHA).setDepth(-990)
  return {
    gameObject: tile,
    resize(width: number, height: number) {
      tile.setPosition(0, 0).setSize(width, height)
    },
  }
}
