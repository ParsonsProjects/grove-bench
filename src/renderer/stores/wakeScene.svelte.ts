import { settingsStore } from './settings.svelte.js';
import { WAKE_SCENE_MS } from '../lib/grove-walk.js';

export interface WakeScene {
  sessionId: string;
  /** What the agent wakes from; its hoodie keeps that state's colour until
   *  it is awake. */
  from: 'sleeping' | 'stopped';
  /** Date.now() when the scene started. */
  startedAt: number;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * The wake-up scene played over the open conversation when its asleep agent
 * (sleeping or stopped) is woken: see the wake-up in lib/grove-walk.ts. Only
 * the open conversation shows it, so there is at most one. It needs grove
 * characters on, and is left out for reduced motion, where it would only be
 * a still picture that delays the chat. Any click or key ends it early.
 */
class WakeSceneStore {
  current = $state<WakeScene | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  start(sessionId: string, from: WakeScene['from']): void {
    if (!settingsStore.current.groveCharacters || prefersReducedMotion()) return;
    this.end();
    this.current = { sessionId, from, startedAt: Date.now() };
    this.timer = setTimeout(() => this.end(), WAKE_SCENE_MS);
  }

  end(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.current = null;
  }

  /** The scene playing for this conversation, if any. */
  for(sessionId: string): WakeScene | null {
    return this.current?.sessionId === sessionId ? this.current : null;
  }
}

export const wakeScene = new WakeSceneStore();
