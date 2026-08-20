# Font Sources

Provenance registry for every font file under `public/assets/fonts/`. Same rule and same
reasoning as `AUDIO-SOURCES.md`: a font ships inside the submission ZIP, so an unresolved
license question on it is a rejection/legal risk exactly like an unlicensed sound. Only
**OFL**, **Apache-2.0**, **CC0**, or **self-generated** fonts are acceptable, and the row
goes in **before** the file is added.

Lives at the repo root, not under `public/assets/`, deliberately — an internal process
document must never end up in `dist/` or the ZIP (see CLAUDE.md "Build Guards & Asset
Policy"). The font's own license text is a different matter: **`OFL.txt` ships next to the
font on purpose** — OFL §3 requires the license to travel with the distributed font.

| File | Source (URL) | License | Date added |
|---|---|---|---|
| `fonts/fredoka-600-latin.woff2` | Fredoka v17, weight 600 (SemiBold), **latin subset only** — fetched from the URL Google Fonts' own `css2?family=Fredoka:wght@600` API serves for that subset: `https://fonts.gstatic.com/s/fredoka/v17/X7n64b87HvSqjb_WIi2yDCRwoQ_k7367_DWu89U.woff2`. Upstream project: https://github.com/hafontia/Fredoka-One | OFL 1.1 (`fonts/OFL.txt`, from https://github.com/google/fonts/blob/main/ofl/fredoka/OFL.txt) | 2026-08-10 |

Why this font and only this subset: CONCEPT.md §6 calls for a heavy rounded grotesque, and
the game ships `en`/`es` only — both fully covered by the latin subset (`U+0000-00FF` plus
common punctuation). Google serves latin-ext and hebrew as separate files; neither is
downloaded or shipped. Adding a locale outside that coverage (Cyrillic, say) means adding
the matching subset file and a row here, **not** silently letting glyphs fall back — a
fallback face mid-string is visible immediately in this style.
