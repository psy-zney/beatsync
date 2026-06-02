import { globalManager } from "./src/managers/GlobalManager";

const room = globalManager.getOrCreateRoom("test-room");
room.addAudioSource({ url: "url1", title: "title1" });
room.addAudioSource({ url: "url2", title: "title2" });
console.log("Sources in room:", room.getAudioSources());
if (room.getAudioSources().length === 2) {
  console.log("SUCCESS: Multiple audio sources preserved correctly in queue!");
} else {
  console.log("FAILURE: Multiple audio sources not preserved!");
}
