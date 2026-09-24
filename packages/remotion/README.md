# @studio-engine/remotion

Renders any `VideoProject` from `@studio-engine/scene-engine` with Remotion. The engine has no dependency on Remotion or React; this package depends on both.

```
src/
├── Root.tsx               <Composition> + calculateMetadata (project JSON as input props)
├── EngineComposition.tsx  plan.series → <TransitionSeries>, plan.audio → <Html5Audio>
├── SceneView.tsx          sampleScene() → background, camera container, layers, edge transitions
├── layers.tsx             one small component per layer type (DOM only, all values come from the engine)
├── presentations.tsx      builtin → @remotion/transitions, custom → generic engine presentation
├── assets.ts              asset src → staticFile()
├── demoProject.ts         EngineDemo: AI-style blueprint → compileBlueprint() → manual edits
└── shotPlanDemo.ts        ShotPlanDemo: ShotPlan (Timeline JSON) → compileShotPlan()
```

## Run

```bash
npm install                      # from the repo root (npm workspaces)
npm run build                    # from the repo root: this package consumes the built engine
npm run assets                   # synthetic PNG, WAV narration/music, MP4 clip, Lottie JSON → public/
npm run typecheck
npm run studio                   # Remotion Studio
npm run render -- [--composition=EngineDemo|ShotPlanDemo] --scale=0.5 [--frames=0-89] [--stills=20,300] [--browser=/path/to/chrome-headless-shell]
```

## Notes

- Springs are computed by Remotion's own `spring()` through `createRemotionAnimationProvider({ spring })`; every other animation uses the engine's deterministic native provider.
- Remotion's shader transitions (`zoomBlur`, `filmBurn`, `ripple`, `zoomInOut`) need Chrome ≥ 148 with HTML-in-Canvas. The plan only uses them with `buildRemotionPlan(project, { capabilities: { htmlInCanvas: true } })`; otherwise the engine's CSS fallbacks are used.
- Not implemented in this reference renderer: non-CSS effects (grain, vignette, color grade, LUT…), line/pie charts, Lottie color overrides, asset masks. See SCENE_ENGINE.md §17.
