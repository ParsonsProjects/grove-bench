/**
 * Patches @electron/node-gyp to support Visual Studio 2025 (v18)
 * and disables Spectre mitigation requirement.
 * Also patches node-pty's winpty.gyp to avoid GetCommitHash.bat CWD issues.
 *
 * Run before electron-rebuild.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function patchFile(relPath, patches) {
  const filePath = path.join(ROOT, 'node_modules', relPath);
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP (not found): ${relPath}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [search, replace] of patches) {
    if (content.includes(search) && !content.includes(replace)) {
      content = content.replace(search, replace);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log(`  PATCHED: ${relPath}`);
  } else {
    console.log(`  OK (already patched or N/A): ${relPath}`);
  }
}

console.log('Applying node-pty build patches...');

// 1. Patch find-visualstudio.js to support VS 2025 (versionMajor 18)
patchFile('@electron/node-gyp/lib/find-visualstudio.js', [
  [
    `return this.findNewVS([2019, 2022])`,
    `return this.findNewVS([2019, 2022, 2025])`,
  ],
  [
    `    if (ret.versionMajor === 17) {\n      ret.versionYear = 2022\n      return ret\n    }\n    this.log.silly('- unsupported version:', ret.versionMajor)`,
    `    if (ret.versionMajor === 17) {\n      ret.versionYear = 2022\n      return ret\n    }\n    if (ret.versionMajor === 18) {\n      ret.versionYear = 2025\n      return ret\n    }\n    this.log.silly('- unsupported version:', ret.versionMajor)`,
  ],
  [
    `    } else if (versionYear === 2022) {\n      return 'v143'\n    }\n    this.log.silly('- invalid versionYear:', versionYear)`,
    `    } else if (versionYear === 2022) {\n      return 'v143'\n    } else if (versionYear === 2025) {\n      return 'v145'\n    }\n    this.log.silly('- invalid versionYear:', versionYear)`,
  ],
]);

// 2. Patch build.js to disable Spectre mitigation requirement
patchFile('@electron/node-gyp/lib/build.js', [
  [
    `argv.push('/p:Configuration=' + buildType + ';Platform=' + p)`,
    `argv.push('/p:Configuration=' + buildType + ';Platform=' + p + ';SpectreMitigation=false')`,
  ],
]);

// 3. Patch winpty.gyp to avoid GetCommitHash.bat CWD issues
patchFile('node-pty/deps/winpty/src/winpty.gyp', [
  [
    `'WINPTY_COMMIT_HASH%': '<!(cmd /c "cd shared && GetCommitHash.bat")'`,
    `'WINPTY_COMMIT_HASH%': 'none'`,
  ],
  [
    `'<!(cmd /c "cd shared && UpdateGenVersion.bat <(WINPTY_COMMIT_HASH)")'`,
    `'gen'`,
  ],
]);

// 4. Create gen/GenVersion.h if it doesn't exist
const genDir = path.join(ROOT, 'node_modules/node-pty/deps/winpty/src/gen');
const genFile = path.join(genDir, 'GenVersion.h');
if (!fs.existsSync(genFile)) {
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(
    genFile,
    '// AUTO-GENERATED\nconst char GenVersion_Version[] = "0.4.3";\nconst char GenVersion_Commit[] = "none";\n'
  );
  console.log('  CREATED: node-pty/deps/winpty/src/gen/GenVersion.h');
}

console.log('Patches applied.');
