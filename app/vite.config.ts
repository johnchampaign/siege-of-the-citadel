import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionStamp } from 'digital-boardgame-framework/vite';

export default defineConfig({
  // versionStamp injects __DBF_BUILD_ID__ and emits version.json into the build,
  // which the UpdateBanner polls to prompt a reload after a new deploy.
  plugins: [react(), versionStamp() as any],
  server: { strictPort: false, port: process.env.PORT ? Number(process.env.PORT) : undefined },
});
