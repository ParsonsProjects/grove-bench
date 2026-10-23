/**
 * Minimal fake of OpenRouter's chat completions endpoint (OpenAI streaming
 * format). `script(body, n)` returns the reply for the n-th request:
 * { text, reasoning?, delayMs? }, { toolCalls: [{ name, args }] } or
 * { status, error, headers? }. `delayMs` pauses between streamed chunks;
 * `streamError` ends a 200 stream with an error chunk, as OpenRouter does.
 * Every request is kept in `requests` (and appended to `logFile`).
 */
import http from 'node:http';
import fs from 'node:fs';

export async function startFake({ script, logFile }) {
  const log = fs.createWriteStream(logFile);
  let n = 0;
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      const idx = n++;
      const entry = { idx, method: req.method, url: req.url, auth: req.headers.authorization, headers: pick(req.headers), body, at: Date.now() };
      requests.push(entry);
      log.write(JSON.stringify(entry) + '\n');
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
        res.writeHead(404).end('{}');
        return;
      }
      const reply = script(body, idx);
      if (reply.status) {
        res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) }).end(JSON.stringify({ error: reply.error }));
        return;
      }
      // The client hanging up mid-stream (e.g. after Stop) is recorded as `aborted`.
      res.on('close', () => { if (!res.writableFinished) entry.aborted = Date.now(); });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const base = { id: `gen-${idx}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model };
      const pause = () => (reply.delayMs ? new Promise((r) => setTimeout(r, reply.delayMs)) : null);
      const send = async (delta, finish = null, extra = {}) => {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
        await pause();
      };
      await send({ role: 'assistant', content: '' });
      if (reply.reasoning) await send({ reasoning: reply.reasoning });
      if (reply.text) for (const part of reply.text.match(/.{1,12}/gs)) await send({ content: part });
      for (const [i, tc] of (reply.toolCalls ?? []).entries()) {
        await send({ tool_calls: [{ index: i, id: `call_${idx}_${i}`, type: 'function', function: { name: tc.name, arguments: '' } }] });
        await send({ tool_calls: [{ index: i, function: { arguments: JSON.stringify(tc.args) } }] });
      }
      if (res.destroyed) return;
      if (reply.streamError) {
        // OpenRouter reports errors that happen after the 200 as a final chunk.
        res.write(`data: ${JSON.stringify({ ...base, error: reply.streamError, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      await send({}, reply.toolCalls?.length ? 'tool_calls' : 'stop');
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 1200 + idx, completion_tokens: 40, total_tokens: 1240 + idx, cost: 0.00005 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/api/v1`, requests, close: () => { server.close(); log.end(); } };
}

function pick(h) {
  const out = {};
  for (const k of Object.keys(h)) if (/^(x-|http-referer|user-agent)/i.test(k)) out[k] = h[k];
  return out;
}
