import * as Phaser from 'phaser'
import { ATLAS_FRAMES, ATLAS_KEY } from '../assets'
import { ensureSwatchTexture, SWATCH_HEIGHT, SWATCH_WIDTH, ensureEffectSwatchTexture} from '../board/swatch'
import { BOARD_ITEM_PREFIX, BOARD_ITEMS, EFFECT_ITEM_PREFIX, EFFECT_ITEMS, PIECE_ITEM_PREFIX, PIECE_ITEMS } from '../game/economy'
import { activeBoardSet, activePieceSet, coinBalance, equipBoardSet, equipPieceSet, spendOn, activeEffectSet, equipEffectSet} from '../game/wallet'
import { isBoardSetId, isPieceSetId, isEffectSetId} from '../game/skins'
import { t, tOptional } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { showRewarded } from '../platform/adGate'
import { getState, mutate } from '../save/store'
import { canAfford, hasPurchased } from '../shop/coins'
import type { ShopItem } from '../shop/catalog'
import { fitScale } from '../ui/fit'
import { titleCase } from '../ui/format'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { gameButton, type GameButton } from '../ui/button'
import { contentColumn, createPageBackground, createTopBar, navBack, type PageBackground, type TopBar, navReturnsTo} from '../ui/chrome'
import { createNavBar, type NavBar } from '../ui/navBar'
import { hasSavedMatch } from '../game/persistence'
import { createSegmented, type Segmented } from '../ui/segmented'
import { listHeightBetween, scrollableCameraRegion, type ScrollableCameraRegion } from '../ui/scrollRegion'
import { computeReleaseVelocity, createScrollMomentumState, pushDragSample, resetScrollMomentum, stepMomentum, type ScrollMomentumState } from '../ui/scrollMomentum'
import { uiScale } from '../ui/uiScale'

const TOPUP_REWARD_ID = 'coins-topup'
const TOPUP_COINS = 50

const ROW_HEIGHT = 72
const ROW_GAP = 10
const ROW_RADIUS = 14
const ROW_PADDING = 12
const TITLE_FONT_SIZE = 16
const PRICE_FONT_SIZE = 14

const ROW_FILL = 0x241040
const ROW_FILL_EQUIPPED = 0x33195c
const ROW_STROKE = 0x5a2394
const ROW_STROKE_EQUIPPED = 0xffc23c
const TITLE_COLOR = '#e6d8f5'
const PRICE_COLOR = '#ffcf3f'
/** Not a different coin, not a different icon — the same price in a colour that means "no". A
 * second currency glyph for "you cannot afford this" is a second thing to learn. */
const PRICE_COLOR_SHORT = '#ff6a3d'

/** Drawn size of the price's coin. The frame itself is `ui/chrome.ts`'s — one texture for one
 * currency, so a price and the balance above it are marked identically. */
const COIN_SIZE = 16

/**
 * The scroll indicator.
 *
 * **The list already scrolled; nothing said so.** Ten rows against a phone's 844px leaves 242px
 * below the fold, and the region camera cuts the last visible row off cleanly at the nav bar — which
 * reads as "the catalogue ends here", not as "there is more". A player who cannot see that the list
 * continues has, in effect, a shop with seven items in it. That is what this fixes; it is a
 * discoverability defect, not a missing mechanism.
 *
 * A bar rather than a fade, because it carries two things a fade cannot: how much more there is, and
 * where you are in it.
 */
const SCROLLBAR_WIDTH = 4
const SCROLLBAR_GAP = 5
const SCROLLBAR_MIN_THUMB = 28
const SCROLLBAR_TRACK_ALPHA = 0.18
const SCROLLBAR_THUMB_ALPHA = 0.75

type RowState = 'buy' | 'use' | 'equipped'

interface Row {
  item: ShopItem
  plate: Phaser.GameObjects.Graphics
  swatch: Phaser.GameObjects.Image
  title: Phaser.GameObjects.Text
  coin: Phaser.GameObjects.Image
  price: Phaser.GameObjects.Text
  action: GameButton
}

