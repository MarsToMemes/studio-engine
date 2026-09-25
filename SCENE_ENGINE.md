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
# --stage=final on any command: blocking editorial rules become errors
```

### 15.1 Editorial plan (ShotPlan version 2)

- **Structure.** Version 2 adds the editorial layer of VIDEO_EDITING_BIBLE.md on top of the shots: **chapters → scenes → beats → shots**, with the reasoning behind every decision.
- **Compatibility.** Version 1 plans stay valid and compile as before. Every v2 field is optional in v1; the rules that need that data only apply to plans that carry it.

```ts
// Shot (added)
sceneId, beat,                        // setup | development | contradiction | escalation | revelation | proof | payoff | aftermath | transition
editorialIntent,                      // hook | context | fact | important_fact | keyword | number | statistic | comparison | quote | proof
                                      // | location | process | contradiction | revelation | aftermath | chapter | conclusion
reasons: { shot, motion?, camera?, transition?, sfx?, music? },   // the inspectable "why"
importance?: 1..5, analysis?: { surprise?, informationDensity?, visualPotential?, tension?: 1..5, emotion?, proofRequired? },
visualHierarchy: { primary, secondary?, background? },
framing?: wide | medium | close_up | extreme_close_up | overhead | pov,
camera?: static | push_in | pull_out | pan_left | pan_right | tilt_up | tilt_down | tracking | parallax | punch_in | punch_out | shake,
focus?: { x, y },                     // percent, target of framing and camera
musicState?: calm | build | tension | reveal | aftermath,
hold?: string,                        // reason of an intentional long shot (RHY-04)
sequence?: string,                    // intentional same-type sequence (exempt from VAR-01)
decidedBy?: ai | user | rules | migration

// ShotPlan (added)
chapters?: [{ id, title, question? }]
scenes?: [{ id, chapterId?, purpose, motifs? }]
narration.segments?: [{ id, sourceStartMs, sourceEndMs, startFrame }]   // ranges of the narration file on the timeline
music.cues?: [{ id, atFrame, state, gainDb?, fadeInFrames? }]           // default: derived from musicState
silences?: [{ id, beforeShotId, durationInFrames, kinds: [music_drop | sfx_drop | ambient_drop] }]
memory?: { visualMotifs, introducedConcepts, callbackCandidates }
asset.source: { provider, id, url, license, commercialUse, attributionRequired, attribution, syntheticMedia }
```

- **Levels.** Editorial scores are ordinal levels from 1 to 5. A decimal such as 0.87 is rejected: these are heuristics, not measurements.
- **Stages.** `validateShotPlan(plan, { stage })`:
  - `draft` (default): the blocking editorial rules are warnings, so a plan in progress can still be previewed. These rules are DIR-01 (intent + `reasons.shot`), SCENE-01 (scenes with a purpose), HIER-01 (primary element) and SRC-01/02 (every asset's license, commercial use);
  - `final`: they are errors. Use it for the final render and to check the AI's output.
- **Rules checked.**
  - Every plan:
    - RHY-01, RHY-03, RHY-04 (`hold`, max 8 s), RHY-08 (no cut inside a spoken word);
    - VAR-01 (≤ 3 shots of the same type in a row);
    - CHAP-01 (card 1–1.5 s), CHAP-02 (title ≤ 6 words);
    - TRANS-02..07 (glitch ≤ 3 per video);
    - SIL-02/03/04 (silence 0.3–0.6 s, one per chapter and ≥ 60 s apart, followed by a strong event), plus a warning when the voice speaks during a silence.
  - v2 plans:
    - SCENE-02 (setup + resolving beat), REV-02 (a revelation needs a setup);
    - MUS-03 (music changes at scene boundaries or around a revelation);
    - scene and chapter contiguity.
- **Segmented narration** (`resolveNarration`):
  - Without segments, the voice is one file from frame 0 (v1).
  - With segments, each range of the file plays where it is placed, and the transcript words move with their segment. This drives captions, keyword sync and the RHY-08 check.
  - Each segment compiles to its own trimmed voice-over track, so the music is ducked **per segment** and comes back up in the pauses (MUS-06).
  - This is what makes silent chapter cards and controlled silences possible.
- **Camera** (`skills/camera.ts`):
  - `camera` moves the media independently of the motion skill;
  - amplitudes follow CAM-03: push 5 %, 7.5 % or 10 % depending on intensity;
  - `punch_in`, `punch_out`, `parallax` and `shake` reuse the corresponding skills;
  - `tracking` is rendered as a pan on a still image, and this is reported;
  - `framing` crops the media around `focus`;
  - a skill that already moves the camera (`controlsCamera`: image, document and map skills, chapter cards) wins, and the conflict is reported as `[CAM-02]` in `notes`.
- **Not rendered yet** (reported in `notes`, never silently ignored): music cues and controlled silences are validated and exported in the Timeline JSON, but the renderer still plays the music at one level with ducking. They are rendered in the sound design phase.
- **Timeline JSON v2.**
  - Adds, flat on each shot: `sceneId`, `beat`, `editorialIntent`, `importance`, `camera`, `framing`, `musicState`, `hold`. `reasons`, `visualHierarchy`, `analysis`, `focus`, `sequence` and `decidedBy` travel in `metadata`.
  - At the top level: `version`, `chapters`, `scenes`, `musicCues` (effective cues, MUS-05), `silences` (with `startFrame`), `narrationSegments`, `memory`.
  - Still lossless.
- **Migration.** `migrateShotPlan(v1)` returns a v2 **draft**:
  - intents are guessed from shot types and marked `decidedBy: 'migration'`;
  - `reasons` and `visualHierarchy` are left empty on purpose (no invented reasoning), so a `final` validation lists exactly what the editor brain must fill in.
- **Reference.** `tests/fixtures/editorial-episode.ts`, the bible's McDonald's sequence, is a clean `final` plan: zero errors, zero warnings.

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
//   events: ['number'], requires?: { graphicKinds: [...] }, version: 1,
//   defaultDuration: 0.8, family: 'number_pop', implementation: 'remotion', controlsCamera: false }
getMotionSkill(id)                                        // one skill's metadata, or undefined
getCompatibleSkills(shotType, filter?)                    // available skills for a shot type
getFallbackSkill(id, shotType?)                           // first available skill of the chain, then the safe fallback

compileShotPlan(plan)                                      // uses defaultMotionSkillRegistry
compileShotPlan(plan, { skills: createMotionSkillRegistry({ graphicKinds }) })   // another renderer
compileShotPlan(plan, { skills: false })                   // no motion
```

