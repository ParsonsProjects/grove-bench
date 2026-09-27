import { animationLoop } from '../shared/motion.js';

/**
 * Plays `steps` in order, then loops, but only while `node` is on screen and
 * the tab is visible (via animationLoop). Each step waits `wait` ms and then
 * runs `run()`. Returns a stop function.
 *
 * @param {Element} node
 * @param {{ wait: number, run: () => void }[]} steps
 */
export function timeline(node, steps) {
  let i = 0;
  let acc = 0;
  return animationLoop(node, (dt) => {
    acc += dt * 1000;
    let guard = steps.length;
    while (acc >= steps[i].wait && guard-- > 0) {
      acc -= steps[i].wait;
      steps[i].run();
      i = (i + 1) % steps.length;
    }
  });
}

/**
 * Builds typing steps: one step per character.
 * @param {string} text
 * @param {number} every ms per character
 * @param {(n: number) => void} set
 */
export function typeSteps(text, every, set) {
  return Array.from({ length: text.length }, (_, n) => ({ wait: every, run: () => set(n + 1) }));
}
