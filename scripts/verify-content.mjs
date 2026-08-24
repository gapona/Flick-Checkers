/**
 * The cast, checked as data.
 *
 * Cheap — no solver, no browser, no Phaser — so it IS in `npm test`, unlike `verify:bot`. What it
 * guards is the class of defect a content file invites: a character that ships half-mute, a line set
 * that repeats itself, a voice profile with no syllables behind it, a ladder whose numbers do not go
 * in the direction the order claims. None of those crash anything; all of them are invisible until a
 * player meets that one character.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FREE_OPPONENTS, isOpponentUnlocked, OPPONENTS, SPEECH_TRIGGERS } from '../src/game/opponents.ts'
import { LOUD_COOLDOWN_SHOTS, LOUD_TRIGGERS, speechDirector, SPEECH_COOLDOWN_SHOTS } from '../src/game/speech.ts'
import { AIM_SPREAD, generateCandidates, POWER_LEVELS } from '../src/bot/search.ts'
import { createMascotChat, FORGET_MS, RETURN_LINE, SULK_LINES, SULK_MS, TIERS } from '../src/game/mascotChat.ts'
import { BRANCH_PROFILES, buildFormation, FORMATION_ORDER } from '../src/game/formations.ts'
import { getRuleSet } from '../src/game/rules.ts'
import { createBoardMetrics } from '../src/board/layout.ts'
import { createSimConfig, createState, liveDiscs, CELL } from '../src/sim/types.ts'
import { firstContact } from '../src/sim/aim.ts'
import { reachOf } from '../src/sim/aim.ts'
import {
  MIN_SYLLABLES,
  syllableStepGlyphs,
  allVoiceMarkers,
  VOICE_PROFILES,
  CADENCES,
  isCadenceId,
  isVowel,
  isStressed,
  hashString,
  MOODS,
  syllableShape,
  terminalOf,
} from '../src/audio/voiceRegistry.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let checks = 0
function ok(label, condition) {
  assert.ok(condition, label)
  checks++
  console.log(`  ok - ${label}`)
}

console.log('game/opponents.ts -- the cast')

ok('every id is unique, and none is empty', new Set(OPPONENTS.map((o) => o.id)).size === OPPONENTS.length && OPPONENTS.every((o) => o.id.length > 0))

/**
 * **No more than two characters may share one (voice, cadence) pair.**
 *
 * Sharing a TIMBRE is the design — eight profiles across eighteen characters, separated at runtime
 * by cadence — but two characters on the same timbre AND the same cadence are the same voice, and a
 * third makes a set of triplets. This is not hypothetical: the schoolteacher was written as
 * `airy` + `measured`, which is what the scout and the sniper already are, and nothing anywhere
 * would have said so.
 */
{
  const pairs = new Map()
  for (const one of OPPONENTS) {
    const key = `${one.voice}+${one.cadence}`
    pairs.set(key, [...(pairs.get(key) ?? []), one.id])
  }
  const crowded = [...pairs.entries()].filter(([, ids]) => ids.length > 2)
  // Named in the label rather than passed to `ok`, which prints only the label: a failure that says
  // WHICH three characters sound alike is a failure somebody can act on.
  const detail = crowded.map(([key, ids]) => `${key}: ${ids.join(', ')}`).join('; ')
  ok(
    crowded.length === 0
      ? `no voice and cadence pair carries more than two characters (${pairs.size} pairs over ${OPPONENTS.length})`
      : `three or more characters share one voice — ${detail}`,
    crowded.length === 0,
  )
}

ok(
  'every character names a voice the sprite actually has',
  OPPONENTS.every((o) => VOICE_PROFILES.includes(o.voice)),
)

for (const one of OPPONENTS) {
  for (const trigger of SPEECH_TRIGGERS) {
    const lines = one.lines[trigger]
    assert.ok(Array.isArray(lines) && lines.length >= 2, `${one.id} needs at least two ${trigger} lines`)
    assert.equal(new Set(lines).size, lines.length, `${one.id}'s ${trigger} lines repeat`)
    assert.ok(
      lines.every((line) => line.trim().length > 0),
      `${one.id} has a blank ${trigger} line`,
    )
  }
}
checks++
console.log(`  ok - all ${OPPONENTS.length} characters carry ${SPEECH_TRIGGERS.length} triggers, 2+ distinct lines each`)

