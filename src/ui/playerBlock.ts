import * as Phaser from 'phaser'
import { getDisplayFontStack } from './font'
import { getTheme, toCssColor } from './theme'

/**
 * One side of the match, as a block in the side panel: avatar, name, a line under it, and how many
 * discs that side still has on the board.
 *
 * Lifted from `../Checkers/src/ui/playerBlock.ts` (its `PROMPT-GAME-SIDEPANEL.md` chunk 3). Two of
 * them sandwich the panel — the opponent at the top, the player at the bottom — **because that is
 * where the two sides sit on the board itself**. The eye does not have to relearn anything moving
 * between the board and the panel, which is the whole reason for the arrangement.
 *
 * ## Whose turn it is, is the BLOCK, not a separate capsule
 *
 * The active block takes the gold edge and a soft glow; the idle one keeps a quiet plum edge. In
 * this game that replaces the floating status capsule, and it is the SECOND time a turn signal has
 * been moved for the same reason: CLAUDE.md records a "turn light" drawn along the board's own rim
 * that was reported as scenery, because a band on the perimeter is read as a statement about the
 * EDGE. A capsule floating over a HUD band is the milder version of the same mistake — it says
 * whose turn it is in a third place, about a side the player then has to work out. Here the
 * statement and the person it is about are one object.
 *
 * The sub-line does double duty for the same reason: it carries the standing fact (the record, or
 * the coin balance) and is TEMPORARILY replaced by the state — `Thinking…`, `Your shot`, the result.
 * A dedicated slot for status would be a row that is empty most of the match.
 *
 * The avatar is not owned here — the opponent's is a `ui/portrait.ts` frame and the player's is
 * something else entirely — so {@link PlayerBlock.avatarBox} is where the owner puts whichever it
 * has. The disc TOKEN beside the count is owned, but its texture is set by the caller
 * ({@link PlayerBlock.setToken}) so this file needs to know nothing about skins or branches.
 */
export interface PlayerBlock {
  readonly objects: Phaser.GameObjects.GameObject[]
  /**
   * The block's own plate, in screen px, valid after {@link PlayerBlock.layout} — and `{0,0,0,0}`
   * before it, which is what tells the guided tour there is nothing here to ring on a layout that
   * does not carry a panel at all.
   */
  readonly box: { x: number; y: number; width: number; height: number }
  /** Where the avatar goes — centre and side, in screen px, valid after {@link PlayerBlock.layout}. */
  readonly avatarBox: { x: number; y: number; size: number }
  /** What the block currently says, for the platform tests — which cannot read a `Text` inside a
   * component any other way, and would otherwise reach in by index into `objects`. */
  readonly text: { name: string; sub: string }
  /** Whether this block is the one lit gold. */
  readonly active: boolean
  setName(text: string): void
  /** The standing line: a record, a balance. Restored by passing `null` to {@link setStatus}. */
  setSubline(text: string): void
  /** Temporarily replaces the sub-line. `null` puts the standing line back. */
  setStatus(text: string | null, tone?: 'normal' | 'alert'): void
  /** Discs this side still has on the board — the number a round is actually about. */
  setDiscs(count: number): void
  setActive(active: boolean): void
  /** The texture drawn beside the count. A disc of this side, in the equipped set. */
  setToken(textureKey: string): void
  setVisible(visible: boolean): void
  layout(x: number, y: number, width: number, height: number, scale: number): void
  destroy(): void
}

const PADDING = 10
/**
 * The avatar's ceiling — it takes whatever the block's height allows, up to this.
 *
 * 76 rather than the 56 the reference started at: that project raised it on a report that the
 * opponent's face was too small to read as a person on a phone, and this game's own note in
 * "Portraits" says the same thing in more detail — 112 is where the faces become recognisable in
 * the picker. The face is the one thing in this block that is not a number.
 */
const AVATAR_SIZE = 76
const NAME_FONT_SIZE = 18
const SUB_FONT_SIZE = 14
const COUNT_FONT_SIZE = 14
const TOKEN_SIZE = 20
const RADIUS = 14
const GLOW_ALPHA = 0.22

