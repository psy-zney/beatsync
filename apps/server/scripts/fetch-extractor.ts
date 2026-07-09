import { existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";

const REPO_OWNER = "psy-zney";
const REPO_NAME = "beatsync";

async function ensureYtDlpBinary() {
  const isWindows = process.platform === "win32";
  const ytdlpName = isWindows ? "yt-dlp.exe" : "yt-dlp";
  const binDir = join(__dirname, "..", "node_modules", "youtube-dl-exec", "bin");
  const ytdlpPath = join(binDir, ytdlpName);

  if (existsSync(ytdlpPath)) {
    console.log(`✅ [setup] yt-dlp binary already exists at:\n   ${ytdlpPath}`);
    return;
  }

  console.log("🔍 [setup] yt-dlp binary not found in youtube-dl-exec. Attempting to install...");
  const postinstallScript = join(__dirname, "..", "node_modules", "youtube-dl-exec", "scripts", "postinstall.js");
  if (existsSync(postinstallScript)) {
    const proc = Bun.spawnSync(["node", postinstallScript], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (proc.exitCode === 0 && existsSync(ytdlpPath)) {
      console.log(`🎉 [setup] Successfully installed yt-dlp binary at:\n   ${ytdlpPath}`);
      return;
    }
  }

  console.log("⚠️ [setup] Failed to automatically install yt-dlp binary.");
}

async function run() {
  await ensureYtDlpBinary();

  const isWindows = process.platform === "win32";
  const exeName = isWindows ? "yt-rust-extractor.exe" : "yt-rust-extractor";
  const assetName = isWindows
    ? "yt-rust-extractor-windows-x86_64.exe"
    : "yt-rust-extractor-linux-x86_64";

  const targetDir = join(__dirname, "..", "yt-rust-extractor", "target", "release");
  const destPath = join(targetDir, exeName);

  // 1. Check if binary already exists
  if (existsSync(destPath)) {
    console.log(`✅ [setup] Rust extractor binary already exists at:\n   ${destPath}`);
    return;
  }

  console.log("🔍 [setup] Rust extractor binary not found. Attempting to fetch from GitHub Releases...");

  mkdirSync(targetDir, { recursive: true });

  // 2. Try fetching latest release from GitHub API
  try {
    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": "beatsync-setup-script",
      },
    });

    if (res.ok) {
      const releaseData = (await res.json()) as {
        assets?: Array<{ name: string; browser_download_url: string }>;
        tag_name?: string;
      };

      const asset = releaseData.assets?.find((a) => a.name === assetName || a.name === exeName);

      if (asset) {
        console.log(`⬇️  [setup] Downloading ${asset.name} from release ${releaseData.tag_name || "latest"}...`);
        const binRes = await fetch(asset.browser_download_url);
        if (binRes.ok) {
          const arrayBuffer = await binRes.arrayBuffer();
          await Bun.write(destPath, arrayBuffer);
          if (!isWindows) {
            try {
              chmodSync(destPath, 0o755);
            } catch (err) {
              // ignore chmod errors
            }
          }
          console.log(`🎉 [setup] Successfully downloaded binary to:\n   ${destPath}`);
          return;
        }
      } else {
        console.log(`⚠️ [setup] No matching asset (${assetName}) found in latest release.`);
      }
    } else {
      console.log(`⚠️ [setup] GitHub Releases API returned HTTP ${res.status}.`);
    }
  } catch (err) {
    console.log(`⚠️ [setup] Failed to download from GitHub Releases: ${(err as Error).message}`);
  }

  // 3. Fallback: try compiling from source with Cargo if installed
  console.log("🔨 [setup] Attempting fallback: compiling from source with Cargo...");
  const cargoCheck = Bun.spawnSync(["cargo", "--version"]);
  if (cargoCheck.exitCode === 0) {
    console.log("🚀 [setup] Cargo found! Running build...");
    const manifestPath = join(__dirname, "..", "yt-rust-extractor", "Cargo.toml");
    const buildProc = Bun.spawnSync(["cargo", "build", "--release", "--manifest-path", manifestPath], {
      stdout: "inherit",
      stderr: "inherit",
    });

    if (buildProc.exitCode === 0) {
      console.log("🎉 [setup] Successfully compiled Rust extractor from source!");
      return;
    } else {
      console.log("❌ [setup] Cargo build failed.");
    }
  } else {
    console.log("⚠️ [setup] Cargo is not installed or not in PATH.");
  }

  console.log("\n💡 [NOTE] To enable automatic audio extraction without installing C++/Rust:");
  console.log(`   1. Create a GitHub Release in ${REPO_OWNER}/${REPO_NAME} using our CI workflow.`);
  console.log("   2. Or download yt-rust-extractor.exe manually into apps/server/yt-rust-extractor/target/release/\n");
}

run();