/**
 * **No bark may be long enough to wrap onto a THIRD line**, because the HUD reserves two.
 *
 * `Game`'s speech row is a fixed height (`SPEECH_ROW_HEIGHT`, derived from the font to hold two
 * lines) with the two priced buttons directly under it — so a line that wraps to three is drawn
 * over controls, on every phone at once. Nothing said so: the row is reserved rather than measured,
 * which is right (the buttons must not jump when a character speaks) and means the overflow is
 * silent.
 *
 * **The budget is in CHARACTERS and that is viewport-independent, which is the non-obvious part.**
 * The wrap width and the font size both come off `uiScale`, so the number of characters that fit on
 * a line is the same on a 320px phone as on a 430px one — measured in a real browser at 320x568,
 * 360x640 and 390x844, all three turn the third line on at the same length. Two lines hold up to
 * **58** characters; **63** is three everywhere. The limit here is 56, below the measured cliff
 * rather than at it, and the longest line the cast currently carries is 47.
 *
 * A character count is a proxy for a width and cannot be exact — a line of capitals and one of
 * lowercase differ — but 56 is far enough under the cliff to absorb that, and the alternative
 * (rendering every line in a headless browser) does not belong in `npm test`.
 */
{
  const LINE_BUDGET = 56
  const spoken = OPPONENTS.flatMap((one) => SPEECH_TRIGGERS.flatMap((trigger) => one.lines[trigger].map((line) => ({ id: one.id, trigger, line }))))
  const over = spoken.filter((entry) => entry.line.length > LINE_BUDGET)
  const longest = spoken.reduce((worst, entry) => (entry.line.length > worst.line.length ? entry : worst), spoken[0])
  ok(
    over.length === 0
      ? `every one of the ${spoken.length} spoken lines fits the HUD's two-line row (longest ${longest.line.length}/${LINE_BUDGET}, ${longest.id}'s ${longest.trigger})`
      : `${over.length} spoken lines would wrap onto a third line and cover the consumable buttons — ${over.map((e) => `${e.id}/${e.trigger} (${e.line.length})`).join(', ')}`,
    over.length === 0,
  )
}

// The ladder is fixed by character rather than by measurement (see the file's own note), but the
// numbers still have to point the same way the order does — a character that considers FEWER shots
// than the one before it while claiming to be harder is a row somebody edited without reading.
// Budget alone, not the shake: `sniper` deliberately looks at less than `gunner` and beats it on
// aim, which is the whole trade that makes it a different character rather than a stronger one.
const budgets = OPPONENTS.map((o) => o.persona.candidates)
ok(
  `the strongest considers the most shots (${Math.max(...budgets)} at the top of the ladder)`,
  budgets[budgets.length - 1] === Math.max(...budgets),
)
ok(
  `the weakest considers the fewest (${Math.min(...budgets)} at the bottom)`,
  budgets[0] === Math.min(...budgets),
)
ok(
  'the shake never rises as the ladder does',
  OPPONENTS[0].persona.angleSigma > OPPONENTS[OPPONENTS.length - 1].persona.angleSigma,
)

console.log('game/opponents.ts -- the habits actually reach the search')

