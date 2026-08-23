import * as Phaser from 'phaser'
import { ATLAS_FRAMES, ATLAS_KEY } from '../assets'
import { bindAction } from '../platform/input'
import { playPressSound } from './theme'
import { t } from '../i18n/strings'
import { getDisplayFontStack } from './font'
import { screenInsets } from './chrome'
import { uiScale } from './uiScale'

/**
 * The bottom navigation.
 *
 * Three destinations, and the pattern is lifted from a sibling project's `navTabs.ts`: the tab
 * list is ONE exported array and the tap handler is ONE exported function, so the hosts that draw
 * a bar cannot drift apart in what the tabs are called, what order they come in, or where they go.
 * A bar assembled independently by each screen is a bar that eventually disagrees with itself.
 *
 * ## It is absent in `Game`, and that is stricter here than it was in draughts
 *
 * The board is SQUARE and fits to the shorter side of the viewport. In portrait, 88px of bottom
 * navigation comes straight off that shorter side — about 11% of the board's edge, which is 11% off
 * every disc's diameter and off the precision of every aim. Draughts could afford it because its
 * board did not have to be square. Here the bar is not merely hidden in `Game`, it is a thing that
 * must never be added there, and `TopBar`'s back button is the whole of gameplay's navigation.
 */

export const NAV_SCENE_KEYS = ['MainMenu', 'Shop', 'Modes'] as const
export type NavSceneKey = (typeof NAV_SCENE_KEYS)[number]

/**
 * A function rather than a constant array: the labels go through `t()`, which must be read AFTER
 * `initLocale()` resolves rather than baked in at module-load time.
 *
 * `icon` is an ATLAS FRAME NAME, not a glyph. It was `U+1F3E0`/`U+1F6D2`/`U+1F3AF` until a phone
 * drew the settings' emoji as tofu and the same question was asked of the navigation: an icon that
 * is a character is an icon the device can decline to draw, and this is the bar every screen wears.
 */
export function navTabs(): { icon: string; label: string; key: NavSceneKey }[] {
  return [
    { icon: ATLAS_FRAMES.home, label: t('navHome'), key: 'MainMenu' },
    { icon: ATLAS_FRAMES.shop, label: t('shop'), key: 'Shop' },
    { icon: ATLAS_FRAMES.modes, label: t('modes'), key: 'Modes' },
  ]
}

/** Bar height in design units, ABOVE the bottom inset. */
export const NAV_BAR_HEIGHT = 88

const ICON_SIZE = 32
const LABEL_SIZE = 13
const ACTIVE_LIFT = 4
const ACTIVE_ICON_GROWTH = 1.1
const INACTIVE_ALPHA = 0.75
const ACTIVE_COLOR = '#ffcf3f'
const INACTIVE_COLOR = '#c4aede'
/** The same two colours as numbers, for `setTint` — which these icons could not use at all while
 * they were emoji, because a glyph is whatever colour its own font draws it. */
const ACTIVE_TINT = 0xffcf3f
const INACTIVE_TINT = 0xc4aede
const BAR_FILL = 0x1d0a2e
const BAR_TOP_LINE = 0x3a1a55

interface Tab {
  key: NavSceneKey
  icon: Phaser.GameObjects.Image
  label: Phaser.GameObjects.Text
  hit: Phaser.GameObjects.Rectangle
}

export interface NavBar {
  readonly objects: Phaser.GameObjects.GameObject[]
  /**
   * Where one tab currently sits, in SCREEN px — for the guided tour's spotlight
   * (`scenes/Coach.ts`). `null` for a key this bar does not carry.
   *
   * The tab's own THIRD of the bar, which is also its hit area: that is the shape a player is
   * actually aiming a thumb at, and ringing only the icon would teach a smaller target than the
   * one that works.
   */
  tabBounds(key: NavSceneKey): { x: number; y: number; width: number; height: number } | null
  /** Total height including the bottom inset — what a scene leaves free beneath its content. */
  height(scene: Phaser.Scene): number
  layout(width: number, height: number): void
  destroy(): void
}

