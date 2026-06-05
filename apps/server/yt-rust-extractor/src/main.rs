use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::{Command, exit};

#[derive(Serialize)]
struct Output {
    stream_url: String,
    title: String,
}

#[derive(Serialize)]
struct ErrorOutput {
    error: String,
}

#[derive(Deserialize)]
struct YtdlOutput {
    url: Option<String>,
    title: Option<String>,
}

fn find_yt_dlp() -> Result<PathBuf, String> {
    let ytdlp_name = if cfg!(target_os = "windows") { "yt-dlp.exe" } else { "yt-dlp" };

    // 1. Try relative to current exe
    if let Ok(exe_path) = env::current_exe() {
        let mut path = exe_path;
        for _ in 0..4 {
            if let Some(parent) = path.parent() {
                path = parent.to_path_buf();
            } else {
                break;
            }
        }
        let candidate = path.join("node_modules").join("youtube-dl-exec").join("bin").join(ytdlp_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // 2. Try relative to current working directory
    if let Ok(cwd) = env::current_dir() {
        let candidate1 = cwd.join("node_modules").join("youtube-dl-exec").join("bin").join(ytdlp_name);
        if candidate1.exists() {
            return Ok(candidate1);
        }
        let candidate2 = cwd.join("apps").join("server").join("node_modules").join("youtube-dl-exec").join("bin").join(ytdlp_name);
        if candidate2.exists() {
            return Ok(candidate2);
        }
    }

    // 3. Fallback to just "yt-dlp" in PATH
    Ok(PathBuf::from("yt-dlp"))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        let err = ErrorOutput {
            error: "Missing YouTube URL argument".to_string(),
        };
        println!("{}", serde_json::to_string(&err).unwrap());
        exit(1);
    }

    let url = &args[1];

    let yt_dlp_path = match find_yt_dlp() {
        Ok(p) => p,
        Err(e) => {
            let err = ErrorOutput { error: e };
            println!("{}", serde_json::to_string(&err).unwrap());
            exit(1);
        }
    };

    let result = Command::new(yt_dlp_path)
        .args(&["--dump-json", "-f", "bestaudio", url])
        .output();

    let output = match result {
        Ok(o) => o,
        Err(e) => {
            let err = ErrorOutput {
                error: format!("Failed to execute yt-dlp: {}", e),
            };
            println!("{}", serde_json::to_string(&err).unwrap());
            exit(1);
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let err = ErrorOutput {
            error: format!("yt-dlp failed (code {:?}): {} {}", output.status.code(), stderr, stdout),
        };
        println!("{}", serde_json::to_string(&err).unwrap());
        exit(1);
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let parsed: YtdlOutput = match serde_json::from_str(&stdout_str) {
        Ok(p) => p,
        Err(e) => {
            let err = ErrorOutput {
                error: format!("Failed to parse yt-dlp JSON output: {}. Raw output: {}", e, stdout_str),
            };
            println!("{}", serde_json::to_string(&err).unwrap());
            exit(1);
        }
    };

    let stream_url = match parsed.url {
        Some(u) => u,
        None => {
            let err = ErrorOutput {
                error: "No stream URL found in yt-dlp output".to_string(),
            };
            println!("{}", serde_json::to_string(&err).unwrap());
            exit(1);
        }
    };

    let final_output = Output {
        stream_url,
        title: parsed.title.unwrap_or_else(|| "YouTube Audio".to_string()),
    };

    println!("{}", serde_json::to_string(&final_output).unwrap());
}