/**
 * **Every quirk a character states has to CHANGE what the search looks at.**
 *
 * This section exists because two of them did not. `targeting` was a silent no-op for any character
 * whose budget was large enough to reach every enemy anyway — the sort order decided nothing, and
 * the measured distance-to-edge of a `'deepest'` character came out identical to the plain search's.
 * `aimSpread` was a no-op for any character whose budget only stretched to one angle per target,
 * because a cone of one sample is the same cone at every width. Both had confident comments on them
 * saying otherwise. A habit that does not reach the board is a lie in the content file, and the only
 * way to keep one out is to measure it here.
 *
 * Cheap enough for `npm test`: `generateCandidates` runs no solver.
 */
{
  const metrics = createBoardMetrics(8, 64)
  const config = createSimConfig(metrics, getRuleSet('classic'))
  const state = createState(buildFormation('infantry', metrics, { piecesPerSide: 8 }))

  // A board with the enemy rank spread out, so "already near an edge" and "deep in the middle" are
  // different discs and a preference between them is visible.
  const foes = liveDiscs(state, 'player')
  foes.forEach((f, i) => {
    f.x = 40 + i * 62
    f.y = 300 + (i % 2 ? 150 : -40)
  })
  foes[3].x = 18
  foes[3].y = 300
  foes[4].x = 256
  foes[4].y = 256

  const edge = (d) => Math.min(d.x, d.y, config.boardW - d.x, config.boardH - d.y)
  const shooter = liveDiscs(state, 'opponent')[3]

  // Each character is compared against ITSELF with the quirks stripped, not against a fixed
  // baseline character. A fixed one does not work: the sergeant was the obvious choice and his
  // budget only stretches to a single angle per target, so his fan is zero degrees wide and nothing
  // could ever measure as narrower than it. Comparing a row to its own unquirked twin isolates the
  // habit from the budget, which is the thing being asserted.
  const look = (one, quirks) => {
    const list = generateCandidates(state, 'opponent', one.persona, { quirks, config }).filter(
      (c) => c.discId === shooter.id,
    )
    // The zero offset is always sampled (`coneOffsets` forces the count odd), so a targeted enemy's
    // straight angle appears verbatim. An exact match, not a nearest-angle guess — a wide fan makes
    // guessing attribute candidates to the wrong disc entirely.
    const angles = new Set(list.map((c) => c.angle.toFixed(12)))
    const hit = foes.filter((f) => angles.has(Math.atan2(f.y - shooter.y, f.x - shooter.x).toFixed(12)))
    return {
      powers: [...new Set(list.map((c) => c.power))].sort((a, b) => a - b),
      meanEdge: hit.reduce((sum, f) => sum + edge(f), 0) / Math.max(1, hit.length),
      spread: Math.max(...list.map((c) => {
        const straights = hit.map((f) => Math.atan2(f.y - shooter.y, f.x - shooter.x))
        return Math.min(...straights.map((st) => Math.abs(((c.angle - st + Math.PI) % (2 * Math.PI)) - Math.PI)))
      })),
    }
  }

  for (const one of OPPONENTS) {
    const quirks = one.persona.quirks
    if (!quirks) continue
    const seen = look(one, quirks)
    const plain = look(one, undefined)

    if (quirks.powers) {
      ok(
        `${one.id} only ever considers [${quirks.powers.join(', ')}]`,
        seen.powers.length === quirks.powers.length && seen.powers.every((p) => quirks.powers.includes(p)),
      )
    }
    if (quirks.targeting === 'exposed') {
      ok(`${one.id} aims at discs nearer an edge than the plain search does`, seen.meanEdge < plain.meanEdge - 1)
    }
    if (quirks.targeting === 'deepest') {
      ok(`${one.id} aims at discs further from an edge than the plain search does`, seen.meanEdge > plain.meanEdge + 1)
    }
    if (quirks.aimSpread !== undefined && quirks.aimSpread < 1) {
      ok(`${one.id} looks through a narrower fan than the plain search`, seen.spread < plain.spread - 1e-9)
    }
    if (quirks.aimSpread !== undefined && quirks.aimSpread > 1) {
      ok(`${one.id} looks through a wider fan than the plain search`, seen.spread > plain.spread + 1e-9)
    }
  }
}

console.log('game/opponents.ts -- the unlock ladder')

ok(`the first ${FREE_OPPONENTS} are open with nothing beaten`, OPPONENTS.slice(0, FREE_OPPONENTS).every((o) => isOpponentUnlocked(o.id, [])))
ok('and nobody after them is', OPPONENTS.slice(FREE_OPPONENTS).every((o) => !isOpponentUnlocked(o.id, [])))

// The property the gate is FOR: beating one opens exactly the next one, not everything after it.
const gated = OPPONENTS[FREE_OPPONENTS]
const after = OPPONENTS[FREE_OPPONENTS + 1]
ok('beating the last free one opens exactly the next rung', isOpponentUnlocked(gated.id, [OPPONENTS[FREE_OPPONENTS - 1].id]))
ok('and not the one after that', !isOpponentUnlocked(after.id, [OPPONENTS[FREE_OPPONENTS - 1].id]))
ok('an unknown id is never unlocked', !isOpponentUnlocked('nobody', OPPONENTS.map((o) => o.id)))

console.log('game/speech.ts -- the rate limit and the rotation')

{
  const director = speechDirector(OPPONENTS[0])
  ok('the first line of a round always speaks', director.next('onOwnMiss') !== null)
  ok('and the next one is swallowed', director.next('onOwnMiss') === null)

  for (let i = 0; i < SPEECH_COOLDOWN_SHOTS; i++) director.noteShot()
  ok(`it speaks again after ${SPEECH_COOLDOWN_SHOTS} shots`, director.next('onOwnMiss') !== null)
}

