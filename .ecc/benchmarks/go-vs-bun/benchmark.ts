import { cpus, freemem, release, totalmem } from "node:os";

type TargetName = "bun" | "go";
type Mode = "all_cores" | "single_core";

interface Target {
  name: TargetName;
  executable: string;
  cwd: string;
}

interface ProcessSample {
  cpuSeconds: number;
  rssBytes: number;
  peakRssBytes: number;
  handles: number;
  threads: number;
}

interface Distribution {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
}

const runtimeRoot = (process.env.BENCH_RUNTIME_ROOT ?? "C:/Users/admin/MyProject/beatsync/.benchmark-runtime").replaceAll("\\", "/");
const snapshotRoot = (process.env.BENCH_SNAPSHOT_ROOT ?? "C:/Users/admin/AppData/Local/Temp/beatsync-benchmark-20260822").replaceAll("\\", "/");
const outputPath = `${import.meta.dir}/raw-windows.json`;
const port = 18081;
const baseUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}`;

const targets: Target[] = [
  {
    name: "bun",
    executable: `${runtimeRoot}/bin/bun-server.exe`,
    cwd: `${snapshotRoot}/bun/apps/server`,
  },
  {
    name: "go",
    executable: `${runtimeRoot}/bin/go-server.exe`,
    cwd: `${snapshotRoot}/go/apps/server`,
  },
];

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    if (sorted.length === 0) return 0;
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  const mean = sorted.length === 0 ? 0 : sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    minMs: round(sorted[0] ?? 0),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    p99Ms: round(percentile(0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
    meanMs: round(mean),
  };
}

async function sleep(ms: number): Promise<void> {
  await Bun.sleep(ms);
}

function processSample(pid: number): ProcessSample {
  const command = `$p=Get-Process -Id ${pid}; [PSCustomObject]@{cpuSeconds=$p.CPU;rssBytes=$p.WorkingSet64;peakRssBytes=$p.PeakWorkingSet64;handles=$p.HandleCount;threads=$p.Threads.Count}|ConvertTo-Json -Compress`;
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Cannot sample process ${pid}: ${result.stderr.toString()}`);
  }
  return JSON.parse(result.stdout.toString()) as ProcessSample;
}

function constrainToSingleCore(pid: number): void {
  const command = `$p=Get-Process -Id ${pid};$p.ProcessorAffinity=1;$p.PriorityClass='BelowNormal'`;
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", command], {
    stdout: "ignore",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Cannot constrain process ${pid}: ${result.stderr.toString()}`);
  }
}

async function waitForHealth(timeoutMs = 10_000): Promise<number> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        await response.arrayBuffer();
        return performance.now() - started;
      }
    } catch {
      // The process is still starting.
    }
    await sleep(2);
  }
  throw new Error("Server did not become healthy in time");
}

async function httpLoad(concurrency: number, durationMs: number) {
  const latencies: number[] = [];
  let successes = 0;
  let errors = 0;
  const started = performance.now();
  const deadline = started + durationMs;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const requestStarted = performance.now();
        try {
          const response = await fetch(`${baseUrl}/health`);
          await response.arrayBuffer();
          if (response.ok) successes += 1;
          else errors += 1;
        } catch {
          errors += 1;
        } finally {
          latencies.push(performance.now() - requestStarted);
        }
      }
    }),
  );

  const elapsedMs = performance.now() - started;
  return {
    concurrency,
    elapsedMs: round(elapsedMs),
    requestsPerSecond: round((successes * 1000) / elapsedMs),
    successes,
    errors,
    latency: distribution(latencies),
  };
}

function connectWebSocket(index: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const clientId = `bench-${index}`;
    const socket = new WebSocket(
      `${wsUrl}/ws?roomId=000000&username=${clientId}&clientId=${clientId}`,
    );
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`WebSocket ${index} connection timeout`));
    }, 10_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket ${index} connection failed`));
      },
      { once: true },
    );
  });
}

function ntpProbe(socket: WebSocket, probeId: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const t0 = performance.timeOrigin + started;
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("NTP response timeout"));
    }, 5_000);
    const onMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string; t0?: number };
        // Only one probe is outstanding per socket. Do not require exact
        // floating-point equality after a JSON round trip through Go.
        if (payload.type === "NTP_RESPONSE") {
          clearTimeout(timeout);
          socket.removeEventListener("message", onMessage);
          resolve(performance.now() - started);
        }
      } catch {
        // Ignore unrelated initialization messages.
      }
    };
    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify({
        type: "NTP_REQUEST",
        t0,
        probeGroupId: probeId,
        probeGroupIndex: probeId % 2,
      }),
    );
  });
}

