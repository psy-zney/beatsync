import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
const serverDir = join(projectDir, "apps", "server");
const executableName = process.platform === "win32" ? "go.exe" : "go";
const bundledGo = join(projectDir, "local", "tooling", "go", "bin", executableName);
const go = Bun.which("go") ?? (existsSync(bundledGo) ? bundledGo : null);

if (!go) {
  console.error("Go was not found. Install Go 1.26+ or put it in local/tooling/go/bin, then run bun dev again.");
  process.exit(1);
}

// Keep the development executable in the workspace. Some Windows machines
// allow project binaries but block go run's executables in the temporary folder.
const outputDir = join(serverDir, "dist");
mkdirSync(outputDir, { recursive: true });
const binary = join(outputDir, process.platform === "win32" ? "beatsync-server-dev.exe" : "beatsync-server-dev");
const defaultCache = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "go-build")
  : join(projectDir, ".cache", "go-build");
mkdirSync(defaultCache, { recursive: true });

const spawnEnv = {
  ...process.env,
  GOCACHE: process.env.GOCACHE || defaultCache,
};

console.log("Building the local Go backend...");
const build = Bun.spawn([go, "build", "-o", binary, "./cmd/beatsync"], {
  cwd: serverDir,
  env: spawnEnv,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const buildExitCode = await build.exited;
if (buildExitCode !== 0) process.exit(buildExitCode);

const server = Bun.spawn([binary], { cwd: serverDir, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
process.exit(await server.exited);
