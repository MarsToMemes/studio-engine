# studio-engine

AI-first documentary video engine: **script + voiceover + assets → scenes → timeline → animation → transitions → final video**, rendered with [Remotion](https://www.remotion.dev).

```
packages/
├── engine/     @studio-engine/scene-engine — typed scene model, validation, timing, animation, transitions,
│               presets, serialization, framework-agnostic renderer, Remotion plan, AI blueprint. Zero runtime deps.
├── remotion/   @studio-engine/remotion — Remotion composition and render (@remotion/renderer).
└── studio/     @studio-engine/studio — live preview (@remotion/player), shot inspector and timeline editor.
.claude/skills/ Official Remotion Agent Skills (remotion-dev/skills), pinned in skills-lock.json.
```

**[SCENE_ENGINE.md](./SCENE_ENGINE.md)** documents the architecture and API.

```bash
npm install              # npm workspaces
npm run check            # typecheck (engine, remotion, studio) + build + tests
npm run studio           # live preview: http://localhost:5173

cd packages/remotion
npm run assets           # generates offline test media into public/
npm run render -- --scale=0.5   # → out/demo.mp4 (540p preview); omit --scale for 1080p
```

Restore the agent skills on a fresh machine: `npx skills experimental_install`.
