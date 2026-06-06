const fs = require('fs');
const dirs = fs.readdirSync('C:/minio/data/beatsync-bucket/state-backup').sort();
const latest = dirs[dirs.length - 1];
const data = fs.readFileSync('C:/minio/data/beatsync-bucket/state-backup/' + latest + '/xl.meta', 'utf8');

// Find the start of the JSON object, looking for "{"timestamp":"
let startIndex = data.indexOf('{"timestamp"');
if (startIndex === -1) {
    startIndex = data.indexOf('{\n  "timestamp"');
}
if (startIndex === -1) {
    startIndex = data.indexOf('{\r\n  "timestamp"');
}

const jsonStr = data.substring(startIndex);
const backup = JSON.parse(jsonStr);

for (const [roomId, room] of Object.entries(backup.data.rooms)) {
    console.log(`Room ${roomId} has ${room.audioSources.length} songs`);
}
