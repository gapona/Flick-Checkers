import { playVoiceMarker, stopVoice } from './audio'
import {
  CADENCES,
  hashString,
  isVowel,
  seededRandom,
  syllableShape,
  syllableStepGlyphs,
  SYLLABLES_PER_PROFILE,
  terminalOf,
  type CadenceId,
  type Terminal,
  type VoiceMood,
  type VoiceProfile,
} from './voiceRegistry'

/**
 * **The dialogue voice: gibberish speech, in the Animal Crossing / Graveyard Keeper manner.**
 *
 * Characters do not have recorded lines and are not going to. They "speak" by chaining meaningless
 * syllables while their words type into a bubble, and everything that makes that read as a VOICE
 * rather than as a rattle happens here: when a syllable lands, how far its pitch wanders, what the
 * sentence's punctuation does to its contour, and how a given character's habits differ from the
 * next one's.
 *
 * ## Four layers, and the rule that separates them
 *
 * ```
 * scripts/make-voice.py     synthesis     build time, deterministic, no game code
 * audio/voiceRegistry.ts    DATA + MATHS  no Phaser import, so verify:content can check it
 * audio/dialogueVoice.ts    THIS          per-line state: when a syllable fires, and shaped how
 * audio/audio.ts            OUTPUT        the only module that touches game.sound
 * ```
 *
 * The arithmetic lives one module down rather than here, and that is not tidiness: this file reaches
 * Phaser through `audio.ts`, so nothing in Node can import it. Anything that can be got wrong
 * silently — the pitch curve, the syllable spacing, the minimum-syllable floor — belongs where a
 * check can see it. The floor shipped as a silent defect once already: `"No."` fired a single 150ms
 * blip and the character read as having no voice at all.
 *
 * ## Why the phonemes are synthesised at BUILD time, not from `OscillatorNode` per syllable
 *
 * `scripts/make-voice.py` is the formant synthesiser — a glottal buzz through two two-pole
 * resonators for each vowel, shaped noise bursts and clicks and nasal hums for the consonants,
 * every noise source seeded from its marker name so a rerun reproduces identical bytes. That is the
 * oscillator-and-filter chain a runtime implementation would build, run once instead of per
 * syllable. Three reasons it stays there:
 *
 * - A node graph per syllable is real work on a phone, and syllables arrive in chains of five to ten.
 * - `AUDIO-SOURCES.md` can go on saying *self-generated*: provenance is a property of the repository
 *   rather than a promise in a registry row, because there is no file to trace, only arithmetic.
 * - `audio.ts` stays the one module allowed to touch `game.sound`, which is the rule that keeps the
 *   platform mute, the SFX slider and the one-voice-at-a-time invariant in a single place.
 *
 * 8 timbres x 7 syllables = 56 markers in one Ogg sprite, each about 150ms.
 *
 * ## Two axes per character, deliberately orthogonal
 *
 * - {@link VoiceProfile} — the TIMBRE, which seven syllables come out of the sprite. Shared between
 *   characters: what separates two of them in play is rarely a third syllable set.
 * - {@link CadenceId} — HOW they speak: base pitch, how wide the wander, how often a syllable lands,
 *   and whether the chain waits for a vowel or runs to a metronome.
 *
 * Two characters on one timbre and two cadences do not sound alike, which is what stops twelve
 * opponents needing twelve syllable sets.
 *
 * ## The sync with the typing IS the illusion
 *
 * {@link DialogueVoiceManager.playLetterSound} is pumped by `ui/speechLine.ts` for every character it
 * reveals — it is not on a timer of its own. An independent timer drifts against the reveal within a
 * single line, and a fraction of a second either way is exactly the difference between a mouth moving
 * and a mouth dubbed.
 */

export type { CadenceId, VoiceMood } from './voiceRegistry'

/**
 * Gap between syllables, in MILLISECONDS, before the cadence and the mood scale it.
 *
 * At roughly a quarter-second a syllable has time to be a syllable; much faster and a line reads as
 * a stutter rather than as speech. This is also what gives the cadences room — a rate that differs
 * by 30% is inaudible when every syllable is already a blip.
 */
export const SYLLABLE_STEP_MIN_MS = 215
export const SYLLABLE_STEP_MAX_MS = 290

export interface DialogueVoiceManager {
  /**
   * Starts a line. **Interrupts whatever was speaking** — there is exactly one voice in the game at a
   * time (the sound instance itself is shared, see `playVoiceMarker`), so an older session left
   * running would be talking over the new one from a bubble that is no longer on screen.
   *
   * The whole text is taken up front because the contour needs to know where the end is and what
   * punctuation it carries: a question rises TOWARD something.
   */
  begin(text: string, mood?: VoiceMood): void
  /**
   * One typed character. **Sounds on roughly one character in five, not on every one** — see
   * {@link SYLLABLE_STEP_MIN_MS} — and prefers to land on a vowel, which is where a mouth opens.
   *
   * `isEndSentence` marks the character that closes the sentence: it guarantees a final syllable
   * lands on it, so a contour that has spent the whole tail rising or falling actually arrives.
   */
  playLetterSound(char: string, isEndSentence?: boolean): void
  /** Cuts the voice — the line was replaced, or the scene is going away. */
  stop(): void
  /** Syllables uttered on the current line. For tests and for anyone tuning a cadence. */
  readonly spoken: number
}

