// Works out how the same tasks play out three ways, up front, so the page
// only has to replay it against a clock.
//
//   solo    one agent in the project folder, one task after another
//   shared  one agent per task, all in the same folder at once
//   grove   one agent per task, each in its own worktree (Grove Bench)
//
// In the shared folder two things go wrong, both real: an agent's edit fails
// because another agent changed the file after it read it, and a test run
// picks up another agent's half-finished change.

const CLASH_DELAY = 1.5;
const RERUN_DELAY = 1.5;

/**
 * @typedef {{ from: number, to: number, kind: 'wait' | 'work' | 'redo' }} Segment
 * @typedef {{ t: number, task: string, text: string, kind: 'info' | 'clash' | 'done' }} Event
 * @typedef {{ task: string, steps: { t: number, tool: string, file: string, clash?: boolean }[], start: number, end: number, segments: Segment[], trouble: { from: number, to: number }[] }} Track
 */

export function planAll(tasks) {
  return { solo: planSolo(tasks), shared: planShared(tasks), grove: planGrove(tasks) };
}

function planSolo(tasks) {
  let t = 0;
  const tracks = tasks.map((task) => {
    const start = t;
    t += task.duration;
    return track(task, start, [
      ...(start > 0 ? [{ from: 0, to: start, kind: 'wait' }] : []),
      { from: start, to: start + task.duration, kind: 'work' },
    ]);
  });
  const events = tracks.flatMap((tr, i) => [
    ...(i > 0 ? [{ t: tr.start, task: tasks[i].key, text: `${tasks[i].branch} starts, after waiting ${fmt(tr.start)} min for the agent to be free.`, kind: 'info' }] : []),
    { t: tr.end, task: tasks[i].key, text: `${tasks[i].title}: done.`, kind: 'done' },
  ]);
  return finish(tracks, events, 0);
}

function planGrove(tasks) {
  const tracks = tasks.map((task) => track(task, 0, [{ from: 0, to: task.duration, kind: 'work' }]));
  const events = tracks.map((tr, i) => ({ t: tr.end, task: tasks[i].key, text: `${tasks[i].branch} done, on its own branch.`, kind: 'done' }));
  return finish(tracks, events, 0);
}

function planShared(tasks) {
  const agents = tasks.map((task) => ({
    task,
    i: 0,
    offset: 0,
    reads: {},
    edits: 0,
    retried: false,
    done: false,
    end: 0,
    steps: [],
    trouble: [],
  }));
  /** file -> { by, t } for the last edit */
  const lastEdit = {};
  const events = [];
  let clashes = 0;
  const when = (a) => a.task.steps[a.i].at + a.offset;

  for (;;) {
    const live = agents.filter((a) => !a.done);
    if (!live.length) break;
    const a = live.reduce((x, y) => (when(y) < when(x) ? y : x));
    const now = when(a);
    const s = a.task.steps[a.i];

    if (s.op === 'read') {
      a.reads[s.file] = now;
    } else if (s.op === 'edit') {
      const last = lastEdit[s.file];
      if (last && last.by !== a.task.key && a.reads[s.file] !== undefined && last.t > a.reads[s.file]) {
        clashes++;
        const other = tasks.find((t) => t.key === last.by);
        events.push({
          t: now,
          task: a.task.key,
          kind: 'clash',
          text: `${a.task.branch}: edit to ${s.file} failed. ${other.branch} changed it after this agent read it. Reading it again.`,
        });
        a.steps.push({ t: now, tool: s.tool, file: s.file, clash: true });
        a.trouble.push({ from: now, to: now + CLASH_DELAY });
        a.offset += CLASH_DELAY;
        a.reads[s.file] = now + CLASH_DELAY;
        continue;
      }
      lastEdit[s.file] = { by: a.task.key, t: now };
      a.edits++;
    } else if (s.op === 'test') {
      const messy = agents.find((o) => o !== a && !o.done && o.edits > 0);
      if (messy && !a.retried) {
        clashes++;
        a.retried = true;
        events.push({
          t: now,
          task: a.task.key,
          kind: 'clash',
          text: `${a.task.branch}: npm test failed on ${messy.task.branch}'s half-finished change. Running it again.`,
        });
        a.steps.push({ t: now, tool: s.tool, file: s.file, clash: true });
        a.trouble.push({ from: now, to: now + RERUN_DELAY });
        a.offset += RERUN_DELAY;
        continue;
      }
    }

    a.steps.push({ t: now, tool: s.tool, file: s.file });
    a.i++;
    if (a.i >= a.task.steps.length) {
      a.done = true;
      a.end = a.task.duration + a.offset;
      events.push({ t: a.end, task: a.task.key, text: `${a.task.title}: done, in the shared folder.`, kind: 'done' });
    }
  }

  const tracks = agents.map((a) => ({
    task: a.task.key,
    steps: a.steps,
    start: 0,
    end: a.end,
    trouble: a.trouble,
    segments: segmentsWithTrouble(a.end, a.trouble),
  }));
  return finish(tracks, events, clashes);
}

function track(task, start, segments) {
  return {
    task: task.key,
    steps: task.steps.map((s) => ({ t: start + s.at, tool: s.tool, file: s.file })),
    start,
    end: start + task.duration,
    segments,
    trouble: [],
  };
}

function segmentsWithTrouble(end, trouble) {
  const out = [];
  let t = 0;
  for (const tr of trouble) {
    if (tr.from > t) out.push({ from: t, to: tr.from, kind: 'work' });
    out.push({ from: tr.from, to: tr.to, kind: 'redo' });
    t = tr.to;
  }
  if (end > t) out.push({ from: t, to: end, kind: 'work' });
  return out;
}

function finish(tracks, events, clashes) {
  events.sort((a, b) => a.t - b.t);
  return { tracks, events, clashes, end: Math.max(...tracks.map((t) => t.end)) };
}

/** Files that more than one of these tasks edits. */
export function sharedFiles(tasks) {
  const by = {};
  for (const t of tasks) for (const s of t.steps) if (s.op === 'edit') (by[s.file] ??= new Set()).add(t.branch);
  return Object.entries(by)
    .filter(([, set]) => set.size > 1)
    .map(([file, set]) => ({ file, branches: [...set] }));
}

/** Where a track is at time t: its current step, or null before it starts. */
export function stepAt(track, t) {
  let cur = null;
  for (const s of track.steps) if (s.t <= t) cur = s;
  return cur;
}

export const inTrouble = (track, t) => track.trouble.some((x) => t >= x.from && t < x.to);

export const fmt = (n) => (Math.round(n * 10) / 10).toString();
