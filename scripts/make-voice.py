#!/usr/bin/env python3
"""Synthesizes the opponents' pseudo-voice syllables into ONE Ogg audio sprite.

Run:  npm run voice                     (needs numpy + ffmpeg with libvorbis on PATH)
Out:  public/assets/voice/voice.ogg + voice.json

What this is
------------
The opponents (`src/game/opponents.ts`) "speak" by chaining meaningless syllables while their
line types into the HUD (`src/audio/babble.ts`, `src/ui/speechLine.ts`). There are no recorded
voices anywhere in this game and there are not going to be — every sample here is arithmetic on
numpy arrays, which is what lets AUDIO-SOURCES.md go on saying `Self-generated` for every row it
owns, exactly as `make-audio.mjs` and `make-atlas.mjs` already do for the cues and the sprites.
Provenance stays a property of the repository rather than a promise in a registry row: there is
no file to trace, only arithmetic.

Seven profiles, seven syllables each — the table here must match `src/audio/voiceRegistry.ts`,
and `npm run verify:content` checks the built sprite's markers against it, because a missing
marker plays NOTHING, silently, and the character merely mouths its line.

A profile is a voice, not a character: `gruff` is the cook and the sergeant, and what separates
them at runtime is `babble.ts`'s per-line mood, not a third syllable set. One set per character
would be 49 more clips for a difference nobody could name blind.

Why a sprite rather than 49 files
---------------------------------
A Vorbis stream carries its codebooks in the header, and for a 150 ms clip that header IS the
file (~4.7 KB) — so 49 separate syllables would cost ~230 KB of which ~225 KB is 49 copies of the
same setup data. One sprite pays it once.

How a syllable is made
----------------------
A vowel is a buzz through resonators (formants), radiated at the lips — that is the whole trick,
and it is why these read as a voice rather than as beeps. In front of it is a consonant, and
**most of a consonant is heard in the vowel after it**: the formants start where the articulation
was and slide to where the vowel wants them over ~45 ms (`GLIDE_MS`, `formant_track`). The
consonant proper is a closure, a release and its aspiration for a plosive, breath through the
coming vowel's own tract for a fricative, a hum through a narrow resonator for `m`/`n` — and each
sits a measured number of dB UNDER the vowel it leads into (`CONSONANT_DB`), which is the one
place that balance is decided. Nothing here is a phoneme in any language; the point is that a
listener hears *speech-shaped noise* and reads the bubble for the words.

Determinism: every noise source is seeded from the marker name, and the encoder's one random
value — the Ogg stream serial — is pinned afterwards (`pin_ogg_serial`), so a rerun reproduces
the file byte for byte rather than churning a binary in the repo.
"""

import json
import pathlib
import subprocess
import sys
import wave

import numpy as np

SR = 32000

GAP_MS = 90
"""Silence after each marker.

A clip is at most 282 ms and `dialogueVoice.ts` detunes by at most 8%, so a marker can overrun its
window by ~23 ms. 90 ms clears that nearly four times over and keeps the sprite short — 56 markers
pay this gap 56 times."""

# **Long enough to overlap the next syllable, which is what makes a chain sound like speech.**
#
# They were 120-200ms against a 215-290ms step, so every syllable finished 65-140ms before the next
# one began and the voice came out as a row of separate blips. Continuous speech has no such gaps:
# one syllable's tail is still sounding when the next starts. These are sized so the clip outlasts
# the step by roughly 25ms at the default pace — see `audio.ts`'s voice pool, which is what allows
# two of them to sound at once.
MIN_MS, MAX_MS = 230, 320
"""The chunk spec's syllable length. Enforced here rather than trusted: under 120 ms a syllable
reads as a click, and over 200 ms the chain stops sounding like speech and starts sounding like
a tune."""

FADE_MS = 12

# How high the glottal source reaches. Speech intelligibility and "presence" live up to about 5-6
# kHz; past that a synthesised voice is buying hiss. See `glottal` for what this replaced and why.
HARMONIC_CEILING_HZ = 6000