export function createPlayerBlock(scene: Phaser.Scene): PlayerBlock {
  const colors = getTheme().colors
  let active = false
  let standing = ''
  let isStatus = false

  const highlight = scene.add.graphics()
  const name = scene.add.text(0, 0, '', { fontFamily: getDisplayFontStack(), fontSize: NAME_FONT_SIZE, color: '#ffffff' }).setOrigin(0, 0.5)
  const sub = scene.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: SUB_FONT_SIZE, color: '#c9b6e8' }).setOrigin(0, 0.5)
  const token = scene.add.image(0, 0, '__DEFAULT').setOrigin(0.5).setVisible(false)
  const count = scene.add.text(0, 0, '×0', { fontFamily: getDisplayFontStack(), fontSize: COUNT_FONT_SIZE, color: '#ffffff' }).setOrigin(0, 0.5)

  const box = { x: 0, y: 0, width: 0, height: 0 }
  const avatarBox = { x: 0, y: 0, size: AVATAR_SIZE }
  let currentScale = 1

  function paint(): void {
    const radius = RADIUS * currentScale
    highlight.clear()
    if (box.width <= 0) return
    // The active block is lit from its own edge outwards — two fainter strokes standing in for a
    // glow, the same device the widget kit uses everywhere else (no Bloom pass, so it survives the
    // Canvas fallback).
    if (active) {
      highlight.lineStyle(6 * currentScale, colors.accent, GLOW_ALPHA)
      highlight.strokeRoundedRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4, radius + 2)
      highlight.lineStyle(2 * currentScale, colors.accent, 0.95)
    } else {
      highlight.lineStyle(1.5 * currentScale, colors.secondary, 0.5)
    }
    highlight.strokeRoundedRect(box.x, box.y, box.width, box.height, radius)
  }

  return {
    objects: [highlight, name, sub, token, count],
    box,
    avatarBox,
    get text() {
      return { name: name.text, sub: sub.text }
    },
    get active() {
      return active
    },

    setName(text) {
      name.setText(text)
    },

    setSubline(text) {
      standing = text
      // Only when the status is not currently borrowing the row — otherwise a coin balance updating
      // mid-shot would wipe "Thinking…" off the screen.
      if (!isStatus) sub.setText(text)
    },

    setStatus(text, tone = 'normal') {
      if (text === null) {
        isStatus = false
        sub.setText(standing).setColor('#c9b6e8')
        return
      }
      isStatus = true
      sub.setText(text).setColor(tone === 'alert' ? toCssColor(colors.accent) : '#ffffff')
    },

    setDiscs(value) {
      count.setText(`×${value}`)
    },

    setActive(value) {
      active = value
      paint()
    },

    setToken(textureKey) {
      if (!scene.textures.exists(textureKey)) return
      token.setTexture(textureKey).setVisible(true)
      token.setDisplaySize(TOKEN_SIZE * currentScale, TOKEN_SIZE * currentScale)
    },

    setVisible(visible) {
      highlight.setVisible(visible)
      name.setVisible(visible)
      sub.setVisible(visible)
      count.setVisible(visible)
      // The token stays hidden until it has a real texture, or an empty white square appears in the
      // corner of the block for the first frame.
      token.setVisible(visible && token.texture.key !== '__DEFAULT')
    },

    layout(x, y, width, height, scale) {
      currentScale = scale
      box.x = x
      box.y = y
      box.width = width
      box.height = height

      const padding = PADDING * scale
      const avatar = Math.min(AVATAR_SIZE * scale, height - padding * 2)
      avatarBox.size = avatar
      avatarBox.x = x + padding + avatar / 2
      avatarBox.y = y + height / 2

      token.setDisplaySize(TOKEN_SIZE * scale, TOKEN_SIZE * scale)
      count.setFontSize(COUNT_FONT_SIZE * scale)
      const countWidth = TOKEN_SIZE * scale + 4 * scale + count.width
      token.setPosition(x + width - padding - countWidth + (TOKEN_SIZE * scale) / 2, y + height / 2)
      count.setPosition(token.x + (TOKEN_SIZE * scale) / 2 + 4 * scale, y + height / 2)

      const textLeft = avatarBox.x + avatar / 2 + padding * 0.8
      // The two lines are centred on the block as a pair, so a block reads as one object rather than
      // as a name with something stuck under it.
      name.setFontSize(NAME_FONT_SIZE * scale)
      sub.setFontSize(SUB_FONT_SIZE * scale)
      const textRight = token.x - (TOKEN_SIZE * scale) / 2 - padding * 0.6
      const available = Math.max(40, textRight - textLeft)
      name.setWordWrapWidth(available)
      sub.setWordWrapWidth(available)
      const pairHeight = name.height + 2 * scale + sub.height
      name.setPosition(textLeft, y + height / 2 - pairHeight / 2 + name.height / 2)
      sub.setPosition(textLeft, y + height / 2 + pairHeight / 2 - sub.height / 2)

      paint()
    },

    destroy() {
      for (const object of [highlight, name, sub, token, count]) object.destroy()
    },
  }
}