{
  // The loud moments get a SHORTER cooldown, not an exemption. They used to bypass the limit
  // outright, which in a round where discs come off in twos is a character commenting on every
  // single shot — the stream-of-text failure the limit exists to prevent, arriving through the door
  // left open for it.
  ok(`a loud moment needs fewer shots than an ordinary one`, LOUD_COOLDOWN_SHOTS < SPEECH_COOLDOWN_SHOTS)

  for (const trigger of LOUD_TRIGGERS) {
    const director = speechDirector(OPPONENTS[0])
    director.next('onOwnMiss')
    ok(`${trigger} is still swallowed immediately after a line`, director.next(trigger) === null)

    for (let i = 0; i < LOUD_COOLDOWN_SHOTS; i++) director.noteShot()
    ok(`${trigger} speaks again after ${LOUD_COOLDOWN_SHOTS} shots`, director.next(trigger) !== null)
  }

  // …and an ordinary line still cannot, at the same point, which is what makes it two tiers rather
  // than one shorter cooldown for everybody.
  const quiet = speechDirector(OPPONENTS[0])
  quiet.next('onOwnMiss')
  for (let i = 0; i < LOUD_COOLDOWN_SHOTS; i++) quiet.noteShot()
  ok('an ordinary line still waits the full cooldown', quiet.next('onOwnMiss') === null)
}

{
  // Rotation, not random: with three alternatives a uniform pick repeats about a third of the time,
  // and a repeat is the one artefact having alternatives exists to prevent.
  const one = OPPONENTS[0]
  const director = speechDirector(one)
  // The cooldown is walked past between picks rather than bypassed — no trigger is exempt from it
  // any more, so a test that asked for three lines in a row would be measuring the rate limit
  // instead of the rotation and would collect nulls.
  const speak = () => {
    for (let i = 0; i < SPEECH_COOLDOWN_SHOTS; i++) director.noteShot()
    return director.next('onOwnKnockout')
  }
  const seen = []
  for (let i = 0; i < one.lines.onOwnKnockout.length; i++) seen.push(speak())
  ok('every line of a pass is a real line', seen.every((line) => line !== null))
  ok('lines rotate rather than repeat within one pass', new Set(seen).size === seen.length)
  ok('and wrap back to the first', speak() === seen[0])
}

{
  // The rotation is PER TRIGGER — hearing all three "I missed" lines must not use up the "I took
  // one" ones, which a single shared cursor would do.
  const director = speechDirector(OPPONENTS[0])
  director.next('onOwnMiss')
  for (let i = 0; i < SPEECH_COOLDOWN_SHOTS; i++) director.noteShot()
  ok('each trigger keeps its own cursor', director.next('onOwnKnockout') === OPPONENTS[0].lines.onOwnKnockout[0])
}

{
  const director = speechDirector(OPPONENTS[0])
  director.next('onOwnMiss')
  director.reset()
  ok('reset puts a fresh round back at the first line, ready to speak', director.next('onOwnMiss') === OPPONENTS[0].lines.onOwnMiss[0])
}

console.log('game/mascotChat.ts -- the mascot tires of being poked')

{
  // The joke IS the escalation, so it is the escalation that gets asserted rather than the lines.
  const chat = createMascotChat()
  let now = 0
  const poke = () => chat.poke((now += 500))

  const first = poke()
  ok('the first poke gets a line', first !== null && first.line.length > 0)

  // Every tier in turn, and each one has to be reachable by poking rather than only by existing.
  const moods = new Set()
  let sulkStarted = -1
  for (let i = 0; i < 40; i++) {
    const remark = poke()
    moods.add(remark.mood)
    if (SULK_LINES.includes(remark.line)) {
      sulkStarted = now
      break
    }
  }
  ok('poking on reaches every mood the tiers name', TIERS.every((t) => moods.has(t.mood)))
  ok('and eventually it refuses to discuss it further', sulkStarted >= 0)

  // The sulk runs from the poke that STARTED it, so the checks below are absolute times measured
  // from that moment rather than relative hops (which is how this test was wrong first time: two
  // `+= 500`s and a `+= SULK_MS - 100` land past the end of a SULK_MS sulk).
  ok('it is still cross a moment into the sulk', SULK_LINES.includes(chat.poke(sulkStarted + 500).line))
  ok('and cross right up to the end of it', SULK_LINES.includes(chat.poke(sulkStarted + SULK_MS - 1).line))

  const back = chat.poke(sulkStarted + SULK_MS + 1)
  ok('then comes back with its one return line', back.line === RETURN_LINE)
}

