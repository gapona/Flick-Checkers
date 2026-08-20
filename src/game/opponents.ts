/**
 * **The opponents** — eighteen characters, in the order the player meets them.
 *
 * A character is DATA: a search budget, a shake, an evaluation bias, a name, a description, a
 * portrait frame, a voice profile, and its lines. There is no per-character code anywhere in the
 * game and there must not be one — a new opponent is a row in this file, and if one ever needs a
 * branch somewhere else then the thing it needs is a new knob here, not a special case there.
 *
 * **Pure TypeScript, no Phaser**, like the rest of `src/game/` — so `npm run verify:bot` and
 * `npm run verify:content` read it directly under Node.
 *
 * ## They replace Easy / Medium / Hard
 *
 * The three difficulty levels were three pairs of numbers with no face on them. These are the same
 * numbers with a face, plus one axis those three never had — see {@link OpponentPersona.weights}.
 * `SaveState.difficulty` became `SaveState.opponent`, and `migrate.ts` maps the three old values
 * onto three of these.
 *
 * ## What actually varies, and what deliberately does not
 *
 * CHAPAEV-PLAN.md §6's rule survives intact and is the reason this works at all: **difficulty is not
 * different logic, it is noise.** Every character runs the same search over the same candidates and
 * picks the same way. What a row may change is only:
 *
 * - `candidates` — how many shots it looks at. More is a bot that has CONSIDERED more, never one
 *   that considers better.
 * - `angleSigma` / `powerSigma` — how badly its hand shakes on the shot it already chose. This is
 *   what makes a weak opponent read as a person misjudging rather than as a machine playing badly,
 *   and it is why noise is applied AFTER the choice, never to the choosing.
 * - `weights` — what it is trying to DO, which the old three levels could not express at all. The
 *   search already takes a weight vector per call (`bot/search.ts`'s `SearchOptions.weights`), so a
 *   character that hoards its discs and one that trades them off are the same code reading a
 *   different row. This is the axis that makes eighteen characters worth having over three levels: with
 *   noise alone, opponent five and opponent six differ only in how often they fluff.
 *
 * **A character may not cheat, and there is nothing here that could.** No row can see the board
 * differently, take two shots, or be handed a better solver — the fields above are the whole
 * surface. Once a player suspects the opponent is cheating, every good shot it plays reads as
 * cheating too.
 *
 * ## The order is the story, not a measurement
 *
 * The ladder is fixed by character. `npm run verify:bot` asserts that it HOLDS — that each
 * character beats the one below it more often than not — and when a character lands far from where
 * it should, the fix is its coefficients and never its position in this array. A raw recruit does
 * not become better than a marshal by measuring well.
 */

import type { EvaluationWeights } from '../bot/evaluate'
import type { BotQuirks } from '../bot/search'
import type { StringKey } from '../i18n/strings'
import type { CadenceId, VoiceProfile } from '../audio/voiceRegistry'

const DEGREE = Math.PI / 180

/**
 * The ten moments a character can speak at. Every character carries an entry for each, with several
 * alternatives — `npm run verify:content` enforces both, so nobody can ship half-mute.
 *
 * These are Chapaev's moments, not a port of another game's: the two that carry this game
 * specifically are {@link SpeechLines.onOwnBlunder} (it shot one of its OWN discs off the board,
 * which is the defining Chapaev disaster and has no equivalent in a game played on a grid) and
 * {@link SpeechLines.onOwnCombo} (§5's multiplier moment).
 */
export interface SpeechLines {
  /**
   * **The player has just tapped this character in the picker.** The only trigger that fires outside
   * a match, and the only one a player hears on purpose rather than as a consequence.
   *
   * Separate from {@link SpeechLines.onMatchStart} rather than reusing it, because the two are
   * different moments: `onMatchStart` is said to a board with the discs already laid out, and this is
   * said to somebody deciding whether to pick you. A character sizing up the player is the whole
   * content of this trigger, and "Line up. We begin." is not that.
   */
  onPicked: string[]
  /** A round is starting. */
  onMatchStart: string[]
  /** Its shot touched one of yours and took nothing off. */
  onOwnHit: string[]
  /** Its shot touched nothing at all. */
  onOwnMiss: string[]
  /** It knocked one of your discs off. */
  onOwnKnockout: string[]
  /** It knocked two or more off in one shot. */
  onOwnCombo: string[]
  /** It knocked one of its OWN discs off — the Chapaev disaster. */
  onOwnBlunder: string[]
  /** You knocked one of its discs off. */
  onPlayerKnockout: string[]
  /**
   * **You knocked one of your OWN discs off** — the same disaster as {@link
   * SpeechLines.onOwnBlunder}, seen from the other side of the board, and the funniest moment this
   * game has. It had no trigger at all: the opponent watched you post your own disc into the void
   * and said nothing, which is the one time a character with a face has to have an opinion.
   */
  onPlayerBlunder: string[]
  /** It is down to two discs or fewer. */
  onLowDiscs: string[]
  onWin: string[]
  onLose: string[]
}

export type SpeechTrigger = keyof SpeechLines

/** Every trigger name, for the suites and for the scheduler. Written out rather than derived from an
 * object, since a `keyof` of an interface has no runtime value. */
export const SPEECH_TRIGGERS: readonly SpeechTrigger[] = [
  'onPicked',
  'onMatchStart',
  'onOwnHit',
  'onOwnMiss',
  'onOwnKnockout',
  'onOwnCombo',
  'onOwnBlunder',
  'onPlayerKnockout',
  'onPlayerBlunder',
  'onLowDiscs',
  'onWin',
  'onLose',
]

/**
 * The numbers that make one character play differently from another.
 *
 * `candidates`, `angleSigma` and `powerSigma` are exactly the old `BotLevel`'s three fields, under
 * the same names, because they are the same knobs — `bot/search.ts` reads this object directly.
 */
export interface OpponentPersona {
  /** Upper bound on shots evaluated per move. The search is exact within this budget. */
  candidates: number
  /** Standard deviation of the angle error added to the chosen shot, in radians. */
  angleSigma: number
  /** Standard deviation of the power error, as a fraction of the chosen power. */
  powerSigma: number
  /**
   * What this character is trying to achieve, as an override on `DEFAULT_WEIGHTS`.
   *
   * Partial on purpose: a row states only the terms it cares about, so reading one tells you what
   * makes the character itself rather than restating the seven every one of them shares. Omit it
   * entirely for a character that simply plays the game well or badly.
   */
  weights?: Partial<EvaluationWeights>
  /**
   * How it plays, as opposed to how well — `bot/search.ts`'s {@link BotQuirks}.
   *
   * **This is the axis that makes a cast worth having over a slider.** Strength alone cannot tell
   * two characters apart at the same rung: with noise and weights only, opponent five and opponent
   * six differ in how often they fluff and in what they are counting. A quirk is a HABIT — which
   * powers it will use at all, how wide a fan it looks through, whether it goes for the strays or
   * the middle of the formation, how much harder it pulls than it meant to — and a habit is a thing
   * a player can learn and then exploit, which is what makes a rematch a different game.
   *
   * None of them can cheat: every field either removes options from the character or biases it
   * toward a worse one. See `BotQuirks`.
   */
  quirks?: BotQuirks
}