- **Only real skills are advertised.** A skill that needs a renderer component (`requires.graphicKinds`) is available only if the renderer declares it. The reference Remotion renderer's component record is typed on `REFERENCE_RENDERER_GRAPHIC_KINDS`: if the engine advertises a component the Remotion package does not implement, the Remotion package does not compile.
- **Fallbacks** work even for skills that are not installed (`BUILT_IN_SKILL_FALLBACKS`), are cycle-safe, and are reported in `notes` (e.g. `glitch_reveal` → `zoom_reveal` → `text_reveal` → …). A skill also falls back when the shot has nothing for it to animate (e.g. `keyword_pop` without highlighted words).
- **Safe fallback by shot type** (`SAFE_FALLBACKS`), tried after the chain, before "no motion": text / revelation / chapter → `word_reveal`, number → `number_count`, chart → `chart_reveal`, map → `map_zoom`, document → `document_zoom`, image / video → `slow_zoom`. An invented id (`cinematic_money_explosion_v4`) on a number shot gives `number_count` with the note `(safe fallback of number shots)`.
- **Family** groups near-duplicates (`pan_left` / `pan_right` → `pan`, `slow_zoom` / `slow_push` / `depth_zoom` / `cinematic_push` → `push`, `counter_roll` / `odometer` → `digit_roll`…). The repetition rule REP-01 and the brain's motion step count families, not ids.
- **Implementation** says what draws the skill: `remotion` (layers and animations only), `svg` (a graphic component of the reference renderer), `maplibre` (`city_zoom`). Reserved: `lottie`, `canvas`, `gsap`.
- **Intensity** (`subtle | medium | strong`) scales each skill (e.g. `slow_zoom` 5 % / 7.5 % / 10 %, `punch_in` 106 % / **112 %** / 118 %).
- **Voice sync.** Skills receive the narration words of their shot (`ShotSkillContext.words`). Keyword effects (`keyword_pop`, `highlight_word`, `underline_word`, `punch_in`, `camera_shake`) land on the frame the word is spoken, never later than 0.5 s before the cut so they are seen.
- **Events.** Each application records editorial events (`keyword`, `number`, `highlight`, `reveal`, `impact`, `glitch`, `whoosh`, `chapter`, `text`) with their frame in `scene.metadata.extra.events` — the input of automatic sound design (Phase 8).
- **Parameters** (`motionParams`) are validated against the skill definition; invalid values fall back to defaults with a note.

Catalog (65 skills; previews in `motion-library/`):

| Category | Skills |
|---|---|
| text | `keyword_pop`, `word_reveal`, `character_reveal`, `typewriter`, `slide_text`, `scale_text`, `blur_reveal`, `mask_reveal`, `highlight_word`, `underline_word`, `kinetic_statement` |
| numbers | `number_pop`, `number_count`, `percentage_reveal` (ring), `currency_reveal`, `stat_card`, `counter_roll`, `odometer` |
| images | `slow_zoom`, `slow_push`, `punch_in`, `punch_out`, `pan_left`, `pan_right`, `parallax`, `blur_transition`, `camera_shake`, `depth_zoom`, `cinematic_push` |
| documents | `document_highlight`, `document_zoom`, `document_pan`, `source_reveal` (the camera moves the whole page so highlights stay on their lines), `document_focus`, `redaction_reveal` |
| data | `chart_growth`, `chart_reveal`, `bar_animation`, `line_animation`, `pie_reveal`, `comparison_graph`, `ranking_animation`, `percentage_bar` |
| maps | `map_zoom`, `map_route`, `location_pin`, `country_highlight`, `business_expansion`, `flight_route`, `city_zoom` (MapLibre) |
| reveals | `glitch_reveal`, `flash_reveal`, `blackout_reveal`, `zoom_reveal`, `text_reveal`, `light_reveal`, `impact_reveal` |
| editorial | `chapter_card`, `source_card`, `quote_card`, `lower_third`, `full_screen_statement`, `warning_card`, `key_fact`, `timeline_event` |

Registry v2 skills (Phase 5), in short:

- `kinetic_statement` sizes each word by weight (`TextLayer.wordScales`): key words 1.3–1.6×, light words 0.62×.
- `counter_roll` / `odometer` animate digit strips (`counter` `data.style`).
- `depth_zoom` is an accelerating zoom toward `shot.focus`; `cinematic_push` is a dolly camera.
- `document_focus` dims the page around the first highlight while the camera goes to it.
- `redaction_reveal` pulls black bars off the passages as they are read.
- `ranking_animation` draws sorted horizontal bars with ranks.
- `percentage_bar` fills a `progress` bar; it applies to `%` values only.
- `flight_route` adds a moving head on the route.
- `city_zoom` is described below.
- `light_reveal` sweeps a light band that rides the reveal edge.
- `impact_reveal` combines a slam, a white flash and a shake.
- `warning_card` is red: the colour is reserved for warnings.
- `key_fact` draws an accent frame with a tab.
- `timeline_event` places dated points on a line.

