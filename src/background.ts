chrome.runtime.onMessage.addListener((message, sender) => {
  if (message['tag'] === "netflix-opensubtitles-message") {
    const extMessage = message['payload'] as NetflixOpensubtitlesPayload;

    if (extMessage['type'] == "show-page-action") {
      chrome.pageAction.show(sender.tab!.id!);
    } else if (extMessage['type'] == "hide-page-action") {
      chrome.pageAction.hide(sender.tab!.id!);
    }
  }
});

chrome.pageAction.onClicked.addListener(tab => {
  chrome.tabs.sendMessage(tab.id!, {
    'tag': "netflix-opensubtitles-message",
    'direction': "from-background",
    'payload': { type: "page-action-clicked" }
  } as NetflixOpensubtitlesMessage)
});