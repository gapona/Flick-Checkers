/**
 * **What the pseudo-voice sprite contains** — the data half of the opponents' speech, with
 * `audio/dialogueVoice.ts` as the policy half and `audio/audio.ts` as the output half. The same split
 * `game/opponents.ts` and `bot/search.ts` already use, and for one practical reason: this file has
 * **no Phaser import**, so `scripts/verify-content.mjs` can read it in plain Node. (`audio.ts`
 * imports Phaser as a value, and Phaser's own init reads `window` — importing it from a script
 * crashes outside a browser.)
 *
 * Must match `scripts/make-voice.py`'s `PROFILES` and `SYLLABLES` tables; `npm run verify:content`
 * checks the built sprite's marker list against these names, because a marker that is missing plays
 * **nothing, silently** — the character just mouths its line and nobody finds out.
 */

/**
 * The eight voices. A profile is shared by several characters where what separates them in play is
 * pitch and pacing rather than a third syllable set nobody could name blind — `gruff` is the cook and
 * the sergeant, and `audio/dialogueVoice.ts`'s per-line mood does the rest.
 *
 * `plummy` is the exception and belongs to nobody in the cast: it is the MENU MASCOT's
 * (`game/mascotChat.ts`), which borrowed the marshal's `burble` until it got one of its own. A
 * character that talks in another character's voice is a character the ear files as that other one.
 */
export const VOICE_PROFILES = ['squeak', 'gruff', 'nasal', 'airy', 'burble', 'dry', 'booming', 'plummy'] as const

export type VoiceProfile = (typeof VOICE_PROFILES)[number]

/** Syllables recorded per profile. The chain picks among these and never repeats one twice running,
 * which needs at least two; seven is where a listener stops hearing the loop. */
export const SYLLABLES_PER_PROFILE = 7

/** Every marker the sprite must carry, in the order it was generated. */
export function allVoiceMarkers(): string[] {
  const markers: string[] = []
  for (const profile of VOICE_PROFILES) {
    for (let i = 1; i <= SYLLABLES_PER_PROFILE; i++) markers.push(`${profile}_${i}`)
  }
  return markers
}

// -- how often a syllable fires ------------------------------------------------------------------

/**
 * **Syllables a line gets however short it is.**
 *
 * `audio/dialogueVoice.ts` spaces syllables in MILLISECONDS, which on a long line is exactly right and on a
 * very short one is a voice that barely happens: measured, `"No."` fired a single syllable and
 * `"Hmph."` two. One 150ms blip is easy to miss altogether, and a character whose reply you did not
 * hear is a character with no voice — which is precisely how it was reported.
 */
export const MIN_SYLLABLES = 3

/**
 * The gap between syllables, in CHARACTERS of the reveal — the quantity `dialogueVoice.ts` actually steps
 * by, so the voice is quantised to the typing rather than running beside it.
 *
 * Lives here rather than in `dialogueVoice.ts` because this file has no Phaser import and that one does
 * (through `audio.ts`), so this is the half `npm run verify:content` can reach. The short-line floor
 * shipped as a silent defect once; arithmetic that has been wrong once should be somewhere a check
 * can see it.
 *
 * Returns `[min, max]`: the chain picks uniformly between them so the rhythm is not a metronome.
 */
export function syllableStepGlyphs(textLength: number, typeMs: number, stepMinMs: number, stepMaxMs: number, pace: number): [number, number] {
  // The step the mood asks for…
  const wantedMin = Math.max(1, Math.round((stepMinMs * pace) / typeMs))
  const wantedMax = Math.max(wantedMin, Math.round((stepMaxMs * pace) / typeMs))
  // …and the largest step that still fits {@link MIN_SYLLABLES} into this particular line. The
  // smaller of the two wins, so a long line keeps its timing and a short one keeps its voice.
  const affordable = Math.max(1, Math.ceil(textLength / MIN_SYLLABLES))
  const min = Math.min(wantedMin, affordable)
  return [min, Math.max(min, Math.min(wantedMax, affordable))]
}

