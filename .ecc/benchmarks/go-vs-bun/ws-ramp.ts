import { cpus } from "node:os";

const runtimeRoot = (process.env.BENCH_RUNTIME_ROOT ?? "C:/Users/admin/MyProject/beatsync/.benchmark-runtime").replaceAll("\\", "/");
const snapshotRoot = (process.env.BENCH_SNAPSHOT_ROOT ?? "C:/Users/admin/AppData/Local/Temp/beatsync-benchmark-20260822").replaceAll("\\", "/");
const port = 18082;
const baseUrl = `http://127.0.0.1:${port}`;
const targets = [
  { name: "bun", executable: `${runtimeRoot}/bin/bun-server.exe`, cwd: `${snapshotRoot}/bun/apps/server` },
  { name: "go", executable: `${runtimeRoot}/bin/go-server.exe`, cwd: `${snapshotRoot}/go/apps/server` },
] as const;

const sleep = (ms: number) => Bun.sleep(ms);

function sample(pid: number) {
  const command = `$p=Get-Process -Id ${pid};[PSCustomObject]@{cpuSeconds=$p.CPU;rssBytes=$p.WorkingSet64;peakRssBytes=$p.PeakWorkingSet64}|ConvertTo-Json -Compress`;
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", command], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}

async function waitForHealth() {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await sleep(5);
  }
  throw new Error("health timeout");
}

function connect(index: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const id = `ramp-${index}`;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?roomId=000000&username=${id}&clientId=${id}`);
    const timeout = setTimeout(() => reject(new Error("connect timeout")), 5_000);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(socket); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("connect error")); }, { once: true });
  });
}

function probe(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timeout = setTimeout(() => { socket.removeEventListener("message", handler); reject(new Error("probe timeout")); }, 2_000);
    const handler = (event: MessageEvent) => {
      try {
        const value = JSON.parse(String(event.data));
        if (value.type === "NTP_RESPONSE") {
          clearTimeout(timeout);
          socket.removeEventListener("message", handler);
          resolve(performance.now() - started);
        }
      } catch {}
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({ type: "NTP_REQUEST", t0: Date.now(), probeGroupId: 1, probeGroupIndex: 0 }));
  });
}

async function run(target: typeof targets[number], round: number) {
  const proc = Bun.spawn([target.executable], {
    cwd: target.cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DEMO: "1",
      DEMO_ROOM_ID: "000000",
      DEMO_AUDIO_DIR: `${target.cwd}/demo-audio`,
      MAX_CONNECTIONS_PER_ROOM: "1000",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    await waitForHealth();
    await sleep(750);
    const before = sample(proc.pid);
    const promises: Promise<WebSocket>[] = [];
    const started = performance.now();
    for (let index = 0; index < 200; index += 1) {
      promises.push(connect(index));
      await sleep(25); // 200 clients over approximately five seconds.
    }
    const settled = await Promise.allSettled(promises);
    const opened = settled.filter((item): item is PromiseFulfilledResult<WebSocket> => item.status === "fulfilled").map((item) => item.value);
    await sleep(1_000);
    const survivors = opened.filter((socket) => socket.readyState === WebSocket.OPEN);
    const connected = sample(proc.pid);
    const probes = await Promise.allSettled(survivors.map(probe));
    const successful = probes.filter((item): item is PromiseFulfilledResult<number> => item.status === "fulfilled").map((item) => item.value);
    for (const socket of opened) socket.close();
    return {
      target: target.name,
      round,
      attempted: 200,
      opened: opened.length,
      survivingAfterOneSecond: survivors.length,
      successfulProbes: successful.length,
      rampElapsedMs: performance.now() - started,
      probeP50Ms: successful.sort((a, b) => a - b)[Math.floor(successful.length / 2)] ?? null,
      idleRssBytes: before.rssBytes,
      connectedRssBytes: connected.rssBytes,
      rssDeltaBytes: connected.rssBytes - before.rssBytes,
      peakRssBytes: connected.peakRssBytes,
    };
  } finally {
    proc.kill();
    await Promise.race([proc.exited, sleep(3_000)]);
    if (proc.exitCode === null) proc.kill(9);
  }
}

const runs = [];
for (let round = 1; round <= 3; round += 1) {
  const order = round % 2 ? targets : [...targets].reverse();
  for (const target of order) {
    console.error(`WS ramp ${target.name} round ${round}`);
    runs.push(await run(target, round));
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, bunVersion: Bun.version, goVersion: "go1.26.5" },
  protocol: "200 WebSocket handshakes ramped uniformly over 5 seconds; settle 1 second; one NTP probe per surviving socket",
  runs,
};
await Bun.write(`${import.meta.dir}/raw-ws-ramp.json`, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output));
