#!/usr/bin/env node
// Generates the game's SIX one-shot cues from code (`npm run audio`). The seventh, the music bed,
// used to be generated here too and is now an external track — `npm run audio` leaves it alone, and
// `npm run audio -- --music` puts the procedural one back over it. See AUDIO-SOURCES.md.
//
// WHY A GENERATOR, AGAIN: the same reasoning as `scripts/make-atlas.mjs`. CONCEPT.md §8/S10 fixes
// what each sound has to do ("у боя должен быть «мясной» отклик, у превращения — фанфара") and
// CLAUDE.md's asset policy allows only CC0 or self-generated audio, because an unresolved
// copyright claim on a sound is one of the most common Playables rejection reasons. Synthesising
// every sample here makes provenance a property of the repository rather than a promise in a
// registry row: there is no file to trace, only arithmetic.
//
// The output is COMMITTED (`public/assets/audio/*.ogg`). A fresh clone does not need to run this.
//
// PREREQUISITE (dev only): `ffmpeg` on PATH, with libvorbis — used solely to turn the WAV this
// script renders into Ogg Vorbis. Encoding Vorbis by hand is a project of its own, and adding a
// wasm encoder as a dependency to regenerate committed files nobody regenerates is a worse trade.
// The script fails loudly rather than silently shipping WAVs if it is missing.
//
// Everything is deterministic (seeded PRNG, no Date/Math.random) — INCLUDING the container, which
// took a second fix: see `pinOggSerial`. Regenerating produces the same bytes and does not churn git.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public/assets/audio')
const TMP_DIR = path.join(tmpdir(), 'draughts-audio')

const RATE = 44100

// -- tiny DSP kit -------------------------------------------------------------------------------

function mulberry32(seed) {
  return function random() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TAU = Math.PI * 2

/** Equal temperament, A4 = 440 Hz. Notes are written as MIDI numbers so a chord is just three
 * integers — transposing a whole cue is then one addition, not a table of retyped frequencies. */
function hz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function buffer(seconds) {
  return new Float32Array(Math.round(seconds * RATE))
}

/**
 * Mixes `render(t, i)` into `out`, starting at `startSec` and WRAPPING at the end of the buffer.
 *
 * The wrap is what makes the music loop seamlessly: a note struck near the end of the loop rings
 * on into the beginning of the same buffer, which is exactly where it will be audible when the
 * loop repeats. Crossfading the ends instead smears the whole mix; this leaves it untouched.
 */
function mix(out, startSec, durationSec, render) {
  const start = Math.round(startSec * RATE)
  const count = Math.round(durationSec * RATE)
  for (let i = 0; i < count; i++) {
    const t = i / RATE
    out[(start + i) % out.length] += render(t, i)
  }
}

/** Exponential decay — the envelope almost every percussive sound here uses. `halfLife` in
 * seconds. */
function decay(t, halfLife) {
  return Math.pow(0.5, t / halfLife)
}

/** Attack/release envelope for sustained tones, with a cosine attack so a pad swells rather than
 * steps in. */
function swell(t, duration, attack, release) {
  if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack)
  const left = duration - t
  if (left < release) return Math.max(0, 0.5 - 0.5 * Math.cos((Math.PI * left) / release))
  return 1
}

/** A rounded, "glossy" tone: a sine plus a little second and third partial. Sounds like a struck
 * object rather than a test tone, at a fraction of the cost of real physical modelling. */
function bell(t, freq, brightness = 0.35) {
  return Math.sin(TAU * freq * t) + brightness * 0.5 * Math.sin(TAU * freq * 2 * t) + brightness * 0.25 * Math.sin(TAU * freq * 3.01 * t)
}

/** One-pole lowpass — takes the fizz off white noise so it reads as "material", not as static. */
function lowpass(cutoffHz) {
  const alpha = 1 - Math.exp((-TAU * cutoffHz) / RATE)
  let state = 0
  return (x) => {
    state += alpha * (x - state)
    return state
  }
}

