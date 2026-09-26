# studio-engine: notes for coding agents

- **Motion is implemented as engine Motion Skills** (`packages/engine/src/skills/`): frame-based, deterministic, rendered by Remotion. Read `SCENE_ENGINE.md` §16 before adding one.
- **HyperFrames skills** (`.claude/skills/hyperframes-animation`, `.claude/skills/hyperframes-keyframes`, Apache-2.0) are a **motion-design reference**: rules, timings, easing. To port a rule as a native Motion Skill, see `packages/engine/src/skills/hyperframes.ts`.
- **HyperFrames catalog** (165 blocks, 223 components) renders through `Shot.block` / `Shot.overlays` (`SCENE_ENGINE.md` §28). Do not edit `packages/remotion/public/hyperframes/` (generated): change `scripts/hyperframes-sync.mjs` and re-run `npm run hyperframes:sync -w @studio-engine/remotion`. After a sync, re-run `hyperframes:probe` and then sync again, so `unsupported` flags follow the new commit. Do not add GSAP to any package: it is fetched by the sync.
- **Remotion skills** (`.claude/skills/remotion-*`) apply to `packages/remotion`.
- **Editorial rules** live in `VIDEO_EDITING_BIBLE.md`; regenerate the catalogue with `npm run bible -w @studio-engine/scene-engine`.
- **Before pushing**, run `npm run check`; for the browser bench, `npm run build -w @studio-engine/studio && npm run e2e -w @studio-engine/studio`.
- **Licences**: never download media without a verified licence (bible SRC-01/02). Record the rights in `asset.source`.
