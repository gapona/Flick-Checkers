import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { buttonAt, DEFAULT_SAVE, launch, open, startMatch, waitForOverlay, waitForSettled, type GamePage, type Harness } from './harness'

/**
 * Two invariants about where things are drawn. Both were added after a player sent a screenshot,
 * and both reproduce a defect every other check in this repo is blind to by construction.
 *
 * 1. **The canvas clear colour must never be visible.** `config.ts` clears to `backgroundTop`
 *    (`0x3d1160`), a bright plum no widget in the game draws with — so a pixel of exactly that
 *    colour is a hole in some scene's background. `Modes`, `Shop` and `UiStand` each painted their
 *    plate as `add.rectangle(0, 0, 4000, 4000).setOrigin(0.5)`: a magic square centred on the world
 *    origin, which covers ±2000 and no more. A desktop window wider than that ended in a hard
 *    vertical seam with a bright band beyond it, and the gear button sat on the band.
 *
 * 2. **Nothing drawn may cross anything else, or leave the viewport.** Landscape is where this
 *    fails, because the two bars eat half of a 360-tall screen. Measured before the fixes: the
 *    shop's list ran 38px past the nav bar — and a later camera OWNS its viewport's pixels rather
 *    than compositing over them, so the bar's icons were erased rather than covered — the modes
 *    list ran under its own Start button, the menu's wordmark sat 25px above the top of the screen
 *    at 640x320, and the board's side panel put the retake button at y = -6, off the screen.
 *
 * The clear-colour check also runs while a gesture is HELD, because the aim camera pulls back and
 * moves: the state a player is in for the whole of every shot had never been screenshotted by
 * anything, and both halves of the camera's focus were wrong there.
 *
 * **Hit areas are deliberately NOT compared.** `ensureMinHitArea` and `gameButton` pad every tap
 * target out to 44px on purpose, so those boxes overlap their neighbours by design — the settings
 * slider's knob sits on its own track, and every label above a control dips into the pad beneath
 * it. Comparing them measures the touch policy rather than the picture, which is exactly what the
 * first version of this file did: 48 findings, every one of them correct behaviour.
 */

const CLEAR_COLOUR = [0x3d, 0x11, 0x60] as const

/** How many pixels of the canvas clear colour the screenshot contains, and where they start. */
async function clearColourPixels(game: GamePage): Promise<{ count: number; box: string }> {
  const img = await loadImage(await game.page.screenshot())
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  let count = 0
  let minX = Infinity
  let minY = Infinity
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      if (data[i] === CLEAR_COLOUR[0] && data[i + 1] === CLEAR_COLOUR[1] && data[i + 2] === CLEAR_COLOUR[2]) {
        count++
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
      }
    }
  }
  return { count, box: count ? `from ${minX},${minY} in ${img.width}x${img.height}` : '' }
}

interface DrawnBox {
  scene: string
  label: string
  x: number
  y: number
  w: number
  h: number
  off: boolean
}

/**
 * Every DRAWN control and label on every active scene, as screen rectangles, each already clipped
 * to the camera that renders it — a scroll region owns its viewport, so content beyond it is not on
 * screen however far its world bounds reach.
 */