/**
 * The wardrobe.
 *
 * ## Three states, because two were a dead end
 *
 * A row used to be `Buy` or `Owned`. Owning a second board and having no way to put it on is the
 * bug that hides inside that: the shop takes the money, says "Owned", and the game looks exactly as
 * it did. The middle state — bought, not worn — is the one the player is in most often, and it is
 * the only one with something left to do.
 *
 * ## It builds its own catalogue now
 *
 * As an overlay it was handed `items`, `onSelect`, `rowState` and `swatchFor` by whoever launched
 * it. As a navigation destination there is no launcher, so the knowledge of what is for sale and
 * what "equipped" means lives here. `src/shop/` keeps the pure mechanism (`coins.ts`) and
 * `game/economy.ts` keeps the catalogue data; this is the screen.
 */
export class Shop extends Phaser.Scene {
  private pageBackground!: PageBackground
  private topBar!: TopBar
  private navBar!: NavBar
  private region!: ScrollableCameraRegion
  private scrollState!: ScrollMomentumState
  private scrollY = 0
  private maxScroll = 0
  private dragging = false
  private dragOrigin = 0
  private scrollOrigin = 0
  /**
   * Drawn INSIDE the scroll region, and pinned by cancelling the region camera's own scroll.
   *
   * The obvious arrangement — bar on the main camera, so it cannot move — does not render at all:
   * measured, the same `Graphics` object draws normally above the region's band and is **erased
   * inside it**, because a later camera's viewport does not merely composite over the earlier one,
   * it owns those pixels. So the bar lives in the region and is drawn at `scrollY + offset`, which
   * cancels the camera's scroll and leaves it apparently fixed.
   */
  private scrollbar!: Phaser.GameObjects.Graphics
  /** Where the scrollbar sits, in screen px. Written by `layout()`, read by `drawScrollbar()` —
   * which is also called from the drag handler and from `update()`, neither of which knows the
   * layout. */
  private scrollbarTrack = { x: 0, width: 0, height: 0 }

  private topup!: GameButton
  private rows: Row[] = []
  /**
   * Which wardrobe is on screen — 0 boards, 1 discs.
   *
   * **The two were one flat list of ten rows and that was wrong twice over.** It was 810px of it,
   * which fits no phone this game targets, so three of the ten were below the fold on the screen
   * whose whole job is showing what is for sale. And running them together implied one choice where
   * there are two: the slots are independent (`SaveState.skins.board` and `.pieces`), a board is
   * worn against whatever discs you already have, and a list that alternates between them invites
   * the reader to pick one thing.
   */
  private tab = 0
  private tabs!: Segmented
  /**
   * Present only when the shop was reached FROM a match, and it is the point of that distinction.
   *
   * The back arrow in the corner already returns to the board — and says nothing about the board,
   * while three navigation tabs along the bottom say loudly that there are other places to be. A
   * player who came here to spend coins on the match they are in the middle of should not have to
   * work out that `<` is the way back to it.
   */
  private backToMatch?: GameButton

  constructor() {
    super('Shop')
  }

