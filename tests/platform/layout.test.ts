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
 *
 * **A button is measured by its PLATE, which has to be found the long way round.** `gameButton`
 * draws its face with a `Graphics` (no `getBounds`, so it can never be emitted from the display
 * list) and takes its taps through a zero-alpha `Rectangle` (skipped below as an invisible hit
 * proxy), so walking the tree finds only the LABEL — and a button's label reaches nowhere near its
 * own left and right thirds. That blind spot is not theoretical: the menu mascot was drawn through
 * the Daily button on three portrait shapes while every case in this file was green. So the scenes'
 * own fields are scanned first for anything shaped like a `GameButton`, and its container is then
 * emitted at the button's real width and height instead of being descended into.
 */
function drawnBoxes(game: GamePage): Promise<{ vw: number; vh: number; out: DrawnBox[] }> {
  return game.page.evaluate(() => {
    const phaser = window.__game!
    const vw = phaser.scale.width
    const vh = phaser.scale.height
    const out: DrawnBox[] = []

    // Fields only, never the display list: a `GameButton` is a plain object that OWNS a container,
    // so it exists nowhere Phaser can be asked about it.
    const isGameObject = (v: any): boolean => Boolean(v) && typeof v === 'object' && typeof v.setActive === 'function' && 'type' in v
    const isButton = (v: any): boolean =>
      Boolean(v) && typeof v === 'object' && !isGameObject(v) && v.container && v.hitArea &&
      typeof v.width === 'number' && typeof v.height === 'number' && typeof v.layout === 'function'
    const ENGINE = new Set([
      'sys', 'game', 'anims', 'cache', 'registry', 'sound', 'textures', 'events', 'cameras', 'scene',
      'add', 'make', 'scale', 'plugins', 'input', 'load', 'tweens', 'time', 'data', 'children',
      'physics', 'lights', 'renderer',
    ])
    const plates = new Map<unknown, { w: number; h: number; name: string }>()
    const seen = new Set<unknown>()
    const scan = (obj: any, depth: number, path: string): void => {
      if (!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return
      seen.add(obj)
      let keys: string[] = []
      try { keys = Object.keys(obj) } catch { return }
      for (const key of keys) {
        if (ENGINE.has(key)) continue
        let value: any
        try { value = obj[key] } catch { continue }
        if (!value || typeof value !== 'object') continue
        const here = `${path}.${key}`
        if (isButton(value)) { plates.set(value.container, { w: value.width, h: value.height, name: key }); continue }
        if (Array.isArray(value)) {
          value.forEach((entry: any, index: number) => {
            if (isButton(entry)) plates.set(entry.container, { w: entry.width, h: entry.height, name: `${key}[${index}]` })
            else if (!isGameObject(entry)) scan(entry, depth + 1, `${here}[${index}]`)
          })
          continue
        }
        if (isGameObject(value)) continue
        scan(value, depth + 1, here)
      }
    }
    for (const scene of phaser.scene.getScenes(true)) scan(scene, 0, scene.scene.key)

    for (const scene of phaser.scene.getScenes(true)) {
      for (const camera of scene.cameras.cameras) {
        const push = (label: string, wx: number, wy: number, ww: number, wh: number): void => {
          const view = camera.worldView
          const zoom = camera.zoom
          const x = camera.x + (wx - view.x) * zoom
          const y = camera.y + (wy - view.y) * zoom
          const x0 = Math.max(x, camera.x)
          const y0 = Math.max(y, camera.y)
          const x1 = Math.min(x + ww * zoom, camera.x + camera.width)
          const y1 = Math.min(y + wh * zoom, camera.y + camera.height)
          if (x1 <= x0 || y1 <= y0) return
          // A full-bleed backdrop is not furniture and covering everything is its job.
          if ((x1 - x0) * (y1 - y0) >= vw * vh * 0.85) return
          out.push({
            scene: scene.scene.key,
            label,
            x: x0,
            y: y0,
            w: x1 - x0,
            h: y1 - y0,
            off: x < -1 || y < -1 || x + ww * zoom > vw + 1 || y + wh * zoom > vh + 1,
          })
        }
        const emit = (obj: any): void => {
          if (typeof obj.getBounds !== 'function') return
          const b = obj.getBounds()
          if (b.width <= 0 || b.height <= 0) return
          push(obj.type === 'Text' ? JSON.stringify(String(obj.text).slice(0, 22)) : (obj.name || obj.type), b.x, b.y, b.width, b.height)
        }
        const walk = (obj: any): void => {
          if (!obj.visible || (obj.alpha ?? 1) < 0.05) return
          if ((obj.depth ?? 0) <= -1000) return
          if (obj.type === 'Zone') return
          // The plate, at its real size, standing in for everything the button draws — see the
          // header. Its own label and icon are inside it and are not emitted separately.
          const plate = plates.get(obj)
          if (plate) {
            const m = obj.getWorldTransformMatrix()
            push(plate.name, m.tx - plate.w / 2, m.ty - plate.h / 2, plate.w, plate.h)
            return
          }
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
async function holdAim(game: GamePage, sceneKey: 'Game' | 'Daily' | 'Tutorial' = 'Game'): Promise<void> {
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

      for (const screen of ['MainMenu', 'Modes', 'Shop', 'HowToPlay'] as const) {
        if (screen === 'Modes') {
          const menu = await buttonAt(game.page, 'MainMenu', 'newMatchButton')
          await game.click(menu.x, menu.y)
          await game.waitForScene('Modes')
        }
        if (screen === 'Shop') {
          await game.page.evaluate(() => window.__game!.scene.getScene('Modes').scene.start('Shop', {}))
          await game.waitForScene('Shop')
        }
        // The rules page paints the same plate as the other two, from the same helper. It is here
        // because the three that shipped the 4000x4000 bug were three copies of one line, and a
        // fourth full-page screen is a fourth chance to write it again.
        if (screen === 'HowToPlay') {
          await game.page.evaluate(() => window.__game!.scene.getScene('Shop').scene.start('HowToPlay', {}))
          await game.waitForScene('HowToPlay')
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

  for (const size of [{ width: 320, height: 700 }, { width: 360, height: 640 }, { width: 375, height: 664 }, { width: 390, height: 844 }, { width: 740, height: 360 }, { width: 844, height: 390 }, { width: 604, height: 455 }]) {
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

  /**
   * **The mascot against the button column, and it needs its own check because `assertLaidOut`
   * cannot see a button's FACE.**
   *
   * `gameButton` draws its plate with a `Graphics`, which has no `getBounds` and is therefore never
   * emitted, and its hit proxy is a zero-alpha `Rectangle`, which this file skips on purpose. The
   * only box a button contributes to the crossing test is its LABEL — so anything overlapping a
   * button's left third, where no label reaches, passes. That is exactly where the mascot stood: it
   * crossed the Daily button by 26px at 320x568, 23px at 360x640 and 25px at 375x664, on every build
   * this file has ever checked.
   *
   * Short portrait shapes only, because that is what makes it happen: the character is sized off the
   * viewport's SHORTER side, so it is the same height on a 568-tall phone as on an 844-tall one while
   * the band under the column is 100px smaller. 360x640 is here and nowhere else in this file for the
   * same reason 375x664 was added to the board's own case.
   */
  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 375, height: 664 }, { width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const at = `${size.width}x${size.height}`

    it(`keeps the mascot clear of every menu button at ${at}`, async () => {
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await game.page.waitForTimeout(700)

      const seen = await game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('MainMenu') as unknown as Record<string, any>
        const b = scene.mascot.image.getBounds()
        const buttons: { name: string; x: number; y: number; w: number; h: number }[] = []
        for (const name of ['continueButton', 'newMatchButton', 'tutorialButton', 'dailyButton']) {
          const button = scene[name]
          if (!button) continue
          buttons.push({ name, x: button.container.x - button.width / 2, y: button.container.y - button.height / 2, w: button.width, h: button.height })
        }
        return { visible: scene.mascot.image.visible as boolean, mascot: { x: b.x, y: b.y, w: b.width, h: b.height }, buttons }
      })

      // A hidden character is a legal answer on a screen with no room for one, and there would then
      // be nothing to measure — but no viewport this game targets should reach it, so say so.
      assert.ok(seen.visible, `${at}: the mascot is hidden, which no targeted viewport should need`)
      assert.ok(seen.buttons.length > 0, `${at}: no menu buttons found to measure against`)

      const m = seen.mascot
      const crossed = seen.buttons
        .map((b) => ({
          b,
          ox: Math.min(m.x + m.w, b.x + b.w) - Math.max(m.x, b.x),
          oy: Math.min(m.y + m.h, b.y + b.h) - Math.max(m.y, b.y),
        }))
        .filter((hit) => hit.ox > 0 && hit.oy > 0)
        .map((hit) => `${hit.b.name} by ${hit.ox.toFixed(1)}x${hit.oy.toFixed(1)}px`)

      assert.deepEqual(crossed, [], `${at}: the mascot crosses ${crossed.join(', ')}`)

      await game.page.close()
    })
  }

  for (const size of [{ width: 320, height: 700 }, { width: 360, height: 640 }, { width: 375, height: 664 }, { width: 390, height: 844 }, { width: 740, height: 360 }, { width: 844, height: 390 }, { width: 604, height: 455 }]) {
    const at = `${size.width}x${size.height}`

    it(`draws the tutorial and the rules page without overlaps at ${at}`, async () => {
      /**
       * Both screens hang their content off `computeHudBands`/`contentColumn` rather than off a
       * fixed number, and both were written after the three lists in this game were caught
       * overrunning what sits below them in landscape. The tutorial is the sharper case: its coach
       * block lives in the trailing band, which in landscape is the full-height strip the top bar's
       * gear also crosses.
       */
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await game.page.waitForTimeout(700)

      const tutorial = await buttonAt(game.page, 'MainMenu', 'tutorialButton')
      await game.click(tutorial.x, tutorial.y)
      await game.waitForScene('Tutorial')
      await game.page.waitForTimeout(700)
      await assertLaidOut(game, `${at} Tutorial`)

      /**
       * And in portrait the coach block stands BELOW the board, not on it.
       *
       * `assertLaidOut` cannot see this: the board is a baked world object with no `input` and no
       * text, so it is not in the display list this file walks. The block was pushed up over the
       * board's bottom rank on any phone whose band is shorter than the block wants — 152px against
       * ~170 at 375x664 — and the report was a screenshot of the lesson title drawn across the last
       * two rows of squares.
       */
      const stack = await game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Tutorial') as unknown as {
          bands: { orientation: string; trailing: { y: number } }
          titleText: { getBounds(): { y: number } }
        }
        return { orientation: scene.bands.orientation, boardBottom: scene.bands.trailing.y, top: scene.titleText.getBounds().y }
      })
      if (stack.orientation === 'portrait') {
        assert.ok(
          stack.top >= stack.boardBottom - 1,
          `${at}: the lesson block starts at ${stack.top.toFixed(1)}, above the board's bottom edge at ${stack.boardBottom.toFixed(1)}`,
        )
      }

      // The hint is the longest copy either screen carries, and it is the state the block is at its
      // tallest in — a layout checked only on the brief is a layout checked on its easy case. The
      // retry prompt is part of it: a failed attempt now waits for a tap and says so, which is one
      // more clause on the line that was already the longest.
      await game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Tutorial') as unknown as { say(line: string): void; lesson: { hintKey: string } }
        scene.say('A disc is out the moment its centre crosses the edge, and a miss at full power runs clean across the board. Tap anywhere to try again.')
      })
      await game.page.waitForTimeout(300)
      await assertLaidOut(game, `${at} Tutorial with a long hint`)

      await game.page.evaluate(() => window.__game!.scene.getScene('Tutorial').scene.start('HowToPlay', {}))
      await game.waitForScene('HowToPlay')
      await game.page.waitForTimeout(700)
      await assertLaidOut(game, `${at} HowToPlay`)

      await game.page.close()
    })
  }

  it('keeps the TUTORIAL covered while aiming too', async () => {
    // A third copy of the aim-camera background arithmetic — `Game`'s, `Daily`'s, and now this one.
    // Same reason the daily has this test: the copy must not be allowed to drift unnoticed.
    const game = await open(harness, { width: 1400, height: 700, save: DEFAULT_SAVE })
    const tutorial = await buttonAt(game.page, 'MainMenu', 'tutorialButton')
    await game.click(tutorial.x, tutorial.y)
    await game.waitForScene('Tutorial')
    await game.page.waitForTimeout(900)
    await holdAim(game, 'Tutorial')

    const holes = await clearColourPixels(game)
    await game.page.mouse.up()
    assert.equal(holes.count, 0, `aiming in the tutorial leaves ${holes.count}px of bare canvas ${holes.box}`)

    await game.page.close()
  })

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

  /**
   * **375x664 is the SHORT portrait phone, and it is here because of a real defect.**
   *
   * Every portrait viewport this file checked was tall — 390x844 and 320x700 are both about 2.2:1 —
   * and a square board leaves the trailing band 235px on those. At 1.77:1 it leaves 152, against a
   * HUD block that wants ~153: the two priced buttons hung a pixel off the bottom of the screen and
   * the guided tour's ring around one of them was cut in half. Reported from a phone with a
   * screenshot, which is the third time an aspect ratio nobody enumerated has been the bug.
   */
  for (const size of [{ width: 360, height: 640 }, { width: 375, height: 664 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 604, height: 455 }, { width: 1024, height: 768 }]) {
    const at = `${size.width}x${size.height}`

    it(`draws the board's HUD without overlaps at ${at}`, async () => {
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      await startMatch(game)
      await waitForSettled(game.page)
      await game.page.waitForTimeout(500)
      await assertLaidOut(game, `${at} Game`)

      /**
       * And the two priced buttons keep real space between them and the screen edge.
       *
       * "Inside the viewport" is not enough here, which is exactly how the short-phone defect got
       * past this file: the buttons overhung the bottom by 0.9px at 375x664, under `assertLaidOut`'s
       * 1px tolerance, while the guided tour's ring around one of them — which stands 8px off
       * whatever it rings — was visibly cut in half. A control flush with the edge is also a control
       * a thumb has to aim at the bezel to press.
       */
      const edges = await game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Game') as unknown as {
          retakeButton: { container: Phaser.GameObjects.Container }
          powerButton: { container: Phaser.GameObjects.Container }
        }
        const of = (name: 'retakeButton' | 'powerButton') => {
          const b = scene[name].container.getBounds()
          return { name, bottom: b.y + b.height, top: b.y }
        }
        return { buttons: [of('retakeButton'), of('powerButton')], height: window.__game!.scale.height }
      })
      for (const button of edges.buttons) {
        const clearance = edges.height - button.bottom
        assert.ok(clearance >= 6, `${at}: ${button.name} ends ${clearance.toFixed(1)}px from the bottom of the screen`)
      }

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

    /**
     * The daily, which nothing in this file covered — and it had the overlap to show for it.
     *
     * Its hint button is placed under the status text, measured from that text's HEIGHT, and
     * `bindLayout`'s first pass runs from `create()` while the text is still empty. The button was
     * therefore one line too high and drawn across "Clear the board in one shot" on every phone that
     * never resizes after boot. Reported with a screenshot.
     */
    it(`draws the daily puzzle without overlaps at ${at}`, async () => {
      const game = await open(harness, { ...size, save: DEFAULT_SAVE })
      const daily = await buttonAt(game.page, 'MainMenu', 'dailyButton')
      await game.click(daily.x, daily.y)
      await game.waitForScene('Daily')
      await game.page.waitForTimeout(900)
      await assertLaidOut(game, `${at} Daily`)

      // The hint is only offered three misses in, and it is the object the overlap was made of, so
      // it has to be on screen for this case to be about anything.
      await game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Daily') as unknown as { attempts: number; refreshHintButton(): void }
        scene.attempts = 3
        scene.refreshHintButton()
      })
      await game.page.waitForTimeout(200)
      await assertLaidOut(game, `${at} Daily with its hint offered`)

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
