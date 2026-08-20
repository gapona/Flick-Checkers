import * as Phaser from 'phaser'
import { YTEvents, isAudioEnabled } from '../platform/yt'
import { getState, mutate } from '../save/store'

/**
 * Sound/music manager sitting on top of Phaser's SoundManager. Scenes must go through
 * this module (playSfx/playMusic/stopMusic/setSound/setMusic) instead of touching
 * `this.sound` directly, so audibility always reflects both the user's two independent
 * flags (SaveState.settings.sound/music) and the platform's audio-enabled state.
 *
 * audible = platformAudioEnabled && userFlag
 *
 * The platform mute is a transient runtime override — it's never written to SaveState.
 * Only setSfxVolume()/setMusicVolume() (user-triggered, via the Settings overlay) touch the save.
 */

// Phaser 4's BaseSound.d.ts omits setMute()/mute/volume/seek, even though every concrete backend
// (WebAudio, HTML5, NoAudio — see the audio-and-sound skill) implements them identically. `volume`
// joined the list when the settings became faders: it is how a level reaches an already-playing
// track, which `setMute` alone cannot express.
interface MutableSound extends Phaser.Sound.BaseSound {
  setMute(value: boolean): this
  volume: number
  seek: number
}

/**
 * Music sits under the game, not next to it: the bed is mixed at roughly the same level as the
 * one-shots in the file itself (every cue is normalised the same way by `scripts/make-audio.mjs`),
 * so the balance between them is made here, once, instead of being baked into one asset.
 */
const MUSIC_VOLUME = 0.5

let soundManager: Phaser.Sound.BaseSoundManager | null = null
let platformAudioEnabled = true
let currentMusicKey: string | null = null
let currentMusic: MutableSound | null = null
let pausedMusicSeek = 0

/**
 * The user's own levels, `0..1` (`SaveState` v3).
 *
 * They replaced two booleans, and the whole layer below reads differently as a result: "is sound
 * on" is now "is the level above zero", and the platform's own mute multiplies rather than gates.
 * Zero is a real level and not a separate muted state — which is what lets the mute BUTTON in
 * settings be nothing more than "set 0, remember what it was".
 */
export function sfxVolume(): number {
  return getState().settings.sfx
}

export function musicVolume(): number {
  return getState().settings.music
}

/** What a one-shot is actually multiplied by: the user's level, silenced entirely by the platform's
 * own mute (`YTEvents.AUDIO_ENABLED_CHANGE`). */
function effectiveSfx(): number {
  return platformAudioEnabled ? sfxVolume() : 0
}

function effectiveMusic(): number {
  return platformAudioEnabled ? musicVolume() : 0
}

function applyMusicAudibility(): void {
  if (!currentMusic) return
  const level = effectiveMusic()
  // Both, deliberately. `volume` is what the player set; `mute` is belt and braces for the platform
  // path, which used to be the only mechanism here and is what the PAUSE handler still drives.
  currentMusic.volume = MUSIC_VOLUME * level
  currentMusic.setMute(level <= 0)
}

/** Fire-and-forget one-shot sound effect. Doesn't even attempt to play when inaudible. */
/**
 * How a one-shot should sound this time.
 *
 * CHAPAEV-PLAN.md §9 makes this the game's most important sound rule: "the impact of disc on disc —
 * volume and pitch FROM THE ENERGY of the hit. This is the game's main sound, it has to be
 * proportional to the force, otherwise a weak and a strong hit sound the same and the physics stops
 * being felt." A fixed sample played flat is exactly the failure it describes.
 */
export interface SfxOptions {
  /** `1` is the sample as recorded. */
  volume?: number
  /** Playback rate, which is pitch: `2` is an octave up. */
  rate?: number
  /** Seconds to wait before it sounds — for a cue that belongs to something the eye has not caught
   * up with yet, like a disc still falling past the rim. */
  delayMs?: number
}