  create() {
    this.rows = []
    this.scrollY = 0
    this.dragging = false
    this.scrollState = createScrollMomentumState()

    this.pageBackground = createPageBackground(this)

    this.topBar = createTopBar(this, { back: true, onBack: () => navBack(this), onSettings: () => this.openSettings() })
    this.navBar = createNavBar(this, 'Shop')

    // Built before the top-up so the two share a row in the order they read in.
    // **And a saved match must actually exist.** The nav bar switches tabs with a bare
    // `scene.start`, so the stack is not popped when a player wanders Shop -> Home -> Shop, and a
    // match that ENDED in between would leave a stale entry pointing at `Game`. The button would
    // then start a brand new match under the words "back to match", which is the opposite of what
    // it says.
    if (navReturnsTo(this) === 'Game' && hasSavedMatch()) {
      this.backToMatch = gameButton(this, { size: 'compact', variant: 'gold', label: t('backToMatch') })
      bindAction(this, 'shopBackToMatch', { pointer: this.backToMatch.hitArea }, () => navBack(this))
    }

    this.topup = gameButton(this, { size: 'compact', variant: 'plum', label: t('shopTopup', { n: TOPUP_COINS }) })
    bindAction(this, 'shopTopup', { pointer: this.topup.hitArea }, () => {
      void this.requestTopup()
    })

    this.tabs = createSegmented(this, {
      labels: [t('shopBoards'), t('shopPieces'), t('shopEffects')],
      initial: this.tab,
      onSelect: (index) => {
        this.tab = index
        // Back to the top: the other wardrobe is a different list, and arriving at it already
        // scrolled past its first two items reads as the screen having lost its place.
        this.scrollY = 0
        this.refresh()
      },
    })

    for (const item of [...BOARD_ITEMS, ...PIECE_ITEMS, ...EFFECT_ITEMS]) {
      const plate = this.add.graphics()
      const swatch = this.add.image(0, 0, this.swatchFor(item)).setOrigin(0, 0.5)
      const title = this.add
        .text(0, 0, tOptional(item.titleKey) ?? titleCase(item.id), { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: TITLE_COLOR })
        .setOrigin(0, 1)
      const coin = this.add.image(0, 0, ATLAS_KEY, ATLAS_FRAMES.coin).setOrigin(0, 0.5)
      const price = this.add
        .text(0, 0, String(item.priceCoins), { fontFamily: getDisplayFontStack(), fontSize: PRICE_FONT_SIZE, color: PRICE_COLOR })
        .setOrigin(0, 0)
      // One token for every row's action, whatever the label says. A row whose button is the width
      // of its own word is a list that looks ragged down its right edge.
      const action = gameButton(this, { size: 'compact', variant: 'plum', label: t('buy') })
      bindAction(this, `shopTap:${item.id}`, { pointer: action.hitArea }, () => this.tap(item))
      this.rows.push({ item, plate, swatch, title, coin, price, action })
    }

    this.region = scrollableCameraRegion(this, { x: 0, y: 0, width: 1, height: 1 })
    this.scrollbar = this.add.graphics()
    this.bindScroll()

    bindLayout(this, (width, height) => this.layout(width, height))
    this.refresh()
  }

  /** The rows of the wardrobe currently on screen. The prefix is what tells them apart — item ids
   * are namespaced (`board-emerald`, `pieces-ember`) precisely because two slots can both hold a set
   * called `default`, and one flat purchase list cannot otherwise say which was bought. */
  private rowsInTab(): Row[] {
    const prefix = this.tab === 0 ? BOARD_ITEM_PREFIX : this.tab === 1 ? PIECE_ITEM_PREFIX : EFFECT_ITEM_PREFIX
    return this.rows.filter((row) => row.item.id.startsWith(prefix))
  }

  private openSettings(): void {
    this.scene.pause()
    this.scene.launch('Settings', { opener: 'Shop' })
  }

  /** The set being sold, worn against whatever is in the OTHER slot — with two independent slots an
   * item has no look on its own. Re-asked on every refresh, since equipping one slot changes what
   * every row in the other should be previewed against. */
  private swatchFor(item: ShopItem): string {
    if (item.id.startsWith(BOARD_ITEM_PREFIX)) {
      const id = item.id.slice(BOARD_ITEM_PREFIX.length)
      if (isBoardSetId(id)) return ensureSwatchTexture(this, id, activePieceSet())
    }
    if (item.id.startsWith(EFFECT_ITEM_PREFIX)) {
      const id = item.id.slice(EFFECT_ITEM_PREFIX.length)
      // An effect has no look as a board-and-two-discs picture — that image is identical for all
      // four sets — so its row previews the particles themselves. See `ensureEffectSwatchTexture`.
      if (isEffectSetId(id)) return ensureEffectSwatchTexture(this, activeBoardSet(), activePieceSet(), id)
    }
    const id = item.id.slice(PIECE_ITEM_PREFIX.length)
    return isPieceSetId(id) ? ensureSwatchTexture(this, activeBoardSet(), id) : ensureSwatchTexture(this, activeBoardSet(), activePieceSet())
  }

  private stateOf(item: ShopItem): RowState {
    if (!hasPurchased(getState().purchases, item.id)) return 'buy'
    return this.isWorn(item.id) ? 'equipped' : 'use'
  }

