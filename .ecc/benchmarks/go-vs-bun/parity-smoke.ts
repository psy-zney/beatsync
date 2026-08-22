const runtimeRoot = (process.env.BENCH_RUNTIME_ROOT ?? "C:/Users/admin/MyProject/beatsync/.benchmark-runtime").replaceAll("\\", "/");
const snapshotRoot = (process.env.BENCH_SNAPSHOT_ROOT ?? "C:/Users/admin/AppData/Local/Temp/beatsync-benchmark-20260822").replaceAll("\\", "/");
const port = 18083;
const targets = [
  { name: "bun", executable: `${runtimeRoot}/bin/bun-server.exe`, cwd: `${snapshotRoot}/bun/apps/server` },
  { name: "go", executable: `${runtimeRoot}/bin/go-server.exe`, cwd: `${snapshotRoot}/go/apps/server` },
] as const;

const sleep = (ms: number) => Bun.sleep(ms);

async function waitForHealth() {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {}
    await sleep(5);
  }
  throw new Error("health timeout");
}

function shape(value: unknown, depth = 0): unknown {
  if (depth >= 3) return typeof value;
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1)] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape((value as any)[key], depth + 1)]));
  }
  return typeof value;
}

async function request(path: string, init?: RequestInit) {
  const started = performance.now();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, signal: AbortSignal.timeout(3_000) });
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch {}
    return { status: response.status, elapsedMs: performance.now() - started, shape: shape(parsed), bodyPreview: text.slice(0, 160) };
  } catch (error) {
    return { error: String(error), elapsedMs: performance.now() - started };
  }
}

async function websocketSmoke() {
  const messages: any[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?roomId=000000&username=smoke&clientId=smoke`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("ws timeout")), 3_000);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    try { messages.push(JSON.parse(String(event.data))); } catch {}
  });
  await sleep(250);
  socket.send(JSON.stringify({ type: "NTP_REQUEST", t0: Date.now(), probeGroupId: 1, probeGroupIndex: 0 }));
  await sleep(250);
  const result = {
    state: socket.readyState,
    messageTypes: messages.map((message) => message.type),
    hasNtpResponse: messages.some((message) => message.type === "NTP_RESPONSE"),
  };
  socket.close();
  return result;
}

const results = [];
for (const target of targets) {
  const proc = Bun.spawn([target.executable], {
    cwd: target.cwd,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DEMO: "1", DEMO_ROOM_ID: "000000", DEMO_AUDIO_DIR: `${target.cwd}/demo-audio` },
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    await waitForHealth();
    results.push({
      target: target.name,
      endpoints: {
        root: await request("/"),
        health: await request("/health"),
        stats: await request("/stats"),
        activeRooms: await request("/active-rooms"),
        discover: await request("/discover"),
        defaults: await request("/default"),
        corsPreflight: await request("/health", { method: "OPTIONS" }),
        voiceUnconfigured: await request("/voice/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId: "000000", clientId: "smoke", username: "Smoke" }) }),
        uploadInDemo: await request("/upload/get-presigned-url", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      },
      websocket: await websocketSmoke(),
    });
  } finally {
    proc.kill();
    await Promise.race([proc.exited, sleep(3_000)]);
    if (proc.exitCode === null) proc.kill(9);
  }
}

const output = { generatedAt: new Date().toISOString(), mode: "DEMO=1 with empty audio directory and no external credentials", results };
await Bun.write(`${import.meta.dir}/parity-smoke.json`, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
