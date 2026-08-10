use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio, exit};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Serialize)]
struct ErrorOutput {
    error: String,
}

#[derive(Serialize)]
struct Output {
    stream_url: String,
    title: String,
}

fn fail(message: impl Into<String>) -> ! {
    let payload = ErrorOutput {
        error: message.into(),
    };
    println!(
        "{}",
        serde_json::to_string(&payload)
            .unwrap_or_else(|_| r#"{"error":"extractor failure"}"#.to_string())
    );
    exit(1);
}

fn find_yt_dlp() -> PathBuf {
    if let Some(configured) = env::var_os("YTDLP_PATH").filter(|value| !value.is_empty()) {
        return PathBuf::from(configured);
    }

    let binary = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    if let Ok(executable) = env::current_exe()
        && let Some(directory) = executable.parent()
    {
        let sibling = directory.join(binary);
        if sibling.is_file() {
            return sibling;
        }
    }
    PathBuf::from(binary)
}

fn main() {
    let url = env::args()
        .nth(1)
        .unwrap_or_else(|| fail("Missing YouTube URL argument"));
    if !(url.starts_with("https://www.youtube.com/") || url.starts_with("https://youtube.com/")) {
        fail("Only canonical HTTPS YouTube URLs are accepted");
    }

    // --print keeps stdout to two tiny JSON strings. The old --dump-json path
    // emitted every available media format and consumed much more memory.
    let mut command = Command::new(find_yt_dlp());
    command.args([
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--no-cache-dir",
        "-f",
        "bestaudio/best",
        "--print",
        "%(url)j",
        "--print",
        "%(title)j",
    ]);

    if let Some(cookies) = env::var_os("YOUTUBE_COOKIES_PATH")
        && Path::new(&cookies).is_file()
    {
        command.arg("--cookies").arg(cookies);
    }
    command.arg(&url);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .unwrap_or_else(|error| fail(format!("Failed to execute yt-dlp: {error}")));
    let deadline = Instant::now() + Duration::from_secs(25);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                fail("yt-dlp timed out after 25 seconds");
            }
            Err(error) => fail(format!("Failed while waiting for yt-dlp: {error}")),
        }
    }
    let output = child
        .wait_with_output()
        .unwrap_or_else(|error| fail(format!("Failed to collect yt-dlp output: {error}")));
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let compact = stderr.chars().take(2_000).collect::<String>();
        fail(format!(
            "yt-dlp failed (code {:?}): {compact}",
            output.status.code()
        ));
    }
    if output.stdout.len() > 64 * 1024 {
        fail("yt-dlp output exceeded 64 KiB");
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let stream_url: String = serde_json::from_str(lines.next().unwrap_or_default())
        .unwrap_or_else(|error| fail(format!("Invalid yt-dlp URL JSON: {error}")));
    let title: String = serde_json::from_str(lines.next().unwrap_or(r#""YouTube Audio""#))
        .unwrap_or_else(|error| fail(format!("Invalid yt-dlp title JSON: {error}")));
    if !(stream_url.starts_with("https://") || stream_url.starts_with("http://")) {
        fail("yt-dlp returned no valid stream URL");
    }
    println!(
        "{}",
        serde_json::to_string(&Output { stream_url, title }).unwrap()
    );
}
