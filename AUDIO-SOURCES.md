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
| `audio/blip.wav` | Synthesized locally — pure ~441 Hz sine tone, 0.15s, 16-bit mono PCM @ 22050 Hz, peak amplitude exactly 20.00% of full scale (verified by inspecting the raw PCM samples: constant-period waveform, no external source referenced in the commit that added it). Not from any downloaded template or sample pack. | Self-generated | 2026-07-08 |
