<script lang="ts" module>
  import { Marked } from 'marked';
  import DOMPurify from 'dompurify';
  import hljs from 'highlight.js';

  // One-time setup: create a configured marked instance with custom code renderer
  const markedInstance = new Marked({ gfm: true, breaks: true });

  markedInstance.use({
    renderer: {
      code({ text, lang }: { text: string; lang?: string }) {
        if (lang && hljs.getLanguage(lang)) {
          const highlighted = hljs.highlight(text, { language: lang }).value;
          return `<pre class="hljs"><code class="language-${lang}">${highlighted}</code></pre>`;
        }
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre class="hljs"><code>${escaped}</code></pre>`;
      },
    },
  });

  export function renderMarkdown(content: string): string {
    try {
      const raw = markedInstance.parse(content) as string;
      return DOMPurify.sanitize(raw);
    } catch {
      return DOMPurify.sanitize(content);
    }
  }
</script>

<script lang="ts">
  let { content }: { content: string } = $props();

  let html = $derived.by(() => renderMarkdown(content));
</script>

<div class="markdown-content">
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
</style>
