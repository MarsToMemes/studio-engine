/**
 * Realistic 10-scene documentary built through the public API, the way a
 * manual editor would: "Why McDonald's is really a real-estate company".
 *
 * Narration: one 48 s file sliced per scene. Each scene lasts its narrative
 * window plus its outgoing transition overlap, so the narration stays
 * continuous and the video lasts exactly the narration length.
 */
import {
  AssetLibrary,
  createLayer,
  createProject,
  createScene,
  defaultPresetRegistry,
  defaultTransitionRegistry,
  sequentialIds,
  type CaptionTrack,
  type Layer,
  type Scene,
  type Transition,
  type VideoProject,
} from '../../src/index.js';

export const FPS = 30;
/** Narrative window of each scene, in frames. Sum = 1440 (48 s). */
export const NARRATIVE = [120, 150, 120, 150, 150, 180, 120, 150, 150, 150] as const;
export const NARRATION_FRAMES = NARRATIVE.reduce((a, b) => a + b, 0);

const SCRIPT = [
  "McDonald's doesn't actually make most of its money from burgers.",
  'Behind every counter there is a much bigger business, hidden in plain sight.',
  'Over ninety-five percent of its restaurants are run by franchisees.',
  'In 1956, Harry Sonneborn changed the company forever.',
  'We are not technically in the food business. We are in the real estate business.',
  'Rent and royalties now bring in the majority of its revenue.',
  'Analysts have been saying it for years.',
  'Land, buildings, leases: the empire grows one corner at a time.',
  'Every new location is first and foremost a property deal.',
  'So next time you order fries, remember who your landlord is.',
];

function cues(ids: (p: string) => string, text: string, length: number): CaptionTrack {
  const words = text.split(' ');
  const half = Math.ceil(words.length / 2);
  const mid = Math.round(length / 2);
  const mk = (ws: string[], start: number, end: number) => {
    const step = (end - start) / ws.length;
    return {
      id: ids('cue'),
      text: ws.join(' '),
      startFrame: start,
      endFrame: end,
      words: ws.map((w, i) => ({ text: w, startFrame: Math.round(start + i * step), endFrame: Math.round(start + (i + 1) * step) })),
    };
  };
  return { id: ids('captions'), language: 'en', cues: [mk(words.slice(0, half), 0, mid), mk(words.slice(half), mid, length)] };
}