# The brightness the delivered set has to clear, measured on the VOICED part of each clip. See the
# check at the end of `main` for what these guard against, why they cannot live in `verify:content`,
# and why measuring the whole clip instead let the guard be satisfied by hiss.
CENTROID_FLOOR_HZ = 1100
ROLLOFF_FLOOR_HZ = 2300
"""Every clip is faded to zero at both ends. The same lesson as the SFX sprite: a tail still
audible when its window closes is a hard truncation, which clicks, and the encoder smears that
discontinuity into the neighbouring silence."""

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "assets" / "voice"


# -- a deterministic container ------------------------------------------------------------------

OGG_SERIAL = 0x43484150  # "CHAP", so a stray serial in a hex dump is identifiably ours


def _ogg_crc(data):
    """Ogg's own CRC-32: polynomial 0x04c11db7, no reflection, no final xor. Not `zlib.crc32`,
    which is the reflected Ethernet variant and gives a different answer."""
    crc = 0
    for byte in data:
        crc ^= byte << 24
        for _ in range(8):
            crc = ((crc << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if crc & 0x80000000 else (crc << 1) & 0xFFFFFFFF
    return crc


def pin_ogg_serial(path, serial=OGG_SERIAL):
    """Rewrites every Ogg page's stream serial to a fixed value and repairs the page CRCs.

    **Because the ENCODER is not deterministic even though the synthesis is**, and this file claims
    in its own docstring that a rerun reproduces identical bytes. Measured: two runs over identical
    input samples differ in exactly 24 bytes — the 4-byte serial in each page header and the 4-byte
    CRC that covers it. libvorbis draws that serial from `av_get_random_seed()`; ffmpeg's
    `-serial_offset` does not pin it (it is added to the random value, not used instead of it), and
    `-fflags +bitexact` does not touch it either. The audio payload was already bit-identical, so
    the whole of the churn is a number whose only job is to tell multiplexed streams apart — and
    there is one stream in this file.

    A page is: "OggS", version, flags, 8-byte granule, 4-byte serial, 4-byte sequence, 4-byte CRC,
    a segment count and that many lengths, then the bodies.
    """
    data = bytearray(path.read_bytes())
    at = 0
    pages = 0
    while at < len(data):
        if data[at:at + 4] != b"OggS":
            sys.exit(f"{path.name}: expected an Ogg page at byte {at}")
        segments = data[at + 26]
        body = sum(data[at + 27:at + 27 + segments])
        size = 27 + segments + body
        data[at + 14:at + 18] = serial.to_bytes(4, "little")
        data[at + 22:at + 26] = bytes(4)
        data[at + 22:at + 26] = _ogg_crc(data[at:at + size]).to_bytes(4, "little")
        at += size
        pages += 1
    path.write_bytes(bytes(data))
    return pages


# -- primitives ---------------------------------------------------------------------------------


def n_samples(ms):
    return int(SR * ms / 1000)


def rng_for(name):
    return np.random.default_rng(sum(name.encode()) * 7919)


def glottal(ms, f0, f1=None, jitter=0.0, rng=None):
    """The buzz a voice is built on: a band-limited pulse train, integrated in phase so a pitch
    glide bends the note instead of sweeping the phase and buzzing (same reason as `make-sfx.py`'s
    `tone`). `jitter` wobbles the period slightly, which is most of what separates a voice from
    an oscillator."""
    n = n_samples(ms)
    t = np.arange(n) / SR
    f = np.full(n, float(f0)) if f1 is None else np.linspace(f0, f1, n)
    if jitter and rng is not None:
        wobble = np.cumsum(rng.standard_normal(n)) / SR
        f = f * (1 + jitter * wobble / (np.abs(wobble).max() + 1e-9))
    phase = 2 * np.pi * np.cumsum(f) / SR

    # **Harmonics up to a FREQUENCY, not a fixed count**, and the difference is the whole of
    # "sounds like a bad recording from underwater".
    #
    # This summed exactly 12 harmonics. At the pitches this cast actually speaks that is a source
    # band-limited to nothing: f0=129 Hz reaches 1542 Hz and f0=90 Hz reaches 1077, with the top
    # harmonic 21 dB down. Measured on the delivered clips, `plummy` put 99.8% of its energy below
    # 500 Hz and 0.1% above 1 kHz — and the third formant, 2240-2550 Hz, which is the band that
    # carries DEFINITION in a voice, had no source energy to resonate at all. It was in the table
    # doing nothing.
    #
    # No runtime filter can repair that: there is nothing above 1 kHz to boost. The count has to
    # come from the pitch, so every profile reaches the same place regardless of how deep it is.
    #
    # The original comment's concern still stands and is why this is a CAP rather than a saw: a raw
    # sawtooth has content to Nyquist and the alias noise is what makes a synthetic voice sound like
    # a modem. The ceiling below is under half the sample rate, and the count is taken from the
    # highest pitch the glide reaches so a rising syllable cannot cross it either.
    top = max(float(f0), float(f1 if f1 is not None else f0)) * (1 + jitter)
    count = max(1, int(min(HARMONIC_CEILING_HZ, 0.45 * SR) / max(top, 1e-6)))
    out = np.zeros(n)
    for harmonic in range(1, count + 1):
        out += np.sin(phase * harmonic) / harmonic
    # Normalised by what a 12-harmonic sum used to reach, so the source keeps its old level rather
    # than getting quieter as it gains bandwidth.
    return out * (1.0 / 2.2)


def resonator(x, freq, q):
    """Two-pole band-pass — one formant. Written as a loop rather than an FFT because a syllable
    is ~8000 samples and there are 56 of them: clarity is worth more than the milliseconds.

    **`freq` may be a TRACK rather than a number**, which is what lets a formant move. A consonant
    is heard mostly in what it does to the vowel after it — the formants start at the place the
    tongue or the lips were and slide to where the vowel wants them, over about 45ms — so the
    coefficients have to be recomputed as the syllable runs. They are computed vectorised, up
    front; only the recursion itself is a loop, which is exactly as it was before."""
    freq = np.asarray(freq, dtype=float)
    if freq.ndim == 0:
        freq = np.full(x.size, float(freq))
    r = np.exp(-np.pi * freq / (q * SR))
    theta = 2 * np.pi * freq / SR
    a1, a2 = 2 * r * np.cos(theta), -(r**2)
    out = np.zeros_like(x)
    y1 = y2 = 0.0
    for i, v in enumerate(x):
        y = v + a1[i] * y1 + a2[i] * y2
        out[i] = y
        y2, y1 = y1, y
    return out * (1 - r)


def radiate(x, a=0.96):
    """Lip radiation: the stage this synthesiser was missing, and the reason it sounded muffled.

    Source-filter theory has three parts and only two were here — a glottal source, a vocal tract of
    formant resonators, and the RADIATION from the lips, which is a differentiator and adds +6 dB per
    octave across the whole spectrum. Without it a formant bank hands back the source's own -6 dB/oct
    slope narrowed to three peaks, and F3 comes out about 30 dB under F1: measured on the delivered
    clips, 99.5% of a voice's energy sat below 500 Hz and the 2.2-2.6 kHz band that carries a voice's
    definition was 0.0%.

    One line, physically motivated, and it does what no amount of runtime filtering could: it changes
    the SLOPE rather than boosting a band that has nothing in it.
    """
    out = np.empty_like(x)
    out[0] = x[0]
    out[1:] = x[1:] - a * x[:-1]
    return out


def formants(x, pairs):
    """Sums several resonators. Two is a vowel; a third adds a bit of body."""
    out = np.zeros_like(x)
    for freq, q, gain in pairs:
        out += resonator(x, freq, q) * gain
    return out


def noise(ms, rng):
    return rng.standard_normal(n_samples(ms))


def noise_n(n, rng):
    return rng.standard_normal(max(0, int(n)))


def active_rms(x):
    """RMS of the part that is actually sounding.

    A plosive is mostly silence — a closure, then a release — so a plain RMS over its window would
    report a level the listener never hears, and balancing against it would make every burst far too
    loud to compensate for the gap in front of it."""
    if x.size == 0:
        return 0.0
    peak = float(np.max(np.abs(x)))
    if peak <= 0:
        return 0.0
    live = x[np.abs(x) > peak * 0.01]
    return float(np.sqrt((live**2).mean())) if live.size else 0.0


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    out = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        out[i] = acc
    return out


def vowel_env(ms, attack_ms, release_ms):
    """Raised-cosine in, exponential-ish out. The attack is what makes a syllable a syllable
    rather than a note switching on."""
    n = n_samples(ms)
    e = np.ones(n)
    a = max(1, n_samples(attack_ms))
    r = max(1, n_samples(release_ms))
    e[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    e[-r:] *= np.linspace(1, 0, r) ** 1.6
    return e


def fade_edges(x):
    f = max(1, n_samples(FADE_MS))
    if x.size <= f * 2:
        return x
    x = x.copy()
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    return x


def norm(x, peak=0.62):
    """Voices sit under the effects rather than over them — the shots are the feedback the game
    is played on (the same reasoning as the music bus's trim in `audio/audio.ts`)."""
    m = np.max(np.abs(x))
    return x if m < 1e-9 else x * (peak / m)


# -- syllable construction ----------------------------------------------------------------------


# A stop's three parts. The comment on the old one-line version claimed "a brief silence then a
# burst" and there was no silence in it — it was a decaying noise puff butted straight against the
# vowel, which is a click, not a stop. **The silence is not a pause, it is the consonant**: the
# closure is what the ear measures the release against, and without it a plosive has nothing to be
# the release OF. The aspiration after it is the same idea from the other end — turbulence through a
# tract that is already shaped for the vowel, before the voicing catches up.
CLOSURE_MS = 22
BURST_MS = 6

# How loud each kind sits under the vowel it leads into, in dB of active RMS.
#
# **Set by measurement rather than by an amplitude, because an amplitude cannot survive a change
# upstream — and did not.** These were fixed multipliers (0.35-0.5) picked when the vowel was raw
# formant output. `radiate` then arrived to fix the underwater sound; it is a differentiator, so it
# cut the voiced part's amplitude hard and nothing rebalanced against it. Measured on the delivered
# clips: nasals came out **+16.3 dB ABOVE** the vowel and fricatives **+9.9 dB above**, so on 24 of
# the 56 clips the loudest thing in the voice was a hum or a hiss and the voice itself was
# normalised down underneath it. Running speech puts a fricative 15-25 dB under the neighbouring
# vowel and a nasal 6-10 under; a burst is louder than that in the peak but it is six milliseconds
# long, so it is quoted here on the same active-RMS footing as the rest.
CONSONANT_DB = {"plosive": -13.0, "fricative": -19.0, "nasal": -8.0}


def consonant(kind, ms, rng, f0, tract):
    """The front of a syllable. Returns a signal to prepend, at whatever level falls out — it is
    scaled against the vowel by `syllable`, which is the only place the balance is decided.

    `tract` is the vowel's own (already profile-scaled) formant bank: aspiration and the nasal
    murmur are the SAME vocal tract as the vowel, excited differently, which is most of why they
    read as belonging to the syllable rather than as a noise stuck on the front of it."""
    if kind == "none":
        return np.zeros(0)
    n = n_samples(ms)

    if kind == "plosive":  # b / d / g — closure, release, aspiration
        out = np.zeros(n)
        at = n_samples(CLOSURE_MS)
        burst_n = n_samples(BURST_MS)
        burst = noise_n(burst_n, rng) * np.exp(-np.linspace(0, 7, burst_n))
        # A release is a high-frequency event — it is air escaping a small gap, not a thump. The old
        # one-pole lowpass at 2600 Hz was pointed the wrong way; subtracting the lowpass keeps the
        # part of the burst the ear actually locates the consonant by.
        burst = burst - lowpass(burst, 700)
        out[at:at + burst_n] = burst
        asp_n = n - (at + burst_n)
        if asp_n > 0:
            asp = radiate(formants(noise_n(asp_n, rng), tract))
            out[at + burst_n:] = asp * np.linspace(1.0, 0.15, asp_n) ** 1.5
        return out

    if kind == "fricative":  # v / gv — breath through the coming vowel's own tract
        breath = lowpass(noise_n(n, rng), 5200)
        breath = breath - lowpass(breath, 900)
        return breath * np.linspace(0.25, 1.0, n) ** 1.3

    if kind == "nasal":  # m / n — a low hum through a narrow resonator
        hum = glottal(ms, f0)
        return formants(hum, [(280, 12, 1.0), (1100, 8, 0.25)]) * vowel_env(ms, 8, 20)

    raise ValueError(kind)


# How long the formants take to slide from the consonant's locus to the vowel's own place.
#
# This is the whole of what "articulated" means here, and it was missing: measured on the delivered
# clips, F2 moved 61 Hz over the vowel's onset, i.e. every vowel started already parked at its
# steady state. A listener reads a transition as a consonant even when the burst in front of it is
# barely audible — it is the strongest cue in the syllable, and it costs one interpolation.
GLIDE_MS = 45
# Where F1 starts at the release. Low for every consonant, because F1 is a function of how open the
# mouth is and a consonant is the closed part.
LOCUS_F1 = 280


def formant_track(target, locus, n, glide_n):
    """A formant's frequency over the vowel: from the locus to where the vowel wants it."""
    if locus is None or glide_n <= 0:
        return target
    track = np.full(n, float(target))
    track[:glide_n] = np.linspace(locus, target, min(glide_n, n))
    return track


def syllable(name, profile, spec):
    """One clip: consonant + vowel, filtered, enveloped, faded, length-checked."""
    rng = rng_for(name)
    cons_kind, cons_ms, vowel_ms, f0_scale, vowel_name, glide, locus = spec
    pairs = VOWELS[vowel_name]

    f0 = profile["f0"] * f0_scale
    total_ms = cons_ms + vowel_ms
    if not MIN_MS <= total_ms <= MAX_MS:
        sys.exit(f"{name} is {total_ms}ms, outside {MIN_MS}-{MAX_MS}ms")

    buzz = glottal(vowel_ms, f0, f0 * glide, jitter=profile["jitter"], rng=rng)
    if profile["breath"] > 0:
        buzz = buzz + lowpass(noise(vowel_ms, rng), 3000) * profile["breath"]

    steady = [(freq * profile["formant_scale"], q, gain) for freq, q, gain in pairs]

    # **The formants slide out of the consonant's place into the vowel's.** F1 always rises from a
    # near-closed mouth; F2 comes from wherever the articulation was — forward for a labial, back
    # for a velar — which is the cue that says WHICH consonant it was. F3 is left alone: it moves
    # too, but it is the weakest of the three and a third track buys nothing audible.
    n_vowel = n_samples(vowel_ms)
    glide_n = min(n_samples(GLIDE_MS), n_vowel)
    scale = profile["formant_scale"]
    tracked = [
        (formant_track(steady[0][0], LOCUS_F1 * scale if locus else None, n_vowel, glide_n), *steady[0][1:]),
        (formant_track(steady[1][0], locus * scale if locus else None, n_vowel, glide_n), *steady[1][1:]),
        steady[2],
    ]
    vowel = radiate(formants(buzz, tracked)) * vowel_env(vowel_ms, 12, max(20.0, vowel_ms * 0.45))

    if profile.get("wet"):
        # The octopus's "wet tail": a fast tremolo plus a downward bend over the last third, so
        # the syllable finishes with a bubble rather than a stop.
        t = np.arange(vowel.size) / SR
        vowel = vowel * (1 + 0.35 * np.sin(2 * np.pi * 34 * t))
        tail = int(vowel.size * 0.66)
        vowel[tail:] *= np.linspace(1, 0.55, vowel.size - tail)

    parts = []
    if cons_ms > 0:
        cons = consonant(cons_kind, cons_ms, rng, f0, steady)
        # **The balance is decided here and nowhere else**, against the vowel this consonant
        # actually leads into rather than against a number chosen when the vowel stage was
        # different. See `CONSONANT_DB` for what that cost the last time it was a constant.
        want = active_rms(vowel) * 10 ** (CONSONANT_DB[cons_kind] / 20)
        have = active_rms(cons)
        if have > 0:
            cons = cons * (want / have)
        parts.append(cons)
    parts.append(vowel)
    clip = np.concatenate(parts) if parts else vowel

    if profile.get("dark"):
        clip = lowpass(clip, profile["dark"])

    want = n_samples(total_ms)
    if clip.size < want:
        clip = np.concatenate([clip, np.zeros(want - clip.size)])
    return norm(fade_edges(clip[:want]))


# Vowel formant pairs, before a profile's own scaling. Roughly: a, e, i, o, u, plus two blends.
# (freq, Q, gain)
VOWELS = {
    "a": [(730, 9, 1.0), (1090, 8, 0.7), (2440, 6, 0.2)],
    "e": [(530, 9, 1.0), (1840, 8, 0.6), (2480, 6, 0.2)],
    "i": [(390, 10, 1.0), (1990, 9, 0.8), (2550, 6, 0.25)],
    "o": [(570, 9, 1.0), (840, 8, 0.6), (2410, 5, 0.15)],
    "u": [(440, 10, 1.0), (1020, 8, 0.5), (2240, 5, 0.12)],
    "ae": [(660, 9, 1.0), (1720, 8, 0.7), (2410, 6, 0.2)],
    "oe": [(500, 9, 1.0), (1500, 8, 0.6), (2500, 5, 0.15)],
}

# (consonant, consonant ms, vowel ms, f0 scale, vowel, pitch glide, F2 locus Hz)
#
# **The consonants are longer than they were and the totals are identical**, to the millisecond: a
# stop needs room for a closure, a release and its aspiration, and that room is taken out of the
# vowel rather than added to the clip. The clip length is load-bearing — see MIN_MS/MAX_MS, where it
# is what makes one syllable's tail overlap the next — so lengthening a consonant at the clip's
# expense would have quietly undone the overlap this set was just retuned for.
#
# The locus is where F2 starts at the release, before it slides to the vowel's own second formant.
# Forward for a labial (the lips are the front of the tract), further back for an alveolar, back
# again for a velar. `None` for the one vowel-initial syllable, which has nothing to slide out of.
SYLLABLES = [
    ("plosive", 48, 214, 1.00, "a", 0.94, 800),     # "ba"  — labial
    ("plosive", 48, 232, 1.06, "u", 0.90, 1750),    # "du"  — alveolar
    ("nasal", 44, 222, 0.96, "oe", 0.97, 900),      # "mrm" — labial nasal
    ("fricative", 42, 232, 1.10, "e", 1.05, 1700),  # "gve"
    ("none", 0, 280, 1.02, "i", 0.88, None),        # "ii"  — vowel-initial
    ("plosive", 48, 234, 0.92, "o", 1.04, 1900),    # "go"  — velar
    ("fricative", 42, 234, 1.04, "ae", 0.93, 1100),  # "vae" — labiodental
]

PROFILES = {
    # f0: the speaking pitch. formant_scale: a smaller vocal tract shifts every formant up, which
    # is what makes `squeak` read as small rather than merely high.
    "squeak": dict(f0=310, formant_scale=1.25, jitter=0.05, breath=0.05),
    "gruff": dict(f0=104, formant_scale=0.88, jitter=0.09, breath=0.10, dark=3200),
    "nasal": dict(f0=196, formant_scale=1.05, jitter=0.04, breath=0.03),
    "airy": dict(f0=214, formant_scale=1.12, jitter=0.03, breath=0.34),
    "burble": dict(f0=138, formant_scale=0.92, jitter=0.07, breath=0.06, wet=True, dark=2600),
    "dry": dict(f0=150, formant_scale=1.00, jitter=0.02, breath=0.02, dark=4200),
    "booming": dict(f0=88, formant_scale=0.82, jitter=0.03, breath=0.04, dark=2800),
    # The menu mascot's own, and the only profile no opponent uses. A coin in a top hat is
    # well-fed and pleased with itself: low-ish, wide-formanted (a bigger tract), and steadier
    # than anything else here — the jitter is what a voice does when it is not sure of itself, so
    # a character this certain gets almost none. Distinct from `gruff` by being smoother and a
    # fourth higher, and from `booming` by being nowhere near as deep.
    "plummy": dict(f0=126, formant_scale=0.86, jitter=0.035, breath=0.08, dark=3000),
}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    pieces = []
    voiced = []
    spritemap = {}
    cursor = 0.0
    gap = np.zeros(n_samples(GAP_MS))

    for profile_name, profile in PROFILES.items():
        for index, spec in enumerate(SYLLABLES, start=1):
            name = f"{profile_name}_{index}"
            clip = syllable(name, profile, spec)
            # Kept apart for the brightness check below, which has to look at the voiced part alone.
            voiced.append(clip[n_samples(spec[1]):])
            ms = clip.size / SR * 1000

            start = cursor
            end = start + ms / 1000
            spritemap[name] = {"start": round(start, 6), "end": round(end, 6), "loop": False}
            pieces.append(clip)
            pieces.append(gap)
            cursor = end + GAP_MS / 1000

    track = np.concatenate(pieces)
    print(f"{len(spritemap)} markers, {cursor:.2f}s total, peak {np.max(np.abs(track)):.3f}")

    # **A brightness floor, checked here because this is the only place the audio exists.**
    #
    # `verify:content` reads the sprite's marker table and cannot decode Ogg, so a voice that got
    # muffled would pass every check in the repository. One did: before `radiate` was added, the
    # delivered clips put 99.5% of their energy below 500 Hz and measured a mean spectral centroid of
    # 813 Hz with a 90% rolloff of 1774 Hz — reported, correctly, as sounding like a bad recording
    # from underwater.
    #
    # **It measures the VOICED part of each clip, and measuring the whole one was a hole in the
    # guard rather than a detail.** `radiate` is a stage in the voiced path; a consonant is
    # broadband noise and lifts a centroid all on its own. While the consonants were mistakenly
    # louder than the vowels (see `CONSONANT_DB`) they supplied most of the number: measured, a set
    # built with `radiate` DELETED and those loud consonants still came out at 1594 Hz / 4098 Hz and
    # sailed past a 1400/3500 floor. The check was passing on hiss. On the voiced part alone the two
    # states are unmistakable — 1478 / 3186 with radiation and 717 / 1538 without — and the floors
    # below sit between them with room for ordinary retuning at either end.
    centroids, rolloffs = [], []
    for clip in (c for c in voiced if c.size > n_samples(GAP_MS)):
        mag = np.abs(np.fft.rfft(clip * np.hanning(clip.size)))
        freqs = np.fft.rfftfreq(clip.size, 1 / SR)
        centroids.append(float((mag * freqs).sum() / max(mag.sum(), 1e-9)))
        run = np.cumsum(mag)
        rolloffs.append(float(freqs[min(int(np.searchsorted(run, mag.sum() * 0.9)), freqs.size - 1)]))
    centroid = float(np.mean(centroids))
    rolloff = float(np.mean(rolloffs))
    print(f"voiced spectral centroid {centroid:.0f} Hz, mean 90% rolloff {rolloff:.0f} Hz")
    if centroid < CENTROID_FLOOR_HZ or rolloff < ROLLOFF_FLOOR_HZ:
        sys.exit(
            f"the voice is muffled: centroid {centroid:.0f} Hz (floor {CENTROID_FLOOR_HZ}), "
            f"90% rolloff {rolloff:.0f} Hz (floor {ROLLOFF_FLOOR_HZ}). "
            "Check that `radiate` is still applied after the formant bank."
        )

    wav_path = OUT_DIR / "voice.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(track, -1, 1) * 32767).astype("<i2").tobytes())

    ogg_path = OUT_DIR / "voice.ogg"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
         "-c:a", "libvorbis", "-q:a", "1", "-ac", "1", str(ogg_path)],
        check=True,
    )
    wav_path.unlink()
    pin_ogg_serial(ogg_path)

    (OUT_DIR / "voice.json").write_text(
        json.dumps({"resources": ["voice.ogg"], "spritemap": spritemap}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {ogg_path.name} ({ogg_path.stat().st_size} bytes) and voice.json")


if __name__ == "__main__":
    main()
