import * as Phaser from 'phaser'
import { activePieceSet } from '../game/wallet'
import { pieceSet } from '../game/skins'
import { discTextureKey, ensureDiscTextures } from '../board/discTextures'
import { getTheme, neonText, type NeonText } from './theme'

/**
 * The game's wordmark, flanked by a disc from each side, mid-flight.
 *
 * ## Why the logo is typography and not a rendered image
 *
 * The obvious way to get a logo is to draw one. Two things rule it out here, and both are facts
 * about this project rather than preferences:
 *
 * 1. **The title is localised.** `i18n/strings.ts` carries `gameTitle` in `en` and `es`
 *    ("Flick Checkers" / "Damas de Pulso"), and the dictionaries are parity-checked at compile time
 *    precisely so a string cannot exist in one language and not the other. A baked wordmark is an
 *    English-only wordmark, and it would silently undo that.
 * 2. **Diffusion models cannot set type.** This is not a guess about the pipeline — the project
 *    already measured the neighbouring case and recorded it in `gen_chapaev_emblems.py`.
 *
 * The display face (`ui/font.ts`, Fredoka 600) already ships and is already awaited before the
 * first scene draws, so a typographic lockup costs no asset, no provenance row and no load time.
 *
 * ## What makes it a lockup rather than a label
 *
 * Two discs, one per side, tilted and set at different angles — the same live textures the board
 * and `ui/flyingDiscs.ts` use, so the logo wears the equipped skin. They are what say "this game is
 * about flicking these" before a word is read, and they are the reason the mark works at a glance
 * in a language the player does not speak.
 *
 * The discs are placed OUTSIDE the text's own box and the whole thing is measured as one width, so
 * a caller can shrink the lockup to fit a narrow phone without the discs riding over the letters —
 * see {@link TitleLockup.width}, which is what `MainMenu` feeds to `fitScale`.
 */

/** Disc diameter as a multiple of the wordmark's cap height, and its gap from the text. */
const DISC_SCALE = 1.35
const DISC_GAP = 0.42

/** The two discs are deliberately NOT mirror images: a symmetric pair reads as a heraldic crest,
 * a mismatched one reads as two objects caught mid-flight. */
const LEFT_ANGLE = -18
const RIGHT_ANGLE = 26

export interface TitleLockup {
  readonly objects: Phaser.GameObjects.GameObject[]
  /** Wordmark plus both discs and both gaps, at the current font size. */
  readonly width: number
  readonly height: number
  setFontSize(size: number): void
  /** Shows or hides the whole lockup — wordmark and both discs. A caller cannot do this itself
   * without knowing how many objects the lockup is made of, which is the thing this module exists
   * to keep to itself. `MainMenu` uses it on a screen too short to hold both the logo and the
   * buttons, where the buttons win. */
  setVisible(visible: boolean): void
  layout(centreX: number, centreY: number): void
  /** The wordmark's own glow pulse, for a caller that wants the logo to announce itself. */
  pulse(): void
  destroy(): void
}

export function createTitleLockup(scene: Phaser.Scene, text: string, fontSize: number): TitleLockup {
  const set = pieceSet(activePieceSet())
  ensureDiscTextures(scene, set)

  const word: NeonText = neonText(scene, text, getTheme().colors.accent, fontSize)
  // Gold on the left, violet on the right: the same two sides the board has, in the same order the
  // player reads in.
  const left = scene.add.image(0, 0, discTextureKey('player', set.id)).setAngle(LEFT_ANGLE)
  const right = scene.add.image(0, 0, discTextureKey('opponent', set.id)).setAngle(RIGHT_ANGLE)

  function discSize(): number {
    return word.height * DISC_SCALE
  }

  function totalWidth(): number {
    return word.width + 2 * (discSize() * (1 + DISC_GAP))
  }

  return {
    objects: [word.container, left, right],

    get width() {
      return totalWidth()
    },
    get height() {
      return Math.max(word.height, discSize())
    },

    setFontSize(size: number): void {
      word.setFontSize(size)
    },

    setVisible(visible: boolean): void {
      word.container.setVisible(visible)
      left.setVisible(visible)
      right.setVisible(visible)
    },
    layout(centreX: number, centreY: number): void {
      const size = discSize()
      const offset = word.width / 2 + size * (0.5 + DISC_GAP)
      word.container.setPosition(centreX, centreY)
      left.setDisplaySize(size, size).setPosition(centreX - offset, centreY)
      right.setDisplaySize(size, size).setPosition(centreX + offset, centreY)
    },

    pulse(): void {
      word.pulse()
    },

    destroy(): void {
      word.container.destroy()
      left.destroy()
      right.destroy()
    },
  }
}