export interface Opponent {
  /**
   * Permanent. It is the value stored in `SaveState.opponent` and the string written into
   * `SaveState.defeated`, so renaming one un-picks the player's chosen opponent and erases their
   * progress against it.
   */
  id: string
  nameKey: StringKey
  descKey: StringKey
  /** Frame name in the `portraits` atlas (`ui/portrait.ts`). Required: a character without a face is
   * a bug rather than a state, and `verify:content` checks this list against the atlas both ways. */
  portrait: string
  /** WHAT it sounds like: which seven syllables come out of the sprite. Shared between characters. */
  voice: VoiceProfile
  /**
   * HOW it speaks — `audio/voiceRegistry.ts`'s {@link CadenceId}: base pitch, how far the pitch
   * wanders per syllable, how often one lands, and whether the chain waits for a vowel.
   *
   * **Orthogonal to `voice` on purpose.** Two characters on one timbre and two cadences do not sound
   * alike, which is what stops eighteen opponents needing eighteen syllable sets — and it is the axis
   * that lets a deep, sparing marshal and a deep, gruff cook share `gruff` without being the same
   * person.
   */
  cadence: CadenceId
  persona: OpponentPersona
  lines: SpeechLines
}

/**
 * The gallery, weakest first.
 *
 * The comment above each one says what it is DOING, because that is the thing the numbers encode and
 * the thing a player is meant to feel. Measured strength lives in `verify:bot`'s output.
 */
