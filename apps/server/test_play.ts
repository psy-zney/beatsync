import ytdl from "youtube-dl-exec";

async function test() {
  try {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    console.log("Getting info via yt-dlp...");
    const output = (await ytdl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      callHome: false,
      noCheckCertificates: true,
      format: "bestaudio/best"
    })) as any;
    console.log("Title:", output.title);
    console.log("Direct URL:", output.url);

    console.log("Fetching stream URL via Bun fetch...");
    const response = await fetch(output.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    console.log("Status:", response.status);
    console.log("Status Text:", response.statusText);
    console.log("Content-Length:", response.headers.get("content-length"));
    console.log("Content-Type:", response.headers.get("content-type"));
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