/** One-pole highpass, built from the lowpass — for the bright half of a shatter. */
function highpass(cutoffHz) {
  const lp = lowpass(cutoffHz)
  return (x) => x - lp(x)
}

/** Soft saturation. Keeps peaks under 1.0 without the crackle of hard clipping, and adds the
 * slight thickness this art direction wants on the low end. */
function softClip(x) {
  return Math.tanh(x * 1.2) / Math.tanh(1.2)
}

/** Normalises to `peak` and soft-clips. Every cue is levelled the same way, so no sound is
 * suddenly twice as loud as its neighbour. */
function finish(buf, peak = 0.82) {
  let max = 0
  for (const sample of buf) max = Math.max(max, Math.abs(sample))
  if (max === 0) return buf
  const gain = peak / max
  for (let i = 0; i < buf.length; i++) buf[i] = softClip(buf[i] * gain)
  return buf
}

/** A short fade at both ends. A cue that starts or stops mid-waveform clicks, and a click is the
 * one artefact a player hears every single time. */
function fadeEdges(buf, seconds = 0.004) {
  const n = Math.min(Math.round(seconds * RATE), Math.floor(buf.length / 2))
  for (let i = 0; i < n; i++) {
    const g = i / n
    buf[i] *= g
    buf[buf.length - 1 - i] *= g
  }
  return buf
}

// -- the cues (CONCEPT.md §8/S10) ----------------------------------------------------------------

/** A UI tap. Deliberately the quietest thing in the game: it fires on every button in every menu,
 * so anything with a tail becomes a rattle. */
function makeUi() {
  const out = buffer(0.09)
  mix(out, 0, 0.09, (t) => {
    const pitch = 1180 - 260 * Math.min(1, t / 0.03)
    return 0.5 * Math.sin(TAU * pitch * t) * decay(t, 0.018) + 0.18 * Math.sin(TAU * pitch * 2 * t) * decay(t, 0.008)
  })
  return fadeEdges(finish(out, 0.5))
}

/**
 * A piece landing. The visual is an arc with overshoot and a squash (CONCEPT.md §6), so the sound
 * is a single rounded knock with a fast pitch drop — the audible half of "it has weight and it has
 * arrived". No tail: a chain plays this once per jump, and a ringing tail would blur into a mush.
 */
function makeMove() {
  const out = buffer(0.22)
  mix(out, 0, 0.22, (t) => {
    const pitch = 250 * (1 + 0.5 * decay(t, 0.012))
    return 0.9 * bell(t, pitch, 0.28) * decay(t, 0.055)
  })
  // The contact transient: a few milliseconds of filtered noise, which is what separates "a tone
  // started" from "two objects touched".
  const random = mulberry32(20260810)
  const lp = lowpass(2600)
  mix(out, 0, 0.03, (t) => 0.5 * lp(random() * 2 - 1) * decay(t, 0.006))
  return fadeEdges(finish(out, 0.7))
}

/**
 * A capture. CONCEPT.md §6 asks for a "мясной" response, and the piece visibly shatters into
 * particles — so this is three layers: a low body thump, a bright shatter, and a short ring-out.
 */
function makeCapture() {
  const out = buffer(0.55)
  // Body: a low sine with a downward pitch envelope — the impact itself.
  mix(out, 0, 0.4, (t) => {
    const pitch = 62 + 130 * decay(t, 0.03)
    return 1.15 * Math.sin(TAU * pitch * t) * decay(t, 0.1)
  })
  // Shatter: highpassed noise in short decaying grains, so it reads as several fragments rather
  // than one hiss.
  const random = mulberry32(777001)
  const hp = highpass(1400)
  mix(out, 0.005, 0.35, (t) => {
    const grain = 0.6 + 0.4 * Math.sin(TAU * 47 * t)
    return 0.55 * hp(random() * 2 - 1) * grain * decay(t, 0.075)
  })
  // Ring-out: a minor-third pair, quiet, so the hit has a pitch to remember rather than being pure
  // noise.
  mix(out, 0.01, 0.5, (t) => 0.3 * (Math.sin(TAU * hz(69) * t) + Math.sin(TAU * hz(72) * t)) * decay(t, 0.11))
  return fadeEdges(finish(out, 0.84))
}

