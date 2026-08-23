import test from 'node:test'
import assert from 'node:assert/strict'
import { launch, open, startMatch, DEFAULT_SAVE, type GamePage, type Harness } from './harness'

/**
 * The guided tour (`scenes/Coach.ts`), as a new player meets it.
 *
 * `tests/gameplay/tour.test.ts` owns the rule about which chapters a save has seen, and can do it in
 * plain node. What only a running page can answer is the half that is geometry and wiring, and every
 * bit of it is the kind of thing that looks fine until somebody holds the phone sideways:
 *
 * - it opens ITSELF on a save that has never seen it, over a PAUSED menu that is still drawn;
 * - the card never lands on the spotlight it is explaining — the failure this file exists for;
 * - walking to the end files the chapter, and a reload does not offer it again;
 * - Skip files it too, because a tour nobody wanted must not come back every launch;
 * - the match chapter opens over a board and rings the board itself, which is the one step whose
 *   rectangle is a world-space conversion and can therefore be silently wrong.
 *
 * Every save seeded here spells `tour` out. `DEFAULT_SAVE` marks both chapters seen precisely so the
 * rest of this directory is testing rather than touring.
 */
let harness: Harness

test.before(async () => {
  harness = await launch()
})

test.after(async () => {
  await harness.close()
})

const VIEWPORTS = [
  { name: 'portrait phone', width: 390, height: 844 },
  // The SHORT portrait phone, at 1.77:1 rather than the usual 2.2:1. A square board leaves it a
  // 152px band instead of 235, which is where the HUD it rings gets squeezed against the bottom
  // edge — and a ring around a control flush with the edge is a ring with its bottom cut off.
  { name: 'short phone', width: 375, height: 664 },
  { name: 'landscape phone', width: 844, height: 390 },
  { name: 'desktop', width: 1280, height: 720 },
]

const FRESH = { ...DEFAULT_SAVE, tour: [] as string[] }

interface CoachState {
  step: number
  total: number
  title: string
  body: string
  card: { x: number; y: number; width: number; height: number }
  hole: { x: number; y: number; width: number; height: number } | null
  next: { x: number; y: number; width: number; height: number }
  skip: { x: number; y: number; width: number; height: number }
  nextLabel: string
  handVisible: boolean
}

const STATE = `(() => {
  const coach = window.__game.scene.getScene('Coach')
  return {
    step: coach.index + 1,
    total: coach.steps.length,
    title: coach.title.text,
    body: coach.body.text,
    card: coach.cardRect,
    hole: coach.holeRect,
    next: { x: coach.nextButton.container.x, y: coach.nextButton.container.y, width: coach.nextButton.width, height: coach.nextButton.height },
    skip: { x: coach.skipButton.container.x, y: coach.skipButton.container.y, width: coach.skipButton.width, height: coach.skipButton.height },
    nextLabel: coach.nextButton.text,
    handVisible: coach.hand.visible,
  }
})()`

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function read(game: GamePage): Promise<CoachState> {
  return game.page.evaluate(STATE) as Promise<CoachState>
}

test('a save that has never seen it gets the tour, over a paused menu', async () => {
  const game = await open(harness, { width: 390, height: 844, save: FRESH, expectScene: 'Coach' })
  await game.page.waitForTimeout(400)

  const menu = (await game.page.evaluate(`(() => {
    const scene = window.__game.scene.getScene('MainMenu')
    return { active: scene.scene.isActive(), visible: scene.scene.isVisible() }
  })()`)) as { active: boolean; visible: boolean }
  // Paused, not stopped: the tour dims the menu it is describing, so the menu has to still be drawn.
  assert.equal(menu.active, false, 'the menu is still running under the tour')
  assert.equal(menu.visible, true, 'the menu was stopped rather than paused — the tour has nothing to point at')

  const state = await read(game)
  assert.equal(state.step, 1)
  assert.ok(state.total >= 4, `only ${state.total} steps — the menu tour has gone empty`)
  assert.ok(state.title.length > 0 && state.body.length > 0, 'the tour opened with no words in it')

  await game.page.close()
})

/**
 * Walks a chapter to its last step, checking the card against the spotlight and the buttons against
 * the card at every one of them. Returns how many steps actually had a spotlight, which is the
 * caller's negative control: every assertion in here passes trivially on a tour that rings nothing.
 */
