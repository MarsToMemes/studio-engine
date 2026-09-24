/**
 * Shot camera (ShotPlan `camera` and `framing`), separate from the motion
 * skill: the camera moves the media, the skill animates the content.
 *
 * A skill that already moves the camera (`controlsCamera`: image, document and
 * map skills, chapter cards…) wins, and the shot camera is ignored (bible
 * CAM-02: one camera move per shot).
 */
import type { Animation } from '../model/animation.js';
import type { ComposedShot, ShotEvent, ShotSkillContext } from '../shotplan/compile.js';
import type { Framing, ShotCameraMove } from '../shotplan/vocabulary.js';
import { addAnimations, byIntensity } from './helpers.js';
import type { MotionSkillRegistry } from './registry.js';

type Implementation =
  | { kind: 'none' }
  | { kind: 'camera'; move: 'pushIn' | 'pullOut' | 'panLeft' | 'panRight' | 'tiltUp' | 'tiltDown'; approximation?: string }
  | { kind: 'skill'; skill: string };

export interface ShotCameraMoveInfo {
  id: ShotCameraMove;
  description: string;
  implementation: Implementation;
}

export const SHOT_CAMERA_MOVE_INFO: Record<ShotCameraMove, ShotCameraMoveInfo> = {
  static: { id: 'static', description: 'No movement: let the viewer read.', implementation: { kind: 'none' } },
  push_in: { id: 'push_in', description: 'Slow push towards the focus (5–10 %).', implementation: { kind: 'camera', move: 'pushIn' } },
  pull_out: { id: 'pull_out', description: 'Slow pull back revealing the context.', implementation: { kind: 'camera', move: 'pullOut' } },
  pan_left: { id: 'pan_left', description: 'Lateral move to the left.', implementation: { kind: 'camera', move: 'panLeft' } },
  pan_right: { id: 'pan_right', description: 'Lateral move to the right.', implementation: { kind: 'camera', move: 'panRight' } },
  tilt_up: { id: 'tilt_up', description: 'Vertical move upwards (document, building).', implementation: { kind: 'camera', move: 'tiltUp' } },
  tilt_down: { id: 'tilt_down', description: 'Vertical move downwards.', implementation: { kind: 'camera', move: 'tiltDown' } },
  tracking: { id: 'tracking', description: 'Follows a subject. On a still image: a lateral move.', implementation: { kind: 'camera', move: 'panRight', approximation: 'rendered as pan_right on a still image' } },
  parallax: { id: 'parallax', description: 'Depth effect on a photo.', implementation: { kind: 'skill', skill: 'parallax' } },
  punch_in: { id: 'punch_in', description: 'Fast accent 100 → 112 → 100 % on the key word.', implementation: { kind: 'skill', skill: 'punch_in' } },
  punch_out: { id: 'punch_out', description: 'Fast pull back to normal.', implementation: { kind: 'skill', skill: 'punch_out' } },
  shake: { id: 'shake', description: 'Short impact shake (≤ 0.5 s), conflict only.', implementation: { kind: 'skill', skill: 'camera_shake' } },
};

/** Scale of a framing on the media (1 = the whole media). */
export const FRAMING_SCALE: Record<Framing, number | undefined> = {
  wide: 1,
  medium: 1.15,
  close_up: 1.4,
  extreme_close_up: 1.8,
  overhead: undefined,
  pov: undefined,
};

export interface ShotCameraResult {
  /** Camera move actually applied. */
  applied?: ShotCameraMove;
  note?: string;
  events?: ShotEvent[];
}

const focusOf = (target: ComposedShot) => (target.shot.focus ? { x: target.shot.focus.x / 100, y: target.shot.focus.y / 100 } : undefined);

/** Crops the media to the shot's framing around its focus. */
export function applyFraming(target: ComposedShot): string | undefined {
  const framing = target.shot.framing;
  const scale = framing ? FRAMING_SCALE[framing] : undefined;
  if (!framing || scale === undefined || scale === 1) return undefined;
  const media = target.roles.media ?? target.roles.document;
  if (!media) return `framing "${framing}" ignored: the shot has no image or video to crop`;
  media.scale = scale;
  const focus = focusOf(target);
  if (focus) media.transform = { ...media.transform, origin: focus };
  return undefined;
}

/**
 * Applies `shot.camera`. `skillControlsCamera`: the applied motion skill
 * already moves the camera, so the shot camera is ignored.
 */
export type CameraSkillSource = Pick<MotionSkillRegistry, 'resolve' | 'resolveParams'>;

export function applyShotCamera(target: ComposedShot, ctx: ShotSkillContext, registry: CameraSkillSource | undefined, skillControlsCamera: string | undefined): ShotCameraResult {
  const move = target.shot.camera;
  if (!move || move === 'static') return move ? { applied: 'static' } : {};
  const info = SHOT_CAMERA_MOVE_INFO[move];
  if (!info) return { note: `unknown camera move "${String(move)}", shot left static` };
  if (skillControlsCamera) return { note: `[CAM-02] camera "${move}" ignored: skill "${skillControlsCamera}" already moves the camera` };
  const intensity = target.shot.intensity ?? 'subtle';
  const impl = info.implementation;
  if (impl.kind === 'none') return { applied: move };
  if (impl.kind === 'camera') {
    const focus = focusOf(target);
    const animation: Animation = {
      type: 'camera',
      move: impl.move,
      // 0.12 × intensity in the native provider: 5 %, 7.5 %, 10 % (bible CAM-03).
      intensity: byIntensity(intensity, 0.42, 0.62, 0.83),
      ...(focus ? { focus } : {}),
      durationInFrames: target.shot.durationInFrames,
      easing: 'easeInOut',
    };
    const media = target.roles.media ?? target.roles.document ?? target.roles.map;
    if (media) addAnimations(media, animation);
    else target.scene.animations = [...target.scene.animations, animation];
    return { applied: move, ...(impl.approximation ? { note: `camera "${move}" ${impl.approximation}` } : {}) };
  }
  if (!registry) return { note: `camera "${move}" needs the motion skill registry; shot left static` };
  const { skill, reason } = registry.resolve(impl.skill, target);
  if (!skill) return { note: `camera "${move}" unavailable (${reason ?? 'no implementation'}); shot left static` };
  const result = skill.apply(target, { ...ctx, intensity, params: registry.resolveParams(skill.id), durationInFrames: target.shot.durationInFrames }) ?? {};
  return { applied: move, ...(skill.id !== impl.skill ? { note: `camera "${move}" fell back to "${skill.id}"` } : {}), ...(result.events?.length ? { events: result.events } : {}) };
}
