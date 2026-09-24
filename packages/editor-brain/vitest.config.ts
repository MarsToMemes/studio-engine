import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Consume the engine from source: no rebuild needed between engine and brain changes.
  resolve: { alias: { '@studio-engine/scene-engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