// -- how a character speaks, as opposed to what it sounds like -----------------------------------

/**
 * **The second axis, and it is orthogonal to {@link VoiceProfile} on purpose.**
 *
 * A profile is a TIMBRE — which seven syllables come out of the sprite — and it is shared between
 * characters because what separates two of them in play is rarely a third syllable set. A cadence is
 * HOW they speak: how deep, how wide the pitch wanders, how often a syllable lands, and whether the
 * chain waits for a vowel or runs to a metronome. Two characters on one timbre and two cadences do
 * not sound alike, which is what stops eighteen opponents needing eighteen syllable sets.
 */
export interface Cadence {
  /** Base pitch offset, in cents. Negative is deeper. */
  cents: number
  /** Per-syllable pitch wander, as a fraction of playback rate. The brief asks for 10-20%; the
   * monotone character is the one deliberate exception and sits far below it. */
  jitterPercent: number
  gain: number
  /** Multiplies the gap between syllables. Above 1 is a character that speaks in rarer, heavier
   * blips; below 1 is a chatterbox. */
  stepScale: number
  /**
   * How many characters past its due point the chain will wait for a VOWEL before giving up and
   * firing on whatever is under it.
   *
   * This is what stops the voice rattling through consonant clusters and makes it land where a mouth
   * would open. `0` disables it — the robotic cadence fires on a fixed interval and never hunts,
   * which is most of what makes it read as a machine.
   */
  vowelSeek: number
}

export type CadenceId = 'measured' | 'grumpy' | 'cute' | 'robotic'

export const CADENCES: Record<CadenceId, Cadence> = {
  /** The default: a person speaking. */
  measured: { cents: 0, jitterPercent: 0.12, gain: 1, stepScale: 1, vowelSeek: 3 },
  /** Deep and sparing — an old soldier, a marshal who does not waste words. */
  // **1.15, not the 1.35 it was.** The clips are 262-282ms and a 1.35 step puts them 290-391ms
  // apart, so the one cadence defined by speaking rarely was also the one that still had 65-130ms of
  // silence between every syllable after the overlap landed — measured, four silent gaps a line
  // against zero for the quick cadences. It is still the slowest of the four and still the deepest;
  // the sparing quality now comes from the pitch and the wander rather than from a hole.
  grumpy: { cents: -260, jitterPercent: 0.1, gain: 1.05, stepScale: 1.15, vowelSeek: 3 },
  /** High and quick, and the widest wander of the four: a small character that has not finished one
   * sentence before starting the next. */
  cute: { cents: 320, jitterPercent: 0.18, gain: 0.95, stepScale: 0.7, vowelSeek: 2 },
  /** Almost no wander, and a fixed interval. The absence of both IS the character. */
  robotic: { cents: 0, jitterPercent: 0.02, gain: 1, stepScale: 1, vowelSeek: 0 },
}

export function isCadenceId(value: string): value is CadenceId {
  return value in CADENCES
}

/**
 * What the line is ABOUT, which the syllables cannot say for themselves.
 *
 * The words are English and most players will not read them mid-shot; the voice is what carries the
 * reaction, and a character that says "you took my last disc" in the tone it says "I missed" has no
 * reaction at all.
 */
export type VoiceMood = 'calm' | 'triumph' | 'alarm'

export interface MoodShape {
  /** Added to every syllable, in cents. */
  baseCents: number
  /** Cents from the first syllable to the last. Negative falls, positive rises. */
  driftCents: number
  /** Multiplier on the cadence's own pitch wander. */
  jitter: number
  /** Multiplier on the gap between syllables — under 1 is faster. */
  pace: number
  gain: number
}

/**
 * How far a `calm` phrase's pitch sags across its length. **It has to beat the wander to exist at
 * all**: at 12% the per-syllable jitter is 196 cents either way, so a drift much under this is
 * invisible in the measurement and inaudible in play — the last syllable comes out HIGHER than the
 * first about as often as not.
 */
