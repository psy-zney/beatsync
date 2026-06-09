import youtubedl from "youtube-dl-exec";

async function run() {
  const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  console.log("Extracting URL via yt-dlp...");
  const output = (await youtubedl(videoUrl, {
    dumpSingleJson: true,
    noWarnings: true,
    callHome: false,
    noCheckCertificates: true,
    format: "worstaudio",
  })) as any;

  const streamUrl = output.url;
  console.log("Direct Stream URL:", streamUrl);

  console.log("Fetching stream URL via Bun fetch...");
  const t0 = Date.now();
  const response = await fetch(streamUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  console.log("Response status:", response.status);
  const buffer = await response.arrayBuffer();
  console.log(`Fetched stream in ${Date.now() - t0}ms. Byte length: ${buffer.byteLength}`);
}

run().catch(console.error);