  private isWorn(itemId: string): boolean {
    if (itemId.startsWith(BOARD_ITEM_PREFIX)) return itemId === `${BOARD_ITEM_PREFIX}${activeBoardSet()}`
    if (itemId.startsWith(EFFECT_ITEM_PREFIX)) return itemId === `${EFFECT_ITEM_PREFIX}${activeEffectSet()}`
    return itemId === `${PIECE_ITEM_PREFIX}${activePieceSet()}`
  }

  private tap(item: ShopItem): void {
    const state = this.stateOf(item)
    if (state === 'equipped') return
    if (state === 'use') {
      this.equip(item)
      this.refresh()
      return
    }
    // The whole read-check-write of a purchase is one `store.mutate()` inside `spendOn` — see
    // CLAUDE.md "Shop Layer" on why that atomicity matters even in a single-threaded runtime.
    if (spendOn(item)) {
      // Bought sets are worn immediately. The alternative is a purchase that visibly does nothing
      // until a second tap, which is the exact confusion the three-state row exists to remove.
      this.equip(item)
      this.refresh()
    }
  }

  private equip(item: ShopItem): void {
    if (item.id.startsWith(BOARD_ITEM_PREFIX)) {
      const id = item.id.slice(BOARD_ITEM_PREFIX.length)
      if (isBoardSetId(id)) equipBoardSet(id)
      return
    }
    if (item.id.startsWith(EFFECT_ITEM_PREFIX)) {
      const fx = item.id.slice(EFFECT_ITEM_PREFIX.length)
      if (isEffectSetId(fx)) equipEffectSet(fx)
      return
    }
    const id = item.id.slice(PIECE_ITEM_PREFIX.length)
    if (isPieceSetId(id)) equipPieceSet(id)
  }

  private async requestTopup(): Promise<void> {
    // `adGate` only — it emits the same PAUSE/RESUME a platform pause does, so the game freezes
    // under the ad. `requestRewardedAd()` direct would show an ad over a running game.
    const granted = await showRewarded(this.game, TOPUP_REWARD_ID)
    if (!granted) return
    mutate((s) => {
      s.coins += TOPUP_COINS
    })
    this.refresh()
  }

  private refresh(): void {
    this.topBar.setCoins(coinBalance())
    this.layout(this.scale.width, this.scale.height)
  }

