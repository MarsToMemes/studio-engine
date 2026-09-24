# Scene Engine

The core of an AI video editor: a **typed, framework-agnostic, data-only** description of a video as a sequence of scenes, plus everything needed to validate it, time it, animate it, and hand it to [Remotion](https://www.remotion.dev) for the final render.

```
SCRIPT + VOICEOVER + ASSETS
          │  (AI agent writes a Blueprint)
          ▼
   compileBlueprint()  ──►  VideoProject (Scene[])  ◄── manual editing (factories, presets)
                                   │
                    validateProject() / serializeProject()
                                   │
                          resolveTimeline()            ← single source of truth for time
                                   │
               ┌───────────────────┴───────────────────┐
     compileProject() + sampleScene()        buildRemotionPlan()
     (renderer-agnostic, per frame)          (composition, series, audio, preload)
               └───────────────────┬───────────────────┘
                                   ▼
             Remotion composition (packages/remotion) → renderMedia() → MP4
```

This document is meant to be enough to work on the engine without reading the whole source. Every name in `code` is an export of `packages/engine/src/index.ts`.

---

## 1. Principles

| Principle | What it means in practice |
|---|---|
| **Data only** | Scenes, layers, animations, transitions, effects and presets are plain JSON-serialisable objects. No classes, functions, `Infinity`, `NaN` or `Date` in the model. |
| **No framework in the model** | Nothing in `packages/engine` imports React or Remotion. The Remotion code lives in `packages/remotion` and consumes the engine. |
| **Integer frames everywhere** | All timing is in frames. Seconds only appear at the edges (AI blueprints, `secondsToFrames`). |
| **Timing is derived, never duplicated** | A scene stores its own `durationInFrames`. Absolute starts, ends, overlaps and clip positions are computed by `resolveTimeline()`. |
| **Deterministic** | Same input → same pixels, on any machine, in any frame order. Noise is seeded (`hash01`, `valueNoise`), springs are analytic, ids can be sequential. Required by Remotion's parallel rendering. |
| **Registries, not switch statements** | Scene types, transitions, presets, animation providers and AI composers are registries. Adding one never requires editing the model. |
| **Zero runtime dependencies** | `package.json` has no `dependencies`. Dev: TypeScript + Vitest. |

---

## 2. Module map

```
packages/engine/src/
├── model/           Types only (+ runtime enum lists in constants.ts)
├── core/            Factories, ids, aspect ratios, layout (LayerBox → px), scene type registry, text splitting
├── assets/          AssetLibrary (dedupe), reference collection, pruning
├── timing/          Frame math, animation windows, timeline resolution
├── animation/       Easing, interpolate, keyframes, noise, AnimationState, providers (native / remotion / external)
├── transitions/     Transition definitions, registry, Remotion mapping
├── presets/         Preset types, registry, 40 built-in presets
├── validation/      validateProject / validateScene, issue codes
├── serialization/   Versioned JSON envelope, migrations
├── renderer/        compileProject / sampleScene: framework-neutral styles per frame
├── adapters/remotion/  buildRemotionPlan, audioVolumeAt
├── ai/              Blueprint contract, validator, compiler, composers, JSON schema, agent catalog
├── shotplan/        ShotPlan (AI/UI language), Timeline JSON view, editorial lint, compiler, CLI
└── skills/          Motion Skill Registry: 49 skills, fallbacks, renderer capabilities
```

Dependency direction: `model` ← `core`/`timing` ← `animation`/`transitions`/`presets` ← `validation`/`renderer` ← `adapters`/`ai`. Lower layers never import higher ones.

---

## 3. Data model

### 3.1 VideoProject

```ts
interface VideoProject {
  id: string;
  name?: string;
  schemaVersion: number;          // SCHEMA_VERSION (1)
  fps: number;
  dimensions: { width: number; height: number };
  aspectRatio: AspectRatio;       // '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '21:9' | any 'w:h'
  background: Background;         // shown behind scenes and during edge transitions
  scenes: Scene[];
  assets: Record<AssetId, Asset>; // every media file, stored once
  audio: AudioTrack[];            // project-wide tracks (music bed), absolute frames
  metadata?: JsonObject;
}
```

`createProject({ aspectRatio: '9:16' })` derives even dimensions from the ratio with the short side at 1080 (`dimensionsForAspectRatio`).

### 3.2 Scene

```ts
interface Scene {
  id: string;
  type: SceneType;                // built-in or registered type
  startFrame?: Frames;            // optional hint; the derived value is authoritative (warning if stale)
  durationInFrames: Frames;       // the ONLY stored timing of a scene
  fps?: number;                   // must equal project fps when present
  aspectRatio?: AspectRatio;
  background: Background;
  layers: Layer[];                // flat list, ordered by zIndex
  audio: AudioTrack[];            // relative to the scene start
  voiceover?: VoiceoverSegment;   // this scene's slice of the narration
  captions?: CaptionTrack;        // cues relative to the scene start
  animations: Animation[];        // scene-level: camera moves, parallax, shake — applied to the whole layer stack
  effects: Effect[];              // scene-level: color grade, grain… applied after compositing
  transitionIn?: Transition;
  transitionOut?: Transition;
  metadata?: SceneMetadata;       // role (hook, explanation…), source (manual|ai|template), notes, extra
}
```

Differences from the original specification, on purpose:
- `startFrame` is optional and derived (spec §9 "avoid duplicating timing information").
- `animations` is an array (a layer usually needs an entrance, an exit and an emphasis).
- The spec's `duration` in animation examples is `durationInFrames`, to match the rest of the model and Remotion.
- `repeat: Infinity` is not JSON-safe; looping is `loop: true`.

### 3.3 Scene types

| Type | Default | Role | Description / contract |
|---|---|---|---|
| `video` | 5 s | — | Full-frame video clip. Needs a video layer or video background. |
| `image` | 4 s | — | Still image, usually with a camera move. Needs image media. |
| `title` | 3 s | hook | Large headline. Needs a text layer. |
| `text` | 4 s | explanation | Short sentence / bullets, kinetic typography. Needs a text layer. |
| `broll` | 4 s | explanation | Illustrative footage under narration. Needs video or image media. |
| `talking_head` | 6 s | — | On-camera speaker. Needs a video. |
| `quote` | 5 s | evidence | Quotation with attribution. Needs a text layer. |
| `statistic` | 4 s | statistic | One striking number. Needs a text or graphic layer. |
| `chart` | 5 s | evidence | Animated data visualisation. Needs a graphic layer. |
| `screenshot` | 4 s | evidence | Website / article / tweet with zoom. Needs an image layer. |
| `montage` | 5 s | — | Several clips/images. Needs ≥ 2 media layers. |
| `endcard` | 5 s | cta | Closing screen. |
| `custom` | 4 s | — | No constraints, any layer type. |

Adding a type (no model change needed, `SceneType` is an open union):

```ts
const sceneTypes = new SceneTypeRegistry().register({
  type: 'map',
  label: 'Map',
  description: 'Animated route on a map',          // also shown to AI agents
  defaultDurationInSeconds: 6,
  allowedLayerTypes: ['background', 'graphic', 'text'],
  check: (s) => (s.layers.some((l) => l.type === 'graphic') ? undefined : 'a map scene needs a graphic layer'),
});
validateProject(project, { sceneTypes });
```

### 3.4 Layers

Layers are flat (no groups → no deep state) and sorted by `zIndex` at compile time. Common fields:

| Field | Type | Notes |
|---|---|---|
| `id`, `type`, `name?` | | `id` unique within the scene |
| `zIndex` | number | stacking order |
| `startFrame?`, `durationInFrames?` | Frames | relative to the scene; default 0 / rest of the scene; clipped to the scene |
| `position` | `LayerBox` | see below |
| `scale` | `number \| {x,y}` | static transform, multiplied by animations |
| `rotation` | degrees | static, added to animations |
| `opacity` | 0..1 | static, multiplied by animations |
| `transform?` | `LayerTransform` | origin, skew, flip, perspective, rotateX/Y |
| `crop?` | `Crop` | inset of the layer box, percent or px |
| `mask?` | `Mask` | shape / polygon / gradient / asset, optional `feather`, `invert` |
| `blendMode?` | CSS blend modes | |
| `animations` | `Animation[]` | |
| `effects` | `Effect[]` | |
| `visible?`, `locked?`, `metadata?` | | |

**LayerBox** (`resolveLayerBox(box, canvas) → {x, y, width, height}` in px): `anchor` is both the canvas point offsets are measured from and the point of the layer aligned to it. `units: 'percent'` is relative to canvas width (x, width) and height (y, height). Omitted width/height = full canvas.

```ts
{ anchor: 'bottom-right', x: -40, y: -40, width: 200, height: 100, units: 'px' } // 40px inside the corner
{ anchor: 'center', x: 0, y: 0, units: 'percent' }                                   // FULL_FRAME
```

Layer types and their payload:

| Type | Payload |
|---|---|
| `background` | `background: Background` (none / color / gradient / image / video with fit, blur, dim) |
| `video` | `assetId`, `fit`, `trim {startFrom, endAt}`, `playbackRate`, `volume`, `muted`, `loop`, `focalPoint` |
| `image` | `assetId`, `fit`, `focalPoint` |
| `text` | `text`, `style: TextStyle`, `emphasis?` (word indices), `maxWidth?`, `autoFit?` |
| `caption` | `trackId?` (defaults to the scene track), `style: CaptionStyle` (`mode: word \| line \| block`, active word style) |
| `shape` | `shape: rect \| ellipse \| line \| polygon \| path`, `fill`, `stroke`, `cornerRadius`, `points`, `path` |
| `lottie` | see §7 |
| `graphic` | `kind: counter \| barChart \| lineChart \| pieChart \| progress \| icon \| svg \| lowerThird \| custom`, `data`, `style` |
| `overlay` | `kind: color \| gradient \| vignette \| grain \| lightLeak \| texture \| letterbox \| asset`, `intensity` |

Create layers with defaults (neutral transform, empty animations/effects):

```ts
const title = createLayer('text', { text: 'Not a burger company', style: presets.apply('typography', 'headline-impact', ctx), zIndex: 40 });
```

### 3.5 Assets

Assets live once in `project.assets`; everything else stores an `assetId`. `AssetLibrary.add()` returns the existing id for the same `kind + src` or the same `checksum`. `collectAssetReferences()` lists every reference with its JSON path (used by validation and preloading), `pruneUnusedAssets()` removes orphans.

### 3.6 Audio, voiceover, captions

- `AudioTrack`: `assetId`, `role` (music, sfx, ambience, voiceover, source), `startFrame`, `durationInFrames?` (defaults to the asset length or the owner's remaining time), `trim`, `volume`, `fadeInFrames`, `fadeOutFrames`, `loop`, `ducking { amount, attackFrames, releaseFrames }` (`amount` = volume multiplier while a voiceover plays).
- `VoiceoverSegment`: a scene's slice of the narration. With one long narration file, every scene points at the same asset with a different `trim` window.
- `CaptionTrack`: sorted `cues` (`startFrame`, exclusive `endFrame`, optional `words` with per-word timings) relative to the scene.

---

## 4. Timing

```
start(0)   = 0
start(i+1) = start(i) + duration(i) − overlap(i, i+1)
total      = Σ duration − Σ overlap
overlap    = duration of the transition between the two scenes (0 for a cut)
```

This is exactly the arithmetic of Remotion's `<TransitionSeries>`, so `buildRemotionPlan().composition.durationInFrames` always matches what Remotion renders.

**Which transition joins A and B?** `B.transitionIn ?? A.transitionOut`. Setting both to different values is a validation warning.

**Edge transitions:** the first scene's `transitionIn` and the last scene's `transitionOut` have no neighbour; they play *inside* the scene (placement `edge`) against the project background and do not change the total.

Utilities (all pure):

| Function | Returns |
|---|---|
| `getSceneDuration(scene)` | frames |
| `getSceneStartFrames(scenes)` / `getSceneStartFrame(scenes, i)` | absolute start(s), O(n) |
| `getSceneEndFrame(scenes, i)` | exclusive absolute end |
| `getTimelineDuration(scenes)` | composition length |
| `getLayerDuration(layer, scene)` / `getLayerEndFrame(layer, scene)` | relative to the scene, clipped |
| `getTransitionBetween(a, b)` / `getTransitionOverlap(a, b)` | |
| `resolveSceneTiming(scenes, i)` | start, end, resolved `transitionIn/Out` with placement |
| `resolveTimeline(project)` | everything absolute: scenes, layers, animation windows, audio, voiceover, captions + `tracks` and `clips` for a multi-track timeline UI |
| `findSceneIndexAtFrame(starts, durations, frame)` | O(log n); incoming scene wins during overlaps |

### Animation windows

Animation frames are relative to their owner (layer or scene):

- `phase: 'in'` / `'during'` (default): starts at `startFrame` (default 0), lasts `durationInFrames` (default: rest of the owner).
- `phase: 'out'`: anchored to the owner end; `startFrame` counts back from the end.
- `repeat` (finite) / `loop: true`, `yoyo`.
- `keyframes` default to their last keyframe; `typewriter` with `charactersPerSecond` derives its duration from the text; `stagger` / `kineticTypography` span `each × (units − 1)` extra frames, where units are counted with *that animation's* split (characters / words / lines).

`resolveAnimationWindow()` and `animationProgressAt()` implement this; windows are computed once at compile time.

---

## 5. Animation system

### 5.1 Animations as data

```ts
{ type: 'fade', from: 0, to: 1, durationInFrames: 15, easing: 'easeOut' }
{ type: 'keyframes', tracks: [{ property: 'scale', keyframes: [
    { frame: 0, value: 1 }, { frame: 15, value: 1.08 }, { frame: 60, value: 1 } ] }] }
```

| Type | Key fields | Phase-aware defaults |
|---|---|---|
| `fade` | `from`, `to` | in 0→1, out 1→0 |
| `slide` | `direction` (travel direction), `distance`, `units`, `fade` | in: from the opposite side to 0 |
| `scale` | `from`, `to` | in 0.85→1, out 1→0.85, during 1→1.1 |
| `zoom` | `from`, `to`, `origin` | 1→1.15 |
| `rotate` | `from`, `to` (deg) | in −8→0, out 0→8, during 0→360 |
| `blur` | `from`, `to` (px) | in 20→0, out 0→20 |
| `bounce` | `height`, `bounces` | decaying bounce, lands at rest |
| `spring` | `property`, `from`, `to`, `mass`, `stiffness`, `damping` | natural physics; stretched when `durationInFrames` is set |
| `stagger` | `animation` (leaf), `each`, `from: start\|end\|center`, `unit` | per unit |
| `reveal` | `direction` | clip inset |
| `typewriter` | `charactersPerSecond`, `cursor` | `textProgress` |
| `kineticTypography` | `style: pop\|slam\|wave\|rise\|flip\|highlight`, `split`, `each`, `intensity` | per unit |
| `parallax` | `depth`, `direction`, `distance` | |
| `camera` | `move: pushIn\|pullOut\|panLeft\|panRight\|tiltUp\|tiltDown\|kenBurns\|dolly\|orbit`, `intensity`, `focus` | |
| `shake` | `amplitude`, `frequency`, `seed`, `rotation` | in: decays, out: grows |
| `glitch` | `intensity`, `frequency`, `seed` | seeded bursts |
| `maskReveal` | `shape: rect\|circle\|diagonal`, `direction`, `center` | |
| `keyframes` | `tracks[{property, keyframes[{frame, value, easing?}]}]` | easing per segment |
| `custom` | `name`, `params`, `provider` | evaluated by the named provider |

Easing: 22 presets (`linear`, `easeInOut`, `easeOutBack`, `easeOutElastic`…), `{ type: 'cubicBezier', points }`, `{ type: 'spring', … }`, `{ type: 'steps', steps }`. `interpolate()` has the same contract as Remotion's (`extend` extrapolation by default).

### 5.2 AnimationState and composition

Every provider returns a partial `AnimationState` (`opacity, x, y, scaleX, scaleY, rotation, skewX, skewY, blur, brightness, saturation, textProgress, clip, glitch, highlight, origin`). States combine **order-independently**: opacity/scale/brightness/saturation multiply, translations/rotation/skew/blur add, `clip`/`textProgress`/`glitch`/`highlight` are last-writer-wins. The renderer then combines the state with the layer's static values (`layer.opacity × state.opacity`, `layer.rotation + state.rotation`…).

Per-unit animations (`stagger`, `kineticTypography`) have no whole-layer effect; renderers call `sampleLayerUnits(compiled, frame, count, …)` with the unit count from `splitText(text, compiled.textSplit)`.

### 5.3 Provider architecture

```
AnimationProvider { id, deterministic, supports(animation), evaluate(animation, ctx) → Partial<AnimationState> }

AnimationProviderRegistry
├── native    built-in, zero deps, deterministic — reference implementation of every type
├── remotion  createRemotionAnimationProvider({ spring }) — Remotion's spring(), native for the rest
└── external  createExternalProvider({ id, deterministic, supports, evaluate }) — GSAP, Theatre.js, Motion…
```

`registry.resolve(animation, mode)`:
- `preview`: the requested provider (`animation.provider ?? default`) if it supports the animation.
- `render`: only **deterministic** providers. Anything else falls back to the default provider and is reported through `onFallback` (and by validation as `animation.provider.nondeterministic`).

Library evaluation (why nothing is installed):

| Library | Fit | Decision |
|---|---|---|
| **Remotion** | Final deterministic renderer; `spring`, `interpolate`, `<TransitionSeries>`, presentations. | Integrated through the adapter and the injectable provider; never imported by the engine. |
| **GSAP** | Excellent authoring timelines. A *paused* timeline driven by `progress(p)` on a plain object is deterministic. | Optional external provider (`deterministic: true` is the integrator's claim). Not a dependency. |
| **Theatre.js** | Visual keyframe authoring; `sequence.position = t` is deterministic. Best used to *author* `keyframes` data. | Optional external provider or authoring tool that exports keyframes. |
| **Motion** | Great for editor UI gestures and springs, time-driven and imperative. | Editor UI only (`deterministic: false`) — never in the render path. |
| **Lottie** | Designer-made vector animations. | Optional **asset** (`lottie` layer), not the animation engine. `@remotion/lottie` renders it deterministically. |
| **Zod** | Runtime schemas. | Not used: hand-written validation keeps the core at zero dependencies, returns stable issue codes with JSON paths for AI repair loops, and keeps the model as readable TypeScript interfaces. |

---

## 6. Transitions

```ts
interface Transition { type; durationInFrames; direction?; easing?; intensity?; params?; presetId? }
```

`direction` is where the **incoming** scene travels to (`push` + `left` = new scene enters from the right). `defaultTransitionRegistry.create(type, fps, overrides)` fills defaults; `evaluate(transition, frame, {box})` / `evaluateAtProgress(transition, easedProgress, {box})` return a `TransitionFrameState` (`exiting`, `entering` states, optional full-frame `overlay`, `distortion` hint, which side is on `top`).

**Remotion mapping — no duplication.** Where Remotion has a presentation, the plan uses it. Remotion's WebGL presentations (`zoomBlur`, `filmBurn`, `ripple`, `zoomInOut`) run on HTML-in-Canvas, which needs **Chrome ≥ 148 with the feature enabled**; they are used only when the render environment declares `capabilities: { htmlInCanvas: true }`, otherwise the engine's deterministic CSS fallback is used.

| Type | Default | Remotion (default) | Remotion (`htmlInCanvas`) | Description |
|---|---|---|---|---|
| `cut` | 0 s | — (no element) | — | Hard cut, no overlap. |
| `crossfade` | 0.5 s | `fade()` | `fade()` | Incoming scene fades in over the outgoing one. |
| `fade` | 0.6 s | engine | engine | Dip through a color (`params.color`, default black). |
| `slide` | 0.5 s | engine | engine | Incoming slides *over* the static outgoing scene. |
| `push` | 0.5 s | `slide()` | `slide()` | Incoming pushes the outgoing out. |
| `wipe` | 0.6 s | `wipe()` | `wipe()` | Hard-edge wipe. |
| `zoom` | 0.5 s | engine | `zoomInOut()` | Zoom through. |
| `zoomBlur` | 0.4 s | engine | `zoomBlur()` | Zoom with motion blur. |
| `whip` | 0.3 s | engine | engine | Very fast push with directional blur. |
| `filmBurn` | 0.8 s | engine | `filmBurn()` | Warm light burst. |
| `ripple` | 0.8 s | engine | `ripple()` | Liquid distortion. |
| `glitch` | 0.4 s | engine | engine | RGB split + slice offsets. |
| `blur` | 0.5 s | engine | engine | Blur dissolve. |
| `flash` | 0.3 s | engine | engine | Flash (`params.color`) hiding the cut. |
| `flip` | 0.6 s | `flip()` | `flip()` | 3D flip. |
| `iris` | 0.7 s | `iris()` | `iris()` | Circular reveal. |

Custom transitions: `new TransitionRegistry().register({ type: 'lightLeak', …, toRemotion, evaluate })` — `TransitionType` is an open union.

---

## 7. Lottie

```ts
createLayer('lottie', {
  source: { kind: 'asset', assetId: 'pin' },   // or { kind: 'url', url, format: 'json' | 'dotlottie' } or { kind: 'inline', data }
  animationId?: 'pin-drop',                     // animation inside a multi-animation dotLottie
  playbackRate: 1, loop: false, direction: 'forward',
  lottieStartFrame: 0, lottieEndFrame: 90,      // in the Lottie's own frame numbering
  fit: 'contain',
  overrides: { themeId?, slots?: { … }, colors?: [{ keypath: 'Pin.Fill 1', color: '#ffd400' }] },
  startFrame: 20, durationInFrames: 90, position: { … }, opacity: 1, animations: [...]   // regular layer fields
});
```

Lottie is an asset like an image: position, opacity, transforms and engine animations apply on top. Assets of kind `lottie`, `dotlottie` or `json` are accepted. Renderers must ignore overrides they cannot apply instead of failing.

---

## 8. Effects

`blur`, `brightness`, `contrast`, `saturate`, `grayscale`, `sepia`, `hueRotate`, `invert`, `dropShadow`, `glow` map to CSS `filter` (`effectsToCssFilter`). `vignette`, `grain`, `chromaticAberration`, `colorGrade`, `lut`, `pixelate`, `custom` are returned by `getNonCssEffects()` for renderer-specific implementations (shaders, SVG filters, overlays). Numeric params can be keyframed with `animatedParams: { amount: Keyframe[] }`; static effect filters are precomputed at compile time.

---

## 9. Presets

A preset is a **named, parameterised builder of plain model data**. Components never contain presets; they receive expanded data. Expansion happens at authoring time (editor action or AI compile), so the render path never looks presets up. Generated animations/transitions keep `presetId` for round-tripping in the editor.

```ts
// Reference as stored / produced by an AI agent:
{ presetId: 'cinematic-zoom', durationInFrames: 45, parameters: { intensity: 0.35, easing: 'easeInOut' } }

defaultPresetRegistry.apply('camera', ref, { fps: 30 })
// → [{ type: 'camera', move: 'pushIn', intensity: 0.35, durationInFrames: 45, easing: 'easeInOut', presetId: 'cinematic-zoom' }]

defaultPresetRegistry.applyToLayer('kinetic-pop-words', { fps: 30 })   // any layer-level category → { animations, effects, style? }
```

Parameters are typed (`number` with min/max, `boolean`, `string`, `color`, `enum`, `easing`); unknown or out-of-range values throw `PresetError`. Categories: `animation`, `camera`, `typography`, `caption`, `textEffect`, `brollTreatment`, `imageTreatment`, `transition`.

Built-in presets (40):

| Category | Presets |
|---|---|
| animation | `fade-in`, `fade-out`, `slide-in`, `pop-in`, `punch-in`, `blur-in`, `mask-wipe-in`, `float` |
| camera | `cinematic-zoom`, `ken-burns`, `slow-pan`, `handheld`, `impact-shake` |
| typography | `headline-impact`, `documentary-serif`, `lower-third`, `statistic-number` |
| caption | `caption-bold-pop`, `caption-clean`, `caption-karaoke` |
| textEffect | `kinetic-pop-words`, `kinetic-rise-words`, `kinetic-slam-words`, `highlight-sweep`, `typewriter`, `glitch-text` |
| brollTreatment | `broll-cinematic`, `broll-documentary-muted`, `broll-archive` |
| imageTreatment | `image-ken-burns`, `image-parallax`, `screenshot-focus` |
| transition | `hard-cut`, `smooth-crossfade`, `dip-to-black`, `whip-fast`, `flash-cut`, `glitch-hit`, `zoom-blur-punch`, `push-slide` |

`buildAgentCatalog()` lists every preset with its description and parameters. Custom presets: `registry.register(definePreset({ id, category, label, description, parameters, build }))`.

---

## 10. Validation

`validateProject(unknown)` / `validateScene(unknown, { fps, assets })` never trust their input (it may come from an AI). They return `{ valid, errors, warnings }` where each issue has a stable `code`, a JSON `path` and a message; `formatIssues()` renders them for a human or for an LLM self-repair loop. `assertValidProject()` throws `SceneValidationError`.

Checked, among others:
- structure: types, integer frames, ranges (opacity 0..1, crop not empty…), enums (exhaustive lists in `model/constants.ts` fail compilation if a union member is missing);
- references: unique scene ids, unique layer ids per scene, assets exist and have a compatible kind, caption `trackId` exists;
- timing: transitions not longer than the scenes they join, incoming + outgoing overlaps ≤ scene duration, stale `startFrame`, layers never visible or clipped, voiceover cut by the scene end, caption cue order;
- scene-type contracts and allowed layer types;
- animation providers that cannot be used for the final render.

Frequent codes: `asset.missing`, `asset.kind.mismatch`, `frame.invalid`, `transition.tooLong`, `transition.overlap.exceeds`, `transition.conflict`, `scene.type.contract`, `scene.layer.notAllowed`, `layer.clipped`, `voiceover.clipped`, `caption.cue.order`, `animation.keyframe.order`, `animation.provider.nondeterministic`.

---

## 11. Serialization

```json
{ "format": "studio-engine/project", "schemaVersion": 1, "project": { … } }
```

`serializeProject()` validates before writing (an invalid project is never saved). `deserializeProject(stringOrObject)` accepts the envelope or a bare project, runs `MIGRATIONS` (keyed by source version) up to `SCHEMA_VERSION`, validates, and returns `{ ok, value | errors, warnings }` without throwing. `serializeScene` / `deserializeScene` handle single scenes (clipboard, AI scene edits).

---

## 12. Renderer layer (framework-agnostic)

```ts
const compiled = compileProject(project, { providers, mode: 'render' });  // once per project version
const frame = sampleScene(compiled.scenes[i], sceneFrame, compiled.options); // per frame
frame.cameraStyle     // scene camera / effects → style of the layer stack container
frame.layers[n].style // position, size, transform, opacity, filter, clipPath, mask, blend mode, zIndex
frame.edgeTransition  // state + style when the first/last scene is transitioning against the background
sampleProjectFrame(compiled, absoluteFrame) // both scenes + transition state during overlaps (editor preview)
```

Styles are `Record<string, string | number>` with CSSOM camelCase keys, directly usable as a React `style`. Helpers: `textStyleToCss`, `maskToCss`, `clipToCss`, `stateToStyle`, `getActiveCaption` / `getCaptionLine`, `splitText` / `visibleText`, `counterValue` / `formatCounter`, `getMediaPlayback`.

`compileProject` does all frame-independent work once: timeline resolution, layer boxes, z-ordering, animation windows, static effect filters, text split. Sampling only evaluates what moves.

---

## 13. Remotion integration

The engine produces a serialisable plan; a thin Remotion project renders it.

```ts
const plan = buildRemotionPlan(project, { capabilities: { htmlInCanvas: false } });
plan.composition   // { id, width, height, fps, durationInFrames }  → <Composition>
plan.series        // sequence | transition items                 → <TransitionSeries>
plan.audio         // absolute from/duration, trims, envelope      → <Sequence><Html5Audio volume={(f) => audioVolumeAt(item, f)} />
plan.preload       // used assets, once each
plan.customPresentations / plan.requiredCapabilities
```

Mapping to components (see `packages/remotion/src`):

| Engine | Remotion |
|---|---|
| `plan.composition` | `<Composition>` + `calculateMetadata` (any project JSON can be rendered as input props) |
| `sequence` item | `<TransitionSeries.Sequence durationInFrames>` → `<SceneView>` (`useCurrentFrame()` = scene frame) |
| `transition` item, `builtin` | the matching `@remotion/transitions` presentation + `linearTiming` / `springTiming` |
| `transition` item, `custom` | one generic presentation rendering `evaluateAtProgress()` |
| `sampleScene()` output | plain `<div style>` per layer; `<OffthreadVideo>`, `<Img>`, `@remotion/lottie` for media |
| `spring` animations | `createRemotionAnimationProvider({ spring })` registered as default provider |
| `plan.audio` | `<Html5Audio>` with `trimBefore` / `trimAfter` and a volume callback (fades + ducking under voiceover) |

**Verified end-to-end.** `packages/remotion` compiles an AI-style blueprint (6 scenes: title, b-roll video, statistic, chart, quote with a feathered mask, end card with Lottie; narration + ducked music; captions) and renders it with `@remotion/renderer` (`renderMedia`, H.264 + AAC, 540 frames). The output was checked with `ffprobe` and by inspecting stills at key frames of every scene. See `packages/remotion/README.md`.

---

## 14. AI integration

An LLM should not write frames, layer boxes or z-orders. It writes a **Blueprint** in seconds with preset ids; the engine compiles it into a validated project.

```jsonc
{
  "version": 1,
  "narration": { "assetId": "narration" },
  "music": { "assetId": "music", "volume": 0.3, "duckTo": 0.25 },
  "style": { "captions": "caption-bold-pop", "transition": "smooth-crossfade", "brollTreatment": "broll-cinematic" },
  "scenes": [
    { "type": "title", "role": "hook", "startSeconds": 0, "endSeconds": 4,
      "script": "McDonald's doesn't actually make most of its money from burgers…",
      "headline": "Not a burger company", "textEffect": "kinetic-slam-words",
      "media": [{ "assetId": "restaurant", "role": "background" }], "camera": "cinematic-zoom" },
    { "type": "broll", "role": "explanation", "startSeconds": 4, "endSeconds": 9,
      "headline": "The real business", "media": [{ "assetId": "kitchen" }], "transitionIn": "whip-fast" },
    { "type": "statistic", "startSeconds": 9, "endSeconds": 13,
      "statistic": { "value": 61, "suffix": "%", "label": "of revenue from franchisees" },
      "camera": { "presetId": "impact-shake", "durationInFrames": 12 }, "transitionIn": "flash-cut" }
  ]
}
```

Pipeline for an agent:

1. Give the model `buildBlueprintJsonSchema()` (tool / structured-output schema, generated from the live registries so it cannot drift) and `buildAgentCatalog()` (scene types, presets with parameters, rules) plus the list of available `assetId`s.
2. `validateBlueprint(doc, { assetIds })` → feed `formatIssues()` back to the model until valid.
3. `compileBlueprint(doc, { assets })` → `{ ok, project, validation, notes }` (deterministic: same blueprint → same project).
4. Edit manually if needed, then `buildRemotionPlan(project)`.

Compiler behaviour:
- **Narration sync**: blueprint times are narrative windows. Each scene starts exactly at its narrative start and is extended by its outgoing transition, so the total equals the narration length and each scene's voiceover slice (`trim`) is contiguous with the next.
- Transitions that do not fit are shortened and reported in `notes`.
- Captions: word timings from forced alignment (`words`) when provided; otherwise cues and **word** timings are estimated from the script (proportional to characters) so word-by-word caption styles still work.
- Layers come from per-type **composers** (`SceneComposerRegistry.register(type, composer)`); unknown types use the generic composer.

---

## 15. ShotPlan and Timeline JSON (editorial layer)

The AI director and the UI speak **ShotPlan**: *what* happens, shot by shot. The engine decides *how* by compiling it into a `VideoProject`.

```
AI / UI ──► ShotPlan ──► validateShotPlan() ──► compileShotPlan() ──► VideoProject ──► Remotion
                 │                                   ▲
                 └──► toTimeline() ◄──► fromTimeline()   (flat Timeline JSON, derived startFrame)
```

```ts
interface Shot {
  id: string;                         // becomes the scene id (UI edits map back to the shot)
  type: 'image' | 'video' | 'text' | 'number' | 'document' | 'chart' | 'map' | 'revelation' | 'chapter';
  durationInFrames: number;           // the only stored timing
  media?: string; text?: string; subtext?: string; highlightedWords?: string[];
  motionSkill?: string;               // resolved by the Motion Skill Registry (never fails the render)
  transition?: string;                // INTO this shot, default "hard_cut"
  transitionDurationInFrames?: number;
  intensity?: 'subtle' | 'medium' | 'strong';
  sfx?: Array<{ sfx: string; at?: number; gainDb?: number }>;   // several sound events per shot
  number?: NumberPayload; chart?: ChartPayload; map?: MapPayload; document?: DocumentPayload;
  metadata?: JsonObject;
}
interface ShotPlan { version: 1; fps; width; height; shots: Shot[]; assets; narration?; music?; captions?; metadata? }
```

Two deliberate differences with a naive flat timeline: **start frames are derived** (changing a duration never desynchronises the rest) and **`sfx` is a list of events**. `toTimeline(plan)` produces the exact flat format (`Timeline { fps, width, height, durationInFrames, shots[{ id, startFrame, durationInFrames, type, media, text, highlightedWords, motionSkill, transition, intensity, sfx, metadata }] }`) and is lossless: extra payloads travel in `metadata`, and `fromTimeline(toTimeline(p))` returns `p`. `fromTimeline` treats an incoming `startFrame` as a hint and reports mismatches.

**Editorial transitions** (snake_case, `EDITORIAL_TRANSITIONS`): `hard_cut` (default, neutral) · `fade`, `dissolve`, `slide`, `push`, `wipe`, `blur` (standard) · `zoom`, `zoom_blur`, `whip`, `flash`, `glitch`, `film_burn` (spectacular). Unknown ids fall back to `hard_cut`; transitions longer than half of a neighbouring shot are shortened.

**Validation** (`validateShotPlan`): errors make the plan uncompilable (missing / wrong-kind media, missing text or payload, invalid durations, odd sizes…). Warnings are the documentary lint: `pacing.hook` (hook outside 1.5–2.5 s), `pacing.static` (> 4 s without a motion skill), `transition.spectacular.adjacent|ratio|subtle`, `transition.unknown|shortened`, `shot.highlight.notFound`, `skill.unknown` (with a skill catalog), `shot.sfx.unresolved`.

**Compilation** (`compileShotPlan`):
- themed base layers per shot type (`DOCUMENTARY_THEME`: `#121212` background, white text, `#FFC72C` keywords / numbers / data, `#DA291C` revelations); `highlightedWords` → `emphasis` indices;
- documents: page fitted with `contain`, highlight regions placed on the *displayed* page and revealed at `at` (sync with the narration), source citation;
- SFX events → `sfx` audio tracks (gain in dB, −6 dB default); narration → continuous `voiceover` track; music at −18 dB, ducked −6 dB more under the voice (→ −24 dB);
- captions sliced from the transcribed narration (`narration.words`, ms) into each shot, word-timed; by default only on image / video / document / chart / map shots (full-screen typography is not repeated);
- motion skills through the Motion Skill Registry (§16), built in by default; `skills: false` disables motion and a custom `applySkill` resolver can replace it. Skills never fail a compile: fallbacks and problems are reported in `notes`.

**@remotion/captions interop**: `toRemotionCaptions(track, fps, offset)` → `Caption[]` for `createTikTokStyleCaptions()`; `fromRemotionCaptions(captions)` turns a transcription (Whisper `toCaptions()`, ElevenLabs…) into `narration.words`.

**CLI for external pipelines** (e.g. a Python `montage.py` through `subprocess`):

```bash
node packages/engine/bin/shotplan.mjs validate plan.json   # issues JSON, exit 1 on errors
node packages/engine/bin/shotplan.mjs timeline plan.json   # flat Timeline JSON
node packages/engine/bin/shotplan.mjs compile  plan.json   # VideoProject document (notes on stderr)
```

---

## 16. Motion Skill Registry (AI = director, engine = execution)

The AI never writes animation code. It picks a **motion skill id** per shot (`Shot.motionSkill`, optional `intensity` and `motionParams`); the registry executes it with deterministic engine data.

```
AI: "number_pop" ──► MotionSkillRegistry.resolve() ──► skill.apply(shot) ──► layers / animations (data) ──► Remotion
                          │ not installed / renderer lacks it / nothing to animate
                          └──► fallback chain ──► … ──► no motion (hard cut). A render never fails on a skill.
```

```ts
getAvailableMotionSkills({ category?, shotType?, intensity?, query? })   // metadata only, plain JSON, for the AI
// { id: 'number_pop', name, category: 'numbers', description, parameters, intensity: 'medium',
//   duration: { min: 0.4, max: 1.2 }, compatibleShotTypes: ['number'], fallback: ['number_count', 'scale_text'],
//   events: ['number'], requires?: { graphicKinds: [...] }, version: 1 }

compileShotPlan(plan)                                      // uses defaultMotionSkillRegistry
compileShotPlan(plan, { skills: createMotionSkillRegistry({ graphicKinds }) })   // another renderer
compileShotPlan(plan, { skills: false })                   // no motion
```

- **Only real skills are advertised.** A skill that needs a renderer component (`requires.graphicKinds`) is available only if the renderer declares it. The reference Remotion renderer's component record is typed on `REFERENCE_RENDERER_GRAPHIC_KINDS`: if the engine advertises a component the Remotion package does not implement, the Remotion package does not compile.
- **Fallbacks** work even for skills that are not installed (`BUILT_IN_SKILL_FALLBACKS`), are cycle-safe, and are reported in `notes` (e.g. `glitch_reveal` → `zoom_reveal` → `text_reveal` → … → no motion). A skill also falls back when the shot has nothing for it to animate (e.g. `keyword_pop` without highlighted words).
- **Intensity** (`subtle | medium | strong`) scales each skill (e.g. `slow_zoom` 5 % / 7.5 % / 10 %, `punch_in` 106 % / **112 %** / 118 %).
- **Voice sync.** Skills receive the narration words of their shot (`ShotSkillContext.words`). Keyword effects (`keyword_pop`, `highlight_word`, `underline_word`, `punch_in`, `camera_shake`) land on the frame the word is spoken, never later than 0.5 s before the cut so they are seen.
- **Events.** Each application records editorial events (`keyword`, `number`, `highlight`, `reveal`, `impact`, `glitch`, `whoosh`, `chapter`, `text`) with their frame in `scene.metadata.extra.events` — the input of automatic sound design (Phase 8).
- **Parameters** (`motionParams`) are validated against the skill definition; invalid values fall back to defaults with a note.

Catalog (49 skills):

| Category | Skills |
|---|---|
| text | `keyword_pop`, `word_reveal`, `character_reveal`, `typewriter`, `slide_text`, `scale_text`, `blur_reveal`, `mask_reveal`, `highlight_word`, `underline_word` |
| numbers | `number_pop`, `number_count`, `percentage_reveal` (ring), `currency_reveal`, `stat_card` |
| images | `slow_zoom`, `slow_push`, `punch_in`, `punch_out`, `pan_left`, `pan_right`, `parallax`, `blur_transition`, `camera_shake` |
| documents | `document_highlight`, `document_zoom`, `document_pan`, `source_reveal` (the camera moves the whole page so highlights stay on their lines) |
| data | `chart_growth`, `chart_reveal`, `bar_animation`, `line_animation`, `pie_reveal`, `comparison_graph` |
| maps | `map_zoom`, `map_route`, `location_pin`, `country_highlight`, `business_expansion` |
| reveals | `glitch_reveal`, `flash_reveal`, `blackout_reveal`, `zoom_reveal`, `text_reveal` |
| editorial | `chapter_card`, `source_card`, `quote_card`, `lower_third`, `full_screen_statement` |

Engine primitives added for skills: `units` on `stagger` / `kineticTypography` (animate only some words), `TextLayer.decorations` (underline / marker drawn at a frame, optional `textColor`), graphic kinds `statCard` and `comparison`.

Reference renderer components (`packages/remotion/src/graphics`): `Counter` (with percentage ring), `StatCard`, `BarChart`, `LineChart` (optional area), `PieChart`, `Comparison`, `WorldMap`. Maps use **Natural Earth** data via `world-atlas` (ISC; data public domain) projected with `d3-geo` (ISC): offline, no token, no attribution requirement.

Adding a skill: `defineSkill({ id, name, category, description, intensity, duration, compatibleShotTypes, fallback, events, requires?, canApply?, apply })` and `registry.register(skill)`. `apply` only edits engine data (layers, animations, scene camera) of the composed shot, addressed by role (`media`, `text`, `number`, `chart`, `map`, `document`, `highlight`, `source`, `subtext`, `accent`, `captions`).

---

## 17. Performance

- Timeline resolution is O(scenes + layers + audio); scene lookup is O(log n); keyframe sampling is O(log k).
- Compile once, sample per frame: per-frame work is proportional to the layers of the visible scene(s) only.
- Easing functions are created once per config and cached; spring settle times are cached.
- Flat layers, id-based references and an asset registry keep state shallow and deduplicated; the model is immutable-friendly (plain data), so React can memoize on object identity.
- Measured (Node 22, this container): 60 scenes × 8 layers × 3 animations (8 410 frames) compile in ~11 ms and sample in ~33 µs per frame. The test suite asserts generous bounds (500 ms / 2 ms per frame) to catch accidental O(n²) regressions without being flaky.

---

## 18. Testing

```
npm test          # 234 tests (Vitest)
npm run check     # typecheck + build + tests, all workspaces
```

Covered: scene/layer creation and registries, validation (~50 targeted error/warning assertions), timing math and overlaps, layer positioning, easing / interpolation / keyframes / every animation type / providers, transitions and the Remotion mapping, presets (every built-in builds valid data), serialization round trips and migrations, renderer styles / masks / captions, the Remotion plan and audio envelopes, blueprint validation and compilation, and a realistic **10-scene documentary** (voiceover, captions, video, images, Lottie, charts, 9 transitions, camera moves) validated, serialized, planned and sampled on every one of its 1 440 frames.

---

## 19. Known limitations and next steps

- **Non-CSS effects** (grain, vignette, color grade, LUT, chromatic aberration, pixelate) are modeled and validated but the reference Remotion renderer does not draw them yet (needs shaders / SVG filters).
- **Graphic kinds**: the reference renderer draws `counter`, `statCard`, `barChart`, `lineChart`, `pieChart`, `comparison` and `map`; `progress`, `icon`, `svg`, `lowerThird` and `custom` have no component (no available skill produces them).
- **Asset masks** (`mask.type: 'asset'`) need asset URL resolution and are left to the renderer (`maskToCss` returns `{}`).
- **Lottie overrides** (slots, colors, themes) are modeled; the reference renderer does not apply them.
- **Remotion shader transitions** require Chrome ≥ 148 with HTML-in-Canvas; off by default.
- **Media probing**: `asset.durationInSeconds` must be provided at ingest (e.g. with Remotion's `parseMedia`); it is not detected by the engine.
- **Caption alignment**: without word timings from a transcription / alignment step, word timings are estimates.
- Not in scope by design: the editor UI and the AI model itself.
