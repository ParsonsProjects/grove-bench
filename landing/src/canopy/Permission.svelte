<script>
  /**
   * The feat/api conversation stopped on a permission prompt. Answering here
   * changes its lamp and bubble in the scene.
   *
   * @type {{ status?: 'pending' | 'allow' | 'always' | 'deny', onanswer?: (choice: 'allow' | 'always' | 'deny' | null) => void }}
   */
  let { status = 'pending', onanswer } = $props();

  const results = {
    pending: 'Its lamp stays amber until you answer.',
    allow: 'Allowed. The lamp goes blue and it carries on.',
    always: 'Always allowed. The lamp goes blue and it carries on.',
    deny: 'Denied. It says what it will try instead.',
  };
</script>

<div class="prompt" role="group" aria-labelledby="perm-q">
  <p id="perm-q" class="q">
    <span class="lamp" class:answered={status !== 'pending'} aria-hidden="true"></span>
    <span><b>feat/api</b> wants to run</span>
  </p>
  <pre class="cmd" aria-label="Command: npm install zod"><span class="dollar" aria-hidden="true">$</span> npm install zod</pre>
  <div class="btns">
    <button type="button" class="cn-btn allow" class:chosen={status === 'allow'} disabled={status !== 'pending'} onclick={() => onanswer?.('allow')}>
      Allow
    </button>
    <button type="button" class="cn-btn allow" class:chosen={status === 'always'} disabled={status !== 'pending'} onclick={() => onanswer?.('always')}>
      Always Allow
    </button>
    <button type="button" class="cn-btn deny" class:chosen={status === 'deny'} disabled={status !== 'pending'} onclick={() => onanswer?.('deny')}>
      Deny
    </button>
  </div>
  <div class="foot">
    <p class="result" aria-live="polite">{results[status]}</p>
    {#if status !== 'pending'}
      <button type="button" class="again" onclick={() => onanswer?.(null)}>Ask again</button>
    {/if}
  </div>
</div>

<style>
  .prompt {
    margin-top: 16px;
    padding: 12px 14px 12px;
    background: rgb(245 158 11 / 0.08);
    box-shadow: inset 0 0 0 1px rgb(245 158 11 / 0.45);
  }
  .q {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: #f2e3c4;
  }
  .q b {
    color: oklch(0.82 0.11 200);
    font-weight: 700;
  }
  .lamp {
    width: 9px;
    height: 9px;
    flex: none;
    background: #f59e0b;
    box-shadow: 0 0 0 2px var(--ink);
    animation: lamp 1s steps(2) infinite;
  }
  .lamp.answered {
    background: oklch(0.62 0.17 254.6);
    animation: none;
  }
  @keyframes lamp {
    50% {
      opacity: 0.45;
    }
  }
  .cmd {
    margin-top: 8px;
    padding: 6px 10px;
    font-family: inherit;
    font-size: 14px;
    color: #e3e7f1;
    background: #07090f;
    overflow-x: auto;
  }
  .dollar {
    color: #6aa8ff;
  }
  .btns {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px 12px;
  }
  .foot {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    min-height: 24px;
  }
  .result {
    font-size: 14px;
    line-height: 1.5;
    color: #c7cfe0;
  }
  .again {
    font-family: inherit;
    font-size: 13px;
    color: #ffe7a8;
    text-decoration: underline;
    text-underline-offset: 3px;
    background: none;
    cursor: pointer;
    min-height: 32px;
  }
  @media (prefers-reduced-motion: reduce) {
    .lamp {
      animation: none;
    }
  }
</style>
