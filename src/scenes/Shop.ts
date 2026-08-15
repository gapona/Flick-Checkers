import * as Phaser from 'phaser'
import { showRewarded } from '../platform/adGate'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { t, tOptional } from '../i18n/strings'
import { getDisplayFontStack } from '../ui/font'
import { titleCase } from '../ui/format'
import { bindLayout } from '../ui/layout'
import { getTheme, neonButton, roundedPanel, rowButton, toCssColor, valueBadge, type NeonButton, type RoundedPanel, type RowButton, type RowColumns, type ValueBadge } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { getCatalog, type ShopItem } from '../shop/catalog'
import { canAfford, earnCoins, hasPurchased, spendCoins } from '../shop/coins'
import { getState, mutate } from '../save/store'

export interface ShopData {
  opener: string
  /** Fired after a `'consumable'` item is purchased (coins already debited) — the game
   * applies whatever effect the item represents. Never called for `'unlock'` items; those
   * are tracked entirely in `SaveState.purchases`, nothing else needs telling. */
  onPurchase?: (item: ShopItem) => void
}

const TOPUP_REWARD_ID = 'coins-topup'
const TOPUP_COINS = 50

const PANEL_WIDTH = 420
const PANEL_SIDE_PADDING = 24
const ROW_WIDTH = PANEL_WIDTH - PANEL_SIDE_PADDING * 2
const ROW_HEIGHT = 52
const ROW_GAP = 10
const HEADER_HEIGHT = 60
const TOPUP_HEIGHT = 60
const FOOTER_HEIGHT = 70
const TOP_PAD = 24
const BOTTOM_PAD = 16

const TITLE_FONT_SIZE = 26
const COINS_FONT_SIZE = 18
const TOPUP_FONT_SIZE = 18
const ROW_FONT_SIZE = 16
const CLOSE_FONT_SIZE = 22

// `'unlock'`-owned / can't-afford rows both dim to this same neutral gray — matches
// `ui/theme.ts`'s own `PILL_BADGE_MAX_COLOR` convention ("only what you can act on glows").
const DIMMED_ROW_COLOR = 0x888888

// [left: icon+title, result: price, reserved (unused), accent: Buy/Owned]
const SHOP_ROW_COLUMNS: RowColumns = [
  { x: 0.04, align: 'left', width: 0.52 },
  { x: 0.56, align: 'left', width: 0.22 },
  { x: 0.78, align: 'left', width: 0 },
  { x: 0.96, align: 'right', width: 0.22 },
]

interface RowEntry {
  item: ShopItem
  row: RowButton
}

/**
 * A demo/reference Shop overlay for the `src/shop/` layer — same `scene.launch({ opener })`
 * pattern as `Settings.ts` (pauses the opener, resumes it by key on close). Not registered
 * anywhere in `MainMenu.ts` by default in production; see CLAUDE.md "Shop Layer" for how a
 * real game wires this up (its own catalog via `setCatalog()`, its own permanent entry
 * point, no DEV gate).
 *
 * Deliberately does not scroll — rows simply stack to fit the catalog's length. A game with
 * a catalog too large for one screen needs its own scrolling list (see `Gallery`-style
 * scroll-vs-tap patterns in other Phaser 4 projects) — out of scope for this template.
 */
export class Shop extends Phaser.Scene {
  private openerKey = ''
  private onPurchase?: (item: ShopItem) => void
  private backdrop!: Phaser.GameObjects.Rectangle
  private panel!: RoundedPanel
  private title!: Phaser.GameObjects.Text
  private coinsBadge!: ValueBadge
  private topupButton!: NeonButton
  private closeButton!: NeonButton
  private rows: RowEntry[] = []

  constructor() {
    super('Shop')
  }

  create(data: ShopData) {
    this.openerKey = data.opener
    this.onPurchase = data.onPurchase
    this.rows = []

    // Same 0x0-until-layout() backdrop pattern as Settings.ts — see its own comment for why
    // setInteractive() can't be called until a real size exists.
    this.backdrop = this.add.rectangle(0, 0, 0, 0, 0x000000, 0.6)

    this.panel = roundedPanel(this)

    this.title = this.add
      .text(0, 0, t('shop'), { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: toCssColor(getTheme().colors.primary) })
      .setOrigin(0.5)

    this.coinsBadge = valueBadge(this, '🪙', getState().coins)

    this.topupButton = neonButton(this, t('shopTopup', { n: TOPUP_COINS }), getTheme().colors.secondary, TOPUP_FONT_SIZE)
    bindAction(this, 'shopTopup', { pointer: this.topupButton.container }, () => {
      void this.requestTopup()
    })

    for (const item of getCatalog()) {
      const label = `${item.icon} ${tOptional(item.titleKey) ?? titleCase(item.id)}`
      const row = rowButton(this, label, `🪙 ${item.priceCoins}`, t('buy'), SHOP_ROW_COLUMNS, getTheme().colors.secondary, ROW_FONT_SIZE)
      bindAction(this, `shopBuy:${item.id}`, { pointer: row.container }, () => this.purchase(item))
      this.rows.push({ item, row })
    }
    this.refreshAllRows()

    this.closeButton = neonButton(this, t('close'), getTheme().colors.primary, CLOSE_FONT_SIZE)
    bindAction(this, 'close', { pointer: this.closeButton.container, keys: ['ESC', 'ENTER'] }, () => this.close())

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)
    const rowCount = this.rows.length
    const rowsHeight = rowCount > 0 ? rowCount * ROW_HEIGHT + (rowCount - 1) * ROW_GAP : 0
    const panelHeight = (TOP_PAD + HEADER_HEIGHT + TOPUP_HEIGHT + rowsHeight + FOOTER_HEIGHT + BOTTOM_PAD) * scale
    const panelWidth = PANEL_WIDTH * scale

