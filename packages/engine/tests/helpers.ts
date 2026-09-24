import { createLayer, createProject, createScene, sequentialIds, type Scene, type Transition, type VideoProject } from '../src/index.js';

/** Minimal valid project: `durations.length` custom scenes with one shape layer each. */
export function simpleProject(durations: number[], transitions: Array<Transition | undefined> = []): VideoProject {
  const ids = sequentialIds();
  const project = createProject({ id: 'p', fps: 30, ids });
  project.scenes = durations.map(
    (d, i): Scene =>
      createScene(
        'custom',
        {
          id: `s${i}`,
          durationInFrames: d,
          layers: [createLayer('shape', { id: 'shape', shape: 'rect', fill: '#fff' }, { ids })],
          ...(transitions[i] ? { transitionIn: transitions[i] } : {}),
        },
        { ids },
      ),
  );
  return project;
}

export const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
