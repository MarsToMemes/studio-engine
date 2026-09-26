# studio-engine

AI-first documentary video engine: **script + voiceover + assets → scenes → timeline → animation → transitions → final video**, rendered with [Remotion](https://www.remotion.dev).

```
packages/
├── engine/     @studio-engine/scene-engine — typed scene model, validation, timing, animation, transitions,
│               presets, serialization, framework-agnostic renderer, Remotion plan, AI blueprint. Zero runtime deps.
├── editor-brain/ @studio-engine/editor-brain — the AI editor brain: script + voice + assets → editorial analysis →
│               story structure → ShotPlan v2 that follows VIDEO_EDITING_BIBLE.md, every decision explained.
├── render/     @studio-engine/render — studio-render CLI: Remotion by cached chunks or FFmpeg draft, JS audio mixer,
│               -14 LUFS master, QC_REPORT.json. What montage.py calls.
├── remotion/   @studio-engine/remotion — Remotion composition (@remotion/renderer).
└── studio/     @studio-engine/studio — technical test bench (@remotion/player preview, browser e2e). The product UI lives elsewhere.
.claude/skills/ Official Remotion Agent Skills (remotion-dev/skills), pinned in skills-lock.json.
```

- **[STUDIO_ENGINE_HANDOFF.md](./STUDIO_ENGINE_HANDOFF.md)**: everything built so far and how to plug it into the local `montage.py` engine, step by step (start here).
- **[VIDEO_EDITING_BIBLE.md](./VIDEO_EDITING_BIBLE.md)**: the editorial reference. Every rule has an id (`RHY-03`), a severity and an enforcement mode. The code catalogue is generated from it (`npm run bible -w @studio-engine/scene-engine`), and validation issues cite the rule they enforce.
- **[SCENE_ENGINE.md](./SCENE_ENGINE.md)**: architecture and API.
- **[motion-library/](./motion-library/README.md)**: the 73 motion skills (8 adapted from HyperFrames) with one preview each (`catalog.json`), and the manifest of licensed asset packs.
- **[LOCAL_ENGINE_INTEGRATION.md](./LOCAL_ENGINE_INTEGRATION.md)**: contract with the local `montage.py` / FFmpeg engine, which this repository complements and never replaces.

```bash
npm install              # npm workspaces
npm run check            # typecheck (engine, remotion, studio) + build + tests
npm run studio           # live preview: http://localhost:5173

cd packages/remotion
npm run assets           # generates offline test media into public/
npm run render -- --scale=0.5   # → out/demo.mp4 (540p preview); omit --scale for 1080p
npm run previews         # → motion-library/previews/*.jpg + catalog.json
npm run loudness -- out/demo.mp4 --fix=out/final.mp4   # → −14 LUFS (MUS-09), two linear passes
npm run qc -- plan.json out/final.mp4   # → QC_REPORT.json, each check cites its bible rule
cd ../..
node packages/render/bin/studio-render.mjs render plan.json out/final.mp4 --fallback   # cached chunks, mix, master
```

Restore the agent skills on a fresh machine: `npx skills experimental_install`.