async function walk(game: GamePage, viewport: { name: string; width: number; height: number }): Promise<number> {
  let spotlights = 0
  for (let guard = 0; guard < 12; guard += 1) {
    const state = await read(game)
    assert.ok(state.card.width > 0 && state.card.height > 0, `${viewport.name}: the card was never sized`)
    // On screen, all four edges of it.
    assert.ok(state.card.x >= -0.5 && state.card.y >= -0.5, `${viewport.name} step ${state.step}: the card starts off screen`)
    assert.ok(state.card.x + state.card.width <= viewport.width + 0.5, `${viewport.name} step ${state.step}: the card runs off the right edge`)
    assert.ok(state.card.y + state.card.height <= viewport.height + 0.5, `${viewport.name} step ${state.step}: the card runs off the bottom edge`)

    // The answers belong INSIDE their own plate, which is not the same assertion as the card being
    // on screen: this kit's `compact` button is a fixed 168 units whatever it says, so two of them
    // plus the padding are wider than `CARD_MAX_WIDTH` and both hung over the edges of the card at
    // every viewport until the card was sized around them. Found in a screenshot; kept here.
    for (const [name, button] of [
      ['Next', state.next],
      ['Skip', state.skip],
    ] as const) {
      const box = { x: button.x - button.width / 2, y: button.y - button.height / 2, width: button.width, height: button.height }
      assert.ok(
        box.x >= state.card.x - 0.5 && box.x + box.width <= state.card.x + state.card.width + 0.5,
        `${viewport.name} step ${state.step}: ${name} ${JSON.stringify(box)} hangs off the card ${JSON.stringify(state.card)}`,
      )
      assert.ok(
        box.y >= state.card.y - 0.5 && box.y + box.height <= state.card.y + state.card.height + 0.5,
        `${viewport.name} step ${state.step}: ${name} sits outside the card vertically`,
      )
    }

    if (state.hole) {
      spotlights += 1
      assert.equal(state.handVisible, true, `${viewport.name} step ${state.step}: a spotlight with no hand in it`)
      // The ring is clamped into the viewport (`Coach`'s `clampRect`), so this can only fail if the
      // clamp is removed — worth guarding, because the symptom is a spotlight that reads as a broken
      // box rather than as a ring around something.
      const hole = state.hole
      assert.ok(
        hole.x >= -0.5 && hole.y >= -0.5 && hole.x + hole.width <= viewport.width + 0.5 && hole.y + hole.height <= viewport.height + 0.5,
        `${viewport.name} step ${state.step}: the spotlight ${JSON.stringify(hole)} leaves the ${viewport.width}x${viewport.height} screen`,
      )
      assert.ok(
        !overlaps(state.card, state.hole),
        `${viewport.name} step ${state.step} ("${state.title}"): the card ${JSON.stringify(state.card)} covers the spotlight ${JSON.stringify(state.hole)}`,
      )
    }

    if (state.step >= state.total) break
    await game.click(state.next.x, state.next.y)
    await game.page.waitForTimeout(180)
  }
  return spotlights
}

test('the card never lands on the spotlight, at any viewport, on any step', async () => {
  // THE regression this file exists for. A card placed in "the bigger of the two vertical bands" is
  // right on a phone held upright and wrong in landscape, where a ringed button across the middle
  // leaves no band tall enough for it — so the explanation ends up drawn over the thing it is
  // explaining.
  for (const viewport of VIEWPORTS) {
    const game = await open(harness, { width: viewport.width, height: viewport.height, save: FRESH, expectScene: 'Coach' })
    await game.page.waitForTimeout(400)
    const spotlights = await walk(game, viewport)
    assert.ok(spotlights >= 3, `${viewport.name}: only ${spotlights} steps had a spotlight`)
    await game.page.close()
  }
})

test('and it does not on a board either, where the spotlights are a different shape', async () => {
  // The match chapter has to be walked separately, and it caught its own bug: ringing the whole
  // BOARD leaves a portrait phone ~230 units of band against a taller card, so the coach's
  // last-resort placement drew the card across the top rank. The step rings one of the player's own
  // discs now (`Game.tourSteps`), which is both smaller and the thing the sentence is about.
  for (const viewport of VIEWPORTS) {
    const game = await open(harness, { width: viewport.width, height: viewport.height, save: { ...DEFAULT_SAVE, tour: ['menu'] } })
    await startMatch(game)
    await game.waitForScene('Coach')
    await game.page.waitForTimeout(400)
    const spotlights = await walk(game, viewport)
    assert.ok(spotlights >= 3, `${viewport.name}: only ${spotlights} steps of the match tour had a spotlight`)
    await game.page.close()
  }
})