**`city_zoom` (MapLibre GL 6, BSD-3).**

- **When it applies.** Only when the shot gives `map.style`: either a MapLibre style URL (a licensed tile provider or self-hosted PMTiles), or `offline:natural-earth` (country shapes from local data, no network; for testing the pipeline). Otherwise it falls back to `map_zoom`.
- **Attribution.** `map.attribution` is drawn on screen (MAP-05).
- **Deterministic rendering.** It is non-interactive, with no fade and the drawing buffer preserved. Each frame moves the camera and waits (`delayRender`) for MapLibre's `idle` event, capped at 8 s so a missing tile never hangs a render.
- **The worker.** MapLibre's worker is served from `packages/remotion/public/maplibre/`, copied by `npm run assets`, `render` and `previews`, or it can be passed in `data.workerUrl`. WebGL works in headless Chromium (SwiftShader).
- **Not verified here: real tiles.** The tile hosts are blocked by this container's network policy.

**Previews.**

- `skillPreviewPlan(skill)` and `skillGalleryPlan(registry)` build canonical one-shot plans on the preview media. Every available skill applies to its own preview (tested).
- `npm run previews -w @studio-engine/remotion -- --browser=…` renders `motion-library/previews/<id>.jpg` and `motion-library/catalog.json`.
- The `MotionLibrary` composition plays the whole reel.

**Asset packs.**

- `loadAssetManifest(motion-library/assets/manifest.json)` keeps only entries whose rights are recorded and usable commercially (license, commercialUse, attribution text when required). It returns `{ assets, byCategory, rejected }`.
- Nothing is downloaded automatically. See `motion-library/README.md`.

Engine primitives added for skills: `units` on `stagger` / `kineticTypography` (animate only some words), `TextLayer.decorations` (underline / marker drawn at a frame, optional `textColor`), graphic kinds `statCard` and `comparison`.

Reference renderer components (`packages/remotion/src/graphics`): `Counter` (with percentage ring and digit strips), `StatCard`, `BarChart` (and ranking bars), `LineChart` (optional area), `PieChart`, `Comparison`, `WorldMap` (with route head), `Progress`, `Timeline`, `MapTiles` (MapLibre). Maps use **Natural Earth** data via `world-atlas` (ISC; data public domain) projected with `d3-geo` (ISC): offline, no token, no attribution requirement.

Adding a skill: `defineSkill({ id, name, category, description, intensity, duration, compatibleShotTypes, fallback, events, requires?, canApply?, apply })` and `registry.register(skill)`. `apply` only edits engine data (layers, animations, scene camera) of the composed shot, addressed by role (`media`, `text`, `number`, `chart`, `map`, `document`, `highlight`, `source`, `subtext`, `accent`, `captions`).

---

## 17. Live preview (`packages/studio`)

A Vite + React app plays the compiled ShotPlan with **`@remotion/player`**, using exactly the composition of the final render (`EngineComposition` from `@studio-engine/remotion`): what you preview is what renders, and no MP4 export is needed to see a change.

```bash
npm run studio            # http://localhost:5173
```

- Shot list (type, start, duration, skill, transition, intensity) · Player · inspector of the selected shot · live issues panel (errors, editorial warnings, fallback notes, compile time).
- Editable: text, highlighted words, duration, media (only compatible assets), motion skill (only skills available for the shot type), intensity, map zoom, transition in, SFX events. Every change recompiles the plan (1–3 ms for 12 shots) and the preview updates in ~40 ms.
- After an edit or a selection the preview jumps to the shot's **poster frame** (after its incoming transition and its skill's last event, e.g. the spoken keyword) and loops the shot (`inFrame`/`outFrame`), so the result is visible immediately. The loop can be turned off.
- An invalid edit never blanks the preview: the last valid version stays on screen while the errors are listed.
- Media the browser cannot decode (e.g. H.264 in an open-source Chromium) is replaced by a "Media unavailable" placeholder instead of breaking the preview.
- Export plan / Timeline JSON.
- Editing logic lives in `src/state/plan.ts` as pure, unit-tested functions; `e2e/smoke.mjs` drives the built app in Chromium (`playwright-core`) and checks rendering, seeking, live edits, warnings, shot looping, every timeline gesture and console errors.

---

## 18. Timeline editor (`packages/studio`)

A horizontal timeline under the preview, built for **narration-locked documentary editing** rather than free NLE editing (no Editor Starter: its free-layer model does not match a ShotPlan, see the Phase 5 decision).

```
Ruler   │0:00      0:05      0:10 ...          click/drag = seek, the shot under the playhead is selected
Video   │[hook][counter ▨kitchen][stat] ...    blocks = shots (thumbnail, label, skill, ⚠ sync), ▨ = transition overlap
Voice   │▁▃▅▇▅▃ McDonald's isn't a burger ...  narration waveform + transcript words (zoomed in)
Music   │▁▂▁▂▁▂ ───────────── (yellow)         music waveform + real gain envelope in dB (fades, ducking)
SFX     │◆impact        ◆impact               SFX events, draggable
```