/** Promotion: the fanfare §S10 asks for, kept to four notes so it never outlasts the crown drop
 * animation it accompanies. */
function makePromote() {
  const out = buffer(1.0)
  const notes = [72, 76, 79, 84] // C5 E5 G5 C6 — a plain major arpeggio, which is the point
  notes.forEach((midi, index) => {
    const at = index * 0.075
    mix(out, at, 0.9, (t) => 0.7 * bell(t, hz(midi), 0.5) * decay(t, index === notes.length - 1 ? 0.3 : 0.13))
  })
  // Sparkle: high, quiet, filtered noise riding the last note — the audible version of the
  // particle burst.
  const random = mulberry32(31337)
  const hp = highpass(4200)
  mix(out, 0.2, 0.6, (t) => 0.22 * hp(random() * 2 - 1) * Math.min(1, t / 0.05) * decay(t, 0.16))
  return fadeEdges(finish(out, 0.82))
}

/** Victory: the promotion fanfare's bigger sibling — a full triad arrival with a sustained chord
 * under it. */
function makeWin() {
  const out = buffer(1.9)
  const lead = [
    [72, 0.0],
    [76, 0.11],
    [79, 0.22],
    [84, 0.34],
    [88, 0.46],
  ]
  for (const [midi, at] of lead) {
    mix(out, at, 1.4, (t) => 0.6 * bell(t, hz(midi), 0.45) * decay(t, 0.34))
  }
  // The chord the arrival lands on, swelling underneath rather than being struck.
  for (const midi of [48, 60, 64, 67]) {
    mix(out, 0.34, 1.5, (t) => 0.3 * Math.sin(TAU * hz(midi) * t) * swell(t, 1.5, 0.12, 0.7))
  }
  return fadeEdges(finish(out, 0.85))
}

/**
 * Defeat. CONCEPT.md §6: "та же панель, приглушённая подача без наказывающих эффектов" — so this
 * is the same instrument as the win, two steps down and without the sparkle. It should read as
 * "that one got away", not as a buzzer.
 */
function makeLose() {
  const out = buffer(1.6)
  const lead = [
    [67, 0.0],
    [63, 0.16],
    [60, 0.34],
  ]
  for (const [midi, at] of lead) {
    mix(out, at, 1.2, (t) => 0.5 * bell(t, hz(midi), 0.22) * decay(t, 0.3))
  }
  for (const midi of [43, 55, 58, 62]) {
    mix(out, 0.1, 1.4, (t) => 0.26 * Math.sin(TAU * hz(midi) * t) * swell(t, 1.4, 0.2, 0.8))
  }
  return fadeEdges(finish(out, 0.72))
}

/**
 * The background bed: four chords, two bars each, at 72 BPM — 26.67 s per loop.
 *
 * Written as a chord table rather than a melody on purpose. A draughts match is long and mostly
 * silent thinking; a tune with a hook becomes unbearable on the fifth loop, while a slow harmonic
 * bed stays under the game. Nothing here lands on the beat hard enough to compete with the SFX.
 */