{
  // **Nothing ever runs out.** Two hundred pokes with no pause, which walks every tier, exhausts the
  // top one repeatedly and spends a lot of time sulking — every single one has to come back with
  // something to say. A silent poke reads as a bug, or as a character that ran out of lines.
  const chat = createMascotChat()
  let now = 0
  let quiet = 0
  const lines = new Set()
  for (let i = 0; i < 200; i++) {
    const remark = chat.poke((now += 400))
    if (!remark || !remark.line) quiet++
    else lines.add(remark.line)
  }
  ok('two hundred pokes without a pause never once fall silent', quiet === 0)

  // …and they came round again rather than drying up: 200 pokes against a vocabulary of this size
  // can only be covered by wrapping.
  const vocabulary = TIERS.reduce((n, t) => n + t.lines.length, 0) + SULK_LINES.length + 1
  ok(`the pools wrap rather than drain (${lines.size} distinct lines from a vocabulary of ${vocabulary})`, lines.size > 1 && 200 > vocabulary)
}

{
  // A burst is ended by the NEXT poke arriving late — there is no clock in the module, which is
  // what makes this testable without faking one.
  const chat = createMascotChat()
  const opener = chat.poke(0)
  const later = chat.poke(FORGET_MS + 1)
  ok('a poke after the forget window opens a fresh burst', later !== null && later.mood === TIERS[0].mood)
  ok('and it is not the same line twice running', later.line !== opener.line)
}

{
  // Rotation, per tier: with five alternatives a uniform pick repeats about a fifth of the time.
  const chat = createMascotChat()
  const lines = []
  let now = 0
  for (let i = 0; i < TIERS[0].lines.length; i++) lines.push(chat.poke((now += 500)).line)
  ok('the first tier rotates rather than repeating', new Set(lines).size === lines.length)
}

{
  const withLines = TIERS.every((tier) => tier.lines.length >= 3 && new Set(tier.lines).size === tier.lines.length)
  ok('every tier carries at least three distinct lines', withLines)
  ok('the tiers start at the first poke', TIERS[0].from === 1)
  ok(
    'and each one needs strictly more poking than the last',
    TIERS.every((tier, i) => i === 0 || tier.from > TIERS[i - 1].from),
  )
}

console.log('audio/voiceRegistry.ts -- every line gets a voice, however short')

{
  // `babble.ts` spaces syllables in MILLISECONDS, which on a long line is right and on a very short
  // one is a voice that barely happens: this shipped with `"No."` firing a SINGLE 150ms syllable and
  // `"Hmph."` two, which is easy to miss altogether — and a character whose reply you did not hear
  // is a character with no voice, which is exactly how it was reported. The floor is arithmetic that
  // has been wrong once, so it lives where a check can see it.
  const TYPE_MS = 42
  const MIN_MS = 215
  const MAX_MS = 290
  const syllablesFor = (length, pace = 1) => {
    const [min, max] = syllableStepGlyphs(length, TYPE_MS, MIN_MS, MAX_MS, pace)
    ok(`a ${length}-character line has a sane step (${min}..${max})`, min >= 1 && max >= min)
    // Worst case for the count is always the LARGEST step, since the chain picks uniformly between.
    let fired = 0
    for (let at = 1; at <= length; at += max) fired++
    return fired
  }

  for (const line of ['No.', 'Hmph.', 'Mind the hat.', 'Stop that at once!']) {
    ok(`"${line}" is voiced at least ${MIN_SYLLABLES} times even at its slowest step`, syllablesFor(line.length) >= MIN_SYLLABLES)
  }

  // …and a long line is UNTOUCHED by the floor: it keeps the millisecond spacing the mood asked for,
  // which is what stops this from turning every quip into a machine-gun.
  const long = 'A gentleman coin, at your service.'.length
  const [wantedMin] = syllableStepGlyphs(1000, TYPE_MS, MIN_MS, MAX_MS, 1)
  const [longMin] = syllableStepGlyphs(long, TYPE_MS, MIN_MS, MAX_MS, 1)
  ok('a long line keeps the spacing the mood asked for', longMin === wantedMin)

  // The alarm mood paces faster, and the floor must not undo that.
  const [calmMin] = syllableStepGlyphs(1000, TYPE_MS, MIN_MS, MAX_MS, 1)
  const [alarmMin] = syllableStepGlyphs(1000, TYPE_MS, MIN_MS, MAX_MS, 0.7)
  ok('a faster mood still steps faster', alarmMin < calmMin)
}

console.log('audio/voiceRegistry.ts -- the dialogue voice contour')