async function websocketLoad(pid: number, clientCount = 200, probeRounds = 5) {
  const before = processSample(pid);
  const connectStarted = performance.now();
  const sockets = await Promise.all(Array.from({ length: clientCount }, (_, index) => connectWebSocket(index)));
  const connectElapsedMs = performance.now() - connectStarted;
  await sleep(500);
  const connected = processSample(pid);
  const latencies: number[] = [];
  let errors = 0;
  const probeStarted = performance.now();
  for (let roundIndex = 0; roundIndex < probeRounds; roundIndex += 1) {
    const outcomes = await Promise.allSettled(
      sockets.map((socket, index) => ntpProbe(socket, roundIndex * clientCount + index)),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") latencies.push(outcome.value);
      else errors += 1;
    }
  }
  const probeElapsedMs = performance.now() - probeStarted;
  const after = processSample(pid);
  for (const socket of sockets) socket.close();
  await sleep(300);
  return {
    clients: clientCount,
    connectElapsedMs: round(connectElapsedMs),
    connectionsPerSecond: round((clientCount * 1000) / connectElapsedMs),
    rssBeforeBytes: before.rssBytes,
    rssConnectedBytes: connected.rssBytes,
    rssDeltaBytes: connected.rssBytes - before.rssBytes,
    approximateBytesPerConnection: round((connected.rssBytes - before.rssBytes) / clientCount),
    probes: latencies.length,
    errors,
    probeElapsedMs: round(probeElapsedMs),
    probesPerSecond: round((latencies.length * 1000) / probeElapsedMs),
    latency: distribution(latencies),
    cpuSeconds: round(after.cpuSeconds - connected.cpuSeconds),
    peakRssBytes: after.peakRssBytes,
  };
}

async function stopProcess(proc: Bun.Subprocess): Promise<void> {
  proc.kill();
  await Promise.race([proc.exited, sleep(3_000)]);
  if (proc.exitCode === null) proc.kill(9);
}

async function runTarget(target: Target, mode: Mode, roundIndex: number) {
  const processStarted = performance.now();
  const proc = Bun.spawn([target.executable], {
    cwd: target.cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DEMO: "1",
      DEMO_ROOM_ID: "000000",
      DEMO_AUDIO_DIR: `${target.cwd}/demo-audio`,
      MEMORY_SOFT_LIMIT_MB: "384",
      MEMORY_HARD_LIMIT_MB: "448",
      MAX_CONNECTIONS_PER_ROOM: "1000",
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    const healthReadyMs = await waitForHealth();
    const startupMs = performance.now() - processStarted;
    if (mode === "single_core") constrainToSingleCore(proc.pid);
    await sleep(1_000);
    const idle = processSample(proc.pid);

    const websocket = await websocketLoad(proc.pid);

    await httpLoad(8, 400); // warm-up, excluded from results

    let before = processSample(proc.pid);
    const httpSequential = await httpLoad(1, 2_000);
    let after = processSample(proc.pid);
    const sequentialCpuSeconds = round(after.cpuSeconds - before.cpuSeconds);

    before = processSample(proc.pid);
    const httpConcurrent = await httpLoad(32, 3_000);
    after = processSample(proc.pid);
    const concurrentCpuSeconds = round(after.cpuSeconds - before.cpuSeconds);

    const final = processSample(proc.pid);
    return {
      target: target.name,
      mode,
      round: roundIndex,
      healthReadyMs: round(healthReadyMs),
      startupMs: round(startupMs),
      idle,
      httpSequential: { ...httpSequential, cpuSeconds: sequentialCpuSeconds },
      httpConcurrent: { ...httpConcurrent, cpuSeconds: concurrentCpuSeconds },
      websocket,
      final,
    };
  } finally {
    await stopProcess(proc);
  }
}

const runs: unknown[] = [];
const schedule: Array<{ mode: Mode; rounds: number }> = [
  { mode: "all_cores", rounds: 5 },
  { mode: "single_core", rounds: 3 },
];

for (const item of schedule) {
  for (let roundIndex = 1; roundIndex <= item.rounds; roundIndex += 1) {
    const order = roundIndex % 2 === 1 ? targets : [...targets].reverse();
    for (const target of order) {
      console.error(`Running ${target.name} / ${item.mode} / round ${roundIndex}`);
      runs.push(await runTarget(target, item.mode, roundIndex));
    }
  }
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  branches: {
    bun: { ref: "backup/bun-backend", commit: "a282e6bdba776ff33c3797d5fd85b1c8837566fa" },
    go: { ref: "migration/go-backend", commit: "0987e39" },
  },
  environment: {
    platform: process.platform,
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtStart: freemem(),
    bunVersion: Bun.version,
    goVersion: "go1.26.5",
  },
  protocol: {
    order: "alternating Bun/Go per round",
    warmup: "400 ms at concurrency 8 per fresh server process",
    allCoreRounds: 5,
    singleCoreRounds: 3,
    httpSequential: "closed-loop GET /health, concurrency 1, 2 seconds",
    httpConcurrent: "closed-loop GET /health, concurrency 32, 3 seconds",
    websocket: "200 connections, then 5 NTP probes per connection",
  },
  runs,
};

await Bun.write(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