export const OPPONENTS: readonly Opponent[] = [
  {
    // Barely looks, shakes badly, and does not mind losing his own discs — so he posts them off the
    // far edge at full power, which is exactly what a beginner does and exactly what a beginner
    // needs to see someone else do first.
    id: 'recruit',
    nameKey: 'oppRecruit',
    descKey: 'oppRecruitDesc',
    portrait: 'recruit.png',
    voice: 'squeak',
    cadence: 'cute',
    persona: {
      candidates: 40,
      angleSigma: 10 * DEGREE,
      powerSigma: 0.3,
      weights: { ownLoss: -1, nearEdge: -0.5, wasted: -1 },
      // He knows one shot and it is the big one. `powerScale` is what actually puts his own discs
      // over the far edge as often as yours — he aims the right shot and drives a third past it.
      quirks: { powers: [1], powerScale: 1.35 },
    },
    lines: {
      onPicked: ['Me? You want ME?', 'I will do my best, honest!', 'Do not tell the sergeant I am nervous.'],
      onMatchStart: ['Sergeant said to just aim.', 'First real match. Ready!', 'Which end do I flick?'],
      onOwnHit: ['I touched it! That counts!', 'Contact! I think.', 'That was aimed. Mostly.'],
      onOwnMiss: ['Ranging shot. Only ranging.', 'The board is crooked.', 'I meant to go past it.'],
      onOwnKnockout: ['Off it went! I did that!', 'One down! Write it down!', 'It worked! Why did it work?'],
      onOwnCombo: ['TWO! I got two!', 'Both of them! Both!', 'Did everyone see that?'],
      onOwnBlunder: ['That was mine. That was mine!', 'Wrong disc. Sorry.', 'Come back! Please come back.'],
      onPlayerKnockout: ['Hey, I was using that.', 'Aw. Not that one.', 'That was my good one.'],
      onPlayerBlunder: ['You did that one for me!', 'Was that on purpose?', 'Even I know not to do that.'],
      onLowDiscs: ['Two left. Is two bad?', 'Running out of army here.', 'I should fetch the sergeant.'],
      onWin: ['I won! Someone tell my mother!', 'Wait — that means I won?', 'Best day of my service!'],
      onLose: ['I will do better tomorrow.', 'Nobody saw that, right?', 'Can we go again?'],
    },
  },
  {
    // ~86. One shot, played as hard as it goes, through a fan twice as wide as anyone else looks
    // through — so he finds angles a better player would never consider and takes almost none of
    // them well. Louder than the recruit and barely better.
    id: 'drummer',
    nameKey: 'oppDrummer',
    descKey: 'oppDrummerDesc',
    portrait: 'drummer.png',
    voice: 'squeak',
    cadence: 'cute',
    persona: {
      // **96, and the number is set by the quirk rather than by the strength.** `aimSpread` widens
      // the FAN, and a budget that only stretches to one angle per target has no fan to widen — the
      // same trap the sniper's own note describes, caught by `verify:content` rather than by
      // reading. 96 is the first budget at which he gets three angles, and looking at more shots
      // than the cook does costs him nothing: he still fires all of them flat out.
      candidates: 96,
      angleSigma: 8 * DEGREE,
      powerSigma: 0.24,
      weights: { knockout: 4, ownLoss: -1, wasted: -0.5 },
      quirks: { powers: [1], aimSpread: 1.6 },
    },
    lines: {
      onPicked: ['Pick me! I am very loud!', 'I brought the drum!', 'Shall I play us in?'],
      onMatchStart: ['Drum roll! Then we begin!', 'I keep the beat. And the board.', 'Loud is a plan.'],
      onOwnHit: ['BOOM! Heard that one!', 'Rattle! That is a hit!', 'Struck it. On the beat.'],
      onOwnMiss: ['Off the beat. One moment.', 'Wide! Wider than I wanted.', 'That was a flourish.'],
      onOwnKnockout: ['Off the board! Roll for it!', 'One down! Drum it!', 'Hah! Straight through!'],
      onOwnCombo: ['Two! On one beat!', 'Double roll! Two of them!', 'Nobody drums like that!'],
      onOwnBlunder: ['That was ours. That was OURS.', 'Too hard. Always too hard.', 'Wrong drum entirely.'],
      onPlayerKnockout: ['Hey! That one kept time!', 'You broke my rhythm.', 'That was my loud one.'],
      onPlayerBlunder: ['You did that yourself!', 'No drum needed for that one.', 'Off it goes! Yours!'],
      onLowDiscs: ['Two left. Quiet band now.', 'The drum is getting lonely.', 'Fewer of us every beat.'],
      onWin: ['Sound the roll! I won!', 'Loudest wins. Obviously.', 'Somebody fetch a bigger drum!'],
      onLose: ['I will drum louder next time.', 'The beat was fine. I was not.', 'Well drummed, anyway.'],
    },
  },
  {
    // Civilian, and the first player you meet who never enlisted. She takes what is already falling —
    // `targeting: 'exposed'` — and does it at full force with nothing else in the bag, so she is
    // lethal to a disc left on the rim and harmless to a tight formation. Beat her by not leaving
    // anything loose, which is the first real lesson this ladder teaches.
    id: 'fishwife',
    nameKey: 'oppFishwife',
    descKey: 'oppFishwifeDesc',
    portrait: 'fishwife.png',
    voice: 'nasal',
    cadence: 'grumpy',
    persona: {
      candidates: 110,
      angleSigma: 6.6 * DEGREE,
      powerSigma: 0.22,
      // She will trade two of hers for one of yours and reckon she had the better of it.
      weights: { knockout: 4, ownLoss: -2 },
      quirks: { targeting: 'exposed', powers: [1] },
    },
    lines: {
      onPicked: ['Come to buy, or to lose?', 'Mind the apron. It bites.', 'You have the look of a bad customer.'],
      onMatchStart: ['A board is a stall. Clear it.', 'I have haggled harder than this.', 'Quick, then. I close at noon.'],
      onOwnHit: ['Got a hand on it.', 'Felt that, did you.', 'That is a touch, and it counts.'],
      onOwnMiss: ['Ach. Wind off the river.', 'I have thrown better fish.', 'Not a scratch. Fine.'],
      onOwnKnockout: ['Off with it. Next!', 'Sold, gone, away.', 'That one was going off anyway.'],
      onOwnCombo: ['Two for the price of one!', 'A pair! Wrap them up!', 'Both of them, would you look.'],
      onOwnBlunder: ['That was MY fish.', 'Oh, you wretched table.', 'I paid good money for that one.'],
      onPlayerKnockout: ['Thief! In broad daylight!', 'You take that off my count.', 'Have it, then. Have it.'],
      onPlayerBlunder: ['You did my work for me!', 'Even the gulls aim better.', 'Ha! Put it on your own bill.'],
      onLowDiscs: ['The stall is looking bare.', 'Down to the last of the catch.', 'Two left, and both smell off.'],
      onWin: ['Cleared out before noon.', 'That is how you close a stall.', 'Next! Who is next?'],
      onLose: ['Bah. Come back Thursday.', 'You caught me on a bad tide.', 'Take it and go.'],
    },
  },
  {
    // Sound aim, no ambition. Values her own discs so far above yours that she will decline a clean
    // trade and nudge instead — safe, slow, and beatable by anyone willing to actually shoot.
    id: 'cook',
    nameKey: 'oppCook',
    descKey: 'oppCookDesc',
    portrait: 'cook.png',
    voice: 'gruff',
    cadence: 'grumpy',
    persona: {
      candidates: 90,
      // **"Sound aim, no ambition" is her description, and her numbers said neither.** At 7 degrees
      // she had the fourth-shakiest hand in the game — worse than the fishwife written BELOW her at
      // 6.6 — so she was handicapped on all four axes at once (aim, a budget under both characters
      // beneath her, `knockout` below its default and `ownLoss` at double it) while the text names
      // exactly one of them. She measured second-weakest of eighteen while sitting fourth.
      //
      // The ambition is the character and is untouched: the weights below still refuse the trades
      // that win rounds, and adding force does not move her (the third power took her from 0.61 to
      // 0.77 enemy discs a shot and her win rate not at all — measured). What she gets back is the
      // aim she is already described as having. 4.6/0.14 measures 23.5% against 11.5%.
      angleSigma: 4.6 * DEGREE,
      powerSigma: 0.14,
      weights: { knockout: 2, ownLoss: -8, nearEdge: -4, approach: 0.2 },
      // Nudges. She will not drive at full power and taps a little under even what she chose — which
      // is why a board against her fills up with discs nobody has managed to remove.
      //
      // **The third power, 0.85, is what makes "never uses full force" a habit instead of a
      // handicap, and it applies to all five characters that carry this quirk.** Measured over the
      // whole cast at 200 rounds each against a fixed reference (`npm run tournament`), the five
      // barred from full force removed **0.83 enemy discs a shot against everyone else's 1.25**,
      // needed 11.8 shots to finish a round against 9.5, and won 29.2% against 42.3%. That is a
      // 13-point penalty no rung's budget or aim ever paid for: all three inverted steps on the
      // ladder had one of these five on one side, and the chessmaster — written second from the top
      // — played like rung 10 and lost 83% of its duels to the sniper below it.
      //
      // `1` is still excluded, so the stated habit is intact: none of them ever drives at full
      // power. What changed is that "does not use force" had come to mean "cannot take a disc off
      // the board", and a habit that removes every option which works is a handicap wearing a
      // habit's name. At the shipped power curve 0.85 travels 9.5 cells against 0.7's 7.5 and a full
      // 11.6 — a real drive with the ceiling still off limits.
      //
      // **`powerScale` was 0.88 and 0.88 made her inert.** Her strongest permitted shot is 0.7, and
      // 0.7 x 0.88 could not cross the gap between the opening ranks on any branch — so she never
      // touched an enemy disc from a starting position at all. That is not a habit, it is a
      // character that cannot open, and `verify:content` now measures it for the whole cast (the
      // check that caught this). 0.95 is the smallest value that clears the tanks board, which is
      // the tightest of the five because tanks' own friction of x1.15 shortens everything on it.
      quirks: { powers: [0.45, 0.7, 0.85], powerScale: 0.95 },
    },
    lines: {
      onPicked: ['If you insist. Let me put the pot down.', 'I would rather be cooking.', 'Nobody gets hurt. Agreed?'],
      onMatchStart: ['Soup first, war after.', 'Let us keep this tidy.', 'Nobody gets hurt. Ideally.'],
      onOwnHit: ['A nudge. That is plenty.', 'Gentle does it.', 'No need to be dramatic.'],
      onOwnMiss: ['Saving the good ones.', 'A careful pass.', 'I was not committed to that.'],
      onOwnKnockout: ['Well. That escalated.', 'One off. Regrettable.', 'It had it coming, I suppose.'],
      onOwnCombo: ['Two? I did not intend two.', 'Goodness. Both of them.', 'That was more than planned.'],
      onOwnBlunder: ['That was one of ours!', 'Oh, that is a waste.', 'Straight into the pot. Wrong pot.'],
      onPlayerKnockout: ['That one peeled potatoes.', 'A shame. A real shame.', 'You are hard on my lads.'],
      onPlayerBlunder: ['Into the pot it goes. Yours.', 'You are doing my work for me.', 'Oh dear. That was yours.'],
      onLowDiscs: ['Thin rations now.', 'Two left in the pot.', 'This is a small kitchen.'],
      onWin: ['Steady wins it. Sit, eat.', 'No heroics required.', 'Told you. Patience.'],
      onLose: ['Too careful, was I.', 'Should have used the ladle.', 'Back to the kitchen.'],
    },
  },
  {
    // The baseline. Default weights, moderate budget, a visible but human shake — the character
    // every other one is felt against, and the one a v3 save's `medium` becomes.
    id: 'sergeant',
    nameKey: 'oppSergeant',
    descKey: 'oppSergeantDesc',
    portrait: 'sergeant.png',
    voice: 'gruff',
    cadence: 'grumpy',
    // **No quirks, and that is his character.** Every power, the plain fan, the nearest enemy: he
    // is the one the others are felt against, and a player who has beaten him knows what the game
    // looks like played straight.
    persona: { candidates: 160, angleSigma: 4 * DEGREE, powerSigma: 0.12 },
    lines: {
      onPicked: ['Good. Someone who wants a straight game.', 'By the book, then.', 'Stand ready.'],
      onMatchStart: ['Line up. We begin.', 'By the book, then.', 'Stand ready.'],
      onOwnHit: ['Contact. Reload.', 'Solid enough.', 'That will do.'],
      onOwnMiss: ['Wide. Correcting.', 'Noted. Adjusting.', 'Short. Again.'],
      onOwnKnockout: ['Off the board. Next.', 'That is one.', 'Clean enough.'],
      onOwnCombo: ['Two with one flick.', 'Both of them. Good.', 'That is how it is done.'],
      onOwnBlunder: ['Blast. That was ours.', 'Own man off. Unforgivable.', 'I will hear about that.'],
      onPlayerKnockout: ['Lost one. Hold the line.', 'That stings.', 'Steady. Steady.'],
      onPlayerBlunder: ['Own man off. I have seen it.', 'That one is on you, not me.', 'Discipline, soldier.'],
      onLowDiscs: ['Two left. Hold.', 'The line is thin.', 'We fight with what we have.'],
      onWin: ['Fall in. We are done.', 'Discipline wins it.', 'As instructed.'],
      onLose: ['Outplayed. Fairly.', 'I will drill harder.', 'Well shot. Dismissed.'],
    },
  },
  {
    // ~72. Will not take a shot that risks one of his own, and only ever aims at discs that are
    // already near an edge — `targeting: 'exposed'` is the whole character. Patient, harmless while
    // your discs are safe, and quietly ahead by the end if they are not.
    id: 'medic',
    nameKey: 'oppMedic',
    descKey: 'oppMedicDesc',
    portrait: 'medic.png',
    voice: 'nasal',
    cadence: 'measured',
    persona: {
      candidates: 180,
      angleSigma: 3.8 * DEGREE,
      powerSigma: 0.11,
      weights: { knockout: 2.5, ownLoss: -9, nearEdge: -4.5, wasted: -0.5 },
      quirks: { targeting: 'exposed', powerScale: 0.9 },
    },
    lines: {
      onPicked: ['I would rather we did not.', 'Try not to make work for me.', 'I will be gentle. You should be too.'],
      onMatchStart: ['Try not to make work for me.', 'Bandages ready. Sadly.', 'Let us keep this survivable.'],
      onOwnHit: ['A tap. Nothing broken.', 'Contact. Minor.', 'That will bruise, no more.'],
      onOwnMiss: ['No harm done, then.', 'A clean miss is still clean.', 'I will not chase it.'],
      onOwnKnockout: ['That one was already going.', 'I only helped it along.', 'It was standing too close.'],
      onOwnCombo: ['Two? I did not mean two.', 'Oh dear. Both of them.', 'That is more paperwork.'],
      onOwnBlunder: ['I have hurt my own man.', 'That is exactly my job, reversed.', 'Unforgivable. Truly.'],
      onPlayerKnockout: ['I cannot mend that one.', 'Straight off the table.', 'A pity. He was doing well.'],
      onPlayerBlunder: ['Self-inflicted. I note it.', 'I have seen this injury before.', 'You did not need my help.'],
      onLowDiscs: ['Two patients left.', 'The ward is nearly empty.', 'I am running out of men.'],
      onWin: ['Everyone home. Mostly.', 'Patience treats most things.', 'No heroics. No casualties. Mine.'],
      onLose: ['I will see to the wounded.', 'You were quicker than the bandages.', 'Well played. Sit down.'],
    },
  },
  {
    // Civilian, elderly, and the narrowest player in the game before the sniper: `aimSpread: 0.5`
    // with every power short of the full drive. He will not play a shot he cannot be sure of, so he never
    // finds a bank and never hands one over either. Patience beats him; force does not.
    id: 'watchmaker',
    nameKey: 'oppWatchmaker',
    descKey: 'oppWatchmakerDesc',
    portrait: 'watchmaker.png',
    voice: 'dry',
    cadence: 'robotic',
    persona: {
      candidates: 240,
      // **1.9 degrees and 0.04 were a rung-16 hand on a rung-6 character, and the ban on full force
      // had been hiding it.** With the third power added (see the cook's note), the watchmaker jumped
      // +14 points and overshot six places up the ladder — measured, `npm run tournament`. His stated
      // character is the NARROW FAN below (`aimSpread`, "will not play a shot he cannot be sure of"),
      // which is a habit; a marksman's steadiness was never part of it and is a different coefficient.
      // So the fan stays and the hand shakes like the rung it sits on.
      angleSigma: 3.6 * DEGREE,
      powerSigma: 0.11,
      // Losing a disc of his own is the intolerable outcome; taking one of yours is merely pleasant.
      weights: { ownLoss: -6, nearEdge: -3 },
      quirks: { aimSpread: 0.5, powers: [0.45, 0.7, 0.85] },
    },
    lines: {
      onPicked: ['One moment. I am counting.', 'Sit. Do not touch the table.', 'You are early. Or I am slow.'],
      onMatchStart: ['Every piece has its place.', 'We begin. Quietly.', 'Do not hurry me.'],
      onOwnHit: ['A touch, as measured.', 'There. Half a turn.', 'Contact, within tolerance.'],
      onOwnMiss: ['Out by a hair.', 'This bench is not level.', 'I shall adjust.'],
      onOwnKnockout: ['Removed, cleanly.', 'One fewer to account for.', 'That is the mechanism.'],
      onOwnCombo: ['Two, in one movement.', 'The whole train moved.', 'Ah. That was satisfying.'],
      onOwnBlunder: ['My own. Unforgivable.', 'I have ruined the count.', 'Sixty years, and still.'],
      onPlayerKnockout: ['You have cost me an hour.', 'That one was set.', 'Noted. Not forgiven.'],
      onPlayerBlunder: ['You wound it too tight.', 'Force is not precision.', 'Hm. Careless.'],
      onLowDiscs: ['Two left. Both must count.', 'The spring is nearly out.', 'Little time left on the face.'],
      onWin: ['On the hour, as it should be.', 'The mechanism holds.', 'Wound, set, and done.'],
      onLose: ['You were faster than the hand.', 'I mis-set it. Twice.', 'Come back when I have slept.'],
    },
  },
  {
    // Plays position rather than kills: takes almost nothing off, but every shot leaves your discs
    // nearer an edge and his own further from one. Loses to anyone who out-shoots him and beats
    // anyone who waits.
    id: 'quartermaster',
    nameKey: 'oppQuartermaster',
    descKey: 'oppQuartermasterDesc',
    portrait: 'quartermaster.png',
    voice: 'nasal',
    cadence: 'robotic',
    persona: {
      candidates: 260,
      angleSigma: 3 * DEGREE,
      powerSigma: 0.09,
      weights: { knockout: 2, approach: 1.5, expose: 3, nearEdge: -3.5 },
      // Measured nudges only. The weights already say he would rather move your disc toward an edge
      // than take it; declining the drive is what makes that visible instead of merely true.
      quirks: { powers: [0.45, 0.7, 0.85] },
    },
    lines: {
      onPicked: ['I have your file. It is thin.', 'Let us open an account.', 'Every disc will be counted.'],
      onMatchStart: ['Opening the ledger.', 'Everything counted. Begin.', 'Let us balance this.'],
      onOwnHit: ['Entered in the column.', 'A small credit.', 'Position improves.'],
      onOwnMiss: ['A minor write-off.', 'Cost of doing business.', 'Filed under variance.'],
      onOwnKnockout: ['Struck from your inventory.', 'Account closed.', 'One line item resolved.'],
      onOwnCombo: ['Two entries at once.', 'An efficient transaction.', 'The column balances early.'],
      onOwnBlunder: ['That is a capital loss.', 'My own stock. Dreadful.', 'The audit will note this.'],
      onPlayerKnockout: ['Deduct one. Regrettably.', 'My books do not like this.', 'An unbudgeted loss.'],
      onPlayerBlunder: ['You debit your own column.', 'A self-inflicted write-off.', 'I did not even bill you.'],
      onLowDiscs: ['The balance runs thin.', 'Two assets remaining.', 'We approach insolvency.'],
      onWin: ['The accounts are settled.', 'Balanced to the last flick.', 'A profitable engagement.'],
      onLose: ['A loss, properly recorded.', 'I shall file the deficit.', 'The figures were against me.'],
    },
  },
  {
    // All-in. Prices a knockout at double and barely counts his own losses, so he trades every time
    // a trade is on the table — spectacular, and it empties his own back rank as fast as yours.
    id: 'cavalry',
    nameKey: 'oppCavalry',
    descKey: 'oppCavalryDesc',
    portrait: 'cavalry.png',
    voice: 'booming',
    cadence: 'measured',
    persona: {
      candidates: 260,
      angleSigma: 3.5 * DEGREE,
      powerSigma: 0.14,
      weights: { knockout: 6, ownLoss: -1.5, nearEdge: -0.5, approach: 1 },
      // A charge does not tap. He will not look at the gentle power at all, and rides a little
      // harder than he meant to on top of that.
      quirks: { powers: [0.7, 1], powerScale: 1.12 },
    },
    lines: {
      onPicked: ['At last! Someone with nerve!', 'Then we ride. Now!', 'Do keep up.'],
      onMatchStart: ['At them! No waiting!', 'Sabres out. Ride!', 'Speed decides this.'],
      onOwnHit: ['Through them!', 'Felt that one!', 'Again! Press!'],
      onOwnMiss: ['Wide! Wheel about!', 'Missed. No matter. Charge!', 'The horse turned.'],
      onOwnKnockout: ['Ridden down!', 'Off the field with him!', 'That is how a charge ends!'],
      onOwnCombo: ['Two in one charge!', 'Straight through the line!', 'They scattered! Both!'],
      onOwnBlunder: ['My own rider! Cursed angle!', 'That was one of mine!', 'Too much sabre, too little sense.'],
      onPlayerKnockout: ['A hit! Ride on!', 'We lose one. Charge anyway.', 'No time to mourn.'],
      onPlayerBlunder: ['You unhorsed your own rider!', 'Ha! Save me the trouble!', 'Wrong direction entirely!'],
      onLowDiscs: ['Two riders left! Ride!', 'The squadron thins!', 'Then we charge harder!'],
      onWin: ['The field is ours!', 'Speed! Always speed!', 'Sound the recall!'],
      onLose: ['Ridden down. Fairly.', 'A better charge won it.', 'Regroup. We ride again.'],
    },
  },
  {
    // Civilian, and the only player in the game with a hole in the middle of her range: `powers:
    // [0.45, 1]` is a tap or a hammer and nothing between, so every shot is either a nudge you can
    // ignore or a drive that overruns. The gap shows inside one round and can be played against.
    id: 'schoolteacher',
    nameKey: 'oppTeacher',
    descKey: 'oppTeacherDesc',
    portrait: 'schoolteacher.png',
    // Not `airy`, which she was first: that is the scout's and the sniper's timbre, and on
    // `measured` all three came out as the same person. See `verify:content`, which now counts.
    voice: 'squeak',
    cadence: 'measured',
    persona: {
      candidates: 300,
      // **2.6 degrees and 0.08 measured four places above her rung, because her quirk is nearly
      // free.** `powers: [0.45, 1]` removes the MIDDLE of the range, and the search wants full power
      // roughly nine shots in ten — so the hole she is written around costs her almost nothing, and
      // her strength was coming from a hand two rungs better than her neighbours'. Compare the cook,
      // whose restriction removes the TOP and was crippling: the same quirk is worth very different
      // amounts depending on which end it takes. `npm run tournament` measured the pair.
      //
      // The hole stays, because it is what a player can see and play against within one round; the
      // hand is what pays for the rung. 3.4/0.11 measures 42.0% against her old 53.0%.
      angleSigma: 3.4 * DEGREE,
      powerSigma: 0.11,
      // A shot that touches nothing at all is the one thing she will not do twice.
      weights: { wasted: -6 },
      quirks: { powers: [0.45, 1] },
    },
    lines: {
      onPicked: ['Sit anywhere. Not there.', 'Have you played before? Honestly.', 'We shall find out what you know.'],
      onMatchStart: ['Begin. Show me your working.', 'Neatly, please.', 'Both hands on the table.'],
      onOwnHit: ['Correct, so far.', 'That is the idea.', 'Contact. Adequate.'],
      onOwnMiss: ['A poor answer. Mine.', 'I shall mark that wrong.', 'Again, then.'],
      onOwnKnockout: ['That is how it is done.', 'Off the board. Next question.', 'One fewer to explain.'],
      onOwnCombo: ['Two. Copy this down.', 'That is the whole lesson.', 'Did you see the line? Look again.'],
      onOwnBlunder: ['Do not write that down.', 'I have set a poor example.', 'Ignore what I have just done.'],
      onPlayerKnockout: ['Very well. Points to you.', 'A good answer, grudgingly.', 'You were listening after all.'],
      onPlayerBlunder: ['Oh dear. Oh dear.', 'And what did we learn?', 'That goes in the book.'],
      onLowDiscs: ['Two remaining. Concentrate.', 'The margin is gone.', 'This is the difficult part.'],
      onWin: ['A pass. Barely, for you.', 'Class dismissed.', 'Study, and come back.'],
      onLose: ['You have taught me something.', 'Well. Full marks.', 'I shall revise.'],
    },
  },
  {
    // ~52. `aimSpread: 1.9` — he looks through a fan almost twice as wide as anybody else, so his
    // list is full of glancing lines and banks off his own discs that nobody else even scores. Half
    // of them are nonsense. The other half you do not see coming.
    id: 'scout',
    nameKey: 'oppScout',
    descKey: 'oppScoutDesc',
    portrait: 'scout.png',
    voice: 'airy',
    cadence: 'measured',
    persona: {
      candidates: 320,
      angleSigma: 2.8 * DEGREE,
      powerSigma: 0.1,
      weights: { knockout: 4, approach: 1.5, expose: 1.5 },
      quirks: { aimSpread: 1.9 },
    },
    lines: {
      onPicked: ['I have already walked your board.', 'I know a way round you.', 'Interesting. Go on, then.'],
      onMatchStart: ['I have walked this board already.', 'There is always a way round.', 'Let us see the ground.'],
      onOwnHit: ['Told you there was a line.', 'Round the side. There.', 'That angle was free.'],
      onOwnMiss: ['Worth looking at anyway.', 'No path that way, then.', 'Mapped. Not repeating it.'],
      onOwnKnockout: ['Off. Nobody saw that line.', 'The long way round works.', 'That is why I look.'],
      onOwnCombo: ['Two off one angle!', 'I have been saving that line.', 'Both, and neither straight.'],
      onOwnBlunder: ['Wrong path. Very wrong.', 'That line went home. Mine.', 'I misread the ground.'],
      onPlayerKnockout: ['You found a line too.', 'Straight through. Effective.', 'I did not scout that one.'],
      onPlayerBlunder: ['That path led nowhere good.', 'I would not have walked that.', 'Off your own edge. Noted.'],
      onLowDiscs: ['Two left. Time to be clever.', 'Thin ground now.', 'I will find something.'],
      onWin: ['The map wins, not the sabre.', 'I knew the ground.', 'Every line, walked first.'],
      onLose: ['You saw one I missed.', 'Good ground. Well used.', 'I will map it better.'],
    },
  },
  {
    // Power is exact, angle is not. He arrives with precisely the right energy at slightly the wrong
    // place — the character that teaches you what the power half of the slingshot is worth.
    id: 'gunner',
    nameKey: 'oppGunner',
    descKey: 'oppGunnerDesc',
    portrait: 'gunner.png',
    voice: 'dry',
    cadence: 'grumpy',
    persona: {
      candidates: 360,
      // **4 degrees was a rung-4 hand on rung 11, and it measured three places low.** The character
      // is the CONTRAST between his two sigmas, not the absolute size of either — "right force,
      // slightly the wrong place" reads from a `powerSigma` of 0.02 against neighbours running 0.05
      // to 0.10, and it reads at 3 degrees exactly as it did at 4. What 4 also did was make the shake
      // RISE going up the ladder by 1.4 degrees, four times the largest deliberate wobble anywhere
      // else in the cast, which is a different claim from "he misses left and right".
      //
      // **Budget cannot substitute for a hand, and this is where that was measured.** Raising him to
      // 520 and then 700 candidates moved him to 37.0% and 35.5% from 38.5% — nothing, with a
      // downward lean. Past some amount of shake the search is already finding a better shot than the
      // hand can deliver, so the extra candidates are spent on precision that is thrown away
      // immediately afterwards. 3 degrees at the original 360 gives 46.5%, which is where rung 11
      // belongs. Do not treat `candidates` and the sigmas as interchangeable strength knobs.
      angleSigma: 3 * DEGREE,
      powerSigma: 0.02,
      weights: { knockout: 4, expose: 2 },
      // Only the two charges a gun crew would actually load.
      quirks: { powers: [0.7, 1] },
    },
    lines: {
      onPicked: ['Give me the range and I will give you the rest.', 'Powder measured. Your move.', 'Stand well back.'],
      onMatchStart: ['Battery loaded. Ready.', 'Powder measured. Begin.', 'Give me the range.'],
      onOwnHit: ['Range confirmed.', 'On for elevation.', 'Charge was correct.'],
      onOwnMiss: ['Right charge, wrong bearing.', 'Traverse is off, not the powder.', 'Adjust left. Same charge.'],
      onOwnKnockout: ['Struck fair. Sponge out.', 'That is the range.', 'One hull, as measured.'],
      onOwnCombo: ['Two on one charge!', 'A gun crew earns its pay.', 'Enfilade. Textbook.'],
      onOwnBlunder: ['Fired on my own gun.', 'Wrong bearing entirely.', 'Log that. Reluctantly.'],
      onPlayerKnockout: ['Counter-battery. Noted.', 'We lost a piece.', 'Hold the line, reload.'],
      onPlayerBlunder: ['Fired on your own position.', 'Friendly fire. Logged.', 'Wrong bearing. Yours, this time.'],
      onLowDiscs: ['Two guns left in action.', 'The battery is broken.', 'Fight the guns to the end.'],
      onWin: ['Cease fire. Secure.', 'Measured, not guessed.', 'Powder well spent.'],
      onLose: ['Outshot. Fairly.', 'Their gunner was better.', 'Sponge out. It is over.'],
    },
  },
  {
    // Civilian, and the other side of the sapper's coin: `targeting: 'deepest'` again, but driven at
    // 22% over the power he chose rather than tapped. He ignores your strays and shoves into the
    // middle of your formation hard enough to scatter it — and hard enough to put his own disc
    // straight through and out the far side.
    id: 'ferryman',
    nameKey: 'oppFerryman',
    descKey: 'oppFerrymanDesc',
    portrait: 'ferryman.png',
    voice: 'booming',
    cadence: 'grumpy',
    persona: {
      candidates: 400,
      angleSigma: 3.2 * DEGREE,
      powerSigma: 0.05,
      weights: { expose: 2, nearEdge: -3 },
      quirks: { targeting: 'deepest', powerScale: 1.22 },
    },
    lines: {
      onPicked: ['A crossing costs the same either way.', 'Get in. Sit still.', 'The river does not wait. Nor do I.'],
      onMatchStart: ['Push off.', 'Deep water in the middle.', 'Hold on to something.'],
      onOwnHit: ['That is the current.', 'Felt the hull, did you.', 'Nudged you off course.'],
      onOwnMiss: ['Missed the landing.', 'Drifted. It happens.', 'The current took it.'],
      onOwnKnockout: ['Overboard.', 'The river takes one.', 'Down it goes.'],
      onOwnCombo: ['Two over the side!', 'Swamped the pair of them.', 'Hold on — that was a wave.'],
      onOwnBlunder: ['Lost one of my own. Damn.', 'That is my boat, not yours.', 'Bad steering. Mine.'],
      onPlayerKnockout: ['You put me under.', 'Take one, then.', 'That was a paying passenger.'],
      onPlayerBlunder: ['Straight over the side!', 'You rowed that one out yourself.', 'The river thanks you.'],
      onLowDiscs: ['Two aboard. Riding low.', 'Not much left afloat.', 'One more wave and we are done.'],
      onWin: ['All ashore. My side.', 'The crossing is mine.', 'The fare is paid.'],
      onLose: ['You know the water better.', 'Ran me aground.', 'Next crossing, then.'],
    },
  },
  {
    // ~38. `targeting: 'deepest'` — he refuses your strays and works on the discs furthest from any
    // edge, with every power short of the full drive. That is worse play in the short run and horrible to sit
    // across from: your formation comes apart from the middle while your loose discs sit untouched.
    id: 'sapper',
    nameKey: 'oppSapper',
    descKey: 'oppSapperDesc',
    portrait: 'sapper.png',
    voice: 'dry',
    cadence: 'grumpy',
    persona: {
      candidates: 460,
      // **A very steady hand attached to a deliberately stubborn plan — and that is the character,
      // not a contradiction.** He measured three places below rung 13, and of the three axes only
      // this one moved him: 2.2 -> 1.7 degrees did nothing (43.5% against 45.5%, inside the noise)
      // and 1.4 gives 54.0%, which is where rung 13 sits.
      //
      // **`candidates` is a NEGATIVE knob for him, measured over three points: 460 -> 640 -> 820
      // gives 45.5% -> 40.5% -> 39.5%.** Monotone, so not noise. The reason is written down in "The
      // Opponents": a character with a targeting preference does not spend surplus budget on more
      // targets, it buys more ANGLES — and his preference (`targeting: 'deepest'`) is deliberately
      // the worse play. More budget therefore buys a more thoroughly executed bad idea. Together with
      // the gunner, whose budget failed for the opposite reason (4 degrees of shake capped what any
      // search could deliver), this is why `candidates` must not be treated as a general strength
      // knob the way this file used to describe it.
      //
      // At 1.4 he is the fourth-steadiest hand in the game while still losing to the partisan above
      // him, which reads exactly as written: he aims beautifully at the wrong thing. Note it does put
      // a 0.6-degree rise between him and the partisan — the same size as two rises the cast already
      // carries, and at a rung whose neighbour is clearly stronger on other axes.
      angleSigma: 1.4 * DEGREE,
      powerSigma: 0.035,
      weights: { knockout: 3, expose: 4, approach: 1.2, ownLoss: -5 },
      quirks: { targeting: 'deepest', powers: [0.45, 0.7, 0.85] },
    },
    lines: {
      onPicked: ['I will start at your foundations.', 'Show me what holds you up.', 'This will take a while. For you.'],
      onMatchStart: ['We start at the foundations.', 'Structure first. Always.', 'Let us see what holds you up.'],
      onOwnHit: ['A load-bearing one, that.', 'The middle gives.', 'Shifted. Good.'],
      onOwnMiss: ['Wrong beam. Try the next.', 'Nothing there to take out.', 'Measured. Adjusting.'],
      onOwnKnockout: ['Out it comes.', 'One support fewer.', 'The rest will follow.'],
      onOwnCombo: ['Two supports at once.', 'That is how a wall comes down.', 'The middle was rotten.'],
      onOwnBlunder: ['I have undermined myself.', 'Wrong side of the trench.', 'That is my own beam.'],
      onPlayerKnockout: ['You went for an easy one.', 'Taken from the outside.', 'The structure holds.'],
      onPlayerBlunder: ['You dug that yourself.', 'I did not have to place a charge.', 'Straight into your own hole.'],
      onLowDiscs: ['Two supports left.', 'The structure is failing.', 'Very little left to hold.'],
      onWin: ['It came apart from the middle.', 'Foundations. Every time.', 'Nothing was left standing.'],
      onLose: ['You worked faster than I dug.', 'A sound demolition. Yours.', 'I will re-survey.'],
    },
  },
  {
    // Irregular, and the widest fan in the game paired with the two hard powers: she scores lines
    // nobody else even generates and then drives them. The scout looks wider still and taps; she
    // looks wide and hits, which makes her a different character rather than a stronger one.
    id: 'partisan',
    nameKey: 'oppPartisan',
    descKey: 'oppPartisanDesc',
    portrait: 'partisan.png',
    voice: 'airy',
    cadence: 'grumpy',
    persona: {
      candidates: 520,
      angleSigma: 2 * DEGREE,
      powerSigma: 0.07,
      weights: { knockout: 4, wasted: -1 },
      quirks: { aimSpread: 1.5, powers: [0.7, 1] },
    },
    lines: {
      onPicked: ['You did not see me sit down.', 'No uniforms at this table.', 'Play, and do not watch the door.'],
      onMatchStart: ['We do this the quiet way.', 'Nothing straight. Nothing expected.', 'Start. I am already moving.'],
      onOwnHit: ['Touched, from where you were not looking.', 'There. Off the side.', 'That came the long way round.'],
      onOwnMiss: ['Wrong angle. Learned it.', 'The forest was easier.', 'The next one lands.'],
      onOwnKnockout: ['Gone, and from nowhere.', 'That is how it is done in the trees.', 'One patrol fewer.'],
      onOwnCombo: ['Both! Off one wall!', 'The line was there the whole time.', 'Two, and neither saw it.'],
      onOwnBlunder: ['My own. Careless.', 'That is how people get caught.', 'I gave that one away.'],
      onPlayerKnockout: ['You found me. Fine.', 'Straight and dull, and it worked.', 'Take it.'],
      onPlayerBlunder: ['You did that to yourself.', 'No ambush required.', 'I did not even have to move.'],
      onLowDiscs: ['Two. That is a raiding party.', 'Small is how I like it.', 'Fewer mouths to feed.'],
      onWin: ['We were never here.', 'Melt away. That is the whole trick.', 'Tell them nothing.'],
      onLose: ['You held the road this time.', 'Good. Somebody should.', 'I will come back at night.'],
    },
  },
  {
    // The opposite trade to the gunner: an almost perfect angle on a short list of shots. He does
    // not consider much, and what he does consider he hits exactly — so he punishes a bad position
    // and misses an opportunity he never looked at.
    id: 'sniper',
    nameKey: 'oppSniper',
    descKey: 'oppSniperDesc',
    portrait: 'sniper.png',
    voice: 'airy',
    cadence: 'measured',
    persona: {
      // **260, not the 200 it was.** `aimSpread` narrows the FAN, and at 200 the budget only ever
      // stretched to a single angle per target — a cone of one sample is the same cone at any
      // width, so the quirk was a no-op and the comment below was a claim about nothing. At 260 he
      // gets three angles, and narrowing them is a thing that happens.
      candidates: 260,
      angleSigma: 0.4 * DEGREE,
      powerSigma: 0.05,
      weights: { knockout: 4, ownLoss: -5, wasted: -5 },
      // Tunnel vision, and it is the trade that makes him a different character rather than a
      // weaker marshal: he looks through a cone less than half as wide as anyone else, so he never
      // finds the bank shot — and every straight line on the board is already his.
      quirks: { aimSpread: 0.4 },
    },
    lines: {
      onPicked: ['You are sure?', 'One shot is usually enough.', 'I have been watching you play.'],
      onMatchStart: ['One shot is enough.', 'I have you already.', 'Breathe out. Begin.'],
      onOwnHit: ['Exactly where I put it.', 'On the line.', 'As intended.'],
      onOwnMiss: ['A wasted breath.', 'I will not miss twice.', 'Wind. Nothing else.'],
      onOwnKnockout: ['Gone. Next.', 'One shot, one disc.', 'Clean through.'],
      onOwnCombo: ['Two on one line.', 'They were queued for me.', 'Both. Same line.'],
      onOwnBlunder: ['My own. Inexcusable.', 'I hurried it.', 'That one is on me.'],
      onPlayerKnockout: ['Good shot. Genuinely.', 'You found the line.', 'Noted. I move.'],
      onPlayerBlunder: ['That one was not mine.', 'You gave me that.', 'A gift. I will take it.'],
      onLowDiscs: ['Two left. Still enough.', 'A sniper needs one.', 'Fewer targets to protect.'],
      onWin: ['Patience. That is all.', 'One line at a time.', 'You looked where I wanted.'],
      onLose: ['You out-aimed me.', 'A better eye won.', 'I will find a new position.'],
    },
  },
  {
    // Civilian, and the strongest player here who never uses force: nearly the marshal's budget and a
    // hand almost as steady, spent entirely on shots short of full power. He will not slam a disc off
    // the board if he can leave your position worse instead — and he is beaten by whoever is willing
    // to simply hit things.
    id: 'chessmaster',
    nameKey: 'oppChessmaster',
    descKey: 'oppChessmasterDesc',
    portrait: 'chessmaster.png',
    voice: 'dry',
    cadence: 'measured',
    persona: {
      candidates: 600,
      angleSigma: 1 * DEGREE,
      powerSigma: 0.03,
      // Position over material, stated as numbers: a knockout is worth less to him than leaving every
      // disc of yours nearer an edge than he found it.
      weights: { knockout: 2, expose: 2.5 },
      quirks: { powers: [0.45, 0.7, 0.85] },
    },
    lines: {
      onPicked: ['You may have the first move.', 'I have seen this position before.', 'Sit. This will not take long.'],
      onMatchStart: ['A quiet opening, I think.', 'Force is for people in a hurry.', 'Let us see your plan.'],
      onOwnHit: ['A small improvement.', 'The position shifts.', 'There. Slightly better for me.'],
      onOwnMiss: ['An inaccuracy. Noted.', 'I saw a ghost.', 'Not the move.'],
      onOwnKnockout: ['Material, at last.', 'A piece is a piece.', 'That was forced, you know.'],
      onOwnCombo: ['Two. It was always two.', 'The combination completes.', 'You were lost four moves ago.'],
      onOwnBlunder: ['A blunder. Mine, plainly.', 'I have annotated worse.', 'Two question marks for that.'],
      onPlayerKnockout: ['Hm. Unexpected.', 'You may have that one.', 'A pawn. Only a pawn.'],
      onPlayerBlunder: ['You resigned that one yourself.', 'Oh, that is very bad.', 'I would not have found that.'],
      onLowDiscs: ['An endgame, then.', 'Two pieces. Still enough.', 'Now it becomes technique.'],
      onWin: ['A clean finish. Thank you.', 'You will see it, in time.', 'Resign whenever you like.'],
      onLose: ['Instructive. Genuinely.', 'You outplayed me. I shall say it once.', 'I want a rematch.'],
    },
  },
  {
    // Everything at maximum: the largest budget in the game, almost no shake, and the default
    // weights untouched — because at this budget the balanced vector is the strongest one there is.
    id: 'marshal',
    nameKey: 'oppMarshal',
    descKey: 'oppMarshalDesc',
    portrait: 'marshal.png',
    voice: 'burble',
    cadence: 'grumpy',
    // No quirks either, and for the opposite reason to the sergeant's: every power, the whole fan,
    // any target. Refusing nothing is what the top of a ladder looks like.
    persona: { candidates: 700, angleSigma: 0.6 * DEGREE, powerSigma: 0.02 },
    lines: {
      onPicked: ['You have chosen the last rung.', 'Bold. I approve of bold.', 'I have read every game you have played.'],
      onMatchStart: ['I have your measure.', 'Begin. I have read this board.', 'Every disc is accounted for.'],
      onOwnHit: ['As expected.', 'The board narrows.', 'Confirmed. Continue.'],
      onOwnMiss: ['Information, not a miss.', 'Noted. Adjusting.', 'The next one lands.'],
      onOwnKnockout: ['Struck from the register.', 'One, as calculated.', 'Precisely as planned.'],
      onOwnCombo: ['Two. The line was always there.', 'Doctrine, not luck.', 'I saw that four shots ago.'],
      onOwnBlunder: ['An error. Mine.', 'That will not repeat.', 'Even doctrine slips.'],
      onPlayerKnockout: ['A creditable shot.', 'Losses were anticipated.', 'The line absorbs it.'],
      onPlayerBlunder: ['An error I did not have to force.', 'You spend your own line for me.', 'Costly. And unprompted.'],
      onLowDiscs: ['The command is reduced.', 'Two. We hold.', 'A marshal does not flinch.'],
      onWin: ['The engagement is concluded.', 'Discipline decides battles.', 'Signal: victory.'],
      onLose: ['You have earned this.', 'Well fought. Genuinely.', 'I shall study this defeat.'],
    },
  },
]

