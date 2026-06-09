import youtubedl from "youtube-dl-exec";

async function run() {
  const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  console.log("Extracting URL via yt-dlp...");
  const output = (await youtubedl(videoUrl, {
    dumpSingleJson: true,
    noWarnings: true,
    callHome: false,
    noCheckCertificates: true,
    format: "bestaudio/best",
  })) as any;

  const streamUrl = output.url;
  console.log("Direct Stream URL length:", streamUrl.length);

  const localProxyUrl = `http://127.0.0.1:8080/youtube/proxy?url=${encodeURIComponent(streamUrl)}`;
  console.log("Fetching local proxy URL:", localProxyUrl);

  try {
    const res = await fetch(localProxyUrl, {
      method: "GET"
    });

    console.log("Proxy response status:", res.status);
    console.log("Proxy response statusText:", res.statusText);
    console.log("Proxy headers:");
    res.headers.forEach((val, key) => {
      console.log(`  ${key}: ${val}`);
    });

    const text = await res.text();
    console.log("Proxy response length:", text.length);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

run().catch(console.error);