- **Everything is derived from the ShotPlan** (`src/state/timeline.ts`, pure and unit-tested): start frames and overlaps from `toTimeline` / `resolveShotTransitions`, skill events (keyword spoken, number landed…) from the compiled scenes, the music envelope from `audioVolumeAt` on the same Remotion audio plan as the render. The timeline cannot drift from what renders.
- **Trim = roll edit by default.** The voice-over is one continuous file starting at frame 0 and shots are cut against it, so dragging a cut moves the boundary between two shots and **everything after it stays in sync with the voice** (episode length unchanged). **Alt+drag = ripple** (the shot changes length and pushes the rest). The last shot always ripples. Minimum shot length 0.5 s. The drag shows `+0.67 s · roll`.
- **Snapping** (toggle) to shot edges and **narration word starts**, so a cut lands on a spoken word.
- **Voice-sync check**: a block shows `⚠ sync` when one of its highlighted words is not spoken during the shot (e.g. after a reorder or a ripple).
- **Reorder** by dragging a block (insertion line), **duplicate** (Ctrl+D), **delete** (Del), **SFX**: drag in time (re-attached to the shot it lands on), double-click the SFX lane or "+ SFX at playhead" to add, Del to remove.
- **Motion skill drop target**: dropping `application/x-motion-skill` data on a block applies the skill if it is available for that shot type, otherwise a message explains why (used by the Motion Library, Phase 6).
- **Undo / redo** (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y) for every plan change; one drag or one burst of typing in a field is one step (`src/state/history.ts`, bounded to 200 steps).
- **Keyboard**: Space play/pause · ←/→ one frame · Shift+←/→ one second · ↑/↓ previous/next shot.
- **Zoom**: slider, +/−, Ctrl+wheel (anchored under the mouse), Fit.
- **Performance**:
  - waveforms are decoded once per file with the Web Audio API (no extra dependency) into 100 peaks/s and drawn only for the visible window (viewport-sized sticky canvas);
  - blocks, ticks and words outside the view are not rendered;
  - thumbnails are real frames of the composition (`<Thumbnail>` from `@remotion/player`), each rendering a one-scene project memoised on that scene's content and debounced, so editing a shot never re-renders the other thumbnails.
  - Measured edit → preview latency: 15–30 ms with or without the timeline mounted. Before memoising the thumbnails it was ~80 ms, with multi-second spikes.

---

## 19. Editorial bible (`VIDEO_EDITING_BIBLE.md`)

- **Single source of truth.** The editorial rules live in `VIDEO_EDITING_BIBLE.md` at the repository root: 149 rules in 26 domains, from narration and rhythm to sound, rights and technical quality.
- **Rule format.** Each rule has a stable id (`RHY-03`), a severity (`bloquant` / `avertissement` / `conseil`) and an enforcement mode:
  - `AUTO`: deterministic check;
  - `HEUR`: approximate check, never blocking;
  - `REVUE`: AI critic or human.
- `src/bible/parse.ts` parses the markdown. `src/bible/rules.generated.ts` is generated from it (`npm run bible -w @studio-engine/scene-engine`), and `tests/bible.test.ts` fails when the two diverge or when the markdown breaks the format (sequential ids per domain, prefix matching its section, no blocking heuristic).
- Validation issues carry `rule` (`ISSUE_CODE_RULES`; structural errors fall under `TECH-02`). The studio shows it as a badge whose tooltip is the rule text. `formatIssues` includes it, so an AI repair loop receives the rule with the error.
- **Checked in code today: 54 rules** (`enforcedRuleIds()`, plan validation and QC on the render), out of 106 automatable rules (`AUTO` + `HEUR`) and 149 in total. `ISSUE_CODE_RULES` gives the exact mapping. The 43 `REVUE` rules belong to the editorial critic (AI, §23) and to the human.

---

## 20. Editor brain (`packages/editor-brain`)

AI = director, engine = execution. The brain turns **script + transcript + catalogued assets + music + sound library** into a **ShotPlan v2** that passes `stage: 'final'` validation, and explains every decision. It depends only on the engine; the engine stays zero-dependency.

```
directEpisode(input) ─► EDITORIAL ANALYZER   one unit per sentence: intent, importance 1–5, entities (figures, places, quote, emphasis), WHY
                        STORY ARCHITECT      chapters · scenes (purpose) · beats (setup … payoff); no scene opens on a revelation
                        RHYTHM EDITOR        durations from the voice, pauses by pacing, splits at word boundaries, hook 1.5–2.5 s, holds
                        SHOT PLANNER /       grammar of the intent × available assets; typography + asset request when proof is missing
                        VISUAL DIRECTOR      hierarchy, framing, camera alternated with a reason, motif kept for the callback
                        MOTION DIRECTOR      installed + compatible + applicable skills, repetition manager, intensity budget
                        SOUND DESIGNER       music states per scene, silence before the chapter's major revelation, SFX on real events
                        QUALITY CONTROL      validateShotPlan(final) + compile notes + STORY-05 check
```

- **Grammar** (`EDITORIAL_GRAMMAR`, engine): bible §4 as data. For each intent: shot types, skills, camera moves and sound categories in order of preference, plus the default *why*. The brain picks from it, and validation checks it (GRAM-01: a skill outside the grammar needs `reasons.motion`).
- **Timing on the voice.**
  - LCS alignment of the script against the transcript tolerates "61 %" written vs "sixty one percent" spoken.
  - Cuts fall on word starts, and natural pauses are capped by `pacing` (calm 700 ms, standard 450 ms, dynamic 200 ms).
  - **J-cuts**: a key figure or place gets its shot on the spoken word (GRAM-03, ±6 frames) while the previous shot covers the first words.
  - The shot before a transition outlasts its voice by the transition length, so voice ranges never overlap.
