/**
 * Resolve paths to the standalone filter scripts.
 * In development, these are in the resources/ directory.
 * In production (packaged), they're in the app's resources.
 */

import path from 'node:path';
import { app } from 'electron';

export function getFilterScriptPaths(): { filterScriptPath: string; hookScriptPath: string } {
  // In packaged app: app.isPackaged is true, resources are in process.resourcesPath
  // In dev: resources are relative to the project root
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'grove-filter')
    : path.join(app.getAppPath(), 'resources');

  return {
    filterScriptPath: path.join(base, 'grove-filter.js'),
    hookScriptPath: path.join(base, 'grove-filter-hook.js'),
  };
}
