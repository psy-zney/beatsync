import { Glob } from "bun";
import * as fs from "fs";

async function run() {
  const glob = new Glob("src/__tests__/**/*.ts");
  let modifiedCount = 0;

  for await (const file of glob.scan(".")) {
    let content = fs.readFileSync(file, "utf8");
    let changed = false;

    if (content.includes("handleOpen(")) {
      content = content.replace(/void handleOpen\(/g, "await handleOpen(");
      content = content.replace(/^[ \t]*handleOpen\(/gm, (match) => match.replace("handleOpen", "await handleOpen"));
      changed = true;
    }

    if (changed) {
      content = content.replace(/it\((["'].*?["']),\s*\(\)\s*=>\s*\{/g, 'it($1, async () => {');
      fs.writeFileSync(file, content);
      modifiedCount++;
    }
  }

  console.log(`Modified ${modifiedCount} files`);
}

run().catch(console.error);

