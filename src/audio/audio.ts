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
 * Only setSound()/setMusic() (user-triggered, via the Settings overlay) touch the save.
 */

// Phaser 4's BaseSound.d.ts omits setMute()/mute/seek, even though every concrete backend
// (WebAudio, HTML5, NoAudio — see the audio-and-sound skill) implements them identically.
interface MutableSound extends Phaser.Sound.BaseSound {
  setMute(value: boolean): this
  seek: number
}

let soundManager: Phaser.Sound.BaseSoundManager | null = null
let platformAudioEnabled = true
let currentMusicKey: string | null = null
let currentMusic: MutableSound | null = null
let pausedMusicSeek = 0

function userSoundOn(): boolean {
  return getState().settings.sound
}

function userMusicOn(): boolean {
  return getState().settings.music
}

function effectiveSound(): boolean {
  return platformAudioEnabled && userSoundOn()
}

function effectiveMusic(): boolean {
  return platformAudioEnabled && userMusicOn()
}

function applyMusicAudibility(): void {
  currentMusic?.setMute(!effectiveMusic())
}

/** Fire-and-forget one-shot sound effect. Doesn't even attempt to play when inaudible. */
export function playSfx(key: string): void {
  if (!soundManager || !effectiveSound()) {
    return
  }
  soundManager.play(key)
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
  currentMusic = soundManager.add(key, { loop: true, seek: seekSeconds }) as MutableSound
  currentMusic.play()
  applyMusicAudibility()
}

/** Stops (and destroys) the current music track. Keeps the key remembered so RESUME can restart it. */
export function stopMusic(): void {
  currentMusic?.destroy()
  currentMusic = null
}

/** User-triggered: persists the SFX flag and takes effect on the next playSfx() call. */
export function setSound(on: boolean): void {
  mutate((s) => {
    s.settings.sound = on
  })
}

/** User-triggered: persists the music flag and immediately (re)mutes the current track. */
export function setMusic(on: boolean): void {
  mutate((s) => {
    s.settings.music = on
  })
  applyMusicAudibility()
}

export function isSoundOn(): boolean {
  return userSoundOn()
}

export function isMusicOn(): boolean {
  return userMusicOn()
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
