# Third-party notices

## HyperFrames (HeyGen), Apache License 2.0

- Source: https://github.com/heygen-com/hyperframes, commit `8798e40`.
- `.claude/skills/hyperframes-animation/` and `.claude/skills/hyperframes-keyframes/` are unmodified copies of the project's agent skills, each with the project's `LICENSE`.
- `packages/engine/src/skills/hyperframes.ts` adapts eight of its motion rules (counting-dynamic-scale, asr-keyword-glow, 3d-text-depth-layers, depth-of-field-blur, depth-scatter-assemble, kinetic-beat-slam, ambient-glow-bloom, multi-phase-camera) as independent, frame-based implementations. They use no HyperFrames or GSAP code.
- **Catalog** (`SCENE_ENGINE.md` §28): `packages/remotion/scripts/hyperframes-sync.mjs` copies the registry (`registry/blocks`, `registry/components`) into `packages/remotion/public/hyperframes/` (not committed). It rewrites CDN and Google Fonts URLs to local copies and injects the runtime. `packages/engine/hyperframes-catalog.json` (committed) is metadata derived from the registry's `registry-item.json` files. `scripts/hyperframes/hf-bridge.js` reproduces the page bridge of HyperFrames' producer (`packages/producer/src/services/fileServer.ts`).
- Runtime: `@hyperframes/core@0.8.78` (`dist/hyperframe.runtime.iife.js`), Apache-2.0, fetched from npm by the sync.
- 25 items embed media (images, 3D models, HDR, audio), listed in `embeddedMedia`. The catalog is Apache-2.0, but whether these media come with rights clear for publication is not documented: verify before publishing (QC warning SRC-01).
- The carousels reference album covers of real artists that the registry does not ship (`missingFiles`). They are copyrighted and are **not** fetched.

- **Studio blocks** (`packages/remotion/hyperframes-studio/`) are original code of this project in the HyperFrames format. They load GSAP (fetched, as above). They use Inter (`@fontsource-variable/inter`) and Source Serif 4 (`@fontsource/source-serif-4`), both under SIL OFL 1.1. `studio-map/dots.js` is derived from world-atlas `land-110m` (ISC; Natural Earth, public domain).

## Libraries fetched by the HyperFrames sync (not committed, loaded inside the item pages)

| Package | Licence |
|---|---|
| gsap 3.14.2, 3.15.0 | GSAP Standard "no charge" licence (https://gsap.com/standard-license), **not OSI**: free including commercial use, except in tools that compete with Webflow's visual builder |
| three 0.128.0, 0.147.0, 0.170.0, 0.181.2, 0.184.0 | MIT |
| d3 7.9.0, d3-delaunay 6.0.4, topojson-client 3.1.0, us-atlas 3.0.1, world-atlas 2.0.2 | ISC |
| es-atlas 0.6.0, lottie-web 5.12.2 | MIT |
| clipper-lib 6.4.2 | Boost Software License 1.0 |
| 22 font families through @fontsource (Inter, Space Mono, Lato, JetBrains Mono, Bebas Neue, Montserrat, DM Sans, Space Grotesk, Poppins, Outfit, Anton, Playfair Display, Instrument Serif, Geist, Gabarito, Figtree, Roboto Flex, Libre Franklin, Libre Baskerville, Gelasio, Big Shoulders Display, Source Serif 4) | SIL Open Font License 1.1 |

## Fonts

Inter and Source Serif 4 are bundled through `@fontsource`, under the SIL Open Font License 1.1.
