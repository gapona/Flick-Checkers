import * as Phaser from 'phaser'
import { ATLAS_FRAMES, ATLAS_KEY } from '../assets'
import { bindAction } from '../platform/input'
import { getDisplayFontStack } from './font'
import { buttonWidth, gameButton, type GameButton } from './button'
import { SAFE_AREA_TOP_MARGIN_PX, SAFE_AREA_TOP_PORTRAIT_EXTRA_PX } from './safeArea'
import { uiScale } from './uiScale'

/**
 * Screen chrome: the safe-area budget, the navigation stack, and the top bar every scene wears.
 *
 * `ui/safeArea.ts` already owned the top margin and keeps owning it — this widens the same idea to
 * all four edges, because the bottom navigation of `ui/navBar.ts` sits exactly where an iOS home
 * indicator does and would otherwise be half a control the player cannot press.
 *
 * **The insets are a fixed budget, not a reading of `env(safe-area-inset-*)`**, for the reason
 * `safeArea.ts` gives at length: inside a cross-origin iframe those values are frequently 0 even
 * when the host IS overlapping content, so trusting them leaves exactly the devices they protect
 * unprotected.
 */

/**
 * The flat plate every full-page nav screen sits on, and the ONE object on such a screen that has
 * to be told how big the viewport is.
 *
 * **It exists because of a shipped bug.** All three pages drew it as
 * `add.rectangle(0, 0, 4000, 4000).setOrigin(0.5)` — a magic square centred on the WORLD ORIGIN,
 * which covers x and y in [-2000, +2000] and therefore stops covering the moment a viewport is
 * wider or taller than 2000 CSS px. Past that edge the canvas shows its own clear colour, which is
 * `backgroundTop` (a much brighter plum than this plate), so the page ended in a hard vertical seam
 * with a bright band beyond it. Reported from a wide desktop window, where the strip was about 140px
 * of the screen and the gear button sat on top of it.
 *
 * The lesson is the one "Responsive Layout" states and this violated: a full-bleed object is SIZED
 * FROM `layout()`'s width/height, never from a number large enough to look infinite. 4000 was a
 * guess about how big a screen gets, and guesses about that expire.
 *
 * Origin (0, 0) rather than centred, so the rectangle's own box IS the viewport box and there is no
 * halving to get wrong a second time.
 */
export const PAGE_FILL = 0x150726

export interface PageBackground {
  rectangle: Phaser.GameObjects.Rectangle
  /** Call from the owning scene's `layout()`, on every resize. */
  resize(width: number, height: number): void
}