test('walking to the end files the chapter, and a reload does not offer it again', async () => {
  const game = await open(harness, { width: 390, height: 844, save: FRESH, expectScene: 'Coach' })
  await game.page.waitForTimeout(400)

  for (let guard = 0; guard < 12; guard += 1) {
    const state = await read(game)
    if (state.step >= state.total) {
      // The last card offers a different word: "Next" on the last step is a promise of a step that
      // does not exist.
      assert.equal(state.nextLabel, 'Got it', 'the last step still says Next')
      await game.click(state.next.x, state.next.y)
      break
    }
    assert.equal(state.nextLabel, 'Next', `step ${state.step} of ${state.total} does not offer another one`)
    await game.click(state.next.x, state.next.y)
    await game.page.waitForTimeout(180)
  }

  await game.page.waitForTimeout(400)
  const back = (await game.page.evaluate(`(() => ({
    coach: Boolean(window.__game.scene.getScene('Coach').scene.isActive()),
    menu: window.__game.scene.getScene('MainMenu').scene.isActive(),
  }))()`)) as { coach: boolean; menu: boolean }
  assert.equal(back.coach, false, 'the last step left the tour open')
  assert.equal(back.menu, true, 'the tour ended without handing the menu back')

  // The store debounces its writes, so the chapter reaches `localStorage` a moment after it reaches
  // the state. Waited for rather than slept through.
  await game.page.waitForFunction(() => (JSON.parse(window.localStorage.getItem('SAVE_DATA') ?? '{}').tour ?? []).includes('menu'), undefined, {
    timeout: 6000,
  })

  await game.page.reload({ waitUntil: 'load' })
  await game.page.waitForFunction(() => Boolean(window.__game?.scene.getScene('MainMenu')?.scene.isActive()))
  await game.page.waitForTimeout(600)
  const again = (await game.page.evaluate(`(() => Boolean(window.__game.scene.getScene('Coach').scene.isActive()))()`)) as boolean
  assert.equal(again, false, 'the tour opened again on a save that had already seen it')

  await game.page.close()
})

test('Skip ends it and files it too', async () => {
  const game = await open(harness, { width: 390, height: 844, save: FRESH, expectScene: 'Coach' })
  await game.page.waitForTimeout(400)

  const state = await read(game)
  await game.click(state.skip.x, state.skip.y)
  await game.page.waitForTimeout(400)

  const after = (await game.page.evaluate(`(() => ({
    coach: Boolean(window.__game.scene.getScene('Coach').scene.isActive()),
    menu: window.__game.scene.getScene('MainMenu').scene.isActive(),
  }))()`)) as { coach: boolean; menu: boolean }
  assert.equal(after.coach, false, 'Skip left the tour open')
  assert.equal(after.menu, true, 'Skip stopped the tour without resuming the menu')

  // A tour the player declined must not come back on the next launch — that is the whole reason Skip
  // files the chapter rather than merely closing.
  await game.page.waitForFunction(() => (JSON.parse(window.localStorage.getItem('SAVE_DATA') ?? '{}').tour ?? []).includes('menu'), undefined, {
    timeout: 6000,
  })

  await game.page.close()
})

test('the match chapter opens over a board, and rings a disc the player owns', async () => {
  // The menu half already seen, so the fixture can reach a board at all.
  const game = await open(harness, { width: 390, height: 844, save: { ...DEFAULT_SAVE, tour: ['menu'] } })
  await startMatch(game)
  await game.waitForScene('Coach')
  await game.page.waitForTimeout(400)

  const state = await read(game)
  assert.ok(state.total >= 4, `only ${state.total} steps in the match tour`)

  // Asserted against the disc's own on-screen geometry rather than a hardcoded rectangle, because
  // that conversion (board space, under a zoomed camera) is the part of this that can silently be
  // wrong — and wrong here means a ring around a patch of empty board.
  const measured = (await game.page.evaluate(`(() => {
    const scene = window.__game.scene.getScene('Game')
    const camera = scene.cameras.main
    const own = scene.sim.discs.filter((disc) => disc.alive && disc.side === scene.humanSide())
    const disc = own[Math.floor(own.length / 2)]
    return {
      disc: {
        x: (disc.x - disc.r - camera.worldView.x) * camera.zoom,
        y: (disc.y - disc.r - camera.worldView.y) * camera.zoom,
        size: disc.r * 2 * camera.zoom,
      },
      board: scene.board.metrics.boardW * camera.zoom,
    }
  })()`)) as { disc: { x: number; y: number; size: number }; board: number }

  assert.ok(state.hole, 'the match tour opened with no spotlight at all')
  const hole = state.hole!
  const disc = measured.disc
  // A containment check rather than an equality one: the ring stands a few units off whatever it is
  // around. What must NOT be true is that it is around something else — hence the upper bound.
  assert.ok(hole.x < disc.x && hole.y < disc.y, 'the hole does not enclose the disc')
  assert.ok(hole.x + hole.width > disc.x + disc.size, 'the hole is narrower than the disc')
  assert.ok(hole.width - disc.size < 40, `the hole is ${Math.round(hole.width - disc.size)} units wider than the disc — it is ringing something else`)
  assert.ok(hole.width < measured.board / 3, 'the spotlight is the whole board again, which no card fits beside in portrait')

  // Exactly ONE "whose shot it is" step survives: the capsule and the panel's opponent block say the
  // same thing in the two HUD shapes, and both are published so neither layout needs a branch.
  const titles = (await game.page.evaluate(`(() => window.__game.scene.getScene('Coach').steps.map((step) => step.title))()`)) as string[]
  const turns = titles.filter((title) => title === 'coachTurnTitle').length
  assert.equal(turns, 1, `the turn is explained ${turns} times`)

  await game.page.close()
})
