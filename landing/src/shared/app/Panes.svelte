<script>
  import GroveScene from '../GroveScene.svelte';
  import Pixels from '../Pixels.svelte';
  import { FLAG } from '../app-art.js';

  /**
   * The non-thread workspace tabs for one conversation: Changes (file list
   * and diff), Checkpoints (one per message, with the two rewind buttons),
   * Terminal and Preview. Empty ones show the app's grove scene and props.
   *
   * @type {{ c: any, tab: 'changes' | 'checkpoints' | 'terminal' | 'preview', file?: number, onfile?: (i: number) => void, checkpoint?: number, oncheckpoint?: (i: number) => void }}
   */
  let { c, tab, file = 0, onfile, checkpoint = -1, oncheckpoint } = $props();

  const f = $derived(c.files?.[file] ?? null);
  const cp = $derived(checkpoint >= 0 ? c.checkpoints?.[checkpoint] : null);
</script>

{#if tab === 'changes'}
  {#if c.files?.length}
    <div class="changes">
      <aside class="files">
        <div class="filter t-faint">Filter files...</div>
        <div class="scope"><span class="on">Uncommitted</span><span>Branch</span></div>
        <div class="grp t-amber">⌄ Changes <span class="t-faint">{c.files.length}</span></div>
        {#each c.files as fl, i}
          <button type="button" class="file" class:on={i === file} data-target="file-{i}" onclick={() => onfile?.(i)}>
            <b class={fl.status === 'A' ? 't-green' : 't-amber'}>{fl.status}</b>
            <span class="fn"><span>{fl.path.split('/').at(-1)}</span><small class="t-faint">{fl.path.split('/').slice(0, -1).join('/')}/</small></span>
            <span class="st"><span class="add">+{fl.add}</span>{#if fl.del}<span class="del"> -{fl.del}</span>{/if}</span>
          </button>
        {/each}
      </aside>
      <section class="diff">
        {#if f}
          <header><b class={f.status === 'A' ? 't-green' : 't-amber'}>{f.status}</b> {f.path} <span class="add">+{f.add}</span>{#if f.del}<span class="del"> -{f.del}</span>{/if}<span class="hbtn t-muted">unified</span><span class="hbtn rv">Revert</span></header>
          <pre>{#each f.diff as line}<span class="ln {line[0] === '+' ? 'a' : line[0] === '-' ? 'd' : line[0] === '@' ? 'h' : ''}">{line || ' '}</span>{/each}</pre>
        {/if}
      </section>
    </div>
  {:else}
    <div class="empty"><GroveScene tab="changes" state={c.state} seed={c.id} scale={4} /><p>Working tree clean</p></div>
  {/if}
{:else if tab === 'checkpoints'}
  {#if c.checkpoints?.length}
    <div class="cps">
      <p class="t-muted intro">One checkpoint per message you sent, taken before the agent acted on it.</p>
      <ol>
        {#each c.checkpoints as k, i}
          <li>
            <button type="button" class="cp" class:on={i === checkpoint} data-target="cp-{i}" onclick={() => oncheckpoint?.(i)}>
              <Pixels map={FLAG} scale={1.5} />
              <span class="cpt">Turn {k.turn}</span>
              <span class="cpm">{k.text}</span>
              <span class="t-faint">{k.age}</span>
            </button>
            {#if i === checkpoint}
              <div class="cpd">
                <p class="t-muted">Since here: <span class="add">+{k.add}</span> <span class="del">-{k.del}</span> in {k.files} file{k.files === 1 ? '' : 's'}</p>
                <div class="cpb">
                  <button type="button" class="gb-btn deny" data-target="rewind-all">Rewind all</button>
                  <button type="button" class="gb-btn">Conv. only</button>
                </div>
                <p class="t-faint small"><b class="t-muted">Rewind all</b> restores the files and the thread. <b class="t-muted">Thread only</b> resets the thread and leaves files as they are.</p>
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    </div>
  {:else}
    <div class="empty">
      <GroveScene tab="checkpoints" state={c.state} seed={c.id} scale={4} />
      <p>No checkpoints yet</p>
      <small class="t-muted">Each message you send saves one before the agent acts on it, so you can see what that turn changed and rewind to it.</small>
    </div>
  {/if}
{:else if tab === 'terminal'}
  <pre class="term"><span class="t-muted">PS {c.cwd ?? 'C:\\dev\\acme-shop'}&gt;</span> {c.term?.[0] ?? 'npm run dev'}
{#each c.term?.slice(1) ?? ['  ready on http://localhost:5173'] as l}{l}
{/each}<span class="t-muted">PS {c.cwd ?? 'C:\\dev\\acme-shop'}&gt;</span> <span class="caret"></span></pre>
{:else}
  <div class="empty"><GroveScene tab="preview" state={c.state} seed={c.id} scale={4} /><p>Preview your app</p><small class="t-muted">Open a local dev server, any web address, or an HTML file in this worktree.</small></div>
{/if}

<style>
  .changes {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
  .files {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-right: 1px solid var(--border);
    overflow: hidden;
  }
  .filter {
    padding: 4px 8px;
    font-size: 12px;
    border: 1px solid var(--border);
  }
  .scope {
    display: flex;
    gap: 2px;
    font-size: 11px;
  }
  .scope span {
    padding: 2px 6px;
    color: var(--muted-fg);
  }
  .scope .on {
    color: var(--fg);
    background: var(--accent);
  }
  .grp {
    margin-top: 6px;
    font-size: 12px;
  }
  .file {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
    padding: 5px 6px;
    margin: 0 -8px;
    text-align: left;
    font-size: 12px;
  }
  .file.on {
    background: oklch(0.26 0 0);
    box-shadow: inset 2px 0 var(--primary);
  }
  .fn {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .fn small {
    overflow: hidden;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st {
    font-size: 11px;
  }
  .diff {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .diff header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
  }
  .hbtn {
    padding: 1px 8px;
    border: 1px solid var(--border);
  }
  .hbtn:first-of-type {
    margin-left: auto;
  }
  .rv {
    color: var(--destructive);
    border-color: oklch(0.608 0.22 22 / 0.6);
  }
  .diff pre {
    margin: 0;
    padding: 8px 0;
    overflow: hidden;
    font: inherit;
    font-size: 12px;
    line-height: 1.6;
  }
  .ln {
    display: block;
    padding: 0 12px;
    white-space: pre;
  }
  .ln.a {
    color: oklch(0.85 0.12 151);
    background: oklch(0.792 0.209 151.711 / 0.1);
  }
  .ln.d {
    color: oklch(0.8 0.12 25);
    background: oklch(0.637 0.237 25.331 / 0.1);
  }
  .ln.h {
    color: var(--cyan);
  }
  .empty {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 8px;
    height: 100%;
    padding: 20px;
    text-align: center;
  }
  .empty p {
    margin: 10px 0 0;
    color: oklch(0.835 0 0 / 0.8);
  }
  .empty small {
    max-width: 46ch;
    font-size: 12px;
  }
  .cps {
    padding: 14px 18px;
  }
  .intro {
    margin: 0 0 10px;
    font-size: 12px;
  }
  .cps ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cp {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    text-align: left;
    border: 1px solid transparent;
  }
  .cp.on {
    background: oklch(0.26 0 0);
    border-color: var(--border);
  }
  .cpt {
    flex: none;
    color: var(--blue);
  }
  .cpm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cpd {
    padding: 8px 10px 10px 36px;
  }
  .cpd p {
    margin: 0;
    font-size: 12px;
  }
  .cpb {
    display: flex;
    gap: 8px;
    margin: 8px 0;
  }
  .small {
    max-width: 60ch;
  }
  .term {
    height: 100%;
    margin: 0;
    padding: 12px 14px;
    overflow: hidden;
    font: inherit;
    font-size: 12px;
    line-height: 1.6;
    color: var(--fg);
    background: oklch(0.17 0 0);
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 13px;
    vertical-align: -2px;
    background: var(--fg);
    animation: gbblink 1s steps(2) infinite;
  }
  @keyframes gbblink {
    50% {
      opacity: 0;
    }
  }
</style>