- **Never invents** (SRC-05, DOC-06, STORY-04):
  - no chart without `hints.chart`, no map without a known place or `hints.map`;
  - no document without a matching catalogued document, no unrelated image;
  - the shot falls back to typography and `assetRequests` says what to provide (`chart-data`, `document`, `document-region`, `image`, `sfx`…);
  - a media imposed by the author (`hints.media`) wins over the grammar.
- **Visual callback.**
  - The first image of the first third of the video becomes the motif, and the conclusion brings it back with a dissolve and a pull-out.
  - The motif is not reused in between.
  - Without an early image, no callback is claimed.
- **Sound.**
  - Music: one state per scene; `build` before a revelation, `reveal` on it, `aftermath` after it.
  - One 0.4 s music drop before the major revelation of a chapter, at most one per 60 s.
  - SFX are placed on the events emitted by the compiled skills, in priority order (reveal > number > document > keyword > transition). Budget: at most 3 in 2 s, about one per two shots, the same file at most 3 times a minute.
- **Heuristics, stated as such.**
  - The analyzer's cues (EN/FR contradiction, revelation, proof, growth, comparison, process), spelled-out numbers (English only), the 70-place gazetteer and the templated scene purposes are an offline baseline.
  - The LLM layer (Phase 4) produces the same `EditorialUnit` / `StoryStructure` with real understanding and reuses everything downstream.
- **Deterministic**: the same input gives the same plan.
- **CLI.** It exits with 1 when the plan is not final-valid; decisions and asset requests go to stderr.

  ```bash
  node packages/editor-brain/bin/editor-brain.mjs direct input.json          # { plan, analysis, structure, assetRequests, decisions, qc }
  node packages/editor-brain/bin/editor-brain.mjs direct input.json --plan   # ShotPlan v2 only
  ```
- **Example**: `mcdonaldsExample()` (input format reference), rendered by the `BrainDemo` Remotion composition.

### 20.1 LLM layer (`directEpisodeWithLlm`)

The model writes the **editorial story**:
- per sentence: intent, 1–5 levels, emotion, whether proof is required, ≤ 2 emphasised words, the *why*, a catalogue media when one truly fits, and place names;
- scenes: sentences, beats and purpose, plus missing chapter questions.

It never provides timing, figures, data or documents. Everything after the story is the deterministic chain above.

```
heuristicStory ─► prompt (bible rules + grammar + script + facts + catalogue) ─► model calls the tool `submit_editorial_story`
               ─► checkStory: ids in order, enums, integer levels, emphasis ∈ sentence, media ∈ catalogue,
                  scenes contiguous / one chapter / ≥ 2 sentences / setup + resolving beat / no revelation first
               ─► invalid? one repair turn: the exact errors as a tool_result error ─► still invalid: keep the valid
                  sentences, heuristic analysis for the rest, heuristic architect rebuilt on the model's intents
               ─► mergeStory (author hints always win) ─► directFromStory ─► plan (decidedBy: "ai")
```

- **Single source.** The system prompt is generated from `BIBLE_RULES` (DIR, STORY, SCENE, GRAM, REV, ESC, CHAP, TYPO, CALL) and `EDITORIAL_GRAMMAR`: the model reads the rules the validation enforces. It is about 2 400 tokens, marked `cache_control: ephemeral` so it is cached across episodes. The user message costs about 25 tokens per sentence, the answer about 150 tokens per sentence (`max_tokens` = 2 000 + 150 × sentences, capped at 64 000).
- **Model.** `AnthropicModel`, through the official SDK `@anthropic-ai/sdk` 0.128.0 with the tool forced. It defaults to `claude-sonnet-5`, reads `ANTHROPIC_API_KEY`, and accepts an injected client. The `EditorModel` interface lets any model plug in.
- **Never breaks.** An API error, a truncated answer (`max_tokens`) or a missing tool call all fall back to the heuristic brain, and the fallback is recorded in `decisions`. `llm` reports the model, the attempts, `full` / `partial` / `none`, the remaining errors and token usage.
- **Reproducible.** `llm.answer` replays with `RecordedModel` to the same plan, without a second API call.
- **CLI:** `editor-brain direct input.json --llm [--model=<id>]`. Without a key it says so and the heuristic brain directs.
- **Limits.**
  - One call per episode: an episode of about 400 sentences reaches the output cap and would need one call per chapter (not implemented).
  - The tests use recorded answers written as fixtures, which prove the contract, not the model's quality.
  - The editorial critic pass over the rendered plan (REVUE rules) is a later phase.

---

## 21. Craft rules checked on every plan

The rules below keep a video from feeling algorithmic. They apply to every plan (v1 or v2), whether it comes from the AI, a human or `montage.py`, and each cites its bible rule.

| Rule | Check |
|---|---|
| REP-01 | a skill more than 3 times in 10 shots |
| REP-02 | a transition more than twice in 10 cuts |
| REP-03 | a sound effect more than 3 times a minute |
| REP-04 | the same camera move on more than 3 shots in a row |
| REP-05 | the same text treatment on 3 typographic shots in a row |
| VAR-02 | fewer than 3 visual types in 10 shots |
| MOT-02 | strong intensity on more than 20 % of shots, or outside the hook, revelations and importance-5 shots |
| MOT-03 | fewer than 2 of 10 shots without content animation (needs the skill catalogue) |
| CAM-07 | more than 3 shakes |
| TYPO-02 / TYPO-03 | more than 12 words, or more than 2 emphasised words |
| DOC-01 / DOC-05 | static document, or document without a source |
| CHART-04 | too many categories |
| MAP-03 | more than 8 labels |
| SND-03 | more than 3 sound effects in 2 s |
| GRAM-01 | skill or camera outside the grammar of the intent, without a reason |

