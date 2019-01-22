import * as $ from "jquery";
import * as React from "react";
import * as ReactDOM from "react-dom";
import OS = require("./opensubtitles.js");
import * as Srt from "subtitle";
import './player-payload.css';
import pinIcon from "./push-pin.svg";

const openSubtitles = new OS(undefined, true); // use default SSL endpoint

const container = $('<div></div>');
$('body').append(container);

interface EpisodeInfo {
  seriesTitle: string;
  season: number;
  episode: number;
  episodeTitle: string;
}

type VideoInfo
  = { type: "film", title: string }
  | { type: "episode", info: EpisodeInfo }

type DownloadState<Result>
  = { state: "idle" }
  | { state: "downloading" }
  | { state: "failed" }
  | { state: "done", result: Result }

interface SubMetadata {
  SubFileName: string;
  SubDownloadLink: string;
  ISO639: string;
  LanguageName: string;
  IDSubtitle: string;
}

interface ConvertedSub {
  baseSub: SubMetadata;
  baseSrt: Srt.subTitleType[];
  url: string;
  filename: string;
  resyncOffset: number;
}

interface Subtitles {
  subtitles: SubMetadata[];
}

interface UiState {
  playingContent: VideoInfo | null;
  subtitleDialogOpen: boolean;
  aboutDialogOpen: boolean;
  subtitles: DownloadState<Subtitles>;
  convertedSub: DownloadState<ConvertedSub>;
}

const uiState: UiState = {
  playingContent: null,
  aboutDialogOpen: false,
  subtitleDialogOpen: false,
  subtitles: { state: "idle" },
  convertedSub: { state: "idle" }
};

let opensubtitlesToken: Promise<string> | null;

const getToken = () => {
  if (opensubtitlesToken) {
    return opensubtitlesToken;
  } else {
    opensubtitlesToken = openSubtitles.LogIn('', '', 'en', OS_USER_AGENT).then(result => result.token)
    return opensubtitlesToken;
  }
}

const loadSubtitles = (content: VideoInfo) => {
  uiState.subtitles = { state: "downloading" };
  refresh();

  const query: any = {};
  if (content.type === "film") {
    query.query = content.title;
  } else {
    query.query = content.info.seriesTitle;
    query.season = content.info.season + '';
    query.episode = content.info.episode + '';
  }

  getToken().then(token => openSubtitles.SearchSubtitles(token, [ query ]))
  .then(results => {
    uiState.subtitles = { state: "done", result: {
      subtitles: results.data as SubMetadata[]
     }
   };
  }, reason => {
    uiState.subtitles = { state: "failed" };
  });
}

const openSubtitleDialog = () => {
  uiState.subtitleDialogOpen = true;
  if (uiState.subtitles.state !== "done") {
    loadSubtitles(uiState.playingContent!);
  }
  refresh();
}

const closeSubtitleDialog = () => {
  uiState.subtitleDialogOpen = false;
  refresh();
}

const openAbout = () => {
  uiState.aboutDialogOpen = true;
  refresh();
};

const closeAbout = () => {
  uiState.aboutDialogOpen = false;
  refresh();
};

const activateClicked = () => {
  // extremely hacky way to simulate a keypress in chromium
  // this only works when the script is injected, not directly in the content script
  const keyCode = 84; // T

  const b = document.createEvent('KeyboardEvent') as any;
  Object.defineProperty(b, 'keyCode', {
      get: function() {
          return this.keyCodeVal;
      }
  }),
  Object.defineProperty(b, 'which', {
      get: function() {
          return this.keyCodeVal;
      }
  }),
  b.initKeyboardEvent ? b.initKeyboardEvent('keydown', true, true, document.defaultView, false, true, true, true, keyCode, keyCode) : b.initKeyEvent('keydown', true, true, document.defaultView, false, true, true, true, keyCode, 0),
  b.keyCodeVal = keyCode;
  $('div.NFPlayer').get(0).dispatchEvent(b);

  uiState.subtitleDialogOpen = false;
  refresh();
}

