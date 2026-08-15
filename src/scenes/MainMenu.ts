import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { gameReady } from '../platform/yt'
import { t } from '../i18n/strings'
import { anchorCenter, anchorTopRight } from '../ui/anchors'
import { bindLayout } from '../ui/layout'
import { getTheme, neonButton, type NeonButton } from '../ui/theme'
import { ensureMinHitArea, uiScale } from '../ui/uiScale'
import { setCatalog } from '../shop/catalog'

const START_FONT_SIZE = 32
const GEAR_FONT_SIZE = 32
const SHOP_FONT_SIZE = 20

// Dev-only demo catalog: seeds a couple of placeholder items purely so the DEV-gated Shop
// button below has something to show. `import.meta.env.DEV` is statically `false` for
// `vite build`/`vite preview`/`npm run bundle` (see CLAUDE.md "Shop Layer"), so this whole
// block — and its two demo items — is dead-code-eliminated out of the shipped bundle; a real
// game calls its own `setCatalog()` unconditionally, with a real catalog, instead.
if (import.meta.env.DEV) {
  setCatalog([
    { id: 'hint-refill', priceCoins: 20, titleKey: 'shopDemoHintRefill', icon: '💡', kind: 'consumable' },
    { id: 'golden-frame', priceCoins: 150, titleKey: 'shopDemoGoldenFrame', icon: '🖼', kind: 'unlock' },
  ])
}

export class MainMenu extends Phaser.Scene {
  private startText!: Phaser.GameObjects.Text
  private gearButton!: Phaser.GameObjects.Text
  private shopButton?: NeonButton

  constructor() {
    super('MainMenu')
  }

  create() {
    // TODO: localize for Playables' global audience via getLanguage() (src/platform/yt.ts)
    // instead of a hardcoded English string — the wrapper exists, nothing calls it yet.
    this.startText = this.add
      .text(0, 0, 'Click to start', {
        fontFamily: 'Arial',
        fontSize: START_FONT_SIZE,
        color: '#ffffff',
      })
      .setOrigin(0.5)

    this.gearButton = this.add
      .text(0, 0, '⚙', { fontFamily: 'Arial', fontSize: GEAR_FONT_SIZE, color: '#ffffff' })
      .setOrigin(1, 0)

    // 'primary' must fire at most once (starting the same scene twice mid-transition is
    // unsafe) — guarded locally rather than adding once/many semantics to bindAction itself.
    let started = false
    bindAction(this, 'primary', { pointer: this.startText, keys: ['SPACE', 'ENTER'] }, () => {
      if (started) return
      started = true
      this.scene.start('Game')
    })

    bindAction(this, 'openSettings', { pointer: this.gearButton, keys: ['ESC'] }, () => {
      this.scene.pause()
      this.scene.launch('Settings', { opener: 'MainMenu' })
    })

    // Dev-only demo entry point into the Shop layer (src/shop/) — a real game wires its own
    // permanent Shop button (no DEV gate, its own catalog) once it actually has products to
    // sell; see CLAUDE.md "Shop Layer".
    if (import.meta.env.DEV) {
      this.shopButton = neonButton(this, t('shop'), getTheme().colors.secondary, SHOP_FONT_SIZE)
      bindAction(this, 'openShop', { pointer: this.shopButton.container }, () => {
        this.scene.pause()
        this.scene.launch('Shop', { opener: 'MainMenu' })
      })
    }

    bindLayout(this, (width, height) => this.layout(width, height))

    // Preloader is fully torn down and the menu is interactable — safe to certify as ready.
    gameReady()
  }

  layout(width: number, _height: number): void {
    const scale = uiScale(width)

    this.startText.setFontSize(START_FONT_SIZE * scale)
    anchorCenter(this.startText)
    ensureMinHitArea(this.startText)

    this.gearButton.setFontSize(GEAR_FONT_SIZE * scale)
    anchorTopRight(this.gearButton, 20, 20)
    ensureMinHitArea(this.gearButton)

    if (this.shopButton) {
      this.shopButton.setFontSize(SHOP_FONT_SIZE * scale)
      anchorCenter(this.shopButton.container, 0, 80 * scale)
    }
  }
}
