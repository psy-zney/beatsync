const fs = require('fs');
const files = [
  'src/__tests__/roomCleanup.test.ts',
  'src/__tests__/audioLoadingCoordination.test.ts',
  'src/__tests__/staleClientReaping.test.ts',
  'src/__tests__/isolated/demoMode.test.ts',
  'src/__tests__/restoreCleanup.test.ts'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Fix roomCleanup syntax error
    if (file.includes('roomCleanup.test.ts')) {
      content = content.replace(/beforeEach\(\(\) => \{\s+clock = sinon\.useFakeTimers\(\{ shouldClearNativeTimers: true, toFake: \["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"\] \}\);\s+globalManager\.deleteRoom\(roomId\);/g, 
        `beforeEach(() => {
    clock = sinon.useFakeTimers({ shouldClearNativeTimers: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const roomIds = globalManager.getRoomIds();
    for (const roomId of roomIds) {
      globalManager.deleteRoom(roomId);`);
    }

    content = content.replace(/clock = sinon\.useFakeTimers\(\);/g, 'clock = sinon.useFakeTimers({ shouldClearNativeTimers: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });');
    fs.writeFileSync(file, content);
  }
}
