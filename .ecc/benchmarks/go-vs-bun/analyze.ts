type Stats = { n: number; median: number; mad: number; min: number; max: number };

const directory = import.meta.dir;
const raw = JSON.parse(await Bun.file(`${directory}/raw-windows.json`).text());
const ramp = JSON.parse(await Bun.file(`${directory}/raw-ws-ramp.json`).text());
const buildTest = JSON.parse(await Bun.file(`${directory}/build-test.json`).text());

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stats = (values: number[]): Stats => {
  const center = median(values);
  return {
    n: values.length,
    median: round(center),
    mad: round(median(values.map((value) => Math.abs(value - center)))),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
};

function summarizeRuns(target: "bun" | "go", mode: "all_cores" | "single_core") {
  const runs = raw.runs.filter((run: any) => run.target === target && run.mode === mode);
  const metric = (read: (run: any) => number) => stats(runs.map(read));
  return {
    startupMs: metric((run) => run.startupMs),
    idleRssMiB: metric((run) => run.idle.rssBytes / 1024 / 1024),
    peakRssMiB: metric((run) => run.final.peakRssBytes / 1024 / 1024),
    httpSequential: {
      requestsPerSecond: metric((run) => run.httpSequential.requestsPerSecond),
      p50Ms: metric((run) => run.httpSequential.latency.p50Ms),
      p95Ms: metric((run) => run.httpSequential.latency.p95Ms),
      p99Ms: metric((run) => run.httpSequential.latency.p99Ms),
      cpuSeconds: metric((run) => run.httpSequential.cpuSeconds),
      requestsPerCpuSecond: metric((run) => run.httpSequential.successes / run.httpSequential.cpuSeconds),
      totalErrors: runs.reduce((sum: number, run: any) => sum + run.httpSequential.errors, 0),
    },
    httpConcurrent: {
      requestsPerSecond: metric((run) => run.httpConcurrent.requestsPerSecond),
      p50Ms: metric((run) => run.httpConcurrent.latency.p50Ms),
      p95Ms: metric((run) => run.httpConcurrent.latency.p95Ms),
      p99Ms: metric((run) => run.httpConcurrent.latency.p99Ms),
      cpuSeconds: metric((run) => run.httpConcurrent.cpuSeconds),
      requestsPerCpuSecond: metric((run) => run.httpConcurrent.successes / run.httpConcurrent.cpuSeconds),
      totalErrors: runs.reduce((sum: number, run: any) => sum + run.httpConcurrent.errors, 0),
    },
    websocketBurst: {
      handshakesPerSecond: metric((run) => run.websocket.connectionsPerSecond),
      successfulProbes: metric((run) => run.websocket.probes),
      errors: metric((run) => run.websocket.errors),
      p50MsForSuccessfulProbes: metric((run) => run.websocket.latency.p50Ms),
    },
  };
}

function summarizeRamp(target: "bun" | "go") {
  const runs = ramp.runs.filter((run: any) => run.target === target);
  const metric = (read: (run: any) => number) => stats(runs.map(read));
  return {
    opened: metric((run) => run.opened),
    survivingAfterOneSecond: metric((run) => run.survivingAfterOneSecond),
    successfulProbes: metric((run) => run.successfulProbes),
    idleRssMiB: metric((run) => run.idleRssBytes / 1024 / 1024),
    connectedRssMiB: metric((run) => run.connectedRssBytes / 1024 / 1024),
    rssDeltaMiB: metric((run) => run.rssDeltaBytes / 1024 / 1024),
    probeP50Ms: metric((run) => run.probeP50Ms),
  };
}

const summary = {
  generatedAt: new Date().toISOString(),
  statisticalConvention: "median and MAD across independent fresh-process runs; ranges retained",
  environment: raw.environment,
  protocol: raw.protocol,
  runtime: {
    allCores: { bun: summarizeRuns("bun", "all_cores"), go: summarizeRuns("go", "all_cores") },
    singleCore: { bun: summarizeRuns("bun", "single_core"), go: summarizeRuns("go", "single_core") },
    websocketRamp: { bun: summarizeRamp("bun"), go: summarizeRamp("go") },
  },
  build: {
    bunCompileSeconds: stats(buildTest.build.bunStandaloneCompileSeconds),
    goColdSeconds: stats(buildTest.build.goColdReleaseSeconds),
    goWarmSeconds: stats(buildTest.build.goWarmReleaseSeconds),
    bunArtifactMiB: round(buildTest.build.bunStandaloneArtifactBytes / 1024 / 1024),
    goArtifactMiB: round(buildTest.build.goReleaseArtifactBytes / 1024 / 1024),
  },
  tests: buildTest.tests,
  staticInventory: buildTest.staticInventory,
};

await Bun.write(`${directory}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
