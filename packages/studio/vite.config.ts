import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Media used by plans (same folder the Remotion renderer serves).
  publicDir: here('../remotion/public'),
  resolve: {
    // Consume the engine from source: edits show up without rebuilding dist/.
    alias: { '@studio-engine/scene-engine': here('../engine/src/index.ts') },
  },
  server: { fs: { allow: [here('../..')] } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