function makeMusic() {
  const BPM = 72
  const beat = 60 / BPM
  const bar = beat * 4
  const chords = [
    [45, 52, 57, 60, 64], // Am9-ish
    [41, 48, 53, 57, 60], // Fmaj7
    [43, 50, 55, 59, 62], // G/B
    [40, 47, 52, 56, 59], // Em7
  ]
  const loopSec = chords.length * bar * 2
  const out = buffer(loopSec)

  chords.forEach((chord, index) => {
    const at = index * bar * 2

    // Pad: three slightly detuned sines per note, swelling over the whole two bars. The detune is
    // what stops five stacked sines from sounding like an organ test tone.
    for (const midi of chord.slice(1)) {
      for (const cents of [-6, 0, 7]) {
        const freq = hz(midi) * Math.pow(2, cents / 1200)
        mix(out, at, bar * 2 + 1.2, (t) => 0.085 * Math.sin(TAU * freq * t) * swell(t, bar * 2 + 1.2, 1.1, 1.6))
      }
    }

    // Root, an octave down, quiet: the floor the chord sits on.
    mix(out, at, bar * 2 + 0.8, (t) => 0.16 * Math.sin(TAU * hz(chord[0] - 12) * t) * swell(t, bar * 2 + 0.8, 0.5, 1.2))

    // Arpeggio: plucked, off the downbeat, using only chord tones — motion without a melody to get
    // tired of.
    const pattern = [0, 2, 3, 2, 4, 2, 3, 1]
    pattern.forEach((step, i) => {
      const when = at + beat * 0.5 + i * beat
      const midi = chord[Math.min(step + 1, chord.length - 1)] + (i % 4 === 3 ? 12 : 0)
      mix(out, when, 1.4, (t) => 0.13 * bell(t, hz(midi), 0.3) * decay(t, 0.16))
    })
  })

  // A single slap-back echo, wrapping like everything else — cheap depth, and it keeps the loop
  // point inaudible because the echo of the last note is already present at the start.
  const delaySamples = Math.round(beat * 0.75 * RATE)
  const wet = new Float32Array(out.length)
  for (let i = 0; i < out.length; i++) wet[(i + delaySamples) % out.length] += out[i] * 0.28
  for (let i = 0; i < out.length; i++) out[i] += wet[i]

  // No fadeEdges(): this file is looped, and a fade at the edges would be an audible dip every
  // 26 seconds. The wrap-around mixing above is what keeps the seam continuous instead.
  return finish(out, 0.5)
}

// -- WAV + encode ---------------------------------------------------------------------------------

function toWav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + samples.length * 2, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20) // PCM
  bytes.writeUInt16LE(1, 22) // mono
  bytes.writeUInt32LE(RATE, 24)
  bytes.writeUInt32LE(RATE * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    bytes.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  return bytes
}

function requireFfmpeg() {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (!out.includes('libvorbis')) {
      console.error('[make-audio] this ffmpeg has no libvorbis encoder — install a full build.')
      process.exit(1)
    }
  } catch {
    console.error('[make-audio] ffmpeg not found on PATH. It is needed only to regenerate audio; the .ogg files are committed.')
    process.exit(1)
  }
}

/**
 * The one value in this pipeline nobody chose. Written into every page of every cue, so a stray
 * serial in a hex dump is identifiably ours.
 *
 * A serial exists to tell multiplexed streams apart inside one container; each cue here is its own
 * file with one stream in it, so there is nothing for it to distinguish and one constant serves all
 * seven.
 */
const OGG_SERIAL = 0x43484150 // "CHAP"

/** Ogg's own CRC-32: polynomial 0x04c11db7, no reflection, no final xor. NOT `zlib.crc32`, which
 * is the reflected Ethernet variant and gives a different answer. */
function oggCrc(buf, from, to) {
  let crc = 0
  for (let i = from; i < to; i++) {
    crc = (crc ^ (buf[i] << 24)) >>> 0
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80000000 ? (((crc << 1) >>> 0) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0
    }
  }
  return crc >>> 0
}

/**
 * Rewrites every Ogg page's stream serial to a fixed value and repairs the page CRCs.
 *
 * **Because the ENCODER is not deterministic even though everything upstream of it is**, and the
 * header of this file has claimed since it was written that a rerun reproduces the same bytes.
 * Measured: two runs over bit-identical WAVs produced seven different `.ogg` files, every time.
 * libvorbis draws the serial from a random seed; ffmpeg's `-serial_offset` does not pin it (it is
 * added to the random value rather than used instead of it) and `-fflags +bitexact` does not touch
 * it either. The audio payload was already identical, so the whole of the churn was a number whose
 * only job is to tell apart streams this file does not have.
 *
 * A page is: "OggS", version, flags, 8-byte granule, 4-byte serial, 4-byte sequence, 4-byte CRC, a
 * segment count, that many segment lengths, then the bodies.
 *
 * `scripts/make-voice.py` carries the same routine for the same reason — the two generators are in
 * different languages, so this is a deliberate second copy rather than a missing import.
 */
