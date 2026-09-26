---
name: produce-episode
description: Produce a documentary episode end to end in the Apple style (studio HyperFrames blocks timed to the voice) — frozen script, ElevenLabs voice, word timings, plan with `--style apple`, control sheet, render, QC. Use whenever the user asks to make, re-make or retouch an episode or a short video from a script. Keeps token spend low: one session per episode, control sheet before any full render.
---

# Produce an episode (Apple style)

The episode lives in `episodes/<slug>/`. Use `episodes/mcdonalds-30s/` as the template:
- `input.mjs` → `input.json`: script, assets and hints;
- `plan-apple-auto.json`: the plan the brain produced;
- `README.md`: what was done.

Read only what this skill names. Do not read the full repository.

## Cost rules (read first)

1. **One session per episode.** Do not continue an episode in a long session: every action re-reads the whole context.
2. **Control sheet before any full render.** `npm run stills` costs about 1 minute and one image to look at. A full render costs about 3 minutes, and a failed one costs a second render.
3. **Retouching one shot:** change the input, regenerate the plan, then run `npm run stills -- <plan> --shots <id>`, then render. Chunks whose shots did not change come from the cache.
4. **Never read the catalogs.** `packages/engine/hyperframes-catalog.json` (660 KB) and `public/hyperframes/` are off limits. The Apple style only uses the 7 studio blocks (SCENE_ENGINE.md §28.1).
5. **Do not open big JSON files whole** (`plan.json`, `words.json`, `QC_REPORT.json`). Summarise them with a one-line `node -e` or `python3 -c`.
6. **Fix the input, not the plan.** Edit `input.mjs` (text, hints) and regenerate. Never hand-edit `plan.json`: the next regeneration would lose the edit.
7. **Group your actions.** Chain the commands of a step in one shell call. Do not run a command only to look at something you can derive.
8. **Do not interrupt a long command** (render, sync). A restart reloads the whole context into the cache.

## 0. Once per machine or container

```bash
npm install && npm run build
npm run hyperframes:sync -w @studio-engine/remotion     # public/hyperframes (studio blocks + runtime)
export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell   # cloud container; locally, omit
```

`ffmpeg` must be on the PATH.

## 1. Script (frozen before the voice)

1. Copy `episodes/mcdonalds-30s/input.mjs` into `episodes/<slug>/input.mjs` and write the script. Use `kind: 'chapter'` for chapters and `kind: 'text'` for sentences.
2. **Freeze the text before generating the voice.** Every regeneration of the voice costs credits again (about 1 credit per character).
3. **Put the facts in the hints, never in guesses.** Each fact has a source.

| Hint | Effect in the Apple style |
|---|---|
| `chart: { kind: 'barChart', labels, values, unit, title, source }` | `studio-bars` |
| `share: { value, of?, label }` | `studio-units` (e.g. 57 of 100) |
| `documentCard: { header, heading, sentence with *marked* words, rows }` | `studio-document` (a reconstruction, labelled as such) |
| `source` | source line under a figure |
| `strike` | a word struck through at the end of the sentence |
| `media` | the asset to show on this sentence |

Without `documentCard` a document keeps the engine's own composition. Without `share` the sentence becomes a title.

## 2. Voice

- **Generate** with ElevenLabs, from the frozen text. Use the ElevenLabs connector if it is present (`creative_generate_speech`), otherwise the web app. Save to `episodes/<slug>/media/voice.mp3`.
- **Normalise the voice to −16 LUFS** and write the WAV the render uses:

```bash
mkdir -p packages/remotion/public/<slug>
node packages/render/bin/studio-render.mjs loudness episodes/<slug>/media/voice.mp3 --preset=voice --fix=packages/remotion/public/<slug>/voice.wav
```

## 3. Word timings (`words.json`: `[{ text, startMs, endMs }]`)

- **Preferred:** a transcription with word timings (ElevenLabs `creative_transcribe_audio`), converted to that shape.
- **Fallback, without speech recognition** (±100–150 ms per word):

```bash
node episodes/mcdonalds-30s/align.mjs episodes/<slug>/media/voice.mp3 episodes/<slug>/transcript.txt > episodes/<slug>/words.json
```

## 4. Media

- **Only own or licensed media.** Record `source` on every asset (provider, licence, attribution, `syntheticMedia: true` for AI images).
- **Never download** copyrighted YouTube videos or commercial assets without a verified licence.
- Copy the files the plan references into `packages/remotion/public/<slug>/`, and write asset `src` as `<slug>/<file>`. `public/` is git-ignored: keep the originals in `episodes/<slug>/media/`.

## 5. Plan

```bash
cd episodes/<slug> && node input.mjs > input.json && cd ../..
node packages/editor-brain/bin/editor-brain.mjs direct episodes/<slug>/input.json --plan --style apple > episodes/<slug>/plan.json
```

Read what the command prints on stderr:
- `decision:` lines explain the choices and the shots left on the engine composition;
- `needs …` lines list the assets the brain lacks.

Exit code 1 means the plan fails the final validation: fix the input.

## 6. Control sheet (mandatory before rendering)

```bash
npm run stills -- episodes/<slug>/plan.json                 # → episodes/<slug>/out/plan-stills.jpg, 3 stills per shot
npm run stills -- episodes/<slug>/plan.json --shots u3,u4   # only some shots
```

Look at the sheet once and check:
- text cut off or overflowing;
- gold on the wrong words;
- a chart or number that does not match the script;
- an image that does not fit.

Grey tiles "no block (engine composition)" are shots the Apple style leaves to the engine (video, document without a card): check those in the render. Fix in `input.mjs`, regenerate (step 5), re-run the sheet for the changed shots only.

## 7. Render and QC

```bash
node packages/render/bin/studio-render.mjs render episodes/<slug>/plan.json episodes/<slug>/out/<slug>.mp4
node packages/render/bin/studio-render.mjs qc episodes/<slug>/plan.json episodes/<slug>/out/<slug>.mp4 --out=episodes/<slug>/out/QC_REPORT.json
```

- **The QC must print `PASS`.** Report its warnings as they are.
- **YouTube description**: report the attributions (SRC-03).
- **Disclosures**: report them. AI-generated realistic media must be declared as "altered or synthetic content" on YouTube (SRC-04).

## 8. Deliver

- Commit `episodes/<slug>/` without `out/` (it is git-ignored): `input.mjs`, `input.json`, `plan.json`, `words.json`, `transcript.txt`, the media you own, and a short `README.md` (steps, sources, licences, QC result).
- Report to the user:
  - the video path;
  - the QC result;
  - the attributions and disclosures;
  - what was left to the engine composition and why.

## If the Apple style is not enough

The rules live in `packages/editor-brain/src/styles/apple.ts`: block per shot type, runs across shots, cues, lines and gold words. The blocks themselves live in `packages/remotion/hyperframes-studio/`.
- Change a rule only with a test in `packages/editor-brain/tests/apple-style.test.ts`.
- Change a block only after checking it on a control sheet.
- Both are engine work, not episode work: do them in their own session.
