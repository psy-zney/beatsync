import youtubedl from "youtube-dl-exec";

async function test() {
  const videoId = "6rUVN6UDhsw";
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  console.log("Extracting...");
  
  const output = (await youtubedl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    callHome: false,
    noCheckCertificates: true,
    format: "worstaudio",
  })) as any;

  const streamUrl = output.url;
  console.log("Stream URL:", streamUrl);

  const stream = { streamUrl };

  console.log("Fetching WITH Range: bytes=0- ...");
  const start = Date.now();
  const response = await fetch(stream.streamUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Range": "bytes=0-"
    }
  });

  console.log("Status:", response.status);
  console.log("Content-Type:", response.headers.get("content-type"));
  
  const buffer = await response.arrayBuffer();
  const duration = Date.now() - start;
  console.log(`Buffer size: ${buffer.byteLength} downloaded in ${duration}ms`);
}

test().catch(console.error);