**Captions.** No captions on a shot whose own text already says what is spoken (CAP-03). A cue never runs across the end of a sentence. The source citation of a document moves to the top when the shot has captions (CAP-04).

---

## 22. Sound design at render

The music states, cues and controlled silences decided in the plan (bible §12, §13) are heard in the render.

- **Volume automation.**
  - `AudioTrack.automation` is a gain curve applied on top of `volume`, the fades and the ducking. It is a list of `{ frame, gain, rampFrames? }` points.
  - Each point ramps from the value reached so far. `rampFrames: 0` is a cut.
  - `audioVolumeAt` applies it, so the Remotion render, `@remotion/player` and the bench timeline envelope hear the same thing. `automationGainAt(points, frame)` reads it alone.
- **Music cues.**
  - `compileShotPlan` turns the cues (explicit `music.cues`, or derived from the shots' `musicState`) into automation on the music bed.
  - Levels are relative to the bed (`music.gainDb`, default −18 dB), in `MUSIC_STATE_LEVELS`:

    | State | Level | Ramp |
    |---|---|---|
    | `calm` | 0 dB | 1.5 s |
    | `build` | +2 dB | 4 s (rises through the scene) |
    | `tension` | +1 dB | 1 s |
    | `reveal` | +3 dB | 0.1 s (a hit) |
    | `aftermath` | −4 dB | 1.5 s (withdraws, MUS-04) |

  - The first cue applies at once; the music's fade-in brings it in. A cue's own `gainDb` (absolute dB of the music) and `fadeInFrames` win.
- **Controlled silences** (`plan.silences`):
  - `music_drop` cuts the music in 0.12 s at the start of the window, and gives it back at the level of its cue on the revelation's first frame;
  - `sfx_drop` removes the SFX events that fall in the window, with a note; the hit at its end stays;
  - `ambient_drop` cuts the ambience bed.
  - The brain's silence before a major revelation drops music and SFX, and the ambience when there is one.
- **Ambience bed** (`plan.ambience { assetId, gainDb = -28 }`, `BrainInput.ambience`): looped under everything, not ducked.
- **Loudness** (`mix/loudness.ts`, bible MUS-01 and MUS-09).
  - `LOUDNESS_TARGETS.master` is −14 LUFS ±1 with a true peak ≤ −1 dBTP (YouTube's playback reference). `LOUDNESS_TARGETS.voice` is −16 LUFS ±1.
  - `parseLoudnorm` reads FFmpeg's `loudnorm` measure. `judgeLoudness` gives the verdict with issues citing the rule (`mix.loudness`, `mix.truePeak`, `voice.loudness`). `loudnormSecondPass` builds the linear second pass.
  - Linear means a single gain: the silences and the dynamics survive the normalisation.
  - `npm run loudness -w @studio-engine/remotion -- out/episode.mp4 [--fix=out/final.mp4] [--preset=voice] [--json]` measures, and with `--fix` normalises. The video stream is copied.
  - It uses FFmpeg on the PATH, else Remotion's bundled FFmpeg, which has `loudnorm` but not `ebur128`.

Verified on a real render (`BrainDemo`, 34 s):

- around the silence before the revelation: about −21 dBFS just before, **−68.8 dBFS** during it, −20.5 dBFS on the hit;
- the music levels between states follow the table within about 1 dB (music-only render compared with the source file);
- the mix measured −16.7 LUFS, and −14.0 LUFS / −4.8 dBTP after `--fix`.

---

## 23. Quality control before publishing (`QC_REPORT.json`)

One report says whether an episode can be published. Each check has a status (`pass`, `fail`, `warn`, `info`, `skipped`) and cites its bible rule. `fail` means a blocking rule is broken.

```bash
cd packages/remotion
npm run qc -- plan.json                                   # plan only
npm run qc -- plan.json out/final.mp4 --frames-dir=out/stills [--stage=preview] [--review=review.json]
node ../editor-brain/bin/editor-brain.mjs critique plan.json --stills=out/stills > review.json   # AI review (ANTHROPIC_API_KEY)
```

Exit code: 0 pass, 1 a check failed, 2 unreadable input. The logic is in the engine (`qc/`, pure functions: `runQc`, `formatQcReport`). The script only decodes the render with FFmpeg: 96×54 grey frames and mono 48 kHz audio. The minimal FFmpeg bundled with Remotion is enough for it.

| Check | Rule | How |
|---|---|---|
| Plan valid (final or draft) | TECH-02 + the rule of each issue | `validateShotPlan` |
| Unresolved references | TECH-06 | compile notes |
| Attributions to publish; disclosure of realistic AI media | SRC-03, SRC-04 | `asset.source` |
| Resolution, codec H.264, fps, frame count, audio stream | TECH-07 | ffprobe (the video stream's frame count: the container also counts AAC priming) |
| Unwanted black frames | TECH-03 | more than 2 black frames where the plan shows content (see below) |
| Frozen picture | RHY-03 | a frame compared with the one a second earlier stays the same for 4 s; shots with `hold` excluded |
| The voice is heard in every narration segment | TECH-01 | at least 30 % of the segment's frames over −45 dBFS. A share, not a mean: one loud instant cannot hide a missing voice |
| Controlled silences are silent | SIL-04 | under −45 dBFS after the 0.15 s drop |
| No unwanted gap | TECH-08 (new) | more than 1.5 s under −60 dBFS outside the controlled silences |
| Clipping, true peak | TECH-05 | full-scale samples, and `loudnorm`'s true peak |
| Mix loudness | MUS-09 | −14 LUFS ±1 |
| Fonts | TECH-04 | the render itself (below) |
| REVUE rules (43) | each rule | editorial review, AI or human |

**What "unwanted" black means.**

- Two kinds of frame count as dark: `black` (a mean under 3.5 %) and `empty` (under 10 % with nothing bright, i.e. the dark theme background alone).
- Dark frames are allowed in these windows (`expectedDarkWindows`):
  - chapter cards and blackout reveals;
  - the first 0.8 s of typographic shots, before their text enters;
  - dips to black;
  - the first and last 0.5 s of the episode.
- Outside those windows, black frames fail and empty frames warn.

**Fonts (TECH-04).**

- The render bundles its fonts: Inter (sans) and Source Serif 4 (quotes, instead of Georgia, which Linux doesn't have). Both are under the SIL OFL 1.1 and loaded through `@fontsource`.
- Before the first frame, every font the project asks for (`usedFontFamilies`) is checked by measuring glyph widths. A missing font **stops the render** with its name. In `@remotion/player` it is a console warning.

**Editorial critic** (`critiqueEpisode`, `editor-brain critique`).

- **What the model sees.** The cut shot by shot: timing, type, on-screen text, spoken words, motion, camera, transition, music, SFX and the editor's reason. It also gets one still per shot from `--frames-dir`, at most 60 stills, evenly spread.
- **What it answers.** Findings on the REVUE rules only, through a forced tool `submit_editorial_review`: `{ rule, shots, severity: major | minor | suggestion, finding, fix }`.
- **How the answer is checked.**
  - Rules must be REVUE rules, and shots must exist.
  - The finding and the fix must say something.
  - One repair turn with the exact errors, then what is still invalid is dropped and listed.
- **Effect on QC.** Findings are warnings in the QC report, never failures: a person decides.
- **Failures.** Without a key, or on an API error, the review stays `pending` and the report lists the 43 rules to review by hand. `RecordedModel` replays an answer.

Verified on a render of `BrainDemo`: 0 failures, and the silence measured at −74 dBFS. A deliberately broken render was also checked, with a black image, a muted sentence, no music and a clipped sound effect. The QC reported all four faults, and nothing else:

- 12 black frames (TECH-03);
- "narration u4 is not heard" (TECH-01);
- a 4.9 s gap (TECH-08);
- 11 clipped frames and a true peak of +0.8 dBTP (TECH-05).

---

## 24. Rendering an episode (`@studio-engine/render`)

`packages/render` is the Node side of the pipeline. It chooses the renderer, keeps a cache, mixes the sound and masters. Its CLI `studio-render` is what `montage.py` calls.

```bash
studio-render render plan.json final.mp4 [--engine=remotion|ffmpeg] [--fallback] [--scale=0.5] [--cache=.studio-cache]
studio-render qc plan.json final.mp4 [--frames-dir=stills] [--review=review.json]
studio-render loudness file [--fix=out] [--preset=voice]
studio-render cache [--prune=<GB>]
```

`render` exits with 0 when rendered, 1 when Remotion failed and the draft was rendered instead (`--fallback`), 2 on error. From the monorepo root, the binary is `node packages/render/bin/studio-render.mjs`. The `npm run qc`, `npm run loudness` and `npm run render:episode` scripts of `packages/remotion` call it.

**`RemotionRenderer`: the episode.**

1. **Chunks of about 3 scenes** (`planRenderChunks`). Boundaries are content-defined: a chunk ends after a scene whose id hashes to a multiple of 3. Inserting or removing a scene only changes the chunks around it.
2. **Cache key** of a chunk: a SHA-256 of `chunkKeyMaterial`. It contains:
   - the scenes the chunk shows, including the previous one while a transition overlaps its start;
   - their offsets inside the chunk;
   - their assets, with a content fingerprint (checksum, else size + modification time);
   - the canvas and the render settings;
   - the version of the rendering code (a hash of the Remotion bundle's JavaScript).

   Absolute positions are left out, so a chunk that only moved in time keeps its key. A change that moves the spoken words inside a shot does change pixels (a keyword effect lands elsewhere), and the key catches it.
3. **Rendering.** Each missing chunk is rendered muted, with one bundle and one browser for all chunks. The chunks are then joined without re-encoding (FFmpeg concat), and the joined frame count is checked.
4. **Sound: the JS mixer** (`mixAudio`). It uses the same audio plan and the same `audioVolumeAt` as the preview, with one gain per video frame (as Remotion applies it). Sources are decoded once to 48 kHz and cached. The mix is cached by the audio plan and the sources' content.
   - If a video layer plays its own sound, the mixer does not handle it, and the audio is rendered by Remotion instead (not cached).
5. **Master**: two linear `loudnorm` passes, then −14 LUFS (MUS-09). The video stream is copied. A silent mix is muxed as is.

Measured on `BrainDemo` (34 s, 1019 frames, 480×270, 4 cores):

| Run | Result |
|---|---|
| Cold | 85 s, 7 chunks rendered |
| Again | **13 s**, everything from the cache |
| One text changed | **22 s**, 1 chunk re-rendered |
| Chunked vs single-pass render, same inputs | mean picture difference 0.09 %, ≤ 0.05 % at the chunk seams |
| Mixer vs Remotion's own audio (WAV) | median gap **0.06 dB** per frame; sources placed to the sample (clicks at frames 30/60/90 exactly; Remotion's AAC adds 43 ms) |

Where the two sound paths differ, Remotion is the one that is wrong:

- When a looped music file restarts, Remotion leaves a hole and then stops applying the volume curve, so the music's fade-out is missing.
- The mixer follows the plan.

At 1080p, a single-pass Remotion render of the same episode takes 114 s on 4 cores, about 3.4× real time.

**`FfmpegRenderer`: the draft.** It is not for publishing, and a `DRAFT · FFmpeg` mark is on every frame.

- **Pictures.** One segment per shot:
  - images with a slow 6 % push (`zoompan`);
  - videos looped and cropped;
  - documents fitted with their source;
  - text, number, chapter, chart and map shots as text cards in Inter (charts and maps become their words: title and values, or place names);
  - burned captions.
- **Transitions.** Cuts, except `fade`.
- **Sound.** The same mixer and master as the final render.
- **Cache.** Segments are cached too.
- **Requirements.** It needs a full FFmpeg (`zoompan`, `drawtext`); `check()` says what is missing.
- **Measured.** The 34 s episode renders in 1080p in 29 s cold, and 17 s when only the texts changed.

`renderEpisode(request, { fallback: true })` renders the draft when Remotion cannot run or fails, and the result's first note says why. Without `fallback`, the error is raised.

**Cache housekeeping.**

- Every file used by a render is touched.
- `studio-render cache --prune=<GB>` removes the least recently used files until the cache is under that size.
- At 1080p, count roughly tens of MB per chunk, so an episode's cache is about 1–2 GB.

---

## 25. Performance

- Timeline resolution is O(scenes + layers + audio); scene lookup is O(log n); keyframe sampling is O(log k).
- Compile once, sample per frame: per-frame work is proportional to the layers of the visible scene(s) only.
- Easing functions are created once per config and cached; spring settle times are cached.
- Flat layers, id-based references and an asset registry keep state shallow and deduplicated; the model is immutable-friendly (plain data), so React can memoize on object identity.
- Measured (Node 22, this container): 60 scenes × 8 layers × 3 animations (8 410 frames) compile in ~11 ms and sample in ~33 µs per frame. The test suite asserts generous bounds (500 ms / 2 ms per frame) to catch accidental O(n²) regressions without being flaky.

---

## 26. Testing

```
npm test          # 340 engine + 43 editor-brain + 7 render + 25 studio tests (Vitest)
npm run e2e -w @studio-engine/studio   # browser smoke test (after npm run build -w @studio-engine/studio)
npm run check     # typecheck + build + tests, all workspaces
```

Covered: scene/layer creation and registries, validation (~50 targeted error/warning assertions), timing math and overlaps, layer positioning, easing / interpolation / keyframes / every animation type / providers, transitions and the Remotion mapping, presets (every built-in builds valid data), serialization round trips and migrations, renderer styles / masks / captions, the Remotion plan and audio envelopes, blueprint validation and compilation, and a realistic **10-scene documentary** (voiceover, captions, video, images, Lottie, charts, 9 transitions, camera moves) validated, serialized, planned and sampled on every one of its 1 440 frames.

---

## 27. Known limitations and next steps

- **Non-CSS effects** (grain, vignette, color grade, LUT, chromatic aberration, pixelate) are modeled and validated but the reference Remotion renderer does not draw them yet (needs shaders / SVG filters).
- **Graphic kinds**: the reference renderer draws `counter`, `statCard`, `barChart`, `lineChart`, `pieChart`, `comparison`, `map`, `mapTiles`, `progress` and `timeline`; `icon`, `svg`, `lowerThird` and `custom` have no component (no available skill produces them).
- **`city_zoom` with real tiles** has not been rendered here (tile hosts blocked by the container's network policy); only the offline style is verified. Render time per frame depends on the tile provider.
- **Motion Library previews are stills**: they show the composition, not the motion.
- **Asset masks** (`mask.type: 'asset'`) need asset URL resolution and are left to the renderer (`maskToCss` returns `{}`).
- **Lottie overrides** (slots, colors, themes) are modeled; the reference renderer does not apply them.
- **Remotion shader transitions** require Chrome ≥ 148 with HTML-in-Canvas; off by default.
- **Media probing**: `asset.durationInSeconds` must be provided at ingest (e.g. with Remotion's `parseMedia`); it is not detected by the engine.
- **Caption alignment**: without word timings from a transcription / alignment step, word timings are estimates.
- **Music ducking without narration segments** follows the whole narration file: with one continuous voice-over (a v1 plan) the music stays ducked for the entire episode. With segments (every plan from the brain), it follows the sentences (MUS-06).
- **One music track per episode**: changing the track at chapters (MUS-07) and loop points on the bar are not handled; a looped file restarts from its beginning, audibly unless it was cut to loop.
- **QC blind spots**:
  - a missing image under captions is not a black frame (the captions are bright), so it is not detected;
  - the frozen-picture check compares frames one second apart at 96×54, so a very slow move on a flat image can pass for frozen;
  - the thresholds (−45 / −60 dBFS, 3.5 % / 10 % luma) are tuned on the demo, not on a real episode.
- **Render**:
  - Remotion copies the `--public` folder into its bundle on every render, so large media are better served over http (as §5.2 of the handoff says);
  - an asset's fingerprint is size + modification time: touching a file without changing it costs a re-render, not a stale chunk;
  - a video layer with its own sound falls back to Remotion's audio, which is not cached and has the loop defect described in §24;
  - the FFmpeg draft ignores `motionSkill`, charts and maps.
- **The AI critic has not been run against the real API here** (no key in this environment): only its contract is tested, with recorded answers.
- **Loudness is measured on the render**, not in the preview. A mono music file comes out about 3 dB lower in Remotion's stereo mix; the loudness pass absorbs it, but the levels of `MUSIC_STATE_LEVELS` are relative, not absolute dBFS.
- **Shot split** (cut a shot in two at the playhead) is not implemented: it needs a media in-point on shots (`Shot` has no trim field yet).
- Not in scope by design: the AI model itself.