  private bindScroll(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.dragging = true
      this.dragOrigin = pointer.y
      this.scrollOrigin = this.scrollY
      resetScrollMomentum(this.scrollState)
      pushDragSample(this.scrollState, pointer.y, pointer.event.timeStamp)
    })
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return
      this.scrollY = Phaser.Math.Clamp(this.scrollOrigin - (pointer.y - this.dragOrigin), 0, this.maxScroll)
      this.region.camera.setScroll(0, this.scrollY)
      this.drawScrollbar()
      pushDragSample(this.scrollState, pointer.y, pointer.event.timeStamp)
    })
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!this.dragging) return
      this.dragging = false
      this.scrollState.velocity = -computeReleaseVelocity(this.scrollState)
    })
  }

  update(time: number, delta: number): void {
    if (this.dragging || this.scrollState.velocity === 0) return
    this.scrollY = stepMomentum(this.scrollState, this.scrollY, delta, 0, this.maxScroll, time)
    this.region.camera.setScroll(0, this.scrollY)
    this.drawScrollbar()
  }

  /**
   * The track and its thumb, sized to how much of the list is on screen and positioned to where in
   * it you are. Drawn from scratch each time — it is two rounded rectangles, and keeping a retained
   * object in step with a list that can change length on any purchase costs more than redrawing.
   *
   * Nothing is drawn when everything fits: a scrollbar that never moves is furniture, and it would
   * appear on the one screen size where the shop has no problem.
   */
  private drawScrollbar(): void {
    this.scrollbar.clear()
    if (this.maxScroll <= 0) return

    const { x, width, height } = this.scrollbarTrack
    const colour = ROW_STROKE
    const radius = width / 2
    // Region-camera space: the rows start at world y 0 and the camera is scrolled to `scrollY`, so
    // adding it back is what pins the bar to the viewport.
    const y = this.scrollY

    this.scrollbar.fillStyle(colour, SCROLLBAR_TRACK_ALPHA)
    this.scrollbar.fillRoundedRect(x, y, width, height, radius)

    // Thumb length is the visible FRACTION of the list, floored so it stays grabbable on a long
    // catalogue; its travel is the remaining track, so it reaches the bottom exactly at maxScroll.
    const visible = height / (height + this.maxScroll)
    const thumb = Math.max(SCROLLBAR_MIN_THUMB, height * visible)
    const travel = height - thumb
    const at = y + travel * (this.scrollY / this.maxScroll)

    this.scrollbar.fillStyle(colour, SCROLLBAR_THUMB_ALPHA)
    this.scrollbar.fillRoundedRect(x, at, width, thumb, radius)
  }

  layout(width: number, height: number): void {
    this.pageBackground.resize(width, height)
    const scale = uiScale(width)
    const column = contentColumn(width)
    const left = (width - column) / 2
    const coins = coinBalance()

    this.topBar.layout(width, height)
    this.navBar.layout(width, height)

    const top = this.topBar.height(this)
    const bottom = this.navBar.height(this)

    /**
     * The header, laid out from MEASURED heights rather than from magic offsets.
     *
     * It was `top + 26` for the button's centre and `top + 52` for the tabs, and a `compact` button
     * is 60 tall once its thickness is counted — so its half-height was bigger than its own offset
     * and it overlapped the top bar by 5px above and the tabs by 5px below. The top one had been
     * there since before the tabs existed and nobody had measured it; the bottom one arrived with
     * them. Two constants that have to agree with a widget's height by hand will not.
     *
     * One centred button, or two side by side when there is a match to go back to, stacked when the
     * pair will not fit — which on a 390px phone it does not. The return is GOLD and the top-up is
     * not: this screen's one-gold rule points at the way out of it, because somebody who came here
     * from a board is not looking for a purse.
     */
    const headerTop = top + 8 * scale
    const gap = 10 * scale
    this.topup.layout(0, 0, scale)
    let headerBottom = headerTop + this.topup.height

    if (this.backToMatch) {
      this.backToMatch.layout(0, 0, scale)
      const pair = this.backToMatch.width + gap + this.topup.width
      const row = headerTop + this.topup.height / 2
      if (pair <= column) {
        this.backToMatch.layout(width / 2 - pair / 2 + this.backToMatch.width / 2, row, scale)
        this.topup.layout(width / 2 + pair / 2 - this.topup.width / 2, row, scale)
      } else {
        this.backToMatch.layout(width / 2, row, scale)
        this.topup.layout(width / 2, row + this.backToMatch.height + gap, scale)
        headerBottom += this.backToMatch.height + gap
      }
    } else {
      this.topup.layout(width / 2, headerTop + this.topup.height / 2, scale)
    }

    const tabsTop = headerBottom + gap
    this.tabs.layout(left, tabsTop, column, scale)

    const listTop = tabsTop + this.tabs.height + gap
    const listHeight = listHeightBetween(listTop, height - bottom - 8 * scale)
    this.region.setBounds({ x: 0, y: listTop, width, height: listHeight })

    const rowH = ROW_HEIGHT * scale
    let y = 0
    /**
     * The rows of the OTHER wardrobe are hidden AND their buttons disabled.
     *
     * `setVisible(false)` alone is not enough in Phaser: a hidden game object still answers pointer
     * events, so the six board rows would keep a live Buy button under wherever the four disc rows
     * are now drawn — a tap on "Ember" charging for "Emerald". The same pairing `ui/segmented.ts`
     * documents for its own control, and for the same reason.
     */
    const shown = new Set(this.rowsInTab())
    for (const row of this.rows) {
      const visible = shown.has(row)
      row.plate.setVisible(visible)
      row.swatch.setVisible(visible)
      row.title.setVisible(visible)
      row.coin.setVisible(visible)
      row.price.setVisible(visible)
      row.action.container.setVisible(visible)
      if (row.action.hitArea.input) row.action.hitArea.input.enabled = visible
    }
    for (const row of this.rowsInTab()) {
      const state = this.stateOf(row.item)
      const affordable = canAfford(coins, row.item.priceCoins)
      const equipped = state === 'equipped'

      row.plate.clear()
      row.plate.fillStyle(equipped ? ROW_FILL_EQUIPPED : ROW_FILL, 1)
      row.plate.fillRoundedRect(left, y, column, rowH, ROW_RADIUS * scale)
      row.plate.lineStyle((equipped ? 3 : 2) * scale, equipped ? ROW_STROKE_EQUIPPED : ROW_STROKE, 1)
      row.plate.strokeRoundedRect(left, y, column, rowH, ROW_RADIUS * scale)

      const pad = ROW_PADDING * scale
      const swatchW = 64 * scale
      row.swatch.setTexture(this.swatchFor(row.item))
      row.swatch.setDisplaySize(swatchW, (swatchW * SWATCH_HEIGHT) / SWATCH_WIDTH)
      row.swatch.setPosition(left + pad, y + rowH / 2)

      // The action is laid out FIRST, because the title's available width is measured against it —
      // and `GameButton.width` only reports the scaled footprint once `layout()` has been given the
      // scale. Reading it before would size the title against last frame's button.
      row.action.setLabel(state === 'buy' ? t('buy') : state === 'use' ? t('equip') : t('equipped'))
      row.action.setVariant(state === 'equipped' ? 'ghost' : 'plum')
      // Only a purchase can be unaffordable. "Equip" is free, and "Equipped" is the row with
      // nothing left to do.
      row.action.setEnabled(state === 'use' || (state === 'buy' && affordable))
      row.action.layout(0, 0, scale)
      row.action.layout(left + column - pad - row.action.width / 2, y + rowH / 2, scale)

      const textLeft = left + pad + swatchW + 10 * scale
      // The title gets whatever is left between the swatch and the action button, and is squeezed
      // into it rather than allowed to run under the button. `uiScale` cannot do this on its own:
      // it floors at 0.8 and knows nothing about how wide 'Emerald Grove' happens to render.
      const titleRoom = left + column - pad - row.action.width - 10 * scale - textLeft
      row.title.setFontSize(TITLE_FONT_SIZE * scale)
      row.title.setFontSize(TITLE_FONT_SIZE * scale * fitScale(row.title.width, titleRoom))
      row.title.setPosition(textLeft, y + rowH / 2 - 2 * scale)
      row.coin.setDisplaySize(COIN_SIZE * scale, COIN_SIZE * scale)
      row.coin.setPosition(textLeft, y + rowH / 2 + 10 * scale)
      row.price.setFontSize(PRICE_FONT_SIZE * scale)
      row.price.setPosition(textLeft + COIN_SIZE * scale + 4 * scale, y + rowH / 2 + 2 * scale)
      // Price and its coin disappear entirely once owned: no longer information, just a number the
      // player already paid.
      row.price.setVisible(state === 'buy')
      row.coin.setVisible(state === 'buy')
      row.price.setColor(affordable ? PRICE_COLOR : PRICE_COLOR_SHORT)

      y += rowH + ROW_GAP * scale
    }

    const contentHeight = Math.max(0, y - ROW_GAP * scale)
    this.maxScroll = Math.max(0, contentHeight - listHeight)
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll)
    this.region.camera.setScroll(0, this.scrollY)

    // Just outside the rows rather than over them, so it never sits on a Buy button.
    // No `y`: the bar is drawn in region-camera space, where its top is always the camera's own
    // scroll — see the field's note.
    this.scrollbarTrack = { x: left + column + SCROLLBAR_GAP * scale, width: SCROLLBAR_WIDTH * scale, height: listHeight }
    this.drawScrollbar()

    const listObjects = [this.scrollbar, ...this.rows.flatMap((r) => [r.plate, r.swatch, r.title, r.coin, r.price, r.action.container])]
    const chrome = [this.topup.container, ...(this.backToMatch ? [this.backToMatch.container] : []), ...this.tabs.objects, ...this.topBar.objects, ...this.navBar.objects]
    this.region.camera.ignore(chrome)
    this.cameras.main.ignore(listObjects)
  }
}
