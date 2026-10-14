'use strict';
// Inject a deterministic slow image source into the child-process server so
// circulation/book writes can happen while a manual cover request is awaiting.
const fs = require('node:fs');
const path = require('node:path');
const file = require.resolve('../lib/cover-assets');
const original = require(file);
const gateDir = process.env.BOEKENBAAI_COVER_RACE_DIR;
if (!gateDir) throw Error('Cover race test gate directory missing');
require.cache[file].exports = {
  ...original,
  createCoverAssetStore(options) {
    const store = original.createCoverAssetStore(options);
    return {
      ...store,
      async saveSource(source) {
        if (source.includes('/slow-')) {
          fs.writeFileSync(path.join(gateDir, 'started'), source);
          const release = path.join(gateDir, 'release');
          let released = false;
          for (let index = 0; index < 250; index += 1) {
            if (fs.existsSync(release)) { released = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (!released) throw Error('Cover test gate timed out');
        }
        return '/api/covers/' + 'a'.repeat(64) + '.png';
      },
      hasAsset(localUrl) {
        return /^\/api\/covers\/[a-f0-9]{64}\.png$/.test(localUrl || '');
      },
    };
  },
};
