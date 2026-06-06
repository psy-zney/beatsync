import * as youtube from "youtube-ext";
import util from "util";

async function run() {
  console.log("Searching with youtube-ext...");
  try {
    const results = await youtube.search("Rick Astley");
    console.log(util.inspect(results.videos.slice(0, 2), { depth: null }));
  } catch (err) {
    console.error(err);
  }
}
run();
