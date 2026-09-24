# studio-engine

AI-first documentary video engine: **script + voiceover + assets → scenes → timeline → animation → transitions → final video**, rendered with [Remotion](https://www.remotion.dev).

```
packages/
├── engine/     @studio-engine/scene-engine — typed scene model, validation, timing, animation, transitions,
│               presets, serialization, framework-agnostic renderer, Remotion plan, AI blueprint. Zero runtime deps.
├── editor-brain/ @studio-engine/editor-brain — the AI editor brain: script + voice + assets → editorial analysis →
│               story structure → ShotPlan v2 that follows VIDEO_EDITING_BIBLE.md, every decision explained.
├── remotion/   @studio-engine/remotion — Remotion composition and render (@remotion/renderer).
└── studio/     @studio-engine/studio — technical test bench (@remotion/player preview, browser e2e). The product UI lives elsewhere.
.claude/skills/ Official Remotion Agent Skills (remotion-dev/skills), pinned in skills-lock.json.
```

- **[VIDEO_EDITING_BIBLE.md](./VIDEO_EDITING_BIBLE.md)**: the editorial reference. Every rule has an id (`RHY-03`), a severity and an enforcement mode. The code catalogue is generated from it (`npm run bible -w @studio-engine/scene-engine`), and validation issues cite the rule they enforce.
- **[SCENE_ENGINE.md](./SCENE_ENGINE.md)**: architecture and API.
- **[LOCAL_ENGINE_INTEGRATION.md](./LOCAL_ENGINE_INTEGRATION.md)**: contract with the local `montage.py` / FFmpeg engine, which this repository complements and never replaces.

```bash
npm install              # npm workspaces
npm run check            # typecheck (engine, remotion, studio) + build + tests
npm run studio           # live preview: http://localhost:5173

cd packages/remotion
npm run assets           # generates offline test media into public/
npm run render -- --scale=0.5   # → out/demo.mp4 (540p preview); omit --scale for 1080p
```

Restore the agent skills on a fresh machine: `npx skills experimental_install`.