export function buildDocumentaryProject(): VideoProject {
  const ids = sequentialIds('doc');
  const lib = new AssetLibrary({}, ids);
  const project = createProject({ id: 'doc-mcdonalds', name: 'McDonalds Real Estate', fps: FPS, aspectRatio: '16:9', ids });
  const fx = { fps: FPS, canvas: project.dimensions };
  const presets = defaultPresetRegistry;
  const tr = (type: string, durationInFrames: number, extra: Partial<Transition> = {}) => defaultTransitionRegistry.create(type, FPS, { durationInFrames, ...extra });

  const a = {
    narration: lib.add({ kind: 'audio', src: 'audio/narration.mp3', durationInSeconds: 48 }),
    music: lib.add({ kind: 'audio', src: 'audio/music-bed.mp3', durationInSeconds: 120 }),
    restaurant: lib.add({ kind: 'video', src: 'footage/restaurant-exterior.mp4', durationInSeconds: 12, width: 1920, height: 1080, fps: 30 }),
    kitchen: lib.add({ kind: 'video', src: 'footage/kitchen.mp4', durationInSeconds: 20, width: 1920, height: 1080, fps: 30 }),
    realEstate: lib.add({ kind: 'video', src: 'footage/real-estate-aerial.mp4', durationInSeconds: 15, width: 3840, height: 2160, fps: 30 }),
    city: lib.add({ kind: 'video', src: 'footage/city-night.mp4', durationInSeconds: 10, width: 1920, height: 1080, fps: 30 }),
    portrait: lib.add({ kind: 'image', src: 'images/sonneborn.jpg', width: 2400, height: 1600 }),
    screenshot: lib.add({ kind: 'image', src: 'images/article-screenshot.png', width: 1600, height: 1200 }),
    counter: lib.add({ kind: 'image', src: 'images/counter.jpg', width: 1920, height: 1080 }),
    map: lib.add({ kind: 'image', src: 'images/franchise-map.png', width: 1920, height: 1080 }),
    pin: lib.add({ kind: 'lottie', src: 'lottie/map-pin.json', fps: 60 }),
    logo: lib.add({ kind: 'dotlottie', src: 'lottie/channel-logo.lottie', fps: 30 }),
  };
  // Adding the same media twice must not duplicate it.
  lib.add({ kind: 'video', src: 'footage/kitchen.mp4' });

  // Transitions INTO scenes 1..9 (scene 0 has an edge fade-in from black).
  const into: Array<Transition | undefined> = [
    undefined,
    presets.apply('transition', 'whip-fast', fx),
    presets.apply('transition', 'flash-cut', fx),
    tr('crossfade', 15),
    presets.apply('transition', 'dip-to-black', fx),
    tr('push', 15, { direction: 'left' }),
    presets.apply('transition', 'zoom-blur-punch', fx),
    presets.apply('transition', 'glitch-hit', fx),
    tr('wipe', 15, { direction: 'right' }),
    tr('iris', 20),
  ];
  const overlap = (i: number) => (into[i + 1] && into[i + 1]!.type !== 'cut' ? into[i + 1]!.durationInFrames : 0);

  const text = (value: string, preset: string, effect: string, box: Layer['position'], zIndex = 40, extra: { startFrame?: number } = {}) => {
    const t = presets.applyToLayer(effect, fx);
    return createLayer('text', { text: value, style: presets.apply('typography', preset, fx), position: box, zIndex, animations: t.animations, effects: t.effects, ...extra }, { ids });
  };
  const captionLayer = (track: CaptionTrack) =>
    createLayer('caption', { trackId: track.id, style: presets.apply('caption', 'caption-bold-pop', fx), zIndex: 60, position: { anchor: 'bottom-center', x: 0, y: -7, width: 90, height: 18, units: 'percent' } }, { ids });

  const scenes: Scene[] = NARRATIVE.map((length, i) => {
    const durationInFrames = length + overlap(i);
    const captions = cues(ids, SCRIPT[i]!, length);
    const offset = NARRATIVE.slice(0, i).reduce((x, y) => x + y, 0);
    const base = {
      durationInFrames,
      captions,
      voiceover: { id: ids('vo'), assetId: a.narration, startFrame: 0, durationInFrames: length, trim: { startFrom: offset, endAt: offset + length }, text: SCRIPT[i]!, captionTrackId: captions.id },
      ...(into[i] ? { transitionIn: into[i] } : {}),
    };
    const broll = (assetId: string, preset = 'broll-cinematic') => {
      const t = presets.apply('brollTreatment', preset, { ...fx });
      return createLayer('video', { assetId, fit: 'cover', muted: true, zIndex: 10, animations: t.animations, effects: t.effects }, { ids });
    };

    switch (i) {
      case 0:
        return createScene('title', {
          ...base,
          metadata: { role: 'hook', source: 'manual' },
          transitionIn: tr('crossfade', 15),
          background: { type: 'video', assetId: a.restaurant, fit: 'cover', dim: 0.3 },
          animations: presets.apply('camera', { presetId: 'cinematic-zoom', durationInFrames: 45, parameters: { intensity: 0.35, easing: 'easeInOut' } }, fx),
          layers: [
            createLayer('overlay', { kind: 'vignette', intensity: 0.6, zIndex: 20 }, { ids }),
            text("McDonald's isn't a burger company", 'headline-impact', 'kinetic-slam-words', { anchor: 'center', x: 0, y: -4, width: 86, height: 34, units: 'percent' }),
            captionLayer(captions),
          ],
        }, { fps: FPS, ids });
      case 1:
        return createScene('broll', {
          ...base,
          layers: [broll(a.kitchen), text('Behind the counter', 'lower-third', 'kinetic-rise-words', { anchor: 'bottom-left', x: 5, y: -14, width: 60, height: 10, units: 'percent' }), captionLayer(captions)],
        }, { fps: FPS, ids });
      case 2:
        return createScene('statistic', {
          ...base,
          background: { type: 'image', assetId: a.counter, fit: 'cover', blur: 20, dim: 0.6 },
          animations: presets.apply('camera', 'impact-shake', fx).map((x) => ({ ...x, startFrame: 36 })),
          layers: [
            createLayer('graphic', {
              kind: 'counter',
              data: { from: 0, to: 95, suffix: '%', decimals: 0, countDurationInFrames: 36 },
              style: { fontSize: 220, fontWeight: 900, color: '#ffd400' },
              zIndex: 30,
              position: { anchor: 'center', x: 0, y: -6, width: 90, height: 30, units: 'percent' },
              animations: presets.apply('animation', 'pop-in', fx),
            }, { ids }),
            text('of restaurants are franchised', 'documentary-serif', 'kinetic-rise-words', { anchor: 'center', x: 0, y: 16, width: 80, height: 10, units: 'percent' }, 40, { startFrame: 12 }),
            captionLayer(captions),
          ],
        }, { fps: FPS, ids });
      case 3: {
        const t = presets.apply('imageTreatment', { presetId: 'image-ken-burns', parameters: { focusX: 0.4, focusY: 0.35 } }, fx);
        return createScene('image', {
          ...base,
          layers: [
            createLayer('image', { assetId: a.portrait, fit: 'cover', zIndex: 10, animations: t.animations, effects: [{ type: 'grayscale', amount: 1 }, { type: 'contrast', amount: 1.1 }] }, { ids }),
            createLayer('overlay', { kind: 'grain', intensity: 0.2, zIndex: 20, blendMode: 'overlay' }, { ids }),
            text('Harry Sonneborn, 1956', 'lower-third', 'fade-in', { anchor: 'bottom-left', x: 5, y: -14, width: 40, height: 10, units: 'percent' }),
            captionLayer(captions),
          ],
        }, { fps: FPS, ids });
      }
      case 4:
        return createScene('quote', {
          ...base,
          background: { type: 'color', color: '#111111' },
          layers: [
            createLayer('shape', { shape: 'rect', fill: '#ffd400', zIndex: 5, position: { anchor: 'center-left', x: 8, y: 0, width: 0.6, height: 30, units: 'percent' }, animations: [{ type: 'scale', phase: 'in', from: 0, to: 1, durationInFrames: 12 }] }, { ids }),
            text('“We are not technically in the food business. We are in the real estate business.”', 'documentary-serif', 'kinetic-rise-words', { anchor: 'center', x: 2, y: -4, width: 76, height: 40, units: 'percent' }),
            text('— Harry J. Sonneborn', 'documentary-serif', 'fade-in', { anchor: 'center', x: 0, y: 22, width: 60, height: 8, units: 'percent' }, 40, { startFrame: 45 }),
          ],
        }, { fps: FPS, ids });
      case 5:
        return createScene('chart', {
          ...base,
          background: { type: 'gradient', gradient: { kind: 'linear', angle: 160, stops: [{ color: '#101820', offset: 0 }, { color: '#1e2a38', offset: 1 }] } },
          layers: [
            createLayer('graphic', {
              kind: 'barChart',
              data: { labels: ['Company-operated', 'Franchised'], values: [8.3, 15.4], unit: 'B$' },
              zIndex: 30,
              position: { anchor: 'center', x: 0, y: 6, width: 80, height: 64, units: 'percent' },
              animations: [{ type: 'stagger', each: 8, animation: { type: 'scale', phase: 'in', from: 0, to: 1, durationInFrames: 20, easing: 'easeOutBack' } }],
            }, { ids }),
            text('Revenue by source, 2023', 'headline-impact', 'fade-in', { anchor: 'top-center', x: 0, y: 8, width: 86, height: 12, units: 'percent' }),
            captionLayer(captions),
          ],
        }, { fps: FPS, ids });
      case 6: {
        const t = presets.apply('imageTreatment', 'screenshot-focus', fx);
        return createScene('screenshot', {
          ...base,
          background: { type: 'color', color: '#e9e9e9' },
          layers: [
            createLayer('image', { assetId: a.screenshot, fit: 'contain', zIndex: 10, position: { anchor: 'center', x: 0, y: 0, width: 80, height: 80, units: 'percent' }, animations: t.animations, effects: t.effects, crop: { top: 0, right: 0, bottom: 10, left: 0, units: 'percent' } }, { ids }),
            createLayer('shape', { shape: 'rect', stroke: { color: '#ff3b30', width: 6 }, cornerRadius: 12, zIndex: 20, position: { anchor: 'center', x: 0, y: -8, width: 50, height: 12, units: 'percent' }, animations: [{ type: 'maskReveal', shape: 'rect', direction: 'right', startFrame: 40, durationInFrames: 15 }] }, { ids }),
            captionLayer(captions),
          ],
        }, { fps: FPS, ids });
      }
      case 7: {
        const slice = Math.floor(durationInFrames / 3);
        const media = [a.realEstate, a.city, a.map];
        return createScene('montage', {
          ...base,
          layers: [
            ...media.map((assetId, k) => {
              const common = { assetId, fit: 'cover' as const, zIndex: 10 + k, startFrame: k * slice, durationInFrames: k === 2 ? durationInFrames - 2 * slice : slice, animations: presets.apply('camera', 'slow-pan', { ...fx }) };
              return k === 2 ? createLayer('image', common, { ids }) : createLayer('video', { ...common, muted: true, playbackRate: 1.25 }, { ids });
            }),
            captionLayer(captions),
          ],
        }, { fps: FPS, ids });
      }
      case 8:
        return createScene('broll', {
          ...base,
          layers: [
            broll(a.realEstate, 'broll-documentary-muted'),
            createLayer('lottie', { source: { kind: 'asset', assetId: a.pin }, loop: false, playbackRate: 1, lottieStartFrame: 0, lottieEndFrame: 90, fit: 'contain', zIndex: 30, startFrame: 20, durationInFrames: 90, position: { anchor: 'center', x: 10, y: -10, width: 12, height: 20, units: 'percent' }, overrides: { colors: [{ keypath: 'Pin.Fill 1', color: '#ffd400' }] } }, { ids }),
            text('Every location = a property deal', 'lower-third', 'kinetic-rise-words', { anchor: 'bottom-left', x: 5, y: -14, width: 60, height: 10, units: 'percent' }),
            captionLayer(captions),
          ],
        }, { fps: FPS, ids });
      default:
        return createScene('endcard', {
          ...base,
          metadata: { role: 'cta', source: 'manual' },
          background: { type: 'color', color: '#0b0b0f' },
          transitionOut: tr('fade', 20),
          layers: [
            createLayer('lottie', { source: { kind: 'asset', assetId: a.logo }, loop: true, fit: 'contain', zIndex: 30, position: { anchor: 'center', x: 0, y: -12, width: 20, height: 20, units: 'percent' } }, { ids }),
            text('Who is your landlord?', 'headline-impact', 'kinetic-pop-words', { anchor: 'center', x: 0, y: 10, width: 86, height: 20, units: 'percent' }),
            createLayer('shape', { shape: 'rect', fill: '#ff0033', cornerRadius: 8, zIndex: 35, position: { anchor: 'bottom-center', x: 0, y: -12, width: 22, height: 8, units: 'percent' }, animations: presets.apply('animation', 'pop-in', fx).map((x) => ({ ...x, startFrame: 30 })) }, { ids }),
            text('SUBSCRIBE', 'lower-third', 'fade-in', { anchor: 'bottom-center', x: 0, y: -12, width: 22, height: 8, units: 'percent' }, 36, { startFrame: 36 }),
          ],
        }, { fps: FPS, ids });
    }
  });

  project.scenes = scenes;
  project.assets = lib.toRegistry();
  project.audio = [{ id: 'music', assetId: a.music, role: 'music', volume: 0.4, loop: true, fadeInFrames: 15, fadeOutFrames: 45, ducking: { amount: 0.3, attackFrames: 6, releaseFrames: 12 } }];
  return project;
}
