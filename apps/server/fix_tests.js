const fs = require('fs');
const glob = require('glob');
const path = require('path');

const files = glob.sync('src/__tests__/**/*.ts');
let modifiedCount = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (content.includes('handleOpen(')) {
    // replace `void handleOpen` with `await handleOpen`
    content = content.replace(/void handleOpen\(/g, 'await handleOpen(');
    
    // replace `handleOpen(` at the start of lines with `await handleOpen(`
    content = content.replace(/^[ \t]*handleOpen\(/gm, (match) => match.replace('handleOpen', 'await handleOpen'));
    
    changed = true;
  }

  if (changed) {
    // find all `it("...", () => {` and replace with `it("...", async () => {`
    content = content.replace(/it\((["'].*?["']),\s*\(\)\s*=>\s*\{/g, 'it($1, async () => {');
    
    // some `it("...", (done) =>` might exist, don't break them, but none do
    fs.writeFileSync(file, content);
    modifiedCount++;
  }
}

console.log(`Modified ${modifiedCount} files`);