    const cx = width / 2
    const cy = height / 2
    const panelTop = cy - panelHeight / 2
    const panelLeft = cx - panelWidth / 2

    this.backdrop.setPosition(cx, cy).setSize(width, height)
    if (!this.backdrop.input) {
      this.backdrop.setInteractive()
    } else {
      ;(this.backdrop.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)
    }

    this.panel.draw(cx, cy, panelWidth, panelHeight, getTheme().colors.secondary)

    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    this.title.setPosition(cx, panelTop + TOP_PAD * scale + (HEADER_HEIGHT * scale) / 2)

    this.coinsBadge.setFontSize(Math.round(COINS_FONT_SIZE * scale))
    this.coinsBadge.container.setPosition(
      panelLeft + panelWidth - PANEL_SIDE_PADDING * scale - this.coinsBadge.container.width / 2,
      panelTop + TOP_PAD * scale + (HEADER_HEIGHT * scale) / 2,
    )

    this.topupButton.setFontSize(TOPUP_FONT_SIZE * scale)
    this.topupButton.container.setPosition(cx, panelTop + (TOP_PAD + HEADER_HEIGHT) * scale + (TOPUP_HEIGHT * scale) / 2)

    let cursorY = panelTop + (TOP_PAD + HEADER_HEIGHT + TOPUP_HEIGHT) * scale + (ROW_HEIGHT * scale) / 2
    for (const { row } of this.rows) {
      row.setSize(ROW_WIDTH * scale, ROW_HEIGHT * scale)
      row.setFontSize(ROW_FONT_SIZE * scale)
      row.container.setPosition(cx, cursorY)
      cursorY += (ROW_HEIGHT + ROW_GAP) * scale
    }

    this.closeButton.setFontSize(CLOSE_FONT_SIZE * scale)
    this.closeButton.container.setPosition(cx, panelTop + panelHeight - BOTTOM_PAD * scale - (FOOTER_HEIGHT * scale) / 2)
  }

  private async requestTopup(): Promise<void> {
    const granted = await showRewarded(this.game, TOPUP_REWARD_ID)
    if (!granted) return
    mutate((s) => {
      s.coins = earnCoins(s.coins, TOPUP_COINS)
    })
    this.coinsBadge.setValue(getState().coins)
    this.refreshAllRows()
  }

  private purchase(item: ShopItem): void {
    const state = getState()
    if (item.kind === 'unlock' && hasPurchased(state.purchases, item.id)) return
    if (!canAfford(state.coins, item.priceCoins)) return

    let spent = false
    mutate((s) => {
      const result = spendCoins(s.coins, item.priceCoins)
      if (result === null) return
      s.coins = result
      if (item.kind === 'unlock') s.purchases.push(item.id)
      spent = true
    })
    if (!spent) return

    this.coinsBadge.setValue(getState().coins)
    this.refreshAllRows()
    if (item.kind === 'consumable') this.onPurchase?.(item)
  }

  /** Re-derives every row's color/price-alpha/accent-label from the current balance and
   * purchase list — called after both a purchase (this item's own state changed) and a
   * top-up (every row's affordability may have changed). */
  private refreshAllRows(): void {
    const state = getState()
    for (const { item, row } of this.rows) {
      const owned = item.kind === 'unlock' && hasPurchased(state.purchases, item.id)
      const affordable = canAfford(state.coins, item.priceCoins)
      const color = owned || !affordable ? DIMMED_ROW_COLOR : getTheme().colors.secondary
      row.setColor(color)
      row.setResultText(`🪙 ${item.priceCoins}`, owned || !affordable ? 0.4 : 0.75)
      row.setAccentText(owned ? t('owned') : t('buy'))
    }
  }

  private close(): void {
    this.scene.stop()

    if (isPlatformPaused()) {
      this.game.events.once(YTEvents.RESUME, () => {
        this.scene.resume(this.openerKey)
      })
      return
    }

    this.scene.resume(this.openerKey)
  }
}
