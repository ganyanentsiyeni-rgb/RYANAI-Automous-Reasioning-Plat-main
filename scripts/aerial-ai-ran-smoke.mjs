import { spawn } from 'node:child_process';

const port = Number(process.env.AERIAL_BRIDGE_PORT || 8791);
const base = 'http://127.0.0.1:' + port;
const child = spawn('python3', ['aerial-bridge/server.py'], {
  env: { ...process.env, AERIAL_BRIDGE_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let healthy = false;
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(500) });
      healthy = response.ok;
      if (healthy) break;
    } catch {}
    await wait(100);
  }

  if (!healthy) throw new Error('Aerial development bridge did not become healthy.\n' + output);

  const response = await fetch(base + '/v1/inference', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'aerial-dev', prompt: 'RyanAI Aerial AI-RAN smoke test' }),
  });

  if (!response.ok) throw new Error('Aerial inference smoke test returned HTTP ' + response.status);
  const result = await response.json();
  if (result.runtime !== 'development-simulator' || typeof result.response !== 'string') {
    throw new Error('Aerial smoke test returned an invalid development contract response.');
  }

  console.log(JSON.stringify({
    status: 'passed',
    health: 'passed',
    inference: 'passed',
    runtime: result.runtime,
  }, null, 2));
} finally {
  child.kill('SIGTERM');
}