{
  // The contour is injected with its randomness, so what gets asserted is the CURVE and never the
  // dice: every call below passes the same rolls, and the only thing that moves is the part being
  // measured. `index: 6, last: true` stands for the final syllable of a seven-syllable line.
  const shapeOf = (text, index, progress, last) =>
    syllableShape({
      index,
      progress,
      last,
      terminal: terminalOf(text),
      mood: 'calm',
      cadence: 'measured',
      hash: hashString(text),
      pitchRoll: 0.5,
      gainRoll: 0.5,
    })
  const body = 'It is exactly the same sentence length here'
  const profile = (mark) => {
    const text = body + mark
    const first = shapeOf(text, 0, 0, false)
    const last = shapeOf(text, 6, 1, true)
    return {
      first: first.cents,
      last: last.cents,
      semitones: (last.cents - first.cents) / 100,
      gainDb: 20 * Math.log10(last.gain / first.gain),
    }
  }

  ok('terminal punctuation is read off the line', terminalOf('Really?') === '?' && terminalOf('No.') === '.' && terminalOf('Stop!') === '!' && terminalOf('mid') === '')

  const statement = profile('.')
  const question = profile('?')
  const exclaim = profile('!')

  // **Three profiles, not one.** A phrase that ends the same way whatever it says has no prosody;
  // the point of reading the punctuation is that these three come out different.
  ok('a statement declines', statement.semitones < -1)
  ok('a question does not', question.semitones > statement.semitones + 2)
  ok('and an exclamation falls hardest of the three', exclaim.semitones < statement.semitones - 2)
  ok('an exclamation front-loads: its first syllable is the highest of the three', exclaim.first > statement.first && exclaim.first > question.first)

  // A rise that lands on a syllable 8 dB down and darkened is a contour in the numbers and not in
  // the ear, which is why a question stresses its last syllable.
  ok('a question does not sag away in loudness', Math.abs(question.gainDb) < 1)
  ok('where a statement does', statement.gainDb < -3)

  // Declination rides UNDER the stress rather than instead of it.
  const early = shapeOf(body + '.', 0, 0, false)
  const late = shapeOf(body + '.', 6, 1, false)
  ok('a phrase sags as it goes, before any terminal', late.cents < early.cents)
}

{
  // The brief's 10-20% wander, and the one deliberate exception to it.
  const spread = (id) => CADENCES[id].jitterPercent
  ok('a speaking cadence wanders within the 10-20% the brief asks for', ['measured', 'grumpy', 'cute'].every((id) => spread(id) >= 0.1 && spread(id) <= 0.2))
  ok('and the monotone one is far below it, on purpose', spread('robotic') < 0.05)

  ok('the deep cadence is deeper than the high one', CADENCES.grumpy.cents < CADENCES.cute.cents)
  ok('the sparing cadence speaks less often than the quick one', CADENCES.grumpy.stepScale > CADENCES.cute.stepScale)
  ok('only the monotone one refuses to hunt for a vowel', CADENCES.robotic.vowelSeek === 0 && ['measured', 'grumpy', 'cute'].every((id) => CADENCES[id].vowelSeek > 0))

  ok('vowels are what the hunt looks for', 'aeiouy'.split('').every(isVowel) && !isVowel('k') && !isVowel('.'))
  ok('a faster mood still steps faster than a calm one', MOODS.alarm.pace < MOODS.calm.pace)
}

{
  /**
   * **Stress, which is what stops it shouting.** `make-voice.py` normalises every clip to the same
   * peak — measured, all 56 land at 0.620 and the RMS spread is 5.5 dB across the set, 1.5-2.9
   * within one profile. Conversational speech puts 10-20 dB between a stressed syllable and an
   * unstressed one; at 2 dB every syllable arrives at full voice, which is what shouting IS.
   */
  const line = 'It is exactly the same sentence length here.'
  const hash = hashString(line)
  const shapeAt = (index) =>
    syllableShape({ index, progress: 0.5, last: false, terminal: '', mood: 'calm', cadence: 'measured', hash, pitchRoll: 0.5, gainRoll: 0.5 })

  ok('a phrase opens on a stress', isStressed(hash, 0))
  const first16 = Array.from({ length: 16 }, (_, i) => isStressed(hash, i))
  const stresses = first16.filter(Boolean).length
  ok(`stress lands every two to three syllables (${stresses} in 16)`, stresses >= 5 && stresses <= 8)

  const loud = shapeAt(0)
  const quiet = shapeAt(1)
  const rangeDb = 20 * Math.log10(loud.gain / quiet.gain)
  ok(`an unstressed syllable sits ${rangeDb.toFixed(1)} dB below a stressed one`, rangeDb >= 6 && rangeDb <= 16)
  ok('a stressed syllable is higher as well as louder', loud.cents > quiet.cents)
  ok('and an unstressed one comes quicker', quiet.stepScale < loud.stepScale)

  // **The third thing that moves with a stress.** A gain drop alone is the same tense syllable
  // played quieter; lowering vocal effort tilts the spectrum too. Measured through the real filter:
  // 334 Hz between the stressed and unstressed centroid over all 56 clips, against ~0 before.
  ok('an unstressed syllable is DARKER as well as quieter', quiet.tiltDb < -1)
  ok('and a stressed one is not tilted at all', Math.abs(loud.tiltDb) < 1e-9)
  ok('the tilt is proportional to the drop', Math.abs(quiet.tiltDb - -6 * (1 - 0.4)) < 1e-9)
}