const DRIFT_CENTS = 260

/**
 * **Drift is now a MODIFIER on declination, not the fall itself.**
 *
 * `DECLINATION_CENTS` is the universal sag every phrase has; a mood then says how far it departs
 * from it. Leaving the old absolute values in place double-counted: a calm statement fell 510 cents
 * instead of 250, and a question could not climb back out of it — measured, the `?` line still ended
 * three semitones BELOW where it started, which is a statement. The three net figures below are the
 * ones that were there before declination was named, so nothing about how a mood sounds has moved.
 */
export const MOODS: Record<VoiceMood, MoodShape> = {
  // net -250: the declination alone.
  calm: { baseCents: 0, driftCents: 0, jitter: 1, pace: 1, gain: 1 },
  // net -90: barely falls, which is what a confident line does.
  triumph: { baseCents: 170, driftCents: 160, jitter: 1, pace: 0.95, gain: 1.1 },
  // The rise is large for the same reason the calm drift is, and the pace is well under 1 because
  // the step is quantised to whole characters of the reveal: 0.9 and 1.0 round to the same number of
  // characters, and the mood's tempo would not exist.
  // net +400: rises, which is what surprise does.
  alarm: { baseCents: 260, driftCents: 650, jitter: 1.4, pace: 0.7, gain: 1.1 },
}

// -- the string's own fingerprint ----------------------------------------------------------------

/**
 * FNV-1a, 32-bit. Every random choice a line makes is drawn from this rather than from
 * `Math.random`, which buys two things the brief asks for and one it needs:
 *
 * - **The same string always speaks the same way.** Stress pattern, syllable spacing and the pitch
 *   wander are all seeded from it, so a character saying "Mind the hat." says it identically every
 *   time, which is what makes it a voice rather than a slot machine.
 * - **Two different strings of the same length differ.** A global cycle indexed by syllable number
 *   gave every eight-syllable line the same rhythm.
 * - **The syllable COUNT stops wobbling.** The step is drawn per syllable; drawn from
 *   `Math.random` the same line came out 5 syllables one time and 7 the next, which meant a
 *   deterministic stress pattern still landed on different words each time. Seeding the draws is
 *   what makes "the same string always the same" true of the whole utterance and not just of the
 *   pattern.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32: a small, fast, well-distributed PRNG. Deterministic from a seed, which is the whole
 * point — see {@link hashString}. */
