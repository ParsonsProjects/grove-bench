import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { PublisherGithub } from '@electron-forge/publisher-github';

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
export default {
  packagerConfig: {
    asar: true,
    icon: 'src/main/icon',
    extraResource: [
      'src/main/docker/worker.mjs',
      'src/main/docker/Dockerfile',
    ],
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['win32']),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'ParsonsProjects', name: 'grove-bench' },
      prerelease: false,
      draft: true,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          entry: 'src/main/preload.ts',
          config: 'vite.preload.config.mjs',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs',
        },
      ],
    }),
  ],
  hooks: {
    postMake: async (forgeConfig, makeResults) => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const crypto = await import('node:crypto');

      for (const result of makeResults) {
        if (result.platform === 'win32') {
          for (const artifact of result.artifacts) {
            if (artifact.endsWith('.exe') && path.basename(artifact).includes('Setup')) {
              const stat = await fs.stat(artifact);
              const fileBuffer = await fs.readFile(artifact);
              const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
              const fileName = path.basename(artifact);
              const version = result.packageJSON.version;

              const latestYml = [
                `version: ${version}`,
                `files:`,
                `  - url: ${fileName}`,
                `    sha512: ${sha512}`,
                `    size: ${stat.size}`,
                `path: ${fileName}`,
                `sha512: ${sha512}`,
                `releaseDate: '${new Date().toISOString()}'`,
              ].join('\n');

              const ymlPath = path.join(path.dirname(artifact), 'latest.yml');
              await fs.writeFile(ymlPath, latestYml);
              result.artifacts.push(ymlPath);
            }
          }
        }
      }
      return makeResults;
    },
  },
};
