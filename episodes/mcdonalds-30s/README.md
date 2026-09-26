# Test episode: McDonald's is a landlord (31.7 s)

Built end to end with studio-engine, from a checked script to a mastered 1080p MP4.

| Step | Command | Output |
|---|---|---|
| Voice | ElevenLabs, voice "Brad – Warm, Trusted Storyteller" (28.75 s) | `media/voice.mp3`, normalised to −16 LUFS with `studio-render loudness --preset=voice --fix` |
| Word timings | `node align.mjs <voice> transcript.txt > words.json` | no speech recognition was reachable here: the known text is aligned on the pauses of the voice (±100–150 ms) |
| Image | ElevenLabs image (Seedream 5 Lite): generic counter, no logo | `media/counter.jpg`, marked `syntheticMedia` (YouTube disclosure) |
| Document | `report.html` → `report.png` | reconstruction of the 10-K 2023 revenue table, labelled as such |
| Music | `node music.mjs music.wav` | synthesised bed (own production), −14 LUFS |
| Plan | `node input.mjs > input.json`, then `editor-brain direct input.json --plan > plan.json` | 12 shots, final-valid |
| Render | `studio-render render plan.json out/mcdonalds-30s.mp4 --fallback` | 950 frames, 1080p, −14.0 LUFS |
| QC | `studio-render qc plan.json out/mcdonalds-30s.mp4` | PASS, 1 warning (SRC-04: synthetic image) |

To render again, copy `media/voice.mp3`, `media/counter.jpg` (as `counter.png`) and `media/report.png`, plus the music from `music.mjs`, into `packages/remotion/public/mcd/`, with the voice converted to WAV (`voice.wav`).

Figures, checked against McDonald's Form 10-K reports:

- 2023 revenue: $25.49B total, of which $15.44B from franchised restaurants. That is 60.5 %, so the script says "over 60 %", not the earlier "over 61 %".
- Rents: $7.50B in 2019 and $9.84B in 2023.
- McDonald's owns about 57 % of the land and 80 % of the buildings of its restaurants, so the script says "the land under more than half of them".

YouTube description: "Figures: McDonald's Corporation, Form 10-K 2023 (SEC)". Declare altered or synthetic content (the restaurant image is AI-generated).