/**
 * Switching tabs uses `scene.start()` with **no transition**. `sceneTransition` is reserved for
 * entering and leaving `Game`, where it marks a change of activity; spending it on lateral
 * navigation makes the whole app feel like it is wading.
 */
export function navigateToTab(scene: Phaser.Scene, key: NavSceneKey): void {
  if (key === scene.scene.key) return
  scene.scene.start(key)
}

export function createNavBar(scene: Phaser.Scene, active: NavSceneKey): NavBar {
  const objects: Phaser.GameObjects.GameObject[] = []
  const bar = scene.add.graphics()
  objects.push(bar)

  const tabs: Tab[] = navTabs().map((tab) => {
    // The hit area is the WHOLE third, not the icon: a bottom bar is pressed with a thumb aimed
    // roughly, and a target the size of the glyph would be a bar that mostly misses.
    const hit = scene.add.rectangle(0, 0, 100, NAV_BAR_HEIGHT, 0x000000, 0).setInteractive({ useHandCursor: true })
    const icon = scene.add.image(0, 0, ATLAS_KEY, tab.icon).setOrigin(0.5)
    const label = scene.add.text(0, 0, tab.label, { fontFamily: getDisplayFontStack(), fontSize: LABEL_SIZE, color: INACTIVE_COLOR }).setOrigin(0.5)
    objects.push(hit, icon, label)
    bindAction(scene, `nav:${tab.key}`, { pointer: hit }, () => {
      // Explicitly, because a nav tab is a bare interactive rectangle rather than a `gameButton` —
      // and NOT inside `bindAction` itself, which also binds the board's own tap targets: a board
      // that clicked like a button on every shot would be worse than a silent one.
      playPressSound()
      navigateToTab(scene, tab.key)
    })
    return { key: tab.key, icon, label, hit }
  })

  return {
    objects,
    tabBounds(key: NavSceneKey) {
      const tab = tabs.find((candidate) => candidate.key === key)
      if (!tab) return null
      const bounds = tab.hit.getBounds()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    },
    height(host: Phaser.Scene) {
      return NAV_BAR_HEIGHT * uiScale(host.scale.width) + screenInsets(host).bottom
    },
    layout(width: number, height: number) {
      const scale = uiScale(width)
      const insets = screenInsets(scene)
      const barHeight = NAV_BAR_HEIGHT * scale
      const top = height - insets.bottom - barHeight
      const third = width / tabs.length

      bar.clear()
      // The fill extends THROUGH the bottom inset: the bar's colour should reach the screen edge
      // even though nothing tappable does, or the home-indicator strip reads as a gap.
      bar.fillStyle(BAR_FILL, 0.97)
      bar.fillRect(0, top, width, barHeight + insets.bottom)
      bar.lineStyle(2 * scale, BAR_TOP_LINE, 1)
      bar.lineBetween(0, top, width, top)

      tabs.forEach((tab, i) => {
        const isActive = tab.key === active
        const centreX = third * (i + 0.5)
        const lift = isActive ? ACTIVE_LIFT * scale : 0

        tab.hit.setPosition(centreX, top + barHeight / 2)
        tab.hit.setSize(third, barHeight)
        const area = tab.hit.input?.hitArea as Phaser.Geom.Rectangle | undefined
        area?.setTo(0, 0, third, barHeight)

        const iconSize = ICON_SIZE * scale * (isActive ? ACTIVE_ICON_GROWTH : 1)
        tab.icon.setDisplaySize(iconSize, iconSize)
        tab.icon.setPosition(centreX, top + barHeight * 0.38 - lift)
        tab.icon.setAlpha(isActive ? 1 : INACTIVE_ALPHA)
        tab.icon.setTint(isActive ? ACTIVE_TINT : INACTIVE_TINT)

        tab.label.setFontSize(LABEL_SIZE * scale)
        tab.label.setPosition(centreX, top + barHeight * 0.76 - lift)
        tab.label.setColor(isActive ? ACTIVE_COLOR : INACTIVE_COLOR)
        tab.label.setAlpha(isActive ? 1 : INACTIVE_ALPHA)
      })
    },
    destroy() {
      for (const object of objects) object.destroy()
    },
  }
}