export function playSfx(key: string, options: SfxOptions = {}): void {
  const level = effectiveSfx()
  if (!soundManager || level <= 0) {
    return
  }

  const config: Phaser.Types.Sound.SoundConfig = {}
  // The caller's volume is the sound's OWN dynamics — §9's impact cue scales with collision energy
  // — and the user's level is a master fader over the top. Multiplying keeps both: a soft hit at
  // half volume stays a soft hit.
  config.volume = (options.volume ?? 1) * level
  if (options.rate !== undefined) config.rate = options.rate
  // `delay` is in seconds in Phaser's own config, and is the only part of this that is not a plain
  // pass-through.
  if (options.delayMs !== undefined) config.delay = options.delayMs / 1000

  soundManager.play(key, config)
}

/** The opponents' syllable sprite (`scripts/make-voice.py`), loaded in `Preloader` beside the
 * one-shots and played only through `audio/dialogueVoice.ts`. */
export const VOICE_SPRITE_KEY = 'voice'

/**
 * **The voice bus's own trim**, under the player's SFX slider rather than beside it.
 *
 * The syllables are normalised like every other cue, but they arrive in chains of five to ten while
 * a shot arrives once — so at matching levels the babble is what the player hears instead of the
 * board. This is the number to move if the characters ever talk over the game.
 *
 * Under the SFX slider and not a third fader of its own: the babble is a sound effect that happens
 * to be shaped like speech, and a slider nobody would think to look for is a setting that does not
 * exist in practice.
 */
const VOICE_TRIM = 0.7

/**
 * **A pool of voice instances, so one syllable can still be sounding when the next begins.**
 *
 * There was one retained instance and every syllable began with `stop()` on it. That was correct
 * while the clips were shorter than the gap between them — but it also made overlap impossible, and
 * overlap is the difference between speech and a row of blips. With 140ms clips on a 215-290ms step,
 * each syllable finished 65-140ms before the next one started; the voice was a sequence of separate
 * events with silence between, which is what "blippy" means.
 *
 * The clips are now longer than the step (see `make-voice.py`'s MIN_MS/MAX_MS), so a syllable's tail
 * has to be allowed to ring while the next one starts. That needs one sound object per overlapping
 * voice, taken round-robin.
 *
 * **The size is measured, not guessed** — see {@link VOICE_POOL}. What has to stay true is the rule
 * the single instance was protecting: a character never talks over ITSELF across lines, which is
 * what {@link stopVoice} is for; it stops every slot, so a replaced line goes silent completely.
 */
interface VoiceSlot {
  sound: MutableSound
  /** Its own shelf. Shared would be wrong now that slots overlap: changing the tilt for a new
   * syllable would retune one that is still sounding. */
  tilt: BiquadFilterNode | null
}

/**
 * How many syllables can be sounding at once.
 *
 * **Measured rather than picked.** Concurrency is the longest clip over the shortest step, and both
 * ends move: clips run 262-282ms, and the step is 215-290ms scaled by the cadence (`cute` 0.7), the
 * mood (`alarm` 0.7) and the unstressed pace (0.82), then quantised to whole characters of the
 * 42ms reveal. The shortest step any combination can reach is therefore 2 characters, 84ms, and the
 * longest clip spans 3.36 of those — so the arithmetic bound is 4.
 *
 * Driving all twelve cadence-by-mood combinations through the real manager and counting the maximum
 * overlap gave **3**. The pool is the arithmetic bound plus one spare: the round-robin means the slot
 * being reused is always the oldest, so the spare is what absorbs a clip that is still ringing when
 * its turn comes round again.
 */
const VOICE_POOL = 5

let voicePool: VoiceSlot[] = []
let voiceCursor = 0

/** Where the shelf turns over. Above this is the part of a voice that falls away when effort drops;
 * below it is the part that does not. */
const VOICE_TILT_HZ = 2000

interface WebAudioNodes {
  pannerNode?: AudioNode
  volumeNode?: AudioNode
}