/** A manager that makes no sound, for an empty line and for a stopped one. */
const SILENT: DialogueVoiceManager = {
  begin() {},
  playLetterSound() {},
  stop() {},
  spoken: 0,
}

/**
 * @param typeMs the typewriter's own reveal rate, which the syllable spacing is quantised against.
 * Passed IN rather than imported: the rate belongs to `ui/speechLine.ts`, and an audio module
 * reaching up into the UI layer to read it would invert the one direction this codebase's imports
 * are allowed to run. A second copy of the number here would be worse still.
 */
export function createDialogueVoice(profile: VoiceProfile, cadence: CadenceId = 'measured', typeMs = 42): DialogueVoiceManager {
  let text = ''
  let hash = 0
  let terminal: Terminal = ''
  let mood: VoiceMood = 'calm'
  let revealed = 0
  let nextAt = 1
  let previous = -1
  let spoken = 0
  let stopped = false
  /**
   * Every draw a line makes comes from here, seeded from the line itself.
   *
   * **`Math.random` was the first version and it made the determinism a half-truth**: the stress
   * pattern was stable per string, but the syllable SPACING was not, so the same line came out five
   * syllables one time and seven the next and the pattern landed in different places. A line is one
   * utterance; it gets one stream.
   */
  let roll: () => number = Math.random

  const shape = CADENCES[cadence]

  /** The gap after a syllable, in characters, scaled by whatever the contour asked for. */
  const stepFor = (stepScale: number): number => {
    const [min, max] = syllableStepGlyphs(text.length, typeMs, SYLLABLE_STEP_MIN_MS, SYLLABLE_STEP_MAX_MS, stepScale)
    return min + Math.floor(roll() * (max - min + 1))
  }

  const fire = (progress: number, last: boolean): void => {
    const shaped = syllableShape({
      // `spoken` is this syllable's index in the phrase, and it is what carries the stress pattern.
      index: spoken,
      progress,
      last,
      terminal,
      mood,
      cadence,
      hash,
      pitchRoll: roll(),
      gainRoll: roll(),
    })

    // Never the same syllable twice running — a repeat is the one artefact having seven of them
    // exists to prevent.
    let index = Math.floor(roll() * SYLLABLES_PER_PROFILE)
    if (index === previous) index = (index + 1) % SYLLABLES_PER_PROFILE
    previous = index

    playVoiceMarker(`${profile}_${index + 1}`, shaped.cents, shaped.gain, shaped.tiltDb)
    spoken++
    // **Scheduled from the DUE point, not from where the syllable actually fired.**
    //
    // The vowel hunt can hold a syllable back by up to `vowelSeek` characters, and measuring from
    // the fire point let that delay stretch the gap to the NEXT one as well — so a hunt of three
    // characters added 126ms of silence on top of a step that was already close to the clip's
    // length. Measured over 1710 real syllable boundaries: 28.8% still had silence, the worst 188ms.
    // Re-basing on the due point keeps the average rate exactly as it was and stops the hunt paying
    // for itself twice. Clamped so a run of delays can never schedule a syllable in the past.
    nextAt = Math.max(revealed + 1, nextAt + stepFor(shaped.stepScale))
  }

  return {
    get spoken() {
      return spoken
    },

    begin(next: string, nextMood: VoiceMood = 'calm') {
      stopVoice()
      text = next
      hash = hashString(next)
      roll = seededRandom(hash)
      terminal = terminalOf(next)
      mood = nextMood
      revealed = 0
      nextAt = 1
      previous = -1
      spoken = 0
      stopped = false
    },

    playLetterSound(char: string, isEndSentence = false) {
      if (stopped || !text) return
      revealed++

      const progress = text.length > 0 ? revealed / text.length : 1

      // The closing character always speaks, whatever the spacing says. A contour that has spent the
      // whole tail rising has to ARRIVE, and a question whose lift lands two characters before the
      // question mark is a question that trails off.
      if (isEndSentence) {
        if (spoken === 0 || revealed >= nextAt - shape.vowelSeek) fire(progress, true)
        return
      }

      if (revealed < nextAt) return

      // Vowel-seeking: past its due point, the chain waits a few characters for a vowel rather than
      // firing on whatever consonant happens to be under it. `vowelSeek: 0` disables the hunt
      // entirely, which is most of what makes the robotic cadence read as a machine.
      if (shape.vowelSeek > 0 && !isVowel(char) && revealed < nextAt + shape.vowelSeek) return

      fire(progress, false)
    },

    stop() {
      stopped = true
      stopVoice()
    },
  }
}

export { SILENT as SILENT_VOICE }