const zeroPad = (length: number, n: number) => {
  let numStr = n + '';
  while (numStr.length < length) {
    numStr = '0' + numStr;
  }
  return numStr;
}

const msToTimestamp = (ms: number) => {
  const millis = ms % 1000;
  ms = Math.floor(ms / 1000);
  const seconds = ms % 60;
  ms = Math.floor(ms / 60);
  const minutes = ms % 60;
  const hours = Math.floor(ms / 60);

  return zeroPad(2, hours) + ':' + zeroPad(2, minutes) + ':' + zeroPad(2, seconds) + '.' + zeroPad(3, millis);
}

const srtToDfxp = (srt: Srt.subTitleType[]) => {
  let dfxpString = `<?xml version="1.0" encoding="UTF-8"?>
<tt xml:lang='en' xmlns='http://www.w3.org/2006/10/ttaf1' xmlns:tts='http://www.w3.org/2006/10/ttaf1#style'>
<head></head>
<body>
<div xml:id="captions">`;

    for (const subtitle of srt) {
      dfxpString += `
<p begin="${msToTimestamp(subtitle.start as number)}" end="${msToTimestamp(subtitle.end as number)}">${subtitle.text.replace('\n', '<br/>')}</p>`;
    }

    dfxpString += `
</div>
</body>
</tt>`;

  return URL.createObjectURL(new Blob([dfxpString], {type: 'application/ttml+xml'}));
}

const downloadSub = (opensubtitle: SubMetadata) => {
  uiState.convertedSub = { state: "downloading" };
  refresh();

  const utf8Url = opensubtitle.SubDownloadLink.replace('.gz', '').replace('download/', 'download/subencoding-utf8/');

  $.get({
    url: utf8Url,
    dataType: 'text'
  }).then(srt => {
    const sub = Srt.parse(srt);

    const content = uiState.playingContent!;

    let contentName = content.type === "film" ? content.title : `${content.info.seriesTitle} - S${zeroPad(2, content.info.season)}E${zeroPad(2, content.info.episode)}`;

    uiState.convertedSub = {
      state: "done",
      result: {
        baseSub: opensubtitle,
        baseSrt: sub,
        url: srtToDfxp(sub),
        filename: `${contentName} - ${opensubtitle.LanguageName}.dfxp`,
        resyncOffset: 0
      }
    }
    refresh();
  });
}

const resyncChanged = (ev: React.ChangeEvent<HTMLInputElement>) => {
  const newOffset = (ev.target as HTMLInputElement).valueAsNumber;

  if (uiState.convertedSub.state == "done") {
    uiState.convertedSub.result.resyncOffset = newOffset;
    uiState.convertedSub.result.url = srtToDfxp(Srt.resync(uiState.convertedSub.result.baseSrt, newOffset * 1000));
  }

  refresh();
}

type Comparison<T> = (x: T, y: T) => number;

function comparing<T, S>(f: (x: T) => S): Comparison<T> {
  return (x, y) => {
    const fx = f(x);
    const fy = f(y);
    if (fx < fy) {
      return -1;
    } else if (fx > fy) {
      return 1;
    } else {
      return 0;
    }
  }
}

function down<T>(cmp: Comparison<T>): Comparison<T> {
  return (x, y) => -cmp(x, y);
}

function compareBy<T>(...comparisons: Comparison<T>[]): Comparison<T> {
  return (x, y) => {
    for (const comparison of comparisons) {
      const res = comparison(x, y);
      if (res != 0) {
        return res;
      }
    }
    return 0;
  }
}

const pinnedLanguagesKey = 'netflix-opensubtitles-pinned-languages';

const getPinnedLanguages = () => {
  const res = localStorage.getItem(pinnedLanguagesKey);
  if (res) {
    return new Set(JSON.parse(res));
  } else {
    return new Set();
  }
}

const putPinnedLanguages = (languages: Set<string>) => {
  localStorage.setItem(pinnedLanguagesKey, JSON.stringify(Array.from(languages)));
}

