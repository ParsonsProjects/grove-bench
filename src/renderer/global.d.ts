/// <reference types="vite/client" />
import type { GroveBenchAPI } from '../shared/types.js';

declare global {
  interface Window {
    groveBench: GroveBenchAPI;
  }
}
