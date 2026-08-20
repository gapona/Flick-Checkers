/**
 * **What the mascot says when you poke it, and how quickly it tires of being poked.**
 *
 * Pure policy and pure content — no Phaser, no scene, no timers — so `scripts/verify-content.mjs`
 * can exercise the escalation in plain Node. `scenes/MainMenu.ts` supplies the pokes and
 * `ui/speechLine.ts` types whatever comes back.
 *
 * ## The joke is the ESCALATION, not the lines
 *
 * One pool of quips answers the first poke well and the tenth badly: a character that is equally
 * delighted to be prodded for the ninth time is not a character, it is a soundboard. So the remarks
 * come in {@link TIERS}, and which tier answers depends on how many times you have poked it in this
 * burst — amused, then pointed, then genuinely indignant, and then it refuses to discuss it further
 * for a few seconds. The refusal is the payoff and the reason the rest exists.
 *
 * ## Nothing ever runs out
 *
 * **Every poke gets a line, always, and the pools wrap.** Each tier rotates modulo its own length, so
 * a burst long enough to exhaust a tier simply comes round to its first line again; and the sulk —
 * which used to be a window where poking returned nothing at all — answers with {@link SULK_LINES}
 * instead. A poke that produces silence is indistinguishable from a poke that produced a bug, and it
 * reads as the character having run out of things to say rather than having decided to stop saying
 * them. After the sulk it comes back on {@link RETURN_LINE} and the whole cycle starts again at the
 * first tier.
 *
 * ## Everything is decided ON the poke, from a timestamp the caller passes in
 *
 * There is no clock in here and nothing to tick. A burst ends because the NEXT poke arrives late,
 * not because time passed while nobody was looking — the same shape `daily/streak.ts` uses for the
 * same reason, and it means the whole escalation is testable without faking a clock.
 *
 * ## English-only, deliberately
 *
 * Same line the opponents' barks are on (`game/opponents.ts`): the names and descriptions a player
 * READS to make a choice go through `t()`, and flavour heard once while looking at a face does not.
 * These are the second kind. Translating them would put ~30 more entries under the compile-time
 * parity guarantee for text that is on screen for two seconds.
 */

import type { VoiceMood } from '../audio/voiceRegistry'

export interface MascotRemark {
  line: string
  mood: VoiceMood
}

interface Tier {
  /** Pokes needed to reach this tier. The first tier's is always 1. */
  from: number
  mood: VoiceMood
  lines: readonly string[]
}

/**
 * A burst ends after this long without a poke, and the character goes back to being pleased to see
 * you.
 *
 * Long enough that a player who prods it, reads the line, and prods again is still in the same
 * conversation; short enough that coming back to the menu after a match does not resume an argument
 * nobody remembers starting.
 */
export const FORGET_MS = 9000

/**
 * How long it refuses to discuss the matter once it has run out of patience.
 *
 * **Three seconds, down from four and a half.** It is a comic beat, not a penalty: long enough that
 * the refusal registers, short enough that a player mashing the character does not conclude it has
 * stopped working. Poking during it is answered — see {@link SULK_LINES} — so the length is about
 * how long it stays cross, not about how long it stays silent.
 */
export const SULK_MS = 3000

/**
 * The tiers, mildest first.
 *
 * It is a coin in a top hat with a moustache, so the seam the jokes run along is DIGNITY — it is
 * valuable, it is well dressed, and it is being prodded by a giant finger. Every line is short
 * enough to finish typing before a player's thumb comes down again.
 */
