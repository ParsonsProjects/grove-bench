/**
 * PixiJS scene for the Game Dev Tycoon office.
 *
 * Owns the render loop and all display objects; Svelte drives it declaratively
 * through sync() — the scene diffs the desired state against what's on stage.
 * Ambient behavior: new developers walk in from the door to their chair,
 * reassigned developers walk to their new desk, working developers bob and
 * their monitors glow, and status bubbles animate. The camera fits the room
 * and supports wheel zoom + drag panning (RTS style).
 */
import { Application, Container, Graphics, Matrix, Text } from 'pixi.js';
import {
  iso, roomLayout, doorTile, chairTile, walkWaypoints, pathLength, pathAt,
  DESK_H, WALL_H, SPRITE_SCALE,
  type Pt, type RoomLayout,
} from './tycoon-iso.js';
import { buildSprite, developerAppearance, SPRITE_COLS, SPRITE_ROWS } from './tycoon-appearance.js';
import type { Mood } from './tycoon-mood.js';

export interface DeskInput {
  id: string;
  tx: number;
  ty: number;
  label: string;
  mood: Mood;
  selected: boolean;
}

export interface SceneCallbacks {
  onselect: (id: string | null) => void;
  onopen: (id: string) => void;
}

const WALK_SPEED = 3.2; // tiles per second
const WALK_STAGGER_MS = 260; // per-actor delay so a crowd files in
const DBLCLICK_MS = 350;
const FONT = "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace";
const INK = 0x1a1a24;

interface Actor {
  input: DeskInput;
  deskC: Container;
  devC: Container;
  bubbleC: Container;
  glowG: Graphics;
  ringG: Graphics;
  plaqueT: Text;
  bubbleAnim: { dots: Graphics[]; pulse: boolean };
  state: 'walking' | 'seated';
  waypoints: Pt[];
  walkDist: number;
  walkDelayMs: number;
  totalLen: number;
  bobPhase: number;
  lastTapAt: number;
}

function depth(p: Pt): number {
  return p.x + p.y;
}

function poly(g: Graphics, pts: [number, number, number][]): Graphics {
  // pts entries are [tx, ty, dyPx]
  const flat: number[] = [];
  for (const [tx, ty, dy] of pts) {
    const q = iso(tx, ty);
    flat.push(q.x, q.y + dy);
  }
  return g.poly(flat);
}

export class TycoonScene {
  private app: Application | null = null;
  private host: HTMLElement | null = null;
  private cb: SceneCallbacks;
  private world = new Container();
  private roomLayer = new Container();
  private deskLayer = new Container();
  private bubbleLayer = new Container();
  private actors = new Map<string, Actor>();
  private layout: RoomLayout | null = null;
  private roomKey = '';
  private userMovedCamera = false;
  private fitScale = 1;
  private elapsedMs = 0;
  private pending: DeskInput[] | null = null;
  private pendingCount = 0;
  private destroyed = false;
  private reducedMotion = false;
  private dragging: { x: number; y: number; wx: number; wy: number; moved: boolean } | null = null;
  private resizeObs: ResizeObserver | null = null;
  private onWheel = (e: WheelEvent) => this.handleWheel(e);

  constructor(cb: SceneCallbacks) {
    this.cb = cb;
  }