{
  /**
   * **The pattern comes from the line, not from a global cycle**, so two lines of the same length
   * differ and one line never changes.
   *
   * The distribution has a FLOOR that no seeding can beat: with stress every 2-3 syllables, the
   * possible patterns in the first N positions are the compositions of N into 2s and 3s — 4 of them
   * at N=6, 7 at N=8, 12 at N=10 — and two different gap sequences collide on the same 8-window.
   * The theoretical maximum share is therefore 25% at N=6 and N=8, and 12.5% at N=10. Measured over
   * the game's own 453 lines: 28%, 23.8%, 13%. The hash is uniform; the ceiling is the rule.
   */
  const pattern = (text, n) => {
    const hash = hashString(text)
    return Array.from({ length: n }, (_, k) => (isStressed(hash, k) ? 'S' : '.')).join('')
  }

  ok('the same line always speaks the same way', pattern('Mind the hat.', 10) === pattern('Mind the hat.', 10))

  const corpus = []
  for (const one of OPPONENTS) for (const lines of Object.values(one.lines)) corpus.push(...lines)
  ok('every line opens on a stress', corpus.every((line) => isStressed(hashString(line), 0)))

  const share = (n) => {
    const seen = new Map()
    for (const line of corpus) {
      const key = pattern(line, n)
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    return Math.max(...seen.values()) / corpus.length
  }
  // At the window where the rule stops binding, the brief's 20% is met.
  ok(`no pattern takes more than 20% over ten syllables (${(share(10) * 100).toFixed(1)}%)`, share(10) <= 0.2)
  // …and at eight it cannot be, so what is asserted there is that the hash reaches the ceiling
  // rather than falling short of it.
  ok(`over eight it sits at the 25% ceiling the 2-3 rule imposes (${(share(8) * 100).toFixed(1)}%)`, share(8) <= 0.27)

  const distinct = new Set(corpus.map((line) => pattern(line, 10)))
  ok(`the corpus produces ${distinct.size} distinct patterns over ten syllables`, distinct.size >= 8)
}

console.log('the voice overlaps rather than blipping')

{
  /**
   * **A clip has to outlast the gap to the next one, or the voice is a row of separate blips.**
   *
   * It was: 140-150ms clips on a 215-290ms step left 65-140ms of silence at EVERY syllable boundary.
   * The sprite's clips are now 262-282ms, which is longer than the shortest step any cadence and mood
   * can produce, so tails overlap and `audio.ts` keeps a pool of voices to let them. Measured over
   * 2017 real syllable boundaries after the change: 17.2% still carry silence (was 100%), mean
   * overlap 96ms, worst remaining gap 188ms.
   *
   * The sprite's marker table is JSON, so this is the one thing about the audio a check can read
   * without decoding it — the brightness floor has to live in `make-voice.py` for that reason.
   */
  const sprite = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'voice', 'voice.json'), 'utf8'))
  const clips = Object.values(sprite.spritemap ?? {}).map((m) => (m.end - m.start) * 1000)
  ok(`the sprite carries ${clips.length} clips`, clips.length > 0)

  const shortestClip = Math.min(...clips)
  // The quickest a syllable can ever arrive: the fastest cadence, the fastest mood and an unstressed
  // syllable, quantised to whole characters of the reveal.
  const fastest = CADENCES.cute.stepScale * MOODS.alarm.pace * 0.82
  const [minGlyphs] = syllableStepGlyphs(200, 42, 215, 290, fastest)
  const [, slowGlyphs] = syllableStepGlyphs(200, 42, 215, 290, CADENCES.grumpy.stepScale * MOODS.calm.pace)
  ok(
    `the shortest clip (${shortestClip.toFixed(0)}ms) outlasts the shortest step (${(minGlyphs * 42).toFixed(0)}ms)`,
    shortestClip > minGlyphs * 42,
  )
  // …and is within reach of the slowest, so even the sparing cadence mostly runs its syllables
  // together instead of leaving a hole between each one.
  ok(
    `and is within 80ms of the slowest step (${(slowGlyphs * 42).toFixed(0)}ms)`,
    slowGlyphs * 42 - shortestClip < 80,
  )
}