export function seededRandom(seed: number): () => number {
  // **Warmed up before the first draw.** Mulberry32 seeded straight from an FNV hash gives
  // near-identical first outputs for near-identical strings, and the first two draws are exactly
  // what pick a line's opening stress gaps — measured over fifty similar lines, one pattern took
  // 38% of them. Three discarded steps decorrelate the low bits before anything reads them.
  let state = seed >>> 0
  for (let i = 0; i < 3; i++) {
    state = (state + 0x6d2b79f5) >>> 0
    state = Math.imul(state ^ (state >>> 15), state | 1) >>> 0
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// -- stress, which is what stops it shouting -----------------------------------------------------

/**
 * **The fix for "it sounds shouty", and the diagnosis is a measurement rather than an opinion.**
 *
 * `make-voice.py` normalises every syllable to the same peak, so all 56 clips land at 0.620 and the
 * RMS spread across the whole set is 5.5 dB — within one profile, 1.5 to 2.9. Conversational speech
 * puts 10 to 20 dB between a stressed syllable and an unstressed one. At 2 dB every syllable is
 * delivered at full voice, and a run of equally-loud syllables at the top of the range is not a
 * character speaking emphatically: it is the definition of shouting. The spectrum was never the
 * problem — mean centroid 813 Hz and 90% rolloff 1774 Hz is warm, not strident.
 *
 * The dynamics stay at RUNTIME and the clips stay normalised, deliberately: baking levels into the
 * sprite would put loudness back in storage and take away the ability to move a stress. What the
 * clips get instead is a small per-syllable wander (see {@link LEVEL_JITTER_DB}) so that a run of
 * stressed syllables is not itself flat.
 *
 * ## Stress-timed, and seeded from the line
 *
 * English puts roughly one stress every two to three syllables, irregularly. The gaps are drawn from
 * the line's own hash, so the rhythm is a property of what is being said: two different lines of the
 * same length get different patterns, and one line always gets its own.
 */
const STRESS_GAPS = [2, 3] as const

/**
 * How far an unstressed syllable drops. **−8 dB**, the low end of the conversational range: further
 * starts swallowing syllables entirely on a phone speaker, which trades one complaint for another.
 */
const UNSTRESSED_GAIN = 0.4
/** A stressed syllable is a little higher as well as louder — pitch and loudness move together in
 * real prosody, and doing only one of them reads as a volume knob rather than as emphasis. */
const STRESS_CENTS = 90
/** …and unstressed syllables come quicker, which is the whole of what "stress-timed" means. */
const UNSTRESSED_PACE = 0.82

/**
 * **The third thing that moves with a stress: the spectral tilt.**
 *
 * A gain drop alone is the same tense syllable played quieter, which is not what a person does.
 * Lowering vocal effort physically changes the slope of the spectrum — the top falls further than
 * the bottom, because the glottal source itself gets less abrupt. So an unstressed syllable also
 * gets a high shelf, in proportion to how far its gain dropped: a full 8 dB drop takes 6 dB off
 * everything above {@link TILT_HZ}.
 */
export const TILT_HZ = 2000
const FULL_TILT_DB = -6

/** Per-syllable level wander, on top of the stress. Small — it exists so that a run of stressed
 * syllables is not itself flat, not to compete with the stress pattern. */
export const LEVEL_JITTER_DB = 1.5

/**
 * Whether the syllable at `index` carries a stress, for a line with this hash.
 *
 * Opens on a stress — a line that begins on an unstressed blip sounds like it started before you
 * were listening — and then walks gaps of two or three drawn from the seeded stream.
 */
export function isStressed(hash: number, index: number): boolean {
  if (index <= 0) return true
  const next = seededRandom(hash)
  let at = 0
  while (at < index) {
    at += STRESS_GAPS[next() < 0.5 ? 0 : 1]
    if (at === index) return true
  }
  return false
}

// -- the phrase contour --------------------------------------------------------------------------

/**
 * **Declination**: pitch and loudness both sag from the first syllable of a phrase to the last, in
 * every language and regardless of what the phrase means. It is applied UNDER the stress pattern
 * rather than instead of it — a stressed syllable late in a line is still quieter than a stressed
 * one at the start, which is what makes a long line sound like one sentence instead of a list.
 *
 * Two and a half semitones and three and a half dB, both at the gentle end: this is the floor the
 * mood and the terminal contour are then applied on top of.
 */
const DECLINATION_CENTS = -250
const DECLINATION_DB = -3.5

/** A question turns up on its LAST syllable — three semitones, and the loudness does not sag with
 * it. A rise spread over the tail reads as a siren; a rise on the final syllable reads as a
 * question, which is why this one is an event and not a ramp. */
const QUESTION_LIFT_CENTS = 300
/** An exclamation front-loads: its first stress is harder, and it drops away sharply at the end.
 * The shape is the opposite of a question's and has to be as legible. */
const EXCLAIM_ONSET_CENTS = 220
const EXCLAIM_ONSET_DB = 2.5
const EXCLAIM_DROP_CENTS = -260

export type Terminal = '.' | '?' | '!' | ''

export function terminalOf(text: string): Terminal {
  const last = text.trimEnd().slice(-1)
  return last === '.' || last === '?' || last === '!' ? last : ''
}

export interface SyllableContext {
  /** Which syllable of the phrase this is, from `0`. Stress is a property of POSITION. */
  index: number
  /** How far through the line this syllable is, 0 to 1 — what declination rides on. */
  progress: number
  /** The last syllable of the utterance. The terminal contour is an EVENT on this one, not a ramp
   * toward it, so it has to be told which one it is. */
  last: boolean
  terminal: Terminal
  mood: VoiceMood
  cadence: CadenceId
  /** The line's fingerprint — {@link hashString}. Drives the stress pattern. */
  hash: number
  /** Two uniform 0-to-1 rolls, INJECTED rather than drawn here. It is what keeps this function pure,
   * and therefore what lets `verify:content` assert the curve instead of the dice. */
  pitchRoll: number
  gainRoll: number
}

export interface SyllableShape {
  /** Detune for `playVoiceMarker`, in cents. */
  cents: number
  gain: number
  /** High-shelf cut above {@link TILT_HZ}, in dB. Negative darkens. */
  tiltDb: number
  /** Multiplies the gap before the NEXT syllable. Above 1 is slower. */
  stepScale: number
}

const dbToGain = (db: number): number => Math.pow(10, db / 20)

/**
 * The pitch, loudness, tilt and tempo of one syllable — cadence, stress, declination, mood and
 * terminal punctuation composed, in that order.
 *
 * Pure, and injected with its randomness so the CURVE can be asserted while the dice cannot.
 */
export function syllableShape(context: SyllableContext): SyllableShape {
  const cadence = CADENCES[context.cadence]
  const mood = MOODS[context.mood]
  const progress = Math.min(1, Math.max(0, context.progress))

  const jitterCents = 1200 * Math.log2(1 + cadence.jitterPercent) * mood.jitter
  let cents = cadence.cents + mood.baseCents + mood.driftCents * progress + (context.pitchRoll * 2 - 1) * jitterCents
  let gainDb = LEVEL_JITTER_DB * (context.gainRoll * 2 - 1)
  let gain = cadence.gain * mood.gain
  let stepScale = cadence.stepScale * mood.pace
  let tiltDb = 0

  // Stress: loudness, pitch, tempo and TILT together — see TILT_HZ for why the fourth one matters.
  //
  // **A question's final syllable always carries one.** The rise is an event on that syllable, and
  // landing it on an unstressed one puts it 8 dB down and darkened — measured, the lift arrived on a
  // syllable quiet enough that the contour was there in the numbers and not in the ear. Questions
  // stress their last syllable in speech for the same reason.
  const stressed = isStressed(context.hash, context.index) || (context.last && context.terminal === '?')
  if (stressed) {
    cents += STRESS_CENTS
  } else {
    gain *= UNSTRESSED_GAIN
    stepScale *= UNSTRESSED_PACE
    // In proportion to how far the gain dropped, so the two can never disagree about how unstressed
    // this syllable is.
    tiltDb += FULL_TILT_DB * (1 - UNSTRESSED_GAIN)
  }

  // Declination, under everything: a phrase sags as it goes, whatever it is saying.
  cents += DECLINATION_CENTS * progress
  gainDb += DECLINATION_DB * progress

  if (context.terminal === '?') {
    if (context.last) cents += QUESTION_LIFT_CENTS
    // A question does not sag away at the end; cancelling the declination's loudness is what stops
    // the rise arriving on a syllable too quiet to hear it on.
    gainDb -= DECLINATION_DB * progress
  }
  if (context.terminal === '!') {
    if (context.index === 0) {
      cents += EXCLAIM_ONSET_CENTS
      gainDb += EXCLAIM_ONSET_DB
    }
    if (context.last) cents += EXCLAIM_DROP_CENTS
  }

  return { cents, gain: Math.max(0, gain * dbToGain(gainDb)), tiltDb, stepScale }
}

/** Vowels, for the cadence's vowel-seeking. `y` is in: it is a vowel often enough in English that
 * leaving it out makes "rhythm" and "gently" fire in the wrong place. */
const VOWELS = 'aeiouy'

export function isVowel(char: string): boolean {
  return VOWELS.includes(char.toLowerCase())
}