const clickPin = (language: string, isPinned: boolean) => {
  const langs = getPinnedLanguages();
  if (isPinned) {
    langs.delete(language);
  } else {
    langs.add(language);
  }
  putPinnedLanguages(langs);
  refresh();
}

const SubtitleTable: React.SFC<{ state: UiState }> = props => {
  const state = props.state.subtitles;

  const pinnedLanguages = getPinnedLanguages();

  if (state.state === "idle") {
    return <div></div>;
  } else if (state.state === "downloading") {
    return <div>Downloading subtitle list...</div>;
  } else if (state.state === "failed") {
    return <div>Failed to fetch subtitles :(</div>;
  } else {
    const isPinned = (sub: SubMetadata) => pinnedLanguages.has(sub.ISO639);

    const sortedSubs = state.result.subtitles.slice(0).sort(compareBy(comparing(sub => isPinned(sub) ? 0 : 1), comparing(sub => sub.LanguageName), comparing(sub => sub.SubFileName)));

    const subtitleRows = sortedSubs.map(sub => {
      const isActive = props.state.convertedSub.state == "done" && props.state.convertedSub.result.baseSub.IDSubtitle === sub.IDSubtitle;

      const className = isPinned(sub) ? "netflix-opensubtitles-pin-cell netflix-opensubtitles-pin-cell-pinned" : "netflix-opensubtitles-pin-cell";
      const pinTitle = isPinned(sub) ? "Click to not move this language to the top of the list" : "Click to move this language to the top of the list"

      return <tr key={sub.IDSubtitle}>
          <td className={className} onClick={() => clickPin(sub.ISO639, isPinned(sub))} title={pinTitle}></td>
          <td>{sub.LanguageName}</td>
          <td onClick={() => downloadSub(sub)} className={isActive ? "netflix-opensubtitles-subtitle-row-chosen netflix-opensubtitles-subtitle-row" : "netflix-opensubtitles-subtitle-row"}>{sub.SubFileName}</td>
        </tr>
    });

    return <div className="netflix-opensubtitles-step">
             <table id="netflix-opensubtitles-subtitle-table">
               <tbody>
                 {subtitleRows}
               </tbody>
             </table>
           </div>;
  }
};

const FinishComponent: React.SFC<{ state: DownloadState<ConvertedSub> }> = (props) => {
  const state = props.state;

  if (state.state === "idle") {
    return null;
  } else if (state.state === "downloading") {
    return <div>Downloading subtitle...</div>;
  } else if (state.state === "failed") {
    return <div>Download failed :(</div>;
  } else {
    return <div>
        <div className="netflix-opensubtitles-step">
          <h2>Step 2: adjust timing (optional)</h2>
          <div>
            <input id="netflix-opensubtitles-timing-adjuster" value={state.result.resyncOffset} type="number" min="0" step="0.1" onChange={resyncChanged} /> seconds
          </div>
        </div>
        <div className="netflix-opensubtitles-step">
          <h2>Step 3: download</h2>
          <div>
            <a href={state.result.url} download={state.result.filename} className="netflix-opensubtitles-button">Download</a>
          </div>
        </div>
        <h2>Step 4: load the subtitles into Netflix</h2>
        <div>
          <a href="#" onClick={activateClicked} className="netflix-opensubtitles-button">Activate</a>
        </div>
      </div>;
  }
}

const MainComponent: React.SFC<{ state: UiState }> = (props) =>
  <div>
    <div id="opensubtitles-dialog" style={{visibility: props.state.subtitleDialogOpen ? "visible" : "hidden"}}>
      <div id="netflix-opensubtitles-buttons">
        <a className="netflix-opensubtitles-button" href="#" onClick={openAbout}>?</a>
        <a className="netflix-opensubtitles-button" href="#" onClick={closeSubtitleDialog}>⨯</a>
      </div>

      <div>
        <div>
          <h1>Download subtitles</h1>
          <h2>Step 1: select your preferred subtitles</h2>
        </div>
        <SubtitleTable state={props.state} />
      </div>

      <div>
        <FinishComponent state={props.state.convertedSub} />
      </div>
    </div>

    <div id="opensubtitles-about-dialog" style={{visibility: props.state.aboutDialogOpen ? "visible" : "hidden"}}>
      <div id="netflix-opensubtitles-buttons">
        <a className="netflix-opensubtitles-button" href="#" onClick={closeAbout}>⨯</a>
      </div>

      <p>
        Subtitles service powered by
      </p>
      <a href="http://www.opensubtitles.org/" target="_blank"><img src="https://static.opensubtitles.org/gfx/logo-transparent.png" /></a>
      <div className="netflix-opensubtitles-about-section">Icons made by <a href="https://www.flaticon.com/authors/smashicons" title="Smashicons" target="_blank">Smashicons</a> from <a href="https://www.flaticon.com/" title="Flaticon" target="_blank">www.flaticon.com</a> is licensed by <a href="http://creativecommons.org/licenses/by/3.0/" title="Creative Commons BY 3.0" target="_blank">CC 3.0 BY</a></div>
      <div className="netflix-opensubtitles-about-section">Report bugs and contribute on <a href="https://github.com/chpatrick/opensubtitles-netflix" target="_blank">GitHub</a></div>
    </div>
  </div>;

const refresh = () => {
  ReactDOM.render(
    <MainComponent state={uiState} />,
    container.get(0)
  );
}

const sendMessageToBackground = (payload: NetflixOpensubtitlesPayload) => {
  window.postMessage({
    'tag': 'netflix-opensubtitles-message',
    'direction': "to-background",
    'payload': payload
  } as NetflixOpensubtitlesMessage, "*")
};

window.addEventListener('message', ev => {
  if (ev.data['tag'] === "netflix-opensubtitles-message" && ev.data['direction'] === "from-background") {
    const message = ev.data as NetflixOpensubtitlesMessage;

    if (message['payload']['type'] == "page-action-clicked") {
      if (uiState.subtitleDialogOpen) {
        closeSubtitleDialog();
      } else {
        openSubtitleDialog();
      }
    }
  }
});

$(document.body).on('keydown', ev => {
  if (ev.key.toLowerCase() === "d") {
    openSubtitleDialog();
  }
})

const checkPlaying = () => {
  let newPlayingEpisode: VideoInfo | null = null;

  const titleElem = $('div.video-title').get();
  if (titleElem) {
    const seriesTitleElem = $(titleElem).find('h4');
    const episodeNumAndTitleElem = $(titleElem).find('span');

    if (seriesTitleElem.length == 1 && episodeNumAndTitleElem.length == 2) {
      const seriesTitle = seriesTitleElem.text();
      const episodeNumString = episodeNumAndTitleElem.get(0).textContent;
      const episodeTitleString = episodeNumAndTitleElem.get(1).textContent;

      if (episodeNumString && episodeTitleString) {
        const episodeNumMatch = /S(\d+):E(\d+)/.exec(episodeNumString);
        if (episodeNumMatch) {
          newPlayingEpisode = {
            type: "episode",
            info: {
              seriesTitle: seriesTitle,
              season: parseInt(episodeNumMatch[1]),
              episode: parseInt(episodeNumMatch[2]),
              episodeTitle: episodeTitleString
            }
          }
        }
      }
    } else if (seriesTitleElem.length === 1) {
      newPlayingEpisode = {
        type: "film",
        title: seriesTitleElem.text()
      }
    }
  }

  const oldEpisode = uiState.playingContent;
  if (!oldEpisode && newPlayingEpisode) {
    sendMessageToBackground({ type: "show-page-action" });
  } else if (oldEpisode && !newPlayingEpisode || JSON.stringify(newPlayingEpisode) !== JSON.stringify(oldEpisode)) {
    uiState.subtitleDialogOpen = false;
    uiState.aboutDialogOpen = false;
    uiState.subtitles = { state: "idle" };
    uiState.convertedSub = { state: "idle" };
    sendMessageToBackground({ type: "hide-page-action" });
  }
  uiState.playingContent = newPlayingEpisode;
  refresh();
};

setInterval(checkPlaying, 500);