function drawnBoxes(game: GamePage): Promise<{ vw: number; vh: number; out: DrawnBox[] }> {
  return game.page.evaluate(() => {
    const phaser = window.__game!
    const vw = phaser.scale.width
    const vh = phaser.scale.height
    const out: DrawnBox[] = []
    for (const scene of phaser.scene.getScenes(true)) {
      for (const camera of scene.cameras.cameras) {
        const emit = (obj: any): void => {
          if (typeof obj.getBounds !== 'function') return
          const b = obj.getBounds()
          if (b.width <= 0 || b.height <= 0) return
          const view = camera.worldView
          const zoom = camera.zoom
          const x = camera.x + (b.x - view.x) * zoom
          const y = camera.y + (b.y - view.y) * zoom
          const x0 = Math.max(x, camera.x)
          const y0 = Math.max(y, camera.y)
          const x1 = Math.min(x + b.width * zoom, camera.x + camera.width)
          const y1 = Math.min(y + b.height * zoom, camera.y + camera.height)
          if (x1 <= x0 || y1 <= y0) return
          // A full-bleed backdrop is not furniture and covering everything is its job.
          if ((x1 - x0) * (y1 - y0) >= vw * vh * 0.85) return
          out.push({
            scene: scene.scene.key,
            label: obj.type === 'Text' ? JSON.stringify(String(obj.text).slice(0, 22)) : (obj.name || obj.type),
            x: x0,
            y: y0,
            w: x1 - x0,
            h: y1 - y0,
            off: x < -1 || y < -1 || x + b.width * zoom > vw + 1 || y + b.height * zoom > vh + 1,
          })
        }
        const walk = (obj: any): void => {
          if (!obj.visible || (obj.alpha ?? 1) < 0.05) return
          if ((obj.depth ?? 0) <= -1000) return
          if (obj.type === 'Zone') return
          // An invisible hit proxy, not a drawn thing — see this file's header.
          if (obj.type === 'Rectangle' && (obj.fillAlpha === 0 || obj.isFilled === false)) return
          if (obj.type === 'Container') {
            if (obj.input) {
              emit(obj)
              return
            }
            for (const child of obj.list) walk(child)
            return
          }
          if (obj.input || obj.type === 'Text') emit(obj)
        }
        for (const obj of scene.children.list as any[]) {
          if ((obj.cameraFilter & camera.id) !== 0) continue
          walk(obj)
        }
      }
    }
    return { vw, vh, out }
  })
}

/**
 * Boxes that CROSS — neither one containing the other.
 *
 * Containment is the signature of ownership rather than collision: the nav bar and the mode cards
 * both take their taps through a bare rectangle with sibling texts drawn on top of it, so there is
 * no parent link to read and a label inside a control's box is that control's own label.
 */
function crossings(boxes: { out: DrawnBox[] }): string[] {
  const found: string[] = []
  for (let i = 0; i < boxes.out.length; i++) {
    for (let j = i + 1; j < boxes.out.length; j++) {
      const a = boxes.out[i]
      const b = boxes.out[j]
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox <= 1 || oy <= 1) continue
      const share = (ox * oy) / Math.min(a.w * a.h, b.w * b.h)
      if (share < 0.06 || share > 0.95) continue
      found.push(
        `${a.scene}:${a.label} [${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)}]` +
          ` crosses ${b.scene}:${b.label} [${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}]` +
          ` by ${(share * 100).toFixed(0)}%`,
      )
    }
  }
  return found
}

async function assertLaidOut(game: GamePage, where: string): Promise<void> {
  const boxes = await drawnBoxes(game)

  const crossed = crossings(boxes)
  assert.deepEqual(crossed, [], `${where}: elements overlap\n  ${crossed.join('\n  ')}`)

  const offscreen = boxes.out
    .filter((b) => b.off)
    .map((b) => `${b.scene}:${b.label} [${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}]`)
    // An object drawn by two cameras is reported twice; the reader does not need it twice.
    .filter((entry, index, all) => all.indexOf(entry) === index)
  assert.deepEqual(offscreen, [], `${where}: elements leave the ${boxes.vw}x${boxes.vh} viewport\n  ${offscreen.join('\n  ')}`)
}

/**
 * The gear, in screen pixels.
 *
 * It belongs to the top bar rather than to the scene, and its taps go through a separate hit-area
 * rectangle — so its own Container carries no `.input` and cannot be found by that. It is simply
 * the last container the bar adds.
 */
function gearAt(game: GamePage, sceneKey: string): Promise<{ x: number; y: number }> {
  return game.page.evaluate((key: string) => {
    const scene = window.__game!.scene.getScene(key) as unknown as { topBar: { objects: Phaser.GameObjects.GameObject[] } }
    const containers = scene.topBar.objects.filter((o) => o.type === 'Container') as Phaser.GameObjects.Container[]
    const m = containers[containers.length - 1].getWorldTransformMatrix()
    return { x: m.tx, y: m.ty }
  }, sceneKey)
}

