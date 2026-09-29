/// <reference types="vite/client" />
import type { GroveBenchAPI } from '../shared/types.js';

declare global {
  interface Window {
    groveBench: GroveBenchAPI;
  }
}

// `title` isn't a standard SVG attribute, but lib/tooltip.ts shows it like any
// other title. An SVG <title> child would raise the native tooltip instead.
declare module 'svelte/elements' {
  interface SVGAttributes<T extends EventTarget> {
    title?: string | null;
  }
}