/**
 * Puts a high shelf between one voice slot and the destination, so an unstressed syllable can be
 * DARKER as well as quieter.
 *
 * **Why a real filter and not a trick with rate or volume.** Lowering vocal effort physically
 * changes the slope of the spectrum: the top falls further than the bottom. A gain drop alone is the
 * same tense syllable played quieter, which is exactly what "shouty" sounds like at low volume.
 * Nothing in Phaser's per-play config can tilt a spectrum.
 *
 * **Inserted defensively.** It reaches into Phaser's own node graph — the sound's last node before
 * the manager's destination — which is a shape that could change under us. Every step is
 * feature-detected and a failure restores the original connection: a missing tilt is a syllable that
 * is merely quieter, which is the behaviour that shipped for months, while a broken insert would be
 * silence.
 */
function insertTilt(sound: MutableSound): BiquadFilterNode | null {
  const manager = soundManager as unknown as { context?: BaseAudioContext; destination?: AudioNode; masterMuteNode?: AudioNode }
  const context = manager?.context
  const nodes = sound as unknown as WebAudioNodes
  const tail = nodes.pannerNode ?? nodes.volumeNode
  const target = manager?.destination ?? manager?.masterMuteNode
  if (!context || !tail || !target || typeof context.createBiquadFilter !== 'function') return null

  const shelf = context.createBiquadFilter()
  shelf.type = 'highshelf'
  shelf.frequency.value = VOICE_TILT_HZ
  shelf.gain.value = 0
  try {
    tail.disconnect()
    tail.connect(shelf)
    shelf.connect(target)
  } catch {
    try {
      tail.disconnect()
      tail.connect(target)
    } catch {
      /* nothing further to try; the voice is silent either way and the game is not */
    }
    return null
  }
  return shelf
}

/** The pool, built on first use. Returns `null` if the sprite never loaded. */
function ensureVoicePool(): VoiceSlot[] | null {
  if (voicePool.length > 0) return voicePool
  if (!soundManager) return null
  // `addAudioSprite` throws if the sprite never loaded — a scene started without `Preloader`, a
  // stripped build — and a missing voice must not take a match down with it.
  if (!soundManager.game.cache.json.exists(VOICE_SPRITE_KEY)) return null

  for (let i = 0; i < VOICE_POOL; i++) {
    const sound = soundManager.addAudioSprite(VOICE_SPRITE_KEY) as MutableSound
    voicePool.push({ sound, tilt: insertTilt(sound) })
  }
  return voicePool
}

/**
 * One syllable of a character's pseudo-voice.
 *
 * **Call `audio/dialogueVoice.ts`'s `createDialogueVoice()`, not this** — this is the output half
 * only, the same split `playSfx` has: policy decides when a syllable happens, this decides whether
 * it is audible.
 */
export function playVoiceMarker(marker: string, detune = 0, gain = 1, tiltDb = 0): void {
  const level = effectiveSfx() * VOICE_TRIM * gain
  if (!soundManager || level <= 0) return

  const pool = ensureVoicePool()
  if (!pool) return

  const slot = pool[voiceCursor]
  voiceCursor = (voiceCursor + 1) % pool.length

  // The shelf is per-syllable and set BEFORE the play: it is a node in the path rather than a
  // per-play config value, so it applies from the moment it is written.
  if (slot.tilt) slot.tilt.gain.value = tiltDb

  // Only THIS slot, and only in case it is somehow still sounding a full lap later — the round-robin
  // means it is the oldest of the pool. Stopping the others is what would kill the overlap.
  slot.sound.stop()
  // **The level goes in the play CONFIG, not on the instance.** Assigning `.volume` and then calling
  // `play(marker, { detune })` looks equivalent and is not: Phaser stores a config per MARKER and
  // `play` applies it over the instance, so the assignment is immediately overwritten by whatever
  // volume that marker was last played at. Measured: gain 0.25, 1 and 2 all came out at 0.6736.
  slot.sound.play(marker, { detune, volume: level })
}

