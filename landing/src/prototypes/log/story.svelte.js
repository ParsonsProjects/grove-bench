// Shared page state. The graph writes the scroll-driven values (head, tod),
// scenes read them. Both are pure functions of the scroll position, so they
// only ever move forward as you scroll down and retrace exactly going up.

export const story = $state({
  /** Draw head of the gutter graph, in px from the top of the log. */
  head: 0,
  /** How far feat/api is drawn. Stops at the permission node until answered. */
  apiHead: 0,
  /** Time of day for every scene: 0 night, 0.5 dawn, 1 day. */
  tod: 0,
  /** Page y (in log px) of graph anchors the scenes wait for. */
  marks: /** @type {Record<string, number>} */ ({}),
  /** 'pending' until the visitor answers the permission prompt. */
  permission: /** @type {'pending' | 'allow' | 'always' | 'deny'} */ ('pending'),
  /** Id of the scene whose character dialogue is open, so only one is. */
  talking: /** @type {string | null} */ (null),
});

/** True once the draw head has passed a named anchor. */
export function passed(mark) {
  const y = story.marks[mark];
  return y != null && story.head >= y;
}
