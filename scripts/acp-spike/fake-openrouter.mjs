/**
 * Minimal fake of OpenRouter's chat completions endpoint (OpenAI streaming
 * format). `script(body, n)` returns the reply for the n-th request:
 * { text, reasoning? }, { toolCalls: [{ name, args }] } or { status, error }.
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
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const idx = n++;
      const entry = { idx, method: req.method, url: req.url, auth: req.headers.authorization, headers: pick(req.headers), body };
      requests.push(entry);
      log.write(JSON.stringify(entry) + '\n');
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
        res.writeHead(404).end('{}');
        return;
      }
      const reply = script(body, idx);
      if (reply.status) {
        res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: reply.error }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const base = { id: `gen-${idx}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model };
      const send = (delta, finish = null, extra = {}) =>
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (reply.reasoning) send({ reasoning: reply.reasoning });
      if (reply.text) for (const part of reply.text.match(/.{1,12}/gs)) send({ content: part });
      (reply.toolCalls ?? []).forEach((tc, i) => {
        send({ tool_calls: [{ index: i, id: `call_${idx}_${i}`, type: 'function', function: { name: tc.name, arguments: '' } }] });
        send({ tool_calls: [{ index: i, function: { arguments: JSON.stringify(tc.args) } }] });
      });
      send({}, reply.toolCalls?.length ? 'tool_calls' : 'stop');
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