/**
 * Cuts the voice — a line replaced mid-utterance, or a scene going away.
 *
 * **Every slot, not the current one.** The pool exists so syllables can overlap; a stop that left
 * the others ringing would let a replaced line finish talking over the one that replaced it, which
 * is the exact rule the single retained instance used to enforce for free.
 */
export function stopVoice(): void {
  for (const slot of voicePool) slot.sound.stop()
}

/**
 * Starts (or restarts, for a different key) a looping music track, muted to match the
 * current flags. `seekSeconds` resumes from a specific position instead of the start —
 * used internally to continue (not restart) a track across a PAUSE/RESUME cycle.
 */
export function playMusic(key: string, seekSeconds = 0): void {
  if (!soundManager) {
    return
  }
  if (currentMusicKey === key && currentMusic?.isPlaying) {
    applyMusicAudibility()
    return
  }

  // destroy(), not stop(): a stopped-but-not-destroyed instance lingers in the
  // manager's sound list, and PAUSE/RESUME cycles would otherwise leak one per cycle.
  currentMusic?.destroy()
  currentMusicKey = key
  currentMusic = soundManager.add(key, { loop: true, seek: seekSeconds, volume: MUSIC_VOLUME * effectiveMusic() }) as MutableSound
  currentMusic.play()
  applyMusicAudibility()
}

/** Stops (and destroys) the current music track. Keeps the key remembered so RESUME can restart it. */
export function stopMusic(): void {
  currentMusic?.destroy()
  currentMusic = null
}

/**
 * User-triggered: persists the SFX level and takes effect on the next `playSfx()` call.
 *
 * A non-silent level is also remembered as what un-muting returns to. Silence deliberately is not:
 * that is the state being escaped from, not a choice worth coming back to.
 */
export function setSfxVolume(level: number): void {
  const clamped = Math.max(0, Math.min(1, level))
  mutate((s) => {
    s.settings.sfx = clamped
    if (clamped > 0) s.settings.sfxRestore = clamped
  })
}

/** The level the mute button restores. Read from the save rather than remembered by the control,
 * so muting and reloading does not strand the player at zero. */
export function sfxRestoreLevel(): number {
  return getState().settings.sfxRestore
}

export function musicRestoreLevel(): number {
  return getState().settings.musicRestore
}

/** User-triggered: persists the music level and applies it to the playing track immediately —
 * a fader the player cannot hear while they are moving it is a fader they cannot set. */
export function setMusicVolume(level: number): void {
  const clamped = Math.max(0, Math.min(1, level))
  mutate((s) => {
    s.settings.music = clamped
    if (clamped > 0) s.settings.musicRestore = clamped
  })
  applyMusicAudibility()
}

/**
 * Wires the sound manager to the game instance and to the platform's audio/lifecycle
 * events (see ../platform/yt.ts). Call once, from main.ts, before scenes start.
 */
export function init(game: Phaser.Game): void {
  soundManager = game.sound
  platformAudioEnabled = isAudioEnabled()

  game.events.on(YTEvents.AUDIO_ENABLED_CHANGE, (enabled: boolean) => {
    platformAudioEnabled = enabled
    applyMusicAudibility()
    console.debug('[audio] platform audio enabled ->', enabled)
  })

  game.events.on(YTEvents.PAUSE, () => {
    if (soundManager) {
      soundManager.mute = true
    }
    // stopMusic() destroys the instance (see its comment) — capture position first so
    // RESUME can continue the track instead of restarting it from 0.
    pausedMusicSeek = currentMusic?.seek ?? 0
    stopMusic()
  })

  game.events.on(YTEvents.RESUME, () => {
    if (soundManager) {
      soundManager.mute = false
    }
    if (currentMusicKey && effectiveMusic()) {
      playMusic(currentMusicKey, pausedMusicSeek)
    }
  })
}
