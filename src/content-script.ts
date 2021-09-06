import * as $ from "jquery";

window.addEventListener('message', ev => {
  if (ev.data['tag'] === "netflix-opensubtitles-message" && ev.data['direction'] === "to-background") {
    chrome.runtime.sendMessage(ev.data);
  }
});

chrome.runtime.onMessage.addListener(message => {
  if (message['tag'] === "netflix-opensubtitles-message" && message['direction'] === "from-background") {
    window.postMessage(message, "*");
  }
});

$(() => {
  const workerScript = document.createElement('script');
  workerScript.src = OS_PAYLOAD_SRC;
  (document.head || document.body).appendChild(workerScript);
});