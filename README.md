# studio-engine

Scene engine for an AI video editing platform: **script + voiceover + assets → scenes → timeline → animation → transitions → final video**, rendered with [Remotion](https://www.remotion.dev).

- `src/` — `@studio-engine/scene-engine`: typed scene model, validation, timing, animation and transition systems, presets, serialization, a framework-agnostic renderer layer, the Remotion composition plan and the AI blueprint compiler. Zero runtime dependencies.
- `examples/remotion/` — reference Remotion composition that renders any project to MP4 (separate package, own dependencies).
- **[SCENE_ENGINE.md](./SCENE_ENGINE.md)** — architecture and API documentation.

```bash
npm install
npm run check        # typecheck + tests + build

cd examples/remotion
npm install
npm run assets       # generates offline test media into public/
npm run render -- --scale=0.5   # → out/demo.mp4
```

```ts
import { compileBlueprint, buildRemotionPlan, validateProject } from '@studio-engine/scene-engine';

const result = compileBlueprint(blueprintFromLLM, { assets });
if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
const plan = buildRemotionPlan(result.project); // → <TransitionSeries>, audio, preload
```
