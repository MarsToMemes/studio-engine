/**
 * Scene type registry. A scene type is a contract (which layers make sense,
 * typical duration, narrative role) — it never contains rendering code.
 * Register new types at runtime; the model's `SceneType` union is open.
 */
import type { LayerType } from '../model/layer.js';
import type { Scene, SceneRole } from '../model/scene.js';

export interface SceneTypeDefinition {
  type: string;
  label: string;
  /** Written for humans AND for AI agents choosing a scene type. */
  description: string;
  defaultDurationInSeconds: number;
  minDurationInSeconds?: number;
  maxDurationInSeconds?: number;
  defaultRole?: SceneRole;
  /** Layer types allowed in the scene. `'any'` disables the check. */
  allowedLayerTypes: readonly LayerType[] | 'any';
  /** Structural requirement. Returns an error message when the scene does not satisfy the type. */
  check?: (scene: Scene) => string | undefined;
}

const VISUAL: readonly LayerType[] = ['background', 'video', 'image', 'text', 'caption', 'shape', 'lottie', 'graphic', 'overlay'];

const hasLayer = (scene: Scene, ...types: LayerType[]) => scene.layers.some((l) => types.includes(l.type));
const hasBackground = (scene: Scene, ...types: Array<Scene['background']['type']>) =>
  types.includes(scene.background.type) || scene.layers.some((l) => l.type === 'background' && types.includes(l.background.type));

const need = (ok: boolean, message: string) => (ok ? undefined : message);

export const BUILT_IN_SCENE_TYPES: readonly SceneTypeDefinition[] = [
  {
    type: 'video',
    label: 'Video',
    description: 'Full-frame video clip, optionally with text or captions on top.',
    defaultDurationInSeconds: 5,
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'video') || hasBackground(s, 'video'), 'a video scene needs a video layer or a video background'),
  },
  {
    type: 'image',
    label: 'Image',
    description: 'Still image, usually animated with a camera move (Ken Burns).',
    defaultDurationInSeconds: 4,
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'image') || hasBackground(s, 'image'), 'an image scene needs an image layer or an image background'),
  },
  {
    type: 'title',
    label: 'Title',
    description: 'Large headline, used for hooks, chapter titles and openers.',
    defaultDurationInSeconds: 3,
    defaultRole: 'hook',
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'text'), 'a title scene needs a text layer'),
  },
  {
    type: 'text',
    label: 'Text',
    description: 'Short sentence or bullet points on a simple background, often with kinetic typography.',
    defaultDurationInSeconds: 4,
    defaultRole: 'explanation',
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'text'), 'a text scene needs a text layer'),
  },
  {
    type: 'broll',
    label: 'B-roll',
    description: 'Illustrative footage or images under the narration, no on-screen speaker.',
    defaultDurationInSeconds: 4,
    defaultRole: 'explanation',
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'video', 'image') || hasBackground(s, 'video', 'image'), 'a b-roll scene needs video or image media'),
  },
  {
    type: 'talking_head',
    label: 'Talking head',
    description: 'On-camera speaker, usually with captions and lower third.',
    defaultDurationInSeconds: 6,
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'video') || hasBackground(s, 'video'), 'a talking head scene needs a video of the speaker'),
  },
  {
    type: 'quote',
    label: 'Quote',
    description: 'A quotation with attribution.',
    defaultDurationInSeconds: 5,
    defaultRole: 'evidence',
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'text'), 'a quote scene needs a text layer'),
  },
  {
    type: 'statistic',
    label: 'Statistic',
    description: 'One striking number (animated counter) with a short label.',
    defaultDurationInSeconds: 4,
    defaultRole: 'statistic',
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'text', 'graphic'), 'a statistic scene needs a text or graphic layer'),
  },
  {
    type: 'chart',
    label: 'Chart',
    description: 'Animated data visualisation (bar, line, pie).',
    defaultDurationInSeconds: 5,
    defaultRole: 'evidence',
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'graphic'), 'a chart scene needs a graphic layer'),
  },
  {
    type: 'screenshot',
    label: 'Screenshot',
    description: 'Screenshot of a website, article or tweet with highlight and zoom.',
    defaultDurationInSeconds: 4,
    defaultRole: 'evidence',
    allowedLayerTypes: VISUAL,
    check: (s) => need(hasLayer(s, 'image'), 'a screenshot scene needs an image layer'),
  },
  {
    type: 'montage',
    label: 'Montage',
    description: 'Fast sequence or grid of several clips / images.',
    defaultDurationInSeconds: 5,
    allowedLayerTypes: VISUAL,
    check: (s) => need(s.layers.filter((l) => l.type === 'video' || l.type === 'image').length >= 2, 'a montage scene needs at least 2 video or image layers'),
  },
  {
    type: 'endcard',
    label: 'End card',
    description: 'Closing screen: call to action, subscribe, next video.',
    defaultDurationInSeconds: 5,
    defaultRole: 'cta',
    allowedLayerTypes: VISUAL,
  },
  {
    type: 'custom',
    label: 'Custom',
    description: 'Free-form scene without structural constraints.',
    defaultDurationInSeconds: 4,
    allowedLayerTypes: 'any',
  },
];

export class SceneTypeRegistry {
  private readonly defs = new Map<string, SceneTypeDefinition>();

  constructor(definitions: readonly SceneTypeDefinition[] = BUILT_IN_SCENE_TYPES) {
    for (const d of definitions) this.defs.set(d.type, d);
  }

  register(definition: SceneTypeDefinition): this {
    this.defs.set(definition.type, definition);
    return this;
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  get(type: string): SceneTypeDefinition | undefined {
    return this.defs.get(type);
  }

  list(): SceneTypeDefinition[] {
    return [...this.defs.values()];
  }
}

export const defaultSceneTypeRegistry = new SceneTypeRegistry();