/**
 * Presses one of the player's own discs and pulls, leaving the pointer DOWN — the aim camera pulls
 * back while a gesture is held, which is the state this file exists to check and the state no test
 * had ever been in.
 */
async function holdAim(game: GamePage, sceneKey: 'Game' | 'Daily' = 'Game'): Promise<void> {
  const disc = await game.page.evaluate((key: string) => {
    const scene = window.__game!.scene.getScene(key) as unknown as {
      sim: { discs: { x: number; y: number; side: string; alive: boolean }[] }
    }
    const camera = window.__game!.scene.getScene(key).cameras.main
    const mine = scene.sim.discs.filter((d) => d.side === 'player' && d.alive)
    const d = mine[mine.length - 1]
    const view = camera.worldView
    return { x: camera.x + (d.x - view.x) * camera.zoom, y: camera.y + (d.y - view.y) * camera.zoom }
  }, sceneKey)
  await game.page.mouse.move(disc.x, disc.y)
  await game.page.mouse.down()
  await game.page.mouse.move(disc.x + 30, disc.y + 110, { steps: 10 })
  // The pull-back is a 200ms-ish tween; the plate has to hold at the END of it, not just the start.
  await game.page.waitForTimeout(700)
}

describe('the layout holds at every shape', () => {
  let harness: Harness

  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  // Wider and taller than the 2000px the old magic plates reached, which is the whole point of
  // these two sizes; the phone is here so a regression that only breaks the common case still fails.
  for (const size of [{ width: 2400, height: 1200 }, { width: 1200, height: 2200 }, { width: 390, height: 844 }]) {
    it(`never shows the bare canvas at ${size.width}x${size.height}`, async () => {
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await game.page.waitForTimeout(500)

      for (const screen of ['MainMenu', 'Modes', 'Shop'] as const) {
        if (screen === 'Modes') {
          const menu = await buttonAt(game.page, 'MainMenu', 'newMatchButton')
          await game.click(menu.x, menu.y)
          await game.waitForScene('Modes')
        }
        if (screen === 'Shop') {
          await game.page.evaluate(() => window.__game!.scene.getScene('Modes').scene.start('Shop', {}))
          await game.waitForScene('Shop')
        }
        await game.page.waitForTimeout(500)
        const holes = await clearColourPixels(game)
        assert.equal(holes.count, 0, `${screen} at ${size.width}x${size.height} leaves ${holes.count}px of bare canvas ${holes.box}`)
      }
      await game.page.close()
    })
  }

  it('re-covers the screen after a resize, which is when this kind of bug appears', async () => {
    const game = await open(harness, { width: 900, height: 700, save: DEFAULT_SAVE })
    const menu = await buttonAt(game.page, 'MainMenu', 'newMatchButton')
    await game.click(menu.x, menu.y)
    await game.waitForScene('Modes')
    await game.page.waitForTimeout(400)

    for (const size of [{ width: 2400, height: 1200 }, { width: 1200, height: 2200 }, { width: 390, height: 844 }]) {
      await game.page.setViewportSize(size)
      await game.page.waitForTimeout(600)
      const holes = await clearColourPixels(game)
      assert.equal(holes.count, 0, `Modes resized to ${size.width}x${size.height} leaves ${holes.count}px of bare canvas ${holes.box}`)
    }
    await game.page.close()
  })

  for (const size of [{ width: 1400, height: 700 }, { width: 390, height: 844 }]) {
    it(`keeps the board's background covering the screen while AIMING at ${size.width}x${size.height}`, async () => {
      /**
       * The aim camera pulls back, so the world rectangle on screen is at its LARGEST exactly while
       * a gesture is being made — and with a side panel it also MOVES, because the panel's shift is
       * a screen-px offset and therefore a different distance in world units at each zoom.
       *
       * Both halves shipped wrong. `enterAimCamera` centred on the bare `boardW / 2` and dropped
       * the shift, which slid the board under the panel; the plate stayed at the shifted centre and
       * came up 120 world units short. Reported from a desktop, and measured here as `#3d1160` —
       * bare canvas — down the whole left edge.
       */
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await startMatch(game)
      await waitForSettled(game.page)
      await game.page.waitForTimeout(400)

      // At rest first: the board is the one full-page screen the clear-colour check did not cover,
      // and a plate that fails at rest would otherwise be reported as an aiming bug.
      const resting = await clearColourPixels(game)
      assert.equal(resting.count, 0, `the board at rest at ${size.width}x${size.height} leaves ${resting.count}px of bare canvas ${resting.box}`)

      await holdAim(game)
      const holes = await clearColourPixels(game)
      await game.page.mouse.up()
      assert.equal(holes.count, 0, `aiming at ${size.width}x${size.height} leaves ${holes.count}px of bare canvas ${holes.box}`)

      await game.page.close()
    })
  }

  it('keeps the DAILY puzzle covered while aiming too', async () => {
    // Same gesture, same camera, a separate scene — and its plate is placed by its own copy of the
    // arithmetic. It has no side panel, so it never had the shift half of the bug; this is here so
    // that the copy cannot drift away from the original unnoticed.
    const game = await open(harness, { width: 1400, height: 700, save: DEFAULT_SAVE })
    const daily = await buttonAt(game.page, 'MainMenu', 'dailyButton')
    await game.click(daily.x, daily.y)
    await game.waitForScene('Daily')
    await game.page.waitForTimeout(900)
    await holdAim(game, 'Daily')

    const holes = await clearColourPixels(game)
    await game.page.mouse.up()
    assert.equal(holes.count, 0, `aiming on the daily leaves ${holes.count}px of bare canvas ${holes.box}`)

    await game.page.close()
  })

  for (const size of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 740, height: 360 }, { width: 844, height: 390 }]) {
    const at = `${size.width}x${size.height}`

    it(`draws every menu without overlaps at ${at}`, async () => {
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await game.page.waitForTimeout(700)
      await assertLaidOut(game, `${at} MainMenu`)

      const gear = await gearAt(game, 'MainMenu')
      await game.click(gear.x, gear.y)
      await game.waitForScene('Settings')
      await waitForOverlay(game.page, 'Settings')
      await assertLaidOut(game, `${at} Settings`)
      const close = await buttonAt(game.page, 'Settings', 'closeButton')
      await game.click(close.x, close.y)
      await game.page.waitForTimeout(500)

      const menu = await buttonAt(game.page, 'MainMenu', 'newMatchButton')
      await game.click(menu.x, menu.y)
      await game.waitForScene('Modes')
      await game.page.waitForTimeout(500)
      await assertLaidOut(game, `${at} Modes`)

      const start = await buttonAt(game.page, 'Modes', 'startButton')
      await game.click(start.x, start.y)
      await game.waitForScene('Confirm')
      await waitForOverlay(game.page, 'Confirm')
      await assertLaidOut(game, `${at} the rival question`)

      const answer = await game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Confirm') as unknown as { buttons: { container: Phaser.GameObjects.Container }[] }
        const m = scene.buttons[0].container.getWorldTransformMatrix()
        return { x: m.tx, y: m.ty }
      })
      await game.click(answer.x, answer.y)
      await game.waitForScene('Opponents')
      await game.page.waitForTimeout(800)
      await assertLaidOut(game, `${at} Opponents`)

      await game.page.close()
    })
  }

  it('draws the chrome icons rather than typing them', async () => {
    /**
     * The navigation and the gear were `U+1F3E0`/`U+1F6D2`/`U+1F3AF`/`U+2699`. They cost less than
     * the mute buttons when a device lacks them — every tab carries its own word underneath — but
     * they are on the two bars a player looks at most, and being sprites now buys something a glyph
     * could never do: the active tab's icon takes the same gold its label does.
     */
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    const menu = await buttonAt(game.page, 'MainMenu', 'newMatchButton')
    await game.click(menu.x, menu.y)
    await game.waitForScene('Modes')
    await game.page.waitForTimeout(600)

    const icons = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Modes')
      const found: { frame: string; tint: string }[] = []
      const walk = (obj: any): void => {
        if (obj.type === 'Image' && obj.texture?.key === 'game') {
          found.push({ frame: obj.frame.name, tint: obj.tintTopLeft.toString(16) })
        }
        if (obj.list) for (const child of obj.list) walk(child)
      }
      for (const obj of scene.children.list) walk(obj)
      return found
    })

    const byFrame = new Map(icons.map((i) => [i.frame, i.tint]))
    for (const frame of ['icon-home', 'icon-shop', 'icon-modes', 'icon-gear']) {
      assert.ok(byFrame.has(frame), `${frame} should be a drawn atlas frame, not a glyph`)
    }
    // Modes is the open screen, so its tab is the gold one and the other two are not.
    assert.equal(byFrame.get('icon-modes'), 'ffcf3f', 'the active tab should carry the gold its label does')
    assert.equal(byFrame.get('icon-home'), 'c4aede')
    assert.equal(byFrame.get('icon-shop'), 'c4aede')

    await game.page.close()
  })

  it('draws the mute icons rather than typing them', async () => {
    /**
     * A control whose meaning IS a system glyph stops meaning anything on a device that does not
     * own that glyph. Reported from a phone: both settings buttons came back as tofu boxes, and
     * since neither carries a word, nothing at all said whether sound or music was muted. They are
     * atlas frames now — the same answer the coin in that atlas had always been.
     */
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    const gear = await gearAt(game, 'MainMenu')
    await game.click(gear.x, gear.y)
    await game.waitForScene('Settings')
    await waitForOverlay(game.page, 'Settings')

    const readFrames = (): Promise<string[]> =>
      game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Settings')
        const found: string[] = []
        const walk = (obj: any): void => {
          if (obj.type === 'Image' && obj.texture?.key === 'game') found.push(obj.frame.name)
          if (obj.list) for (const child of obj.list) walk(child)
        }
        for (const obj of scene.children.list) walk(obj)
        return found
      })

    assert.deepEqual(await readFrames(), ['icon-sound-on', 'icon-sound-on'], 'both sliders should wear a DRAWN speaker')

    // Muting the first one must change what its button shows — a drawn icon that never swaps is the
    // same dead end as a missing glyph.
    const mute = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Settings')
      const hits: Phaser.GameObjects.Rectangle[] = []
      const walk = (obj: any): void => {
        if (obj.type === 'Rectangle' && obj.input) hits.push(obj)
        if (obj.list) for (const child of obj.list) walk(child)
      }
      for (const obj of scene.children.list) walk(obj)
      return hits
        .map((r) => {
          const m = r.getWorldTransformMatrix()
          return { x: m.tx, y: m.ty }
        })
        .sort((a, b) => a.x - b.x)[0]
    })
    await game.click(mute.x, mute.y)
    await game.page.waitForTimeout(500)
    assert.deepEqual(await readFrames(), ['icon-sound-off', 'icon-sound-on'], 'muting should swap the frame')

    await game.page.close()
  })

  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const at = `${size.width}x${size.height}`

    it(`draws the board's HUD without overlaps at ${at}`, async () => {
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await startMatch(game)
      await waitForSettled(game.page)
      await game.page.waitForTimeout(500)
      await assertLaidOut(game, `${at} Game`)

      // The two consumables were the last glyphs in the UI (`U+21A9`, `U+1F4A5`), and unlike every
      // other icon they sit INSIDE a label, beside the price they cost. They are frames now, drawn
      // next to the text rather than typed into it.
      const marks = await game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Game')
        const found: string[] = []
        const walk = (obj: any): void => {
          if (obj.type === 'Image' && obj.texture?.key === 'game') found.push(obj.frame.name)
          if (obj.list) for (const child of obj.list) walk(child)
        }
        for (const obj of scene.children.list) walk(obj)
        return found
      })
      assert.ok(marks.includes('icon-retake'), `${at}: the retake button should wear a drawn mark`)
      assert.ok(marks.includes('icon-power'), `${at}: the power shot button should wear a drawn mark`)

      await game.page.close()
    })

    it(`draws the shop without overlaps at ${at}`, async () => {
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('Shop', {}))
      await game.waitForScene('Shop')
      await game.page.waitForTimeout(700)
      await assertLaidOut(game, `${at} Shop`)
      await game.page.close()
    })
  }
})
