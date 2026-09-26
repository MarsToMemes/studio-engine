# studio-engine: notes for coding agents

- **Motion is implemented as engine Motion Skills** (`packages/engine/src/skills/`): frame-based, deterministic, rendered by Remotion. Read `SCENE_ENGINE.md` §16 before adding one.
- **HyperFrames skills** (`.claude/skills/hyperframes-animation`, `.claude/skills/hyperframes-keyframes`, Apache-2.0) are installed as a **motion-design reference**: rules, blueprints, timings, easing choices. Do not write HyperFrames HTML, do not add GSAP, and do not use the `hyperframes` CLI here. Port a rule as a Motion Skill (see `packages/engine/src/skills/hyperframes.ts` for the pattern and the attribution).
- **Remotion skills** (`.claude/skills/remotion-*`) apply to `packages/remotion`.
- **Editorial rules** live in `VIDEO_EDITING_BIBLE.md`; regenerate the catalogue with `npm run bible -w @studio-engine/scene-engine`.
- **Before pushing**, run `npm run check`; for the browser bench, `npm run build -w @studio-engine/studio && npm run e2e -w @studio-engine/studio`.
- **Licences**: never download media without a verified licence (bible SRC-01/02). Record the rights in `asset.source`.
