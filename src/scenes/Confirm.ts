import * as Phaser from 'phaser'
import { t } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { gameButton, type ButtonVariant, type GameButton } from '../ui/button'
import { createOverlay, type Overlay } from '../ui/overlay'
import { getTheme } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

export interface ConfirmChoice {
  /** Already resolved through `t()` by the caller — see {@link ConfirmData.message}. */
  label: string
  variant: ButtonVariant
  /**
   * What picking it does, run AFTER the opener has been resumed.
   *
   * `undefined` is the cancel: it closes and does nothing else, which is a real answer and the one
   * every dialog here needs. It is also what `ESC` and a tap outside the panel resolve to.
   */
  onPick?: () => void
}

export interface ConfirmData {
  opener: string
  /** An i18n-resolved question. The caller does the lookup, so this scene needs no key of its own
   * and can be reused for anything. */
  message: string
  /**
   * The answers, in reading order. Two or three.
   *
   * **This replaced a fixed `confirmLabel`/`onConfirm` pair**, and the reason is the second caller:
   * `Modes` has to ask whether the next match is against a character or against the person sitting
   * next to you, which is two ACTIONS rather than one action and a cancel. Encoding that as an
   * optional "and also a second button" on a yes/no dialog would have been two ways of saying one
   * thing in one contract — see the leave-match caller in `Game`, which now expresses its old shape
   * as two choices and reads no worse for it.
   *
   * Exactly one should be gold: gold is where the eye goes, so it marks the answer that is SAFE
   * rather than the one that is likely. The leave-match dialog puts it on Cancel for that reason —
   * the destructive answer is the ghost one.
   */
  choices: readonly ConfirmChoice[]
}

const PANEL_WIDTH = 320
const TITLE_FONT_SIZE = 19
const BUTTON_GAP = 10
/** Below this much room the stack becomes a row — see {@link Confirm.layout}. */
const MIN_VIEWPORT_HEIGHT = 420

/**
 * A question over a paused scene, with two or three answers.
 *
 * Exists for one specific case named in `PROMPT-UI-CHAPAEV.md`'s chunk 2: **back inside `Game` must
 * not leave the match outright.** A round is ten to twenty shots of accumulated position, and the
 * back button sits in the corner a thumb rests on — a stray tap that discards all of it is not a
 * risk worth taking to save one confirmation. `Modes` then wanted the same shape for a different
 * question, which is what turned the fixed yes/no into {@link ConfirmData.choices}.
 *
 * It is `dismissible`, unlike the result panel: cancelling is the safe answer to everything asked
 * here, so a tap outside can mean it. That is also why a cancel CHOICE is still supplied by every
 * caller rather than left to the dismiss — an exit nobody can see is not an exit.
 */
export class Confirm extends Phaser.Scene {
  private openerKey = ''
  private overlay!: Overlay
  private message!: Phaser.GameObjects.Text
  private buttons: GameButton[] = []

  constructor() {
    super('Confirm')
  }

  create(data: ConfirmData) {
    this.openerKey = data.opener
    // Phaser re-uses the scene INSTANCE, and this one is raised from two places now — a stale array
    // would hand `panel.add` objects destroyed on the previous SHUTDOWN, which is the bug
    // `MatchResult`'s header describes in full.
    this.buttons = []

    this.overlay = createOverlay(this, { onDismiss: () => this.close() })

    this.message = this.add
      .text(0, 0, data.message, {
        fontFamily: getDisplayFontStack(),
        fontSize: TITLE_FONT_SIZE,
        color: '#e6d8f5',
        align: 'center',
        wordWrap: { width: PANEL_WIDTH - 48 },
      })
      .setOrigin(0.5)
    this.overlay.panel.add(this.message)

    data.choices.forEach((choice, index) => {
      const button = gameButton(this, { size: 'compact', variant: choice.variant, label: choice.label })
      this.overlay.panel.add(button.container)
      this.buttons.push(button)
      // `ESC` goes on the cancel — the choice that does nothing — wherever the caller put it.
      const keys = choice.onPick ? undefined : ['ESC']
      bindAction(this, `confirmChoice${index}`, { pointer: button.hitArea, keys }, () => this.close(choice.onPick))
    })

    bindLayout(this, (width, height) => this.layout(width, height))
    this.overlay.open()
  }

  /**
   * The answers STACK, and fall back to a row only when the viewport is too short for it.
   *
   * Stacked is right for a list of choices — a full-width button is a bigger target and the eye
   * reads a column as "pick one of these" where a row of three reads as a toolbar. The fallback
   * exists because three stacked buttons plus a two-line question do not fit a phone held sideways,
   * and a panel taller than its viewport loses whichever answer is at the bottom.
   */
  layout(width: number, height: number): void {
    const scale = uiScale(width)
    const stack = height >= MIN_VIEWPORT_HEIGHT || this.buttons.length < 3

    this.message.setFontSize(TITLE_FONT_SIZE * scale)

    for (const button of this.buttons) button.layout(0, 0, scale)
    const buttonHeight = this.buttons[0]?.height ?? 0
    const gap = BUTTON_GAP * scale

    const row = this.buttons.reduce((sum, b) => sum + b.width, 0) + gap * (this.buttons.length - 1)
    // A stacked column is as wide as its widest button; a row is as wide as all of them together,
    // and the panel has to hold whichever is in force plus its padding.
    const wanted = Math.max(PANEL_WIDTH * scale, (stack ? Math.max(...this.buttons.map((b) => b.width)) : row) + 48 * scale)
    const panelWidth = Math.min(wanted, width - 32)

    this.message.setWordWrapWidth(panelWidth - 48 * scale)

    const buttonBlock = stack ? buttonHeight * this.buttons.length + gap * (this.buttons.length - 1) : buttonHeight
    // Height from the content, not a constant — a two-line question and a one-line question should
    // not both get a panel sized for the longer.
    const panelHeight = this.message.height + 40 * scale + buttonBlock + 48 * scale

    this.overlay.layout(width, height)
    this.overlay.drawPanel(panelWidth, panelHeight, scale, getTheme().colors.secondary)

    this.message.setPosition(0, -panelHeight / 2 + 28 * scale + this.message.height / 2)

    const bottom = panelHeight / 2 - 24 * scale
    if (stack) {
      let y = bottom - buttonBlock + buttonHeight / 2
      for (const button of this.buttons) {
        button.layout(0, y, scale)
        y += buttonHeight + gap
      }
      return
    }

    let x = -row / 2
    for (const button of this.buttons) {
      button.layout(x + button.width / 2, bottom - buttonHeight / 2, scale)
      x += button.width + gap
    }
  }

  private close(then?: () => void): void {
    this.overlay.close(() => {
      this.scene.stop()

      const resume = () => {
        this.scene.resume(this.openerKey)
        // AFTER the resume: a callback that starts another scene would otherwise set it up while
        // the scene underneath is still paused, which is the bug `MatchResult` already documents.
        then?.()
      }

      if (isPlatformPaused()) {
        this.game.events.once(YTEvents.RESUME, resume)
        return
      }
      resume()
    })
  }
}

/** Kept so `Game`'s leave-match dialog reads as the yes/no it is, rather than as a list literal at
 * the call site. Two choices, gold on the safe one. */
export function leaveConfirm(message: string, confirmLabel: string, onConfirm: () => void): Omit<ConfirmData, 'opener'> {
  return {
    message,
    choices: [
      { label: confirmLabel, variant: 'ghost', onPick: onConfirm },
      { label: t('cancel'), variant: 'gold' },
    ],
  }
}