console.log('the built assets agree with the registries')

{
  const jsonPath = path.join(ROOT, 'public', 'assets', 'voice', 'voice.json')
  assert.ok(fs.existsSync(jsonPath), 'public/assets/voice/voice.json is missing — run `npm run voice`')
  const sprite = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const built = new Set(Object.keys(sprite.spritemap ?? {}))
  const wanted = allVoiceMarkers()
  // Both directions. A missing marker plays NOTHING, silently — the character mouths its line — and
  // an extra one is a registry that has drifted from the generator, which is how the first kind
  // happens next time.
  const missing = wanted.filter((m) => !built.has(m))
  const extra = [...built].filter((m) => !wanted.includes(m))
  ok(`the voice sprite carries all ${wanted.length} markers the registry names`, missing.length === 0)
  ok('and carries nothing the registry does not', extra.length === 0)
}

{
  const jsonPath = path.join(ROOT, 'public', 'assets', 'portraits', 'portraits.json')
  if (!fs.existsSync(jsonPath)) {
    // Not a failure yet: the portraits are rendered in their own pass and `ui/portrait.ts` draws a
    // plain stand-in until they land. This line is the reminder that the stand-in is still in use.
    console.log('  -- portraits.json absent: the cast is running on drawn stand-ins (see ART-SOURCES.md)')
  } else {
    const atlas = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const frames = new Set((atlas.textures?.[0]?.frames ?? []).map((f) => f.filename))
    const wanted = OPPONENTS.map((o) => o.portrait)
    ok('every character has its frame in the portrait atlas', wanted.every((f) => frames.has(f)))
    ok('and the atlas carries no frame nobody wears', [...frames].every((f) => wanted.includes(f)))
  }
}

{
  // -- can every character actually REACH the enemy? ---------------------------------------------
  //
  // The gap this closes shipped for months and was reported from live play as "боты бьют слабовато,
  // просто удар не долетает их". `quirks.powers` restricts which of `POWER_LEVELS` a character may
  // consider at all — a real and wanted habit — and five characters are barred from full force. Under
  // the power curve the game shipped with, their strongest permitted shot travelled 4.4 to 5.7 cells
  // against the 6.2 cells between the two opening ranks, so **they could not touch an enemy disc from
  // the opening at all**, ever, on any board. They were spread across the whole ladder (rungs 3, 6, 7,
  // 13 and 16), which is also why the cast read as uniformly feeble.
  //
  // The checks above measure that a quirk CHANGES what the search looks at. That is the wrong
  // question on its own: a habit that removes an option is a habit, and a habit that removes every
  // option which works is a handicap wearing a habit's name. This asks the other half.
  //
  // Cheap on purpose — a ray test and a closed form, no solver — so it stays inside `npm test`.
  const metrics = createBoardMetrics(8)

  const shortfalls = []
  for (const branch of FORMATION_ORDER) {
    const profile = BRANCH_PROFILES[branch]
    const config = createSimConfig(metrics)
    const state = createState(buildFormation(branch, metrics, { piecesPerSide: 8 }))
    const mine = liveDiscs(state, 'player')

    // The shortest clear line to an enemy anyone on this side has — the easiest shot on the board,
    // so a character that cannot make THIS one cannot make any of them.
    let gap = Infinity
    for (const shooter of mine) {
      for (const enemy of liveDiscs(state, 'opponent')) {
        const angle = Math.atan2(enemy.y - shooter.y, enemy.x - shooter.x)
        const contact = firstContact(state, shooter, angle, config)
        if (contact.discId === enemy.id) gap = Math.min(gap, contact.distance)
      }
    }

    for (const opponent of OPPONENTS) {
      const quirks = opponent.persona.quirks
      const allowed = quirks?.powers?.length ? quirks.powers : POWER_LEVELS
      const best = Math.min(1, Math.max(...allowed) * (quirks?.powerScale ?? 1))
      const reach = reachOf(best, config, { frictionScale: profile.frictionScale })
      if (reach < gap) {
        shortfalls.push(`${opponent.id} on ${branch}: best shot ${(reach / CELL).toFixed(2)}c vs ${(gap / CELL).toFixed(2)}c gap`)
      }
    }
  }

  // Printed BEFORE the assertion: `ok` throws, and a failure that reports only its own title is a
  // failure somebody has to re-derive by hand.
  for (const line of shortfalls) console.log(`     ! ${line}`)
  ok('every character can reach the enemy from the opening with a power it is allowed to use', shortfalls.length === 0)
}

console.log(`${checks} checks passed`)