export function createPageBackground(scene: Phaser.Scene, color: number = PAGE_FILL): PageBackground {
  const rectangle = scene.add.rectangle(0, 0, 1, 1, color).setOrigin(0, 0).setDepth(-1000)
  return {
    rectangle,
    resize(width: number, height: number) {
      rectangle.setPosition(0, 0).setSize(width, height)
    },
  }
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** Room for the iOS home indicator. Portrait only — in landscape the indicator is a thin bar the
 * layout already clears, and vertical space is the scarce resource on that orientation. */
const SAFE_AREA_BOTTOM_PORTRAIT_PX = 20
/** A landscape notch is on the SIDE, which is where a full-bleed row of controls would disappear
 * into it. Portrait needs nothing here — the same asymmetry `safeAreaTop` documents, mirrored. */
const SAFE_AREA_SIDE_LANDSCAPE_PX = 16

export function screenInsets(scene: Phaser.Scene): Insets {
  const { width, height } = scene.scale
  // Portrait is `height > width` — the same test the rest of the layout code uses, not a device
  // query, so an unusual window on a desktop is treated by its shape rather than by its name.
  const portrait = height > width
  return {
    top: SAFE_AREA_TOP_MARGIN_PX + (portrait ? SAFE_AREA_TOP_PORTRAIT_EXTRA_PX : 0),
    right: portrait ? 0 : SAFE_AREA_SIDE_LANDSCAPE_PX,
    bottom: portrait ? SAFE_AREA_BOTTOM_PORTRAIT_PX : 0,
    left: portrait ? 0 : SAFE_AREA_SIDE_LANDSCAPE_PX,
  }
}

/**
 * The width every menu screen lays its content out in.
 *
 * A full-bleed column looks correct on a phone and broken on a desktop, where a settings row would
 * stretch a metre wide with its label and its value at opposite ends of the monitor. Capped at 720
 * and inset 16 a side below that — one rule, applied on every screen, so no menu can be the odd one.
 */
export const CONTENT_COLUMN_MAX = 720

export function contentColumn(width: number): number {
  return Math.min(CONTENT_COLUMN_MAX, width - 32)
}

// -- navigation stack ------------------------------------------------------------------------

const NAV_STACK_KEY = 'navStack'
/** Where "back" lands when the stack is empty — a scene reached by a deep link, a reload, or a
 * flow that forgot to push. */
export const NAV_ROOT = 'MainMenu'

/**
 * The scene the back button returns to, as a stack in the game registry.
 *
 * **Not a hardcoded `MainMenu`**, which is the bug this exists to prevent: the shop is reachable
 * from the menu AND from gameplay, so a fixed destination sends half its visitors somewhere they
 * were not. The registry rather than a module-level array because it is per-`Phaser.Game`, which is
 * the same lifetime as the navigation it describes.
 */
interface NavEntry {
  key: string
  /**
   * What to hand the scene when we come BACK to it.
   *
   * **The stack held bare keys, and that was a trap the moment `Game` used it.** `Game` reads
   * `GameData.resume`, and a scene restarted with no data at all resumes nothing — it starts a fresh
   * match and DISCARDS the saved one. So a shop button on the board would have cost the player the
   * match they left to visit it, silently, with the back button they pressed to return.
   */
  data?: object
}

function stackOf(scene: Phaser.Scene): NavEntry[] {
  const existing = scene.registry.get(NAV_STACK_KEY) as NavEntry[] | undefined
  if (existing) return existing
  const created: NavEntry[] = []
  scene.registry.set(NAV_STACK_KEY, created)
  return created
}

/**
 * Starts `key`, remembering where we came from. Use instead of `scene.start()` for anything the back
 * button should be able to undo.
 *
 * `returnData` is what THIS scene wants handed back to it on the way home — see {@link NavEntry}.
 * Most callers have no state to restore and leave it out.
 */
export function navTo(scene: Phaser.Scene, key: string, data?: object, returnData?: object): void {
  stackOf(scene).push({ key: scene.scene.key, data: returnData })
  scene.scene.start(key, data)
}

/**
 * The scene the back button would return to, without going there.
 *
 * For a screen that wants to OFFER the return rather than only accept it: the shop reached from a
 * match is the case, where `<` in the corner is the only way back to the board and says nothing
 * about the board — while three navigation tabs along the bottom say, loudly, that there are other
 * places to be.
 */
export function navReturnsTo(scene: Phaser.Scene): string | null {
  const stack = stackOf(scene)
  return stack.length > 0 ? stack[stack.length - 1].key : null
}

/** Returns to whatever pushed us, or to {@link NAV_ROOT} if nothing did. */
export function navBack(scene: Phaser.Scene): void {
  const entry = stackOf(scene).pop()
  scene.scene.start(entry?.key ?? NAV_ROOT, entry?.data)
}

/** Marks this scene as the root of navigation — clears the stack so a back button never appears
 * and a stale entry cannot survive into a new session of play. */
export function navMarkRoot(scene: Phaser.Scene): void {
  stackOf(scene).length = 0
}

export function navCanGoBack(scene: Phaser.Scene): boolean {
  return stackOf(scene).length > 0
}

// -- top bar ---------------------------------------------------------------------------------

/** Bar height in design units, ABOVE the top inset. */
export const TOP_BAR_HEIGHT = 72

/** Drawn size of the coin, in design units — matched to the readout's cap height so the two read
 * as one token rather than as a picture next to a number. */
const COIN_SIZE = 22
const BADGE_FONT_SIZE = 20
const ROUND_FONT_SIZE = 20
const BADGE_PADDING_X = 14
const BADGE_HEIGHT = 40
const BADGE_RADIUS = 12
const BADGE_FILL = 0x2a0f40
const BADGE_CONTOUR = 0x1a0628
const BADGE_TEXT = '#ffcf3f'

export interface TopBarOptions {
  /** Omit or `false` on the root scene — the back button is not drawn at all there, rather than
   * drawn and disabled. */
  back?: boolean
  /** Overrides the default `navBack()`. `Game` uses this to raise an exit confirmation instead of
   * leaving a match the player is in the middle of. */
  onBack?: () => void
  /** Shown only where a round exists. Absent everywhere else, not blank. */
  round?: boolean
  onSettings: () => void
}

/** See {@link TopBar.parts}. `null` means this layout does not carry that control at all. */
export interface TopBarParts {
  balance: Phaser.Geom.Rectangle | null
  settings: Phaser.Geom.Rectangle
  back: Phaser.Geom.Rectangle | null
}

export interface TopBar {
  /** Everything the bar draws — hand to `uiCamera`'s set and `cameras.main.ignore()`. */
  readonly objects: Phaser.GameObjects.GameObject[]
  setCoins(coins: number): void
  setRound(index: number, total: number): void
  /**
   * Hides the balance and the round pill, keeping Back and the gear.
   *
   * For one caller: `Game`'s landscape side panel carries both of those itself, and the same number
   * twice in one frame is the defect the reference brief this panel came from calls out by name. The
   * navigation stays — it is the only way off the screen and belongs at the edge whatever else the
   * layout is doing.
   */
  setBadgesVisible(visible: boolean): void
  /**
   * Where the bar's own controls currently are, in SCREEN px — for the guided tour's spotlight
   * (`scenes/Coach.ts`), which needs a rectangle to cut a hole around.
   *
   * A method rather than a stored field, and rectangles rather than the objects themselves: a
   * caller handed the gear's `GameButton` could also press it, and a caller handed a rectangle from
   * the last layout would be pointing at where the bar used to be. Anything absent from this
   * layout — the back button on the root scene, the badges in the side panel's — reports `null`
   * rather than a zero box, so a caller cannot accidentally ring the top-left corner.
   */
  parts(): TopBarParts
  /** Total height the bar occupies, including the top inset — what a scene lays out beneath. */
  height(scene: Phaser.Scene): number
  layout(width: number, height: number): void
  destroy(): void
}

/**
 * The bar every scene wears, built once from one place.
 *
 * Four slots, and the two edge ones are `icon`-token buttons so they obey the same 44px floor as
 * everything else — a gear drawn as a bare `Text` (which is what the game had) is a tap target the
 * size of the glyph, and the glyph is 24px.
 */
export function createTopBar(scene: Phaser.Scene, options: TopBarOptions): TopBar {
  const objects: Phaser.GameObjects.GameObject[] = []
  /** The badge's box as `drawBadge` last drew it — a `Graphics` keeps no bounds of its own, and
   * {@link TopBar.parts} has to be able to answer where it is. */
  const badgeBox = new Phaser.Geom.Rectangle()
  /**
   * The last `layout()`'s geometry, kept so that CHANGING A NUMBER can re-place what that number
   * sizes.
   *
   * **Both readouts in this bar are sized from their own content and neither was redrawn when the
   * content changed.** `setCoins` writes the text and the plate stays the width it was drawn at;
   * `setRound` writes `1 / 5` into a `Text` that was positioned while it was still EMPTY, so the
   * pill was centred as if it were zero pixels wide and then grew symmetrically out of that centre
   * — straight over the badge's right border once a balance reached four digits. That is the same
   * defect as the status capsule drawn around the PREVIOUS status, one screen along: a plate fitted
   * to text has to be refitted when the text moves.
   */
  const lastLayout = { width: 0, height: 0, laid: false }

  const badge = scene.add.graphics()
  const coins = scene.add.text(0, 0, '0', { fontFamily: getDisplayFontStack(), fontSize: BADGE_FONT_SIZE, color: BADGE_TEXT }).setOrigin(0, 0.5)
  // The atlas frame, not an emoji: `Shop`'s prices point at the same one, so a price and a balance
  // can never be marked with different currencies. An emoji would also render as whatever the host
  // OS thinks a coin looks like, which is a different picture on every phone.
  const coinIcon = scene.add.image(0, 0, ATLAS_KEY, ATLAS_FRAMES.coin).setOrigin(0, 0.5)
  objects.push(badge, coinIcon, coins)

  const round = options.round
    ? scene.add.text(0, 0, '', { fontFamily: getDisplayFontStack(), fontSize: ROUND_FONT_SIZE, color: '#e6d8f5' }).setOrigin(0.5)
    : null
  if (round) objects.push(round)

  const back = options.back ? gameButton(scene, { size: 'icon', variant: 'ghost', icon: '‹' }) : null
  if (back) {
    objects.push(back.container)
    bindAction(scene, 'back', { pointer: back.hitArea, keys: ['ESC'] }, () => {
      // Hardware back on Android is NOT reachable here: the game runs in a cross-origin iframe and
      // gets no `popstate` for the host's navigation. `ESC` is the whole of the keyboard half.
      ;(options.onBack ?? (() => navBack(scene)))()
    })
  }

  const gear = gameButton(scene, { size: 'icon', variant: 'plum', iconFrame: ATLAS_FRAMES.gear })
  objects.push(gear.container)
  bindAction(scene, 'openSettings', { pointer: gear.hitArea }, options.onSettings)

  /**
   * Re-fits the balance plate around whatever number is currently in it, at the last layout's scale.
   *
   * A no-op before the first `layout()` — `setCoins` is called from a scene's `create()`, which on
   * some screens runs before `bindLayout` has laid anything out.
   */
  function redrawBadge(): void {
    if (!lastLayout.laid) return
    const scale = uiScale(lastLayout.width)
    const insets = screenInsets(scene)
    const edge = 12 * scale
    let cursor = insets.left + edge
    if (back) cursor += back.width + 8 * scale
    drawBadge(cursor, insets.top + (TOP_BAR_HEIGHT * scale) / 2, scale)
  }

  /**
   * Puts the round pill in the GAP between the badge and the gear, never at the viewport's centre.
   *
   * Centred was fine while a balance was three digits and stopped being fine at four: measured at
   * 360px wide with 2325 coins, the badge ran to x=167 and `1 / 5` began at x=163, so the round
   * indicator was drawn across the badge's own right border. Reported from a phone as "налазит".
   *
   * The badge is the element that GROWS — it is sized from the number inside it — so the rule has to
   * be "clear of whatever the badge came to", never a wider constant. Centred within the free span
   * keeps it looking placed rather than shoved aside; the clamp is what holds when the span runs
   * out, pushing the pill right rather than letting the two overlap.
   */
  function placeRound(): void {
    if (!round || !lastLayout.laid) return
    const scale = uiScale(lastLayout.width)
    const insets = screenInsets(scene)
    const edge = 12 * scale
    const gap = 10 * scale
    const gearW = buttonWidth('icon', scale)
    const from = badgeBox.right + gap + round.width / 2
    const to = lastLayout.width - insets.right - edge - gearW - gap - round.width / 2
    round.setPosition(Math.max(from, Math.min(lastLayout.width / 2, to)), insets.top + (TOP_BAR_HEIGHT * scale) / 2)
  }

  function drawBadge(x: number, y: number, scale: number): void {
    const h = BADGE_HEIGHT * scale
    // `displayWidth`, not `width`: an Image's `width` is its NATIVE texture size (64 for the coin
    // frame) and never changes with `setDisplaySize`. Measuring with it made the badge three times
    // wider than its contents and pushed it under the round indicator.
    const w = coinIcon.displayWidth + coins.width + BADGE_PADDING_X * scale * 2 + 6 * scale
    badgeBox.setTo(x, y - h / 2, w, h)
    badge.clear()
    badge.fillStyle(BADGE_FILL, 0.92)
    badge.fillRoundedRect(x, y - h / 2, w, h, BADGE_RADIUS * scale)
    badge.lineStyle(2 * scale, BADGE_CONTOUR, 1)
    badge.strokeRoundedRect(x, y - h / 2, w, h, BADGE_RADIUS * scale)
    coinIcon.setPosition(x + BADGE_PADDING_X * scale, y)
    coins.setPosition(coinIcon.x + coinIcon.displayWidth + 6 * scale, y)
  }

  return {
    objects,
    setCoins(value: number) {
      coins.setText(String(Math.max(0, Math.floor(value))))
      // The plate is fitted to the number, so a new number needs a new plate — and the round pill
      // is placed off the plate's right edge, so it moves with it.
      redrawBadge()
      placeRound()
    },
    setRound(index: number, total: number) {
      round?.setText(`${index} / ${total}`)
      placeRound()
    },
    setBadgesVisible(visible: boolean) {
      badge.setVisible(visible)
      coinIcon.setVisible(visible)
      coins.setVisible(visible)
      round?.setVisible(visible)
    },
    parts() {
      const boxOf = (button: GameButton): Phaser.Geom.Rectangle => {
        // The CONTAINER's bounds, not the hit area's: `gameButton` pads every tap target out to 44
        // units and a ring drawn around that padding stands away from the button it is ringing.
        const bounds = button.container.getBounds()
        return new Phaser.Geom.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
      }
      return {
        balance: badge.visible && badgeBox.width > 0 ? Phaser.Geom.Rectangle.Clone(badgeBox) : null,
        settings: boxOf(gear),
        back: back ? boxOf(back) : null,
      }
    },
    height(host: Phaser.Scene) {
      return screenInsets(host).top + TOP_BAR_HEIGHT * uiScale(host.scale.width)
    },
    layout(width: number, height: number) {
      lastLayout.width = width
      lastLayout.height = height
      lastLayout.laid = true
      const scale = uiScale(width)
      const insets = screenInsets(scene)
      const centreY = insets.top + (TOP_BAR_HEIGHT * scale) / 2
      const edge = 12 * scale

      let cursor = insets.left + edge
      if (back) {
        back.layout(cursor + back.width / 2, centreY, scale)
        cursor += back.width + 8 * scale
      }

      coinIcon.setDisplaySize(COIN_SIZE * scale, COIN_SIZE * scale)
      coins.setFontSize(BADGE_FONT_SIZE * scale)
      // After both, since the plate is sized from what it contains.
      drawBadge(cursor, centreY, scale)

      const gearW = buttonWidth('icon', scale)
      gear.layout(width - insets.right - edge - gearW / 2, centreY, scale)

      /**
       * The round pill goes in the GAP between the badge and the gear, not at the viewport's centre.
       *
       * Centred was fine while a balance was three digits and stopped being fine at four: measured at
       * 360px wide with 2325 coins, the badge ran to x=167 and `1 / 5` began at x=163, so the round
       * indicator was drawn across the badge's own right border. Reported as "налазит", from a phone.
       *
       * The badge is the element that GROWS — it is sized from the number inside it — so the fix has
       * to be expressed as "clear of whatever the badge came to", never as a wider constant. Centred
       * in the free span keeps it looking placed rather than shoved, and the clamp is what holds when
       * the span runs out: a long balance pushes the pill right rather than under itself.
       */
      round?.setFontSize(ROUND_FONT_SIZE * scale)
      placeRound()
    },
    destroy() {
      badge.destroy()
      coinIcon.destroy()
      coins.destroy()
      round?.destroy()
      back?.destroy()
      gear.destroy()
    },
  }
}
