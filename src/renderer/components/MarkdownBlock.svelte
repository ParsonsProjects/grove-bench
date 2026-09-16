<script lang="ts" module>
  import { Marked } from 'marked';
  import DOMPurify from 'dompurify';
  import hljs from '../lib/hljs.js';

  // Allow data-code attribute through DOMPurify for copy button support
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'data-code') {
      data.forceKeepAttr = true;
    }
  });

  const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Code renderer; `highlight` false skips highlight.js (used while streaming,
   *  where the whole block is re-rendered on every flush). */
  function codeRenderer(highlight: boolean) {
    return {
      code({ text, lang }: { text: string; lang?: string }) {
        const encoded = btoa(encodeURIComponent(text));
        const copyBtn = `<button class="code-copy-btn" data-code="${encoded}" title="Copy">${COPY_SVG}</button>`;

        if (highlight && lang && hljs.getLanguage(lang)) {
          const highlighted = hljs.highlight(text, { language: lang }).value;
          return `<div class="code-block-wrapper"><pre class="hljs"><code class="language-${lang}">${highlighted}</code></pre>${copyBtn}</div>`;
        }
        return `<div class="code-block-wrapper"><pre class="hljs"><code>${escapeHtml(text)}</code></pre>${copyBtn}</div>`;
      },
    };
  }

  // One-time setup: configured marked instances with custom code renderers
  const markedInstance = new Marked({ gfm: true, breaks: true });
  markedInstance.use({ renderer: codeRenderer(true) });

  const markedStreaming = new Marked({ gfm: true, breaks: true });
  markedStreaming.use({ renderer: codeRenderer(false) });

  export function renderMarkdown(content: string, opts: { highlight?: boolean } = {}): string {
    const instance = opts.highlight === false ? markedStreaming : markedInstance;
    try {
      const raw = instance.parse(content) as string;
      return DOMPurify.sanitize(raw, { ADD_ATTR: ['data-code'] });
    } catch {
      return DOMPurify.sanitize(content);
    }
  }
</script>

<script lang="ts">
  /** `streaming`: the content is a live preview that re-renders on every
   *  flush, so skip syntax highlighting; the finalized message gets it. */
  let { content, streaming = false }: { content: string; streaming?: boolean } = $props();

  let html = $derived.by(() => renderMarkdown(content, { highlight: !streaming }));
  let container: HTMLDivElement;

  const checkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const copySvg = COPY_SVG;

  $effect(() => {
    const _html = html; // track re-renders
    if (!container) return;

    // Intercept link clicks to open externally (especially localhost URLs)
    const linkHandler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (href && /^https?:\/\//i.test(href)) {
        e.preventDefault();
        window.groveBench.openExternal(href);
      }
    };
    container.addEventListener('click', linkHandler);

    const buttons = container.querySelectorAll<HTMLButtonElement>('.code-copy-btn');
    const handlers: Array<[HTMLButtonElement, () => void]> = [];

    for (const btn of buttons) {
      const handler = async () => {
        const encoded = btn.getAttribute('data-code');
        if (!encoded) return;
        try {
          const text = decodeURIComponent(atob(encoded));
          await navigator.clipboard.writeText(text);
          btn.innerHTML = checkSvg;
          btn.classList.add('copied');
          setTimeout(() => {
            btn.innerHTML = copySvg;
            btn.classList.remove('copied');
          }, 1500);
        } catch { /* ignore */ }
      };
      btn.addEventListener('click', handler);
      handlers.push([btn, handler]);
    }

    return () => {
      container.removeEventListener('click', linkHandler);
      for (const [btn, handler] of handlers) {
        btn.removeEventListener('click', handler);
      }
    };
  });
</script>

<div class="markdown-content" bind:this={container}>
  {@html html}
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
    background: #1e1e1e;
    padding: 0.15em 0.4em;
    font-size: 0.9em;
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }
  .markdown-content :global(pre) {
    background: #1a1a1a;
    border: 1px solid #333;
    padding: 0.8em;
    margin: 0.5em 0;
    overflow-x: auto;
  }
  .markdown-content :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85em;
  }
  .markdown-content :global(blockquote) {
    border-left: 3px solid #444;
    margin: 0.5em 0;
    padding: 0.2em 0.8em;
    color: #999;
  }
  .markdown-content :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
    width: 100%;
  }
  .markdown-content :global(th),
  .markdown-content :global(td) {
    border: 1px solid #333;
    padding: 0.4em 0.8em;
    text-align: left;
  }
  .markdown-content :global(th) {
    background: #1a1a1a;
    font-weight: 600;
  }
  .markdown-content :global(a) {
    color: #60a5fa;
    text-decoration: underline;
  }
  .markdown-content :global(hr) {
    border: none;
    border-top: 1px solid #333;
    margin: 0.8em 0;
  }
  .markdown-content :global(.code-block-wrapper) {
    position: relative;
  }
  .markdown-content :global(.code-copy-btn) {
    position: absolute;
    top: 0.4em;
    right: 0.4em;
    padding: 0.2em;
    color: #666;
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .markdown-content :global(.code-block-wrapper:hover .code-copy-btn) {
    opacity: 1;
  }
  .markdown-content :global(.code-copy-btn:hover) {
    color: #ccc;
  }
  .markdown-content :global(.code-copy-btn.copied) {
    color: #4ade80;
    opacity: 1;
  }
</style>
