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

## HyperFrames version

`node hyperframes.mjs` writes `plan-hyperframes.json`: the same plan with five shots taken from the HyperFrames catalog (SCENE_ENGINE.md §28):

| Shot | Item |
|---|---|
| chapter-2 | `split-flap-board` "REAL ESTATE EMPIRE" (played at 2.4×) |
| u6-b | `vox-annotate`, "prime" highlighted, note "location, location, location" |
| u7 | `marker-highlight`, "land" circled on the impact |
| u8 | `line-swap` "McDonald's makes billions" → "from real estate." |
| u9 | overlay `shutter-slam` "LANDLORD" |

Render: `npm run hyperframes:sync -w @studio-engine/remotion` once, then `studio-render render plan-hyperframes.json out/mcdonalds-30s-hyperframes.mp4`. Result: 950 frames, 104 s cold, −14.0 LUFS, QC PASS (same SRC-04 warning).

The LANDLORD overlay repeats the caption "it's a landlord" under it.

## Apple-style version (studio blocks)

`node apple.mjs` writes `plan-apple.json`: every shot is a studio block (SCENE_ENGINE.md §28.1), timed to the words of the narration. The cues are computed from `words.json` through the narration segments, so they follow the voice even where the segments are shifted.
- Same voice, music, sound effects and cut points.
- Hard cuts: the two transitions become cuts, and the shots they overlapped lose the overlap, so every shot keeps its start frame.
- No burned-in captions: the type carries the words.

| Shots | Block |
|---|---|
| u1 | `studio-title`, "burger" struck through |
| u2, u9 | `studio-image`: the counter opens from a window, dims under the line |
| u3 | `studio-stat`: 60 % in a filling ring |
| u4 | `studio-document`: the 10-K sentence, "rent" and "royalties" highlighted as they are said, the two rows |
| u5-a + u5-b | one `studio-bars`: $7.5B → $9.8B, +31 % |
| chapter-2 + u6-a | one `studio-map`: chapter title in the pause, the four cities as they are named |
| u6-b, u8 | `studio-title` |
| u7 | `studio-units`: 57 of 100 units, "more than half" |

Render: `studio-render render plan-apple.json out/mcdonalds-30s-apple.mp4`. Result: 950 frames, 164 s cold, −14.0 LUFS. QC PASS, with one warning (SRC-04, synthetic image).

To render again, copy `media/voice.mp3`, `media/counter.jpg` (as `counter.png`) and `media/report.png`, plus the music from `music.mjs`, into `packages/remotion/public/mcd/`, with the voice converted to WAV (`voice.wav`).

Figures, checked against McDonald's Form 10-K reports:

- 2023 revenue: $25.49B total, of which $15.44B from franchised restaurants. That is 60.5 %, so the script says "over 60 %", not the earlier "over 61 %".
- Rents: $7.50B in 2019 and $9.84B in 2023.
- McDonald's owns about 57 % of the land and 80 % of the buildings of its restaurants, so the script says "the land under more than half of them".

YouTube description: "Figures: McDonald's Corporation, Form 10-K 2023 (SEC)". Declare altered or synthetic content (the restaurant image is AI-generated).
