import * as Protocol from "./protocol";

import * as OS from "./opensubtitles";

const openSubtitles = new OS.OS(undefined, true); // use default SSL endpoint

chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message['tag'] === "netflix-opensubtitles-message") {
    const extMessage = message['payload'] as Protocol.NetflixOpensubtitlesPayload;

    if (extMessage.type == "show-page-action") {
      chrome.pageAction.show(sender.tab!.id!);
    } else if (extMessage.type == "hide-page-action") {
      chrome.pageAction.hide(sender.tab!.id!);
    } else if (extMessage.type == "opensubtitles-call") {
      let response;
      try {
        if (extMessage.method == 'LogIn') {
          const request = extMessage.request as Protocol.LoginRequest;
          response = { type: 'success', value: await openSubtitles.LogIn(
            request.username,
            request.password,
            request.language,
            request.useragent
          )};
        } else if (extMessage.method == 'SearchSubtitles') {
          const request = extMessage.request as Protocol.SearchSubtitlesRequest;
          response = { type: 'success', value: await openSubtitles.SearchSubtitles(request.token, request.array_queries) };
        }
      } catch (error) {
        response = { type: 'error', error: error };
      }
      chrome.tabs.sendMessage(sender.tab!.id!, {
        'tag': "netflix-opensubtitles-message",
        'direction': "from-background",
        'payload': {
          type: "opensubtitles-response",
          requestId: extMessage.requestId,
          response: response
        }
      } as Protocol.NetflixOpensubtitlesMessage);
    }
  }
});

chrome.action.onClicked.addListener(tab => {
  chrome.tabs.sendMessage(tab.id!, {
    'tag': "netflix-opensubtitles-message",
    'direction': "from-background",
    'payload': { type: "page-action-clicked" }
  } as Protocol.NetflixOpensubtitlesMessage)
});

