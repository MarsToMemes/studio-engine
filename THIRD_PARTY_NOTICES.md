# Third-party notices

## HyperFrames (HeyGen), Apache License 2.0

- Source: https://github.com/heygen-com/hyperframes, commit `8798e40`.
- `.claude/skills/hyperframes-animation/` and `.claude/skills/hyperframes-keyframes/` are unmodified copies of the project's agent skills, each with the project's `LICENSE`.
- `packages/engine/src/skills/hyperframes.ts` adapts eight of its motion rules (counting-dynamic-scale, asr-keyword-glow, 3d-text-depth-layers, depth-of-field-blur, depth-scatter-assemble, kinetic-beat-slam, ambient-glow-bloom, multi-phase-camera) as independent, frame-based implementations. They use no HyperFrames or GSAP code.
- GSAP, used by HyperFrames' own recipes, is **not** a dependency of studio-engine. Its licence is not OSI-approved and has its own terms.

## Fonts

Inter and Source Serif 4 are bundled through `@fontsource`, under the SIL Open Font License 1.1.
