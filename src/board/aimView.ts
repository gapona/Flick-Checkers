import * as Phaser from 'phaser'
import { getTheme } from '../ui/theme'

/**
 * What aiming looks like: the disc you have hold of, the band you are pulling, where the shot is
 * pointed, and how hard it will go.
 *
 * All four exist because GAME-PLAN.md §3 asks for a gesture that is **readable while it is being
 * made**, which is the entire argument for a slingshot over a real flick. A flick's power is only
 * knowable after it has happened; this has to show its power before committing, or the choice was
 * never offered.
 *
 * Drawn in world space through the WORLD camera, so it sits on the board at the board's own scale —
 * hand `worldObjects` to `uiCamera.ignore()` like any other board content.
 *
 * ## What is deliberately NOT drawn
 *
 * The line stops at the first thing the shot meets. No bounce, no second contact, no prediction of
 * where anything ends up. §5 puts a full trajectory preview firmly out of scope: it solves the shot
 * for the player and converts a game of touch into a game of reading a line. The first segment is
 * the aim; everything past it is the part they are meant to be judging. `sim/aim.ts`'s
 * `firstContact` is structurally incapable of returning more, which is the safest way to hold a
 * line like this.
 */

const RING_WIDTH = 4
const RING_GAP = 5
const RING_PULSE_MS = 620

/** The band from the disc back to the finger — the catapult being drawn. Thin and quiet: it says
 * what you are doing, while the forward ray says what will happen. */
const BAND_WIDTH = 3
const BAND_ALPHA = 0.5
const BAND_DASH = 11
const BAND_GAP = 8

const RAY_MIN_WIDTH = 3
const RAY_MAX_WIDTH = 9
const RAY_ALPHA = 0.92
const ARROW_LENGTH = 16
const ARROW_SPREAD = 0.42

/** The power arc wraps the disc itself, where the eye already is — no separate gauge to look away
 * to, which on a phone means no gauge under the thumb either. */
const POWER_ARC_RADIUS_GAP = 13
const POWER_ARC_WIDTH = 6
/** Sweeps most of the way round, leaving a gap at the bottom so full and nearly-full are
 * distinguishable rather than both reading as "a closed circle". */
const POWER_ARC_SWEEP = Math.PI * 1.6

/** Marks the disc the shot will actually reach. Absent when the shot falls short, which is how a
 * weak pull at a distant target reads as "you will not get there". */
const TARGET_RING_WIDTH = 3

/** Weak shots are the theme's gold; full power ramps to a hot orange-red. Colour carries the same
 * information as the arc, so it survives being glanced at rather than read. */
const POWER_COLD = 0xffd873
const POWER_HOT = 0xff5a2b

export interface AimVisual {
  /** The disc being aimed, in board units. */
  x: number
  y: number
  r: number
  /** Where the finger is, in board units. */
  pointerX: number
  pointerY: number
  /** Shot direction in radians, and `0..1` power. */
  angle: number
  power: number
  /** The pull is too short to fire — show the grip, but no shot. */
  cancelled: boolean
  /** Where the aim line ends: the first contact, or where the shot runs out. */
  endX: number
  endY: number
  /** The disc the shot reaches, if it reaches one. `null` when the shot falls short or leaves the
   * board. */
  target: { x: number; y: number; r: number } | null
}

export interface AimView {
  readonly worldObjects: Phaser.GameObjects.GameObject[]
  /** Redraw for the current gesture. Call on every pointer move. */
  show(visual: AimVisual): void
  /** Gesture over — clear everything. */
  hide(): void
  destroy(): void
}

function lerpChannel(from: number, to: number, t: number, shift: number): number {
  const a = (from >> shift) & 0xff
  const b = (to >> shift) & 0xff
  return Math.round(a + (b - a) * t) << shift
}

function powerColor(power: number): number {
  return lerpChannel(POWER_COLD, POWER_HOT, power, 16) | lerpChannel(POWER_COLD, POWER_HOT, power, 8) | lerpChannel(POWER_COLD, POWER_HOT, power, 0)
}

