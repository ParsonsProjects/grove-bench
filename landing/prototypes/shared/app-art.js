// The grove art the app itself draws, straight from src/renderer/lib (see the
// `@app-art` alias in vite.prototypes.config.js). Characters, scenery, the
// logo tree, the grove walk and the context grove all come from here, so the
// prototypes never drift from the app.

export {
  AGENT_SPRITES,
  SPRITE_W,
  SPRITE_H,
  SIDE_WALK_MAPS,
  SIDE_WALK_W,
  SIDE_WALK_H,
  SKIN_TONES,
  HAIR_TONES,
  SCENERY_PALETTE,
  BENCH,
  LAMP,
  WATERING_CAN,
  SPROUT,
  FLAG,
  EASEL,
  agentLook,
  agentColors,
  toRuns,
} from '../../../src/renderer/lib/agent-sprite.ts';
export { PIXEL_TREE, PIXEL_TREE_W, PIXEL_TREE_H } from '../../../src/renderer/lib/pixel-tree.ts';
export {
  WALK_BACK,
  WALK_FRONT,
  WALK_VIEW_W,
  WALK_VIEW_H,
  WALK_GROUND_Y,
  WALK_FRAME_SECONDS,
  WAKE_AWAKE_AT_MS,
  WAKE_WALK_AT_MS,
  ARRIVE_SIT_AT_MS,
  ARRIVE_TYPE_AT_MS,
  ARRIVE_PATH_FROM,
  BENCH_PATH_OFFSET,
  WAKE_PATH_HEAD_START_SECONDS,
  wakePhase,
  arrivePhase,
} from '../../../src/renderer/lib/grove-walk.ts';
export { GROVE_H, GROVE_STEP_MS, GroveGrowth, groveLayout, groveRuns, grovePaths } from '../../../src/renderer/lib/context-grove.ts';