function pinOggSerial(oggPath, serial = OGG_SERIAL) {
  const buf = readFileSync(oggPath)
  let at = 0
  while (at < buf.length) {
    if (buf.toString('latin1', at, at + 4) !== 'OggS') {
      console.error(`[make-audio] ${path.basename(oggPath)}: expected an Ogg page at byte ${at}`)
      process.exit(1)
    }
    const segments = buf[at + 26]
    let body = 0
    for (let i = 0; i < segments; i++) body += buf[at + 27 + i]
    const size = 27 + segments + body
    buf.writeUInt32LE(serial, at + 14)
    buf.writeUInt32LE(0, at + 22)
    buf.writeUInt32LE(oggCrc(buf, at, at + size), at + 22)
    at += size
  }
  writeFileSync(oggPath, buf)
}

/** `quality` is libvorbis's -q:a scale (-1..10). SFX are short enough that 4 is inaudible from
 * lossless; the music bed gets 3, where its slow content still holds up and the file halves. */
function encode(name, samples, quality) {
  const wavPath = path.join(TMP_DIR, `${name}.wav`)
  const oggPath = path.join(OUT_DIR, `${name}.ogg`)
  writeFileSync(wavPath, toWav(samples))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-c:a', 'libvorbis', '-q:a', String(quality), '-ac', '1', oggPath], { stdio: 'inherit' })
  pinOggSerial(oggPath)
  return oggPath
}

// -- write -----------------------------------------------------------------------------------------

requireFfmpeg()
mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(TMP_DIR, { recursive: true })

const CUES = [
  { name: 'ui', render: makeUi, quality: 4 },
  { name: 'move', render: makeMove, quality: 4 },
  { name: 'capture', render: makeCapture, quality: 4 },
  { name: 'promote', render: makePromote, quality: 4 },
  { name: 'win', render: makeWin, quality: 4 },
  { name: 'lose', render: makeLose, quality: 4 },
  { name: 'music', render: makeMusic, quality: 3 },
]

/**
 * The MUSIC BED IS NO LONGER GENERATED, and this guard is the same one `make-atlas.mjs` grew for
 * the backgrounds, for the same reason and after the same near-miss.
 *
 * `npm run audio` is a command anyone would run to refresh the six one-shots — and until this
 * existed, running it silently replaced the shipped track with the procedural chord bed. That is
 * exactly the failure the `--backgrounds` flag was added for: a regeneration command must not
 * overwrite a file it did not make.
 *
 * `makeMusic` is deliberately still here and still called by `--music`. It is the fallback if the
 * track is ever pulled, and a generator deleted the day its output stops shipping is a generator
 * nobody can run when they need it back. See AUDIO-SOURCES.md for what ships instead.
 */
const REGENERATE_MUSIC = process.argv.includes('--music')
const cues = REGENERATE_MUSIC ? CUES : CUES.filter((c) => c.name !== 'music')
if (!REGENERATE_MUSIC) {
  console.log('[make-audio] music.ogg SKIPPED — the shipped bed is an external track (see AUDIO-SOURCES.md).')
  console.log('[make-audio] pass --music to regenerate the procedural bed over it instead.')
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
let total = 0
for (const cue of cues) {
  const samples = cue.render()
  const size = statSync(encode(cue.name, samples, cue.quality)).size
  total += size
  console.log(`[make-audio] ${cue.name}.ogg  ${(samples.length / RATE).toFixed(2)}s  ${kb(size)}`)
}
rmSync(TMP_DIR, { recursive: true, force: true })
console.log(`[make-audio] total ${kb(total)}`)
if (REGENERATE_MUSIC) {
  console.log('[make-audio] NOTE: the shipped music bed has just been REPLACED by the procedural one.')
}