export const TIERS: readonly Tier[] = [
  {
    from: 1,
    mood: 'calm',
    lines: [
      'Yes? I was admiring my own rim.',
      'Careful. I am legal tender.',
      'A gentleman coin, at your service.',
      'Mind the hat.',
      'I am worth rather a lot, you know.',
      'Heads or tails? Do not answer that.',
    ],
  },
  {
    from: 4,
    mood: 'calm',
    lines: [
      'I am not a doorbell.',
      'There is a Play button. Just there.',
      'Poke the discs. That is what they are for.',
      'You have done that four times now.',
      'I do have a game to introduce.',
    ],
  },
  {
    from: 7,
    mood: 'alarm',
    lines: [
      'ENOUGH. The hat is crooked now.',
      'Right! That is quite enough poking!',
      'I shall be filing a complaint!',
      'I am not a toy! I am a COIN!',
      'Stop that at once!',
    ],
  },
]

/**
 * What it says while sulking — short, flat refusals rather than nothing at all.
 *
 * These exist because the sulk used to return `null` and a silent poke reads as a broken button, or
 * worse, as a character that has run out of lines. A grudging "Hmph." says the opposite: it has
 * plenty left and is declining to spend them on you.
 */
export const SULK_LINES: readonly string[] = ['Hmph.', 'No.', 'I am not speaking to you.', 'Still no.']

/** The one line that plays when a sulk has expired and the player pokes again. Deliberately a single
 * line and not a pool: it is a beat, and hearing it every time is what makes it read as one. */
export const RETURN_LINE = 'Fine. But gently.'

export interface MascotChat {
  /** The remark for a poke at `now`. **Never `null`** — see the module note on why nothing ever runs
   * out, including while it is refusing to talk. */
  poke(now: number): MascotRemark
  /** Pokes counted in the current burst, for a caller that wants to react to the mood itself. */
  readonly pokes: number
  reset(): void
}

/** The sulk pool's slot in the same rotation map the tiers use. Negative so it can never collide
 * with a tier's `from`, which is a poke count and therefore positive. */
const SULK_CURSOR = -1

export function createMascotChat(): MascotChat {
  const cursor = new Map<number, number>()
  let pokes = 0
  let lastPoke = -Infinity
  let sulkUntil = -Infinity

  return {
    get pokes() {
      return pokes
    },

    poke(now: number): MascotRemark {
      if (now < sulkUntil) {
        const index = (cursor.get(SULK_CURSOR) ?? -1) + 1
        cursor.set(SULK_CURSOR, index)
        return { line: SULK_LINES[index % SULK_LINES.length], mood: 'alarm' }
      }

      // Coming back from a sulk, or from long enough away that the burst is over. The two are one
      // branch on purpose: both mean "this is a fresh conversation", and only the first of them has
      // anything to apologise for.
      const returning = sulkUntil > -Infinity && now >= sulkUntil
      if (returning || now - lastPoke > FORGET_MS) {
        pokes = 0
        const wasSulking = returning
        sulkUntil = -Infinity
        if (wasSulking) {
          pokes = 1
          lastPoke = now
          return { line: RETURN_LINE, mood: 'calm' }
        }
      }

      pokes++
      lastPoke = now

      // The last tier is also the limit: exhaust its lines and the character stops discussing it.
      const top = TIERS[TIERS.length - 1]
      if (pokes >= top.from + top.lines.length) {
        sulkUntil = now + SULK_MS
        pokes = 0
        const index = (cursor.get(SULK_CURSOR) ?? -1) + 1
        cursor.set(SULK_CURSOR, index)
        return { line: SULK_LINES[index % SULK_LINES.length], mood: 'alarm' }
      }

      let tier = TIERS[0]
      for (const candidate of TIERS) if (pokes >= candidate.from) tier = candidate

      // Rotation rather than a random pick, per tier — the same reason `game/speech.ts` rotates:
      // with five alternatives a uniform pick repeats about a fifth of the time, and a repeat is the
      // one artefact having alternatives exists to prevent.
      const index = (cursor.get(tier.from) ?? -1) + 1
      cursor.set(tier.from, index)
      return { line: tier.lines[index % tier.lines.length], mood: tier.mood }
    },

    reset() {
      cursor.clear()
      pokes = 0
      lastPoke = -Infinity
      sulkUntil = -Infinity
    },
  }
}