/** Depth sits above the discs (-4 in `discView.ts`) but below a falling one, so the aim never draws
 * over a disc leaving the board. */
const AIM_DEPTH = 40

export function createAimView(scene: Phaser.Scene): AimView {
  const graphics = scene.add.graphics().setDepth(AIM_DEPTH)

  /** Drives the selection ring's breathing. Read from the scene clock rather than accumulated
   * per-frame, so it cannot drift and needs no update hook of its own — the ring is only ever
   * redrawn while a pointer is moving anyway. */
  const pulse = (): number => 0.5 + 0.5 * Math.sin((scene.time.now / RING_PULSE_MS) * Math.PI * 2)

  function drawDashedLine(fromX: number, fromY: number, toX: number, toY: number): void {
    const dx = toX - fromX
    const dy = toY - fromY
    const length = Math.hypot(dx, dy)
    if (length <= 0) return

    const stepX = dx / length
    const stepY = dy / length
    for (let at = 0; at < length; at += BAND_DASH + BAND_GAP) {
      const end = Math.min(at + BAND_DASH, length)
      graphics.lineBetween(fromX + stepX * at, fromY + stepY * at, fromX + stepX * end, fromY + stepY * end)
    }
  }

  function drawArrowHead(x: number, y: number, angle: number, color: number, width: number): void {
    graphics.lineStyle(width, color, RAY_ALPHA)
    graphics.lineBetween(x, y, x - Math.cos(angle - ARROW_SPREAD) * ARROW_LENGTH, y - Math.sin(angle - ARROW_SPREAD) * ARROW_LENGTH)
    graphics.lineBetween(x, y, x - Math.cos(angle + ARROW_SPREAD) * ARROW_LENGTH, y - Math.sin(angle + ARROW_SPREAD) * ARROW_LENGTH)
  }

  return {
    get worldObjects() {
      return [graphics]
    },

    show(visual: AimVisual): void {
      graphics.clear()

      const theme = getTheme()
      const color = powerColor(visual.power)

      // The grip: a ring around the disc under the finger. Drawn even when the pull is too short to
      // fire, because "I have hold of this one" is true from the moment of the press and is what
      // makes the cancel discoverable.
      graphics.lineStyle(RING_WIDTH, theme.colors.accent, 0.55 + 0.35 * pulse())
      graphics.strokeCircle(visual.x, visual.y, visual.r + RING_GAP)

      // The band back to the finger.
      graphics.lineStyle(BAND_WIDTH, theme.colors.secondary, BAND_ALPHA)
      drawDashedLine(visual.x, visual.y, visual.pointerX, visual.pointerY)

      if (visual.cancelled) return

      // The shot. Thickness and colour both carry power, so it survives a glance.
      const width = RAY_MIN_WIDTH + (RAY_MAX_WIDTH - RAY_MIN_WIDTH) * visual.power
      graphics.lineStyle(width, color, RAY_ALPHA)
      graphics.lineBetween(visual.x, visual.y, visual.endX, visual.endY)
      drawArrowHead(visual.endX, visual.endY, visual.angle, color, width)

      // The power arc, starting from straight up and sweeping clockwise.
      graphics.lineStyle(POWER_ARC_WIDTH, color, 0.95)
      graphics.beginPath()
      graphics.arc(visual.x, visual.y, visual.r + POWER_ARC_RADIUS_GAP, -Math.PI / 2, -Math.PI / 2 + POWER_ARC_SWEEP * visual.power, false)
      graphics.strokePath()

      if (visual.target) {
        graphics.lineStyle(TARGET_RING_WIDTH, color, 0.85)
        graphics.strokeCircle(visual.target.x, visual.target.y, visual.target.r + RING_GAP)
      }
    },

    hide(): void {
      graphics.clear()
    },

    destroy(): void {
      graphics.destroy()
    },
  }
}