  async init(host: HTMLElement) {
    this.host = host;
    this.reducedMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const app = new Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: false,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      autoDensity: true,
    });
    // The component may have been destroyed while init was in flight.
    if (this.destroyed) {
      app.destroy(true, { children: true });
      return;
    }
    this.app = app;
    host.appendChild(app.canvas);

    this.deskLayer.sortableChildren = true;
    this.world.addChild(this.roomLayer, this.deskLayer, this.bubbleLayer);
    app.stage.addChild(this.world);

    // Background: drag to pan, plain click to deselect
    app.stage.eventMode = 'static';
    app.stage.hitArea = { contains: () => true };
    app.stage.on('pointerdown', (e) => {
      this.dragging = { x: e.global.x, y: e.global.y, wx: this.world.x, wy: this.world.y, moved: false };
    });
    app.stage.on('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.global.x - this.dragging.x;
      const dy = e.global.y - this.dragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.dragging.moved = true;
      if (this.dragging.moved) {
        this.world.x = this.dragging.wx + dx;
        this.world.y = this.dragging.wy + dy;
        this.userMovedCamera = true;
      }
    });
    const endDrag = (tapped: boolean) => {
      if (this.dragging && !this.dragging.moved && tapped) this.cb.onselect(null);
      this.dragging = null;
    };
    app.stage.on('pointerup', () => endDrag(true));
    app.stage.on('pointerupoutside', () => endDrag(false));

    app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.resizeObs = new ResizeObserver(() => {
      if (!this.userMovedCamera) this.fitCamera();
    });
    this.resizeObs.observe(host);

    app.ticker.add(() => this.tick(app.ticker.deltaMS));

    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.sync(this.pendingCount, p);
    }
  }

  destroy() {
    this.destroyed = true;
    this.resizeObs?.disconnect();
    if (this.app) {
      this.app.canvas.removeEventListener('wheel', this.onWheel);
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.actors.clear();
  }

  /** Declarative update: the room is derived from `count`, desks are diffed by id. */
  sync(count: number, desks: DeskInput[]) {
    if (!this.app) {
      this.pending = desks;
      this.pendingCount = count;
      return;
    }

    const layout = roomLayout(count);
    const key = `${layout.cols}x${layout.rows}:${layout.tier.name}`;
    if (key !== this.roomKey) {
      this.roomKey = key;
      this.layout = layout;
      this.buildRoom(layout);
      this.userMovedCamera = false;
      this.fitCamera();
    } else {
      this.layout = layout;
    }

    const seen = new Set<string>();
    let spawnIndex = 0;
    for (const d of desks) {
      seen.add(d.id);
      const existing = this.actors.get(d.id);
      if (!existing) {
        this.createActor(d, spawnIndex++);
      } else {
        this.updateActor(existing, d);
      }
    }
    for (const [id, actor] of [...this.actors]) {
      if (!seen.has(id)) {
        actor.deskC.destroy({ children: true });
        actor.devC.destroy({ children: true });
        actor.bubbleC.destroy({ children: true });
        this.actors.delete(id);
      }
    }
  }

  // ─── Camera ───

  private fitCamera() {
    if (!this.app || !this.layout) return;
    const vb = this.layout.viewBox;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (w < 4 || h < 4) return;
    const scale = Math.min(w / vb.w, h / vb.h) * 0.96;
    this.fitScale = scale;
    this.world.scale.set(scale);
    this.world.x = (w - vb.w * scale) / 2 - vb.x * scale;
    this.world.y = (h - vb.h * scale) / 2 - vb.y * scale;
  }

  private handleWheel(e: WheelEvent) {
    if (!this.app) return;
    e.preventDefault();
    const old = this.world.scale.x;
    const next = Math.min(this.fitScale * 3.5, Math.max(this.fitScale * 0.5, old * Math.exp(-e.deltaY * 0.0012)));
    if (next === old) return;
    // Zoom around the cursor
    const rect = this.app.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    this.world.x = px - ((px - this.world.x) / old) * next;
    this.world.y = py - ((py - this.world.y) / old) * next;
    this.world.scale.set(next);
    this.userMovedCamera = true;
  }

  // ─── Room ───

  private buildRoom(layout: RoomLayout) {
    this.roomLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const { cols, rows, tier } = layout;
    const g = new Graphics();

    // Walls
    poly(g, [[0, 0, -WALL_H], [0, rows, -WALL_H], [0, rows, 0], [0, 0, 0]]).fill(tier.wallLeft);
    poly(g, [[0, 0, -WALL_H], [cols, 0, -WALL_H], [cols, 0, 0], [0, 0, 0]]).fill(tier.wallRight);
    poly(g, [[0, 0, -7], [0, rows, -7], [0, rows, 0], [0, 0, 0]]).fill(tier.trim);
    poly(g, [[0, 0, -7], [cols, 0, -7], [cols, 0, 0], [0, 0, 0]]).fill(tier.trim);

    // Windows
    for (let t = 1.4; t + 1.6 <= rows - 1; t += 3) {
      poly(g, [[0, t, -74], [0, t + 1.6, -74], [0, t + 1.6, -36], [0, t, -36]])
        .fill({ color: 0xcfe6f2, alpha: 0.92 })
        .stroke({ width: 2, color: 0xf2f2ee });
    }
    for (let t = 1.4; t + 1.6 <= cols - 1; t += 3) {
      poly(g, [[t, 0, -74], [t + 1.6, 0, -74], [t + 1.6, 0, -36], [t, 0, -36]])
        .fill({ color: 0xd8ecdf, alpha: 0.92 })
        .stroke({ width: 2, color: 0xf2f2ee });
    }

    // Floor
    for (let fx = 0; fx < cols; fx++) {
      for (let fy = 0; fy < rows; fy++) {
        poly(g, [[fx, fy, 0], [fx + 1, fy, 0], [fx + 1, fy + 1, 0], [fx, fy + 1, 0]])
          .fill((fx + fy) % 2 === 0 ? tier.floorA : tier.floorB);
      }
    }

    // Door mat at the entrance
    const door = doorTile(layout);
    poly(g, [
      [door.x - 0.6, door.y - 0.45, 0], [door.x + 0.6, door.y - 0.45, 0],
      [door.x + 0.6, door.y + 0.45, 0], [door.x - 0.6, door.y + 0.45, 0],
    ]).fill({ color: 0x000000, alpha: 0.18 });

    // Plant decor
    if (tier.decor) {
      const b = iso(cols - 1.4, 1.1);
      g.poly([b.x - 7, b.y - 14, b.x + 7, b.y - 14, b.x + 5, b.y, b.x - 5, b.y]).fill(0xa4552f);
      g.poly([b.x, b.y - 44, b.x + 12, b.y - 26, b.x, b.y - 12, b.x - 12, b.y - 26]).fill(0x3f8f4a);
      g.poly([b.x - 10, b.y - 36, b.x, b.y - 26, b.x - 4, b.y - 16]).fill(0x4aa858);
      g.poly([b.x + 10, b.y - 36, b.x, b.y - 26, b.x + 4, b.y - 16]).fill(0x357a40);
    }
    this.roomLayer.addChild(g);

    // Studio name painted on the left wall plane
    const anchor = iso(0, rows * 0.72);
    const wallText = new Text({
      text: tier.name.toUpperCase(),
      style: {
        fontFamily: FONT, fontSize: 15, fontWeight: '700',
        letterSpacing: 2, fill: { color: 0xffffff, alpha: 0.65 },
      },
      resolution: 2,
    });
    wallText.setFromMatrix(new Matrix(0.894, -0.447, 0, 1, anchor.x + 3, anchor.y - 46));
    this.roomLayer.addChild(wallText);
  }

  // ─── Actors ───

  private createActor(input: DeskInput, spawnIndex: number) {
    const deskC = new Container();
    const devC = new Container();
    const bubbleC = new Container();

    // Developer sprite + chair
    const chairG = new Graphics();
    chairG.rect(-10, -32, 20, 26).fill(0x3a3f47);
    chairG.rect(-12, -8, 24, 5).fill(0x2f343b);
    const devG = new Graphics();
    for (const px of buildSprite(developerAppearance(input.id))) {
      devG.rect(px.x, px.y, 1, 1).fill(px.color);
    }
    devG.scale.set(SPRITE_SCALE);
    devG.position.set(-(SPRITE_COLS / 2) * SPRITE_SCALE, -SPRITE_ROWS * SPRITE_SCALE - 12);
    devC.addChild(chairG, devG);

    const ringG = new Graphics();
    const deskG = new Graphics();
    const glowG = new Graphics();
    const plaqueT = new Text({
      text: '',
      style: {
        fontFamily: FONT, fontSize: 8, fontWeight: '600',
        fill: 0xf2e9dc, stroke: { color: 0x4a3018, width: 2 },
      },
      resolution: 3,
    });
    plaqueT.anchor.set(0.5, 0.5);
    deskC.addChild(ringG, deskG, glowG, plaqueT);
    deskC.eventMode = 'static';
    deskC.cursor = 'pointer';
    devC.eventMode = 'static';
    devC.cursor = 'pointer';
    const tap = (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      const now = performance.now();
      if (now - actor.lastTapAt < DBLCLICK_MS) {
        this.cb.onopen(input.id);
      } else {
        this.cb.onselect(input.id);
      }
      actor.lastTapAt = now;
    };
    deskC.on('pointertap', tap);
    devC.on('pointertap', tap);
    // Swallow pointerdown so a click on a desk never starts a camera drag
    deskC.on('pointerdown', (e) => e.stopPropagation());
    devC.on('pointerdown', (e) => e.stopPropagation());

    this.deskLayer.addChild(deskC, devC);
    this.bubbleLayer.addChild(bubbleC);

    const actor: Actor = {
      input: { ...input, tx: NaN, ty: NaN, mood: 'idle', label: '', selected: false },
      deskC, devC, bubbleC, glowG, ringG, plaqueT,
      bubbleAnim: { dots: [], pulse: false },
      state: 'seated',
      waypoints: [], walkDist: 0, walkDelayMs: 0, totalLen: 0,
      bobPhase: (spawnIndex * 1.7) % (Math.PI * 2),
      lastTapAt: 0,
    };
    this.actors.set(input.id, actor);
    this.updateActor(actor, input);

    // Walk in from the door
    if (!this.reducedMotion && this.layout) {
      this.startWalk(actor, doorTile(this.layout), spawnIndex * WALK_STAGGER_MS);
    }
  }

  private startWalk(actor: Actor, from: Pt, delayMs: number) {
    const to = chairTile({ x: actor.input.tx, y: actor.input.ty });
    actor.waypoints = walkWaypoints(from, to);
    actor.totalLen = pathLength(actor.waypoints);
    actor.walkDist = 0;
    actor.walkDelayMs = delayMs;
    actor.state = 'walking';
    this.placeDev(actor, from);
  }

  private placeDev(actor: Actor, tile: Pt) {
    const q = iso(tile.x, tile.y);
    actor.devC.position.set(q.x, q.y);
    actor.devC.zIndex = depth(tile);
  }

  private updateActor(actor: Actor, input: DeskInput) {
    const prev = actor.input;
    const moved = prev.tx !== input.tx || prev.ty !== input.ty;
    const moodChanged = prev.mood !== input.mood;
    const labelChanged = prev.label !== input.label;
    const selChanged = prev.selected !== input.selected;
    const hadDesk = Number.isFinite(prev.tx);
    actor.input = input;

    if (moved) {
      this.drawDesk(actor);
      this.drawBubble(actor);
      if (hadDesk && !this.reducedMotion && actor.state === 'seated') {
        // Desk reshuffle: walk from the old chair to the new one
        this.startWalk(actor, chairTile({ x: prev.tx, y: prev.ty }), 0);
      } else if (actor.state !== 'walking') {
        this.seat(actor);
      } else {
        // Already walking — retarget
        this.startWalk(actor, pathAt(actor.waypoints, actor.walkDist), actor.walkDelayMs);
      }
    }
    if (moodChanged && !moved) this.drawBubble(actor);
    if (moodChanged || moved) this.drawGlow(actor);
    if (labelChanged || moved) actor.plaqueT.text = input.label.length > 18 ? input.label.slice(0, 17) + '…' : input.label;
    if (selChanged || moved) this.drawRing(actor);
  }

  private seat(actor: Actor) {
    actor.state = 'seated';
    const chair = chairTile({ x: actor.input.tx, y: actor.input.ty });
    this.placeDev(actor, chair);
  }

  private drawDesk(actor: Actor) {
    const { tx, ty } = actor.input;
    const g = actor.deskC.children[1] as Graphics;
    g.clear();
    const dh = DESK_H;
    poly(g, [[tx, ty, -dh], [tx + 2, ty, -dh], [tx + 2, ty + 1, -dh], [tx, ty + 1, -dh]]).fill(0xa9714b);
    poly(g, [[tx, ty + 1, -dh], [tx + 2, ty + 1, -dh], [tx + 2, ty + 1, 0], [tx, ty + 1, 0]]).fill(0x8a5a3a);
    poly(g, [[tx + 2, ty, -dh], [tx + 2, ty + 1, -dh], [tx + 2, ty + 1, 0], [tx + 2, ty, 0]]).fill(0x754c30);
    // Monitor, back toward the camera
    poly(g, [[tx + 0.9, ty + 0.45, -dh - 2], [tx + 1.1, ty + 0.45, -dh - 2], [tx + 1.1, ty + 0.45, -dh], [tx + 0.9, ty + 0.45, -dh]]).fill(0x101018);
    poly(g, [[tx + 0.55, ty + 0.5, -dh - 21], [tx + 1.45, ty + 0.5, -dh - 21], [tx + 1.45, ty + 0.5, -dh - 2], [tx + 0.55, ty + 0.5, -dh - 2]]).fill(0x191922);
    poly(g, [[tx + 0.55, ty + 0.5, -dh - 21], [tx + 1.45, ty + 0.5, -dh - 21], [tx + 1.45, ty + 0.5, -dh - 18], [tx + 0.55, ty + 0.5, -dh - 18]]).fill(0x2c2c3a);

    actor.deskC.zIndex = tx + 1 + ty + 1;
    const plaque = iso(tx + 1, ty + 1);
    actor.plaqueT.position.set(plaque.x, plaque.y - DESK_H / 2);
  }

  private drawGlow(actor: Actor) {
    const { tx, ty, mood } = actor.input;
    actor.glowG.clear();
    if (mood !== 'working') return;
    poly(actor.glowG, [[tx + 0.55, ty + 0.5, -DESK_H - 21], [tx + 1.45, ty + 0.5, -DESK_H - 21], [tx + 1.45, ty + 0.5, -DESK_H - 2], [tx + 0.55, ty + 0.5, -DESK_H - 2]])
      .stroke({ width: 1.4, color: 0x6fb7ff });
  }

  private drawRing(actor: Actor) {
    const { tx, ty, selected } = actor.input;
    actor.ringG.clear();
    if (!selected) return;
    poly(actor.ringG, [[tx - 0.45, ty - 1.15, 0], [tx + 2.45, ty - 1.15, 0], [tx + 2.45, ty + 1.45, 0], [tx - 0.45, ty + 1.45, 0]])
      .fill({ color: 0x58d68d, alpha: 0.1 })
      .stroke({ width: 1.5, color: 0x58d68d });
  }

  private drawBubble(actor: Actor) {
    const { mood } = actor.input;
    actor.bubbleC.removeChildren().forEach((c) => c.destroy());
    actor.bubbleAnim = { dots: [], pulse: mood === 'waiting' || mood === 'done' };
    actor.bubbleC.visible = mood !== 'idle';
    if (mood === 'idle') return;

    const g = new Graphics();
    g.rect(-15, -18, 30, 16).fill(0xf4f4f0).stroke({ width: 1.5, color: INK });
    g.rect(-2, -3, 4, 4).fill(INK);
    actor.bubbleC.addChild(g);

    if (mood === 'working') {
      for (let i = 0; i < 3; i++) {
        const dot = new Graphics().rect(-8 + i * 6, -12, 4, 4).fill(INK);
        actor.bubbleC.addChild(dot);
        actor.bubbleAnim.dots.push(dot);
      }
    } else {
      const glyph = mood === 'waiting' ? '?' : mood === 'error' ? '!' : mood === 'setup' ? 'zZz' : '✓';
      const color = mood === 'waiting' ? 0xb45309 : mood === 'error' ? 0xb91c1c : mood === 'done' ? 0x15803d : INK;
      const t = new Text({
        text: glyph,
        style: {
          fontFamily: FONT, fontSize: mood === 'setup' ? 8 : 11, fontWeight: '700',
          fontStyle: mood === 'setup' ? 'italic' : 'normal', fill: color,
        },
        resolution: 3,
      });
      t.anchor.set(0.5, 0.5);
      t.position.set(0, -10);
      actor.bubbleC.addChild(t);
    }
    this.positionBubble(actor);
  }

  private positionBubble(actor: Actor) {
    // Above the developer's head, wherever they currently are
    actor.bubbleC.position.set(actor.devC.x, actor.devC.y - SPRITE_ROWS * SPRITE_SCALE - 22);
  }

  // ─── Render loop ───

  private tick(dtMs: number) {
    this.elapsedMs += dtMs;
    const t = this.elapsedMs / 1000;

    for (const actor of this.actors.values()) {
      if (actor.state === 'walking') {
        actor.walkDelayMs -= dtMs;
        if (actor.walkDelayMs <= 0) {
          actor.walkDist += (WALK_SPEED * dtMs) / 1000;
          if (actor.walkDist >= actor.totalLen) {
            this.seat(actor);
          } else {
            const pos = pathAt(actor.waypoints, actor.walkDist);
            this.placeDev(actor, pos);
            // step bounce
            actor.devC.y -= Math.abs(Math.sin(actor.walkDist * 6)) * 2.2;
          }
        }
      } else if (actor.input.mood === 'working' && !this.reducedMotion) {
        // typing bob
        const chair = chairTile({ x: actor.input.tx, y: actor.input.ty });
        const q = iso(chair.x, chair.y);
        actor.devC.y = q.y + Math.sin(t * 7 + actor.bobPhase) * 0.9;
      }

      if (actor.bubbleC.visible) this.positionBubble(actor);
      if (actor.bubbleAnim.dots.length) {
        actor.bubbleAnim.dots.forEach((dot, i) => {
          const phase = (t * 2.5 - i * 0.28) % 1;
          dot.alpha = phase < 0.35 ? 1 : 0.25;
        });
      }
      if (actor.bubbleAnim.pulse) {
        actor.bubbleC.alpha = 0.65 + Math.sin(t * 5) * 0.35;
      }
      if (actor.input.mood === 'working') {
        actor.glowG.alpha = 0.35 + (Math.sin(t * 4 + actor.bobPhase) + 1) * 0.3;
      }
    }
  }
}