/** How many characters are playable from the very first visit. */
export const FREE_OPPONENTS = 3

export const DEFAULT_OPPONENT_ID = OPPONENTS[0].id

export function opponent(id: string): Opponent | undefined {
  return OPPONENTS.find((one) => one.id === id)
}

export function opponentIndex(id: string): number {
  return OPPONENTS.findIndex((one) => one.id === id)
}

/** Narrows a raw string — one out of the save file, which may predate a rename or have been
 * hand-edited — to a character this build actually has. */
export function isOpponentId(value: string): boolean {
  return opponentIndex(value) >= 0
}

/**
 * The gate: the first {@link FREE_OPPONENTS} are open from the start, and every one after that opens
 * by **defeating the character before it**.
 *
 * Not by defeating any three, and not by a score — the ladder IS the content, so meeting the
 * quartermaster should mean the cavalry captain is next. Reads a list of defeated ids rather than a
 * win count for the same reason: only a win may unlock, and a count cannot say WHICH.
 */
/**
 * Every character below `id` on the ladder — exactly the set that has to be in `defeated` for `id` to
 * be reachable.
 *
 * Its one caller is `migrate.ts`'s `v3 -> v4` step, which needs the character it derived from an old
 * difficulty to actually be unlocked. Here rather than there because the relationship between the
 * order of this array and the gate below is this file's business, and a second place computing "what
 * comes before" is a second place to get it wrong.
 */
export function opponentsBefore(id: string): string[] {
  const index = opponentIndex(id)
  return index <= 0 ? [] : OPPONENTS.slice(0, index).map((one) => one.id)
}

export function isOpponentUnlocked(id: string, defeated: readonly string[]): boolean {
  const index = opponentIndex(id)
  if (index < 0) return false
  if (index < FREE_OPPONENTS) return true
  return defeated.includes(OPPONENTS[index - 1].id)
}
