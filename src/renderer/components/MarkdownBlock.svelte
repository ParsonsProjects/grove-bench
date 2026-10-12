<script lang="ts" module>
  import { Marked, Renderer, type Tokens } from 'marked';
  import DOMPurify from 'dompurify';
  import hljs from '../lib/hljs.js';
  import { openLink } from '$lib/preview-links.js';
  import { splitStreamingMarkdown } from '$lib/markdown-stream.js';
  import { writeRichText, encodeCopyText } from '$lib/clipboard.js';
  import { COPY_MARK, isRenderedCopyButton, renderedCode, renderedTable } from '$lib/copy-mark.js';
  import { HIGHLIGHT_MARK, highlightWhenVisible } from '$lib/code-highlight.js';
  import { localFilePath, localFileTarget, openWorktreeFile } from '$lib/worktree-files.js';
  import { madeFileKind, worktreeFileUrl, worktreeImageType } from '../../shared/attachments.js';

  const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Code renderer. With `highlight`, a block in a language highlight.js
   *  knows is marked to be coloured once it is on screen (lib/code-highlight);
   *  without it (while streaming, where the whole block is re-rendered on
   *  every flush) it stays plain. Either way it renders as escaped text. */
  function codeRenderer(highlight: boolean) {
    return {
      code({ text, lang }: { text: string; lang?: string }) {
        // Copies the block's own code text (see the click handler).
        const copyBtn = `<button class="code-copy-btn" data-copy="${COPY_MARK}" title="Copy">${COPY_SVG}</button>`;

        if (highlight && lang && hljs.getLanguage(lang)) {
          return `<div class="code-block-wrapper"><pre class="hljs"><code class="language-${lang}" data-hl="${HIGHLIGHT_MARK}">${escapeHtml(text)}</code></pre>${copyBtn}</div>`;
        }
        return `<div class="code-block-wrapper"><pre class="hljs"><code>${escapeHtml(text)}</code></pre>${copyBtn}</div>`;
      },
    };
  }

  /** Table renderer: marked's default table plus a copy button that holds the
   *  Markdown source. A click copies the rendered table as HTML and
   *  tab-separated text; Shift+click copies the Markdown. */
  const tableRenderer = {
    table(this: Renderer, token: Tokens.Table) {
      const encoded = encodeCopyText(token.raw.trim());
      const copyBtn = `<button class="table-copy-btn" data-copy="${COPY_MARK}" data-code="${encoded}" aria-label="Copy table" title="Copy table (Shift+click for Markdown)">${COPY_SVG}</button>`;
      return `<div class="table-wrapper">${Renderer.prototype.table.call(this, token)}${copyBtn}</div>`;
    },
  };

  function escapeAttr(text: string): string {
    return escapeHtml(text).replace(/"/g, '&quot;');
  }

  /** Image renderer: an image the agent saved in its worktree (`![shot](shots/home.png)`)
   *  is written with its path in `data-local-src` and no `src`, so nothing
   *  loads it against the app's own address. The component points it at the
   *  thread's worktree once it's on screen. Web images render as usual. */
  const imageRenderer = {
    image(this: Renderer, token: Tokens.Image) {
      const local = localFilePath(token.href);
      if (local === null || !worktreeImageType(local)) return false;
      const alt = token.tokens ? this.parser.parseInline(token.tokens, this.parser.textRenderer) : token.text;
      const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
      return `<img data-local-src="${escapeAttr(local)}" alt="${escapeAttr(alt)}"${title}>`;
    },
  };

  /** Link renderer: a link to an output file in the worktree (madeFileKind)
   *  keeps the path as written in `data-local-href`. DOMPurify would drop an
   *  absolute one (`C:\\...`, `file:///...`) from `href`, which only holds `#`. */
  const linkRenderer = {
    link(this: Renderer, token: Tokens.Link) {
      const local = localFilePath(token.href);
      if (local === null || !madeFileKind(local)) return false;
      const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
      return `<a href="#" data-local-href="${escapeAttr(token.href)}"${title}>${this.parser.parseInline(token.tokens)}</a>`;
    },
  };

  // One-time setup: configured marked instances with custom code, table, image and link renderers
  const markedInstance = new Marked({ gfm: true, breaks: true });
  markedInstance.use({ renderer: { ...codeRenderer(true), ...tableRenderer, ...imageRenderer, ...linkRenderer } });

  const markedStreaming = new Marked({ gfm: true, breaks: true });
  markedStreaming.use({ renderer: { ...codeRenderer(false), ...tableRenderer, ...imageRenderer, ...linkRenderer } });

  export function renderMarkdown(content: string, opts: { highlight?: boolean } = {}): string {
    const instance = opts.highlight === false ? markedStreaming : markedInstance;
    try {
      const raw = instance.parse(content) as string;
      // No forms: submitting one would navigate the app window.
      return DOMPurify.sanitize(raw, { FORBID_TAGS: ['form'] });
    } catch {
      return DOMPurify.sanitize(content);
    }
  }
</script>

<script lang="ts">
  /** `streaming`: the content is a live preview that re-renders on every
   *  flush, so skip syntax highlighting; the finalized message gets it. It
   *  is also rendered a block at a time: blocks that are done keep their
   *  HTML, and each flush re-parses only the block still growing.
   *  `sessionId`: the thread the text is in. Images and links that name a
   *  file in its worktree show and open it; without one they do nothing. */
  let { content, streaming = false, sessionId }: { content: string; streaming?: boolean; sessionId?: string } = $props();

  let html = $derived(streaming ? '' : renderMarkdown(content));
  let streamParts = $derived(streaming ? splitStreamingMarkdown(content) : null);
  let container: HTMLDivElement;

  const checkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const copySvg = COPY_SVG;

  /** `markdown`: a table copies its Markdown source instead (Shift+click). */
  async function copy(btn: HTMLElement, markdown: boolean) {
    try {
      if (btn.classList.contains('table-copy-btn')) {
        const table = renderedTable(btn);
        if (!table) return;
        if (markdown) await navigator.clipboard.writeText(table.markdown);
        else await writeRichText(table.tsv, table.html);
      } else {
        const code = renderedCode(btn);
        if (code === null) return;
        await navigator.clipboard.writeText(code);
      }
      btn.innerHTML = checkSvg;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = copySvg;
        btn.classList.remove('copied');
      }, 1500);
    } catch { /* ignore */ }
  }

  // One listener for the whole block, so content that re-renders (or grows
  // while streaming) needs nothing re-attached.
  $effect(() => {
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Only buttons this renderer made: chat content can hold its own.
      const btn = target.closest('button.code-copy-btn, button.table-copy-btn');
      if (isRenderedCopyButton(btn)) {
        void copy(btn, e.shiftKey);
        return;
      }
      // Links: localhost opens in the Preview tab, the rest in the system
      // browser. An output file in the thread's worktree (a web page, PDF,
      // image, video, spreadsheet: madeFileKind) opens from there, a web page
      // in the Preview tab. Every other link (source files, `?x`, `#x`,
      // mailto:) does nothing: followed, it would navigate or reload the app
      // window, and a link the agent wrote shouldn't open a script.
      const anchor = target.closest('a');
      if (!anchor) return;
      e.preventDefault();
      const href = anchor.getAttribute('href');
      if (href && /^https?:\/\//i.test(href)) {
        openLink(href, e);
        return;
      }
      const local = localFileTarget(anchor.dataset.localHref ?? href);
      if (local !== null && sessionId && madeFileKind(local.path)) {
        const sid = sessionId;
        openWorktreeFile(sid, local.path, local.hash)
          .then((found) => { if (!found) anchor.title = `${local.path} isn't in this thread's worktree`; })
          .catch((err) => console.warn(`Could not open ${local.path}:`, err));
      }
    };
    // An image from the worktree that won't load (gone, or outside it) says so.
    // Load errors don't bubble, so this listens as they go down.
    const onError = (e: Event) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.localSrc === undefined) return;
      const note = document.createElement('span');
      note.className = 'local-image-missing';
      note.textContent = `Image not found: ${img.dataset.localSrc}`;
      img.replaceWith(note);
    };
    container.addEventListener('click', onClick);
    container.addEventListener('error', onError, true);
    return () => {
      container.removeEventListener('click', onClick);
      container.removeEventListener('error', onError, true);
    };
  });

  // Point images the agent saved in its worktree at it (imageRenderer), each
  // time the HTML is drawn again. Without a thread they stay unloaded.
  $effect(() => {
    void html;
    void streamParts;
    const sid = sessionId;
    if (!container || !sid) return;
    for (const img of container.querySelectorAll<HTMLImageElement>('img[data-local-src]:not([src])')) {
      img.src = worktreeFileUrl(sid, img.dataset.localSrc ?? '');
    }
  });

  // Colour the code blocks once they are on screen (lib/code-highlight), not
  // while the reply renders. Runs again for each new render of a finished
  // reply; a streaming one stays plain.
  $effect(() => {
    void html;
    if (!container || streaming) return;
    return highlightWhenVisible(container);
  });
