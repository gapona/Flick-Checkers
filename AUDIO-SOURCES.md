# Audio Sources

Provenance registry for every audio file under `public/assets/`. Required by CLAUDE.md
"Build Guards & Asset Policy": no audio file may be added without a row here, and only
**CC0** or **self-generated** audio is allowed — an unresolved copyright claim on a sound
is one of the most common rejection reasons on Playables.

Lives at the repo root, not under `public/assets/`, deliberately: it's an internal
process document, not a game asset — it must never ship inside `dist/` or the submission
ZIP (see CLAUDE.md "Build Guards & Asset Policy").

| File | Source (URL) | License | Date added |
|---|---|---|---|
| `audio/move.ogg` | Synthesized by `scripts/make-audio.mjs` (`npm run audio`) — every sample computed in plain JS from oscillators, noise from a seeded PRNG, enveloped and mixed by that script, then encoded to Ogg Vorbis with ffmpeg. No sample pack, no recording, no external source of any kind. | Self-generated | 2026-08-11 |
| `audio/capture.ogg` | Same generator, same terms. | Self-generated | 2026-08-11 |
| `audio/promote.ogg` | Same generator, same terms. | Self-generated | 2026-08-11 |
| `audio/win.ogg` | Same generator, same terms. | Self-generated | 2026-08-11 |
| `audio/lose.ogg` | Same generator, same terms. | Self-generated | 2026-08-11 |
| `audio/ui.ogg` | Same generator, same terms. | Self-generated | 2026-08-11 |
| `audio/music.ogg` | **Stable Audio (Stability AI), run by the project author** — NOT the procedural bed and not a stock library, a loop pack or a recording. Supplied as `warm-cheerful-instrumental-major-key_082026.mp3` (90.00s, stereo 44.1kHz, MP3 130kbps); the file's own metadata says nothing, every tag having been stripped before it arrived, so the model is recorded here on the author's statement rather than from the artifact. **The prompt and the seed are NOT recorded and cannot be recovered from the file** — which is the one place this row falls short of every image row above, where a seed makes each render reproducible from the script alone. **The licence position still needs confirming before submission — see the note below.** Delivered by one deterministic transform, no dynamics processing of any kind: trimmed to 89.656s (the source ends with 344ms of digital silence, which on `loop: true` is an audible hole at every wrap), gain-matched by LINEAR `loudnorm` to **−16.5 LUFS** — measured off the procedural bed it replaces, so `MUSIC_VOLUME` and all six one-shot levels stay calibrated — and encoded to Ogg Vorbis `-q:a 3`, stereo, the same quality number `make-audio.mjs` had always given this cue. Required gain was −2.1 dB against a source true peak of −0.08 dBTP, so linear was reachable and the master is untouched apart from that one scalar. | Stability AI — **see the note below**, this is NOT the CreativeML Open RAIL++-M the images rely on | 2026-08-20 |
| `voice/voice.ogg` | Synthesized by `scripts/make-voice.py` (`npm run voice`) — the opponents' pseudo-voice and the menu mascot's, **56 syllables in one Ogg audio sprite**, each 262-282ms — long enough to overlap the next one, which is what makes a chain of them read as speech rather than as separate blips — eight profiles of seven. Seven belong to the cast (`src/game/opponents.ts`, several shared between characters, because what separates two of them in play is pitch and pacing rather than a third syllable set nobody could name blind); the eighth, `plummy`, is the mascot's alone, added when it stopped borrowing the marshal's `burble` — a character that talks in another character's voice is a character the ear files as that other one. Every sample is arithmetic on numpy arrays: a glottal buzz through formant resonators for each vowel, radiated at the lips; for each consonant a closure, a release and its aspiration, or breath through the tract the vowel is about to use, balanced a measured number of dB under that vowel, with the formants sliding out of the consonant's own place into the vowel's. Every noise source is seeded from the marker name and the encoder's one random value — the Ogg stream serial — is pinned afterwards, so a rerun reproduces the file byte for byte. **No recording, no voice actor, no text-to-speech, no sample pack** — nothing here is a phoneme in any language, it is speech-*shaped* noise and the words are read from the screen. Encoded to Ogg Vorbis with ffmpeg. | Self-generated | 2026-08-18 |

## The music bed is the first audio file this repo did not compute

Every other row above is arithmetic, and that was the whole argument: provenance is a property of
the repository rather than a promise in a registry row, because there is no file to trace, only code
to read. The music is now an exception, deliberately, and it costs two things worth naming.

**The generator still exists and is no longer run by default.** `makeMusic` is untouched in
`scripts/make-audio.mjs`; what changed is that `npm run audio` — a command anyone would run to
refresh the six one-shots — now SKIPS the music cue and says so, because until this it would have
silently overwritten the track. That is the same guard, for the same reason and after the same near
miss, that `npm run assets -- --backgrounds` grew when the backgrounds became renders.
`npm run audio -- --music` puts the procedural bed back, which is the fallback if the track is ever
pulled.

**The row above names the model and still does not clear it, and the build gate cannot tell the
difference.** `check-bundle.mjs` only asks that the filename appears in this file — it is
deliberately dumb, and this is exactly the case its own documentation warns about: it cannot tell a
truthful row from a careless one. Two things are open, and the second is the one that matters:

- **The prompt and seed are not recorded.** Every image in `ART-SOURCES.md` can be re-derived from
  its script and a seed; this track cannot be re-derived from anything. If it is ever re-rolled,
  record both, the same way the render scripts do.
- **Stable Audio is not covered by the licence the rest of this project leans on.** The images
  stand on SDXL's CreativeML Open RAIL++-M plus the position that a raw model output is not
  copyrightable under current US Copyright Office guidance — which is the position this game needs,
  since it means nobody else can register a claim either. Stable Audio ships under **Stability AI's
  own community/marketplace terms, a different document**, and which one applies depends on whether
  this came from the hosted service or from open weights run locally: the hosted service grants
  commercial use on paid tiers only, and the open weights carry a revenue threshold and an
  attribution condition. **Confirm which was used and read that document before submission** — the
  numbers are not restated here on purpose, because a licence summarised from memory in a registry
  row is precisely the kind of promise this file exists to replace.

Until that is done, the honest description of this file is "named, not cleared". The procedural bed
is one command away (`npm run audio -- --music`) if the answer comes back wrong.

Removed, kept here because the rule is about every file that ever shipped:

| File | Source (URL) | License | Removed |
|---|---|---|---|
| `audio/blip.wav` | Synthesized locally — pure ~441 Hz sine tone, 0.15s, 16-bit mono PCM @ 22050 Hz, peak amplitude exactly 20.00% of full scale (verified by inspecting the raw PCM samples: constant-period waveform, no external source referenced in the commit that added it). Not from any downloaded template or sample pack. Added 2026-07-08 as the template's placeholder; deleted in S10 once the real set landed. | Self-generated | 2026-08-11 |