</script>

<div class="markdown-content" bind:this={container}>
  {#if streamParts}
    <!-- A block's string never changes once cut, so its HTML is made once. -->
    {#each streamParts.settled as block, i (i)}
      {@html renderMarkdown(block, { highlight: false })}
    {/each}
    {@html renderMarkdown(streamParts.tail, { highlight: false })}
  {:else}
    {@html html}
  {/if}
</div>

<style>
  .markdown-content {
    line-height: 1.6;
    word-wrap: break-word;
  }
  .markdown-content :global(p) {
    margin: 0.4em 0;
  }
  .markdown-content :global(h1),
  .markdown-content :global(h2),
  .markdown-content :global(h3) {
    margin: 0.8em 0 0.4em;
    font-weight: 600;
  }
  .markdown-content :global(h1) { font-size: 1.3em; }
  .markdown-content :global(h2) { font-size: 1.15em; }
  .markdown-content :global(h3) { font-size: 1.05em; }
  .markdown-content :global(ul),
  .markdown-content :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.5em;
  }
  .markdown-content :global(li) {
    margin: 0.2em 0;
  }
  .markdown-content :global(code) {
    background: var(--code-inline);
    padding: 0.15em 0.4em;
    font-size: 0.9em;
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }
  .markdown-content :global(pre) {
    background: var(--code-block);
    border: 1px solid var(--code-border);
    padding: 0.8em;
    margin: 0.5em 0;
    overflow-x: auto;
  }
  .markdown-content :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85em;
  }
  .markdown-content :global(img) {
    max-width: 100%;
    max-height: 32rem;
  }
  .markdown-content :global(.local-image-missing) {
    font-size: 0.85em;
    color: var(--muted-foreground);
  }
  .markdown-content :global(blockquote) {
    border-left: 3px solid var(--quote-border);
    margin: 0.5em 0;
    padding: 0.2em 0.8em;
    color: var(--quote-foreground);
  }
  .markdown-content :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
    width: 100%;
  }
  .markdown-content :global(th),
  .markdown-content :global(td) {
    border: 1px solid var(--code-border);
    padding: 0.4em 0.8em;
    text-align: left;
  }
  /* marked writes `:---:` and `---:` columns as an align attribute, which the
     rule above would override. */
  .markdown-content :global(th[align='center']),
  .markdown-content :global(td[align='center']) {
    text-align: center;
  }
  .markdown-content :global(th[align='right']),
  .markdown-content :global(td[align='right']) {
    text-align: right;
  }
  .markdown-content :global(th) {
    background: var(--code-block);
    font-weight: 600;
  }
  .markdown-content :global(a) {
    color: var(--link);
    text-decoration: underline;
  }
  .markdown-content :global(hr) {
    border: none;
    border-top: 1px solid var(--code-border);
    margin: 0.8em 0;
  }
  .markdown-content :global(.code-block-wrapper) {
    position: relative;
  }
  .markdown-content :global(.table-wrapper) {
    position: relative;
    margin: 0.5em 0;
    padding-top: 1.6em;
  }
  .markdown-content :global(.table-wrapper > table) {
    margin: 0;
  }
  .markdown-content :global(.code-copy-btn),
  .markdown-content :global(.table-copy-btn) {
    position: absolute;
    top: 0.4em;
    right: 0.4em;
    padding: 0.2em;
    color: var(--copy-button);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Sits in a strip above the table so it never covers header text. */
  .markdown-content :global(.table-copy-btn) {
    top: 0;
    right: 0;
  }
  .markdown-content :global(.code-block-wrapper:hover .code-copy-btn),
  .markdown-content :global(.table-wrapper:hover .table-copy-btn) {
    opacity: 1;
  }
  .markdown-content :global(.code-copy-btn:hover),
  .markdown-content :global(.table-copy-btn:hover) {
    color: var(--copy-button-hover);
  }
  .markdown-content :global(.code-copy-btn.copied),
  .markdown-content :global(.table-copy-btn.copied) {
    color: var(--ok);
    opacity: 1;
  }
</style>
