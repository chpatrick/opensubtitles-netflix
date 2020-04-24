import * as $ from "jquery";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as OS from "./opensubtitles";
import * as Srt from "subtitle";
import './player-payload.css';
import opensubtitlesLogo from "./opensubtitles.webp";
import { srtToTtml } from "./srt-converter";
import * as Sentry from '@sentry/browser';
import * as SentryIntegrations from '@sentry/integrations';
import axios from 'axios';

const openSubtitles = new OS.OS(undefined, true); // use default SSL endpoint

let container: HTMLDivElement;

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
  SubTranslator: string;
  SubFormat: string;
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

interface Settings {
  openSubtitlesCredentials: { username: string, password: string } | null;
  enableReporting: boolean;
  pinnedLanguages: string[];
}

interface UiState {
  settings: Settings;
  playingContent: VideoInfo | null;
  subtitleDialogOpen: boolean;
  aboutDialogOpen: boolean;
  subtitles: DownloadState<Subtitles>;
  convertedSub: DownloadState<ConvertedSub>;

  tentativeUsername: string;
  tentativePassword: string;
  loginState: DownloadState<{}>;
  opensubtitlesToken: string | null;
}

interface Query {
  query?: string;
  season?: string;
  episode?: string;
}

const uiState: UiState = {
  settings: {
    openSubtitlesCredentials: null,
    enableReporting: true,
    pinnedLanguages: []
  },
  opensubtitlesToken: null,
  playingContent: null,
  aboutDialogOpen: false,
  subtitleDialogOpen: false,
  subtitles: { state: "idle" },
  convertedSub: { state: "idle" },
  loginState: { state: "idle" },
  tentativeUsername: '',
  tentativePassword: ''
};

const settingsKey = 'netflix-opensubtitles-settings';
const maybeSettings = localStorage.getItem(settingsKey);
if (maybeSettings !== null) {
  uiState.settings = JSON.parse(maybeSettings);
  uiState.tentativeUsername = uiState.settings.openSubtitlesCredentials?.username ?? '';
}

const initSentry = () => {
  Sentry.init({
    dsn: OS_SENTRY_DSN!,
    defaultIntegrations: false,
    integrations: [
      new Sentry.Integrations.UserAgent(),
      new SentryIntegrations.ExtraErrorData(),
    ]
   });
}

const deinitSentry = () => {
  Sentry.init();
}

if (OS_SENTRY_DSN !== null && uiState.settings.enableReporting) {
  initSentry();
}


function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(uiState.settings));
}

function getPinnedLanguages(): Set<string> {
  return new Set<string>(uiState.settings.pinnedLanguages);
}

function reportRejection(error: any) {
  Sentry.configureScope(scope => {
    if (error?.config?.url) {
      scope.setExtra("request-url", error.config.url);
    }
    if (error?.config?.method) {
      scope.setExtra("request-method", error.config.method);
    }
    Sentry.captureException(error);
  })
}

const loadSubtitles = async (content: VideoInfo) => {
  Sentry.addBreadcrumb({
    message: 'load-subtitles',
    data: {
      'content': JSON.stringify(content)
    }
  });

  uiState.subtitles = { state: "downloading" };
  refresh();

  const query: Query = {};
  if (content.type === "film") {
    query.query = content.title;
  } else {
    query.query = content.info.seriesTitle;
    query.season = content.info.season + '';
    query.episode = content.info.episode + '';
  }


  try {
    await (uiState.opensubtitlesToken !== null ? Promise.resolve() : logIn(uiState.settings.openSubtitlesCredentials));
    const results: { data: SubMetadata[] } = await openSubtitles.SearchSubtitles(uiState.opensubtitlesToken!, [ query ]);

    const subs = results.data.filter(sub => sub.SubFormat === 'srt');

    uiState.subtitles = { state: "done", result: {
      subtitles: subs
     }
    };
    refresh();

    const pinnedLanguages = getPinnedLanguages();
    const pinnedSubs = subs.filter((sub: SubMetadata) => pinnedLanguages.has(sub.ISO639));
    // If there's exactly one pinned sub, download it immediately.
    if (pinnedSubs.length == 1) {
      downloadSub(pinnedSubs[0]).catch(reportRejection);
    }
  } catch (error) {
    uiState.subtitles = { state: "failed" };
    refresh();
    throw error;
  }
}

const openSubtitleDialog = () => {
  if (uiState.playingContent === null) {
    return;
  }

  uiState.subtitleDialogOpen = true;
  if (uiState.subtitles.state !== "done" && uiState.settings.openSubtitlesCredentials !== null) {
    loadSubtitles(uiState.playingContent).catch(reportRejection);
  }
  refresh();
}

const closeSubtitleDialog = () => {
  uiState.subtitleDialogOpen = false;
  refresh();
}

const toggleSubtitleDialog = () => {
  if (uiState.subtitleDialogOpen) {
    closeSubtitleDialog();
  } else {
    openSubtitleDialog();
  }
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
  return Math.round(ms * 1e4) + 't';
}

const srtToDfxp = (srt: Srt.subTitleType[]) => {
  let dfxpString = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" ttp:tickRate="10000000" ttp:timeBase="media" xmlns="http://www.w3.org/ns/ttml">
<head>
<ttp:profile use="http://netflix.com/ttml/profile/dfxp-ls-sdh"/>
<styling>
<style tts:backgroundColor="transparent" tts:textAlign="center" xml:id="style0"/>
</styling>
<layout>
<region tts:displayAlign="after" xml:id="region0"/>
<region tts:displayAlign="before" xml:id="region1"/>
</layout>
</head>
<body>
<div xml:space="preserve">`;

    for (let subtitleIndex = 0; subtitleIndex < srt.length; subtitleIndex++) {
      const subtitle = srt[subtitleIndex];
      if (!subtitle.text) {
        continue;
      }
      dfxpString += `
<p begin="${msToTimestamp(subtitle.start as number)}" end="${msToTimestamp(subtitle.end as number)}" region="region0" style="style0" tts:extent="80.00% 80.00%" tts:origin="10.00% 10.00%" xml:id="subtitle${subtitleIndex}">${srtToTtml(subtitle.text)}</p>`;
    }

    dfxpString += `
</div>
</body>
</tt>`;

  return URL.createObjectURL(new Blob([dfxpString], {type: 'application/ttml+xml'}));
}

const downloadSub = async (opensubtitle: SubMetadata) => {
  Sentry.addBreadcrumb({
    message: 'download-sub',
    data: {
      'subtitle': JSON.stringify(opensubtitle)
    }
  });

  uiState.convertedSub = { state: "downloading" };
  refresh();

  const utf8Url = opensubtitle.SubDownloadLink.replace('.gz', '').replace('download/', 'download/subencoding-utf8/');

  try {
    const srtResponse = await axios.get(utf8Url, { responseType: 'text' });
    const sub = Srt.parse(srtResponse.data);

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
  } catch(error) {
    uiState.convertedSub = { state: "failed" }
    refresh();
    throw error;
  }
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

const clickPin = (language: string, isPinned: boolean) => {
  const langs = getPinnedLanguages();
  if (isPinned) {
    langs.delete(language);
  } else {
    langs.add(language);
  }
  uiState.settings.pinnedLanguages = Array.from(langs);
  saveSettings();
  refresh();
}

const SubtitleTable: React.SFC<{ state: UiState }> = props => {
  const state = props.state.subtitles;

  if (state.state === "idle") {
    return <div></div>;
  } else if (state.state === "downloading") {
    return <div className="netflix-opensubtitles-step">Downloading subtitle list...</div>;
  } else if (state.state === "failed") {
    return <div className="netflix-opensubtitles-step">Failed to fetch subtitles :(</div>;
  } else {
    const pinnedLanguages = getPinnedLanguages();
    const isPinned = (sub: SubMetadata) => pinnedLanguages.has(sub.ISO639);

    const sortedSubs = state.result.subtitles.slice(0).sort(compareBy(comparing(sub => isPinned(sub) ? 0 : 1), comparing(sub => sub.LanguageName), comparing(sub => sub.SubFileName.toLowerCase())));

    const subtitleRows = sortedSubs.map(sub => {
      const isActive = props.state.convertedSub.state == "done" && props.state.convertedSub.result.baseSub.IDSubtitle === sub.IDSubtitle;

      const className = isPinned(sub) ? "netflix-opensubtitles-pin-cell netflix-opensubtitles-pin-cell-pinned" : "netflix-opensubtitles-pin-cell";
      const pinTitle = isPinned(sub) ? "Click to not move this language to the top of the list" : "Click to move this language to the top of the list"

      return <tr key={sub.IDSubtitle}>
          <td className={className} onClick={() => clickPin(sub.ISO639, isPinned(sub))} title={pinTitle}></td>
          <td>{sub.LanguageName}</td>
          <td onClick={() => downloadSub(sub).catch(reportRejection)} className={isActive ? "netflix-opensubtitles-subtitle-row-chosen netflix-opensubtitles-subtitle-row" : "netflix-opensubtitles-subtitle-row"}>{sub.SubFileName}</td>
          <td>{sub.SubTranslator}</td>
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
    return <div className="netflix-opensubtitles-step">Downloading subtitle...</div>;
  } else if (state.state === "failed") {
    return <div className="netflix-opensubtitles-step">Download failed :( Maybe the subtitle is corrupt?</div>;
  } else {
    return <div>
        <div className="netflix-opensubtitles-step">
          <strong>Step 2: adjust timing (optional): </strong>
          <input id="netflix-opensubtitles-timing-adjuster" value={state.result.resyncOffset} type="number" step="0.1" onChange={resyncChanged} /> seconds
        </div>
        <div className="netflix-opensubtitles-step">
          <strong>Step 3: </strong> <a href={state.result.url} download={state.result.filename} className="netflix-opensubtitles-button">Download</a>
        </div>
        <div className="netflix-opensubtitles-step">
          <strong>Step 4: </strong><a href="#" onClick={activateClicked} className="netflix-opensubtitles-button">Activate</a>
        </div>
      </div>;
  }
}

const reportProblem = () => {
  const eventId = Sentry.captureMessage("User feedback");
  Sentry.showReportDialog({
    eventId,
    title: "Something wrong?",
    subtitle: ""
  });
};

class LoginError extends Error {
  constructor(anonymous: boolean, result: OS.LogInResult) {
    super("Login failed.");
    this.anonymous = anonymous;
    this.result = result;
  }

  anonymous: boolean;
  result: OS.LogInResult;
}

const logIn = async (credentials: { username: string, password: string } | null) => {
  const result = await openSubtitles.LogIn(credentials?.username ?? '', credentials?.password ?? '', 'en', OS_USER_AGENT);
  if (!result.status.includes("200")) {
    throw new LoginError(credentials === null, result);
  }

  uiState.opensubtitlesToken = result.token;
}

const tryNewLogIn = async () => {
  try {
    uiState.loginState = { state: "downloading" };
    refresh();

    await logIn({ username: uiState.tentativeUsername, password: uiState.tentativePassword });
    if (uiState.tentativeUsername.trim() === '' && uiState.tentativePassword.trim() === '') {
      uiState.settings.openSubtitlesCredentials = null;
    } else {
      uiState.settings.openSubtitlesCredentials = {
        username: uiState.tentativeUsername,
        password: uiState.tentativePassword
      };
    }
    uiState.loginState = { state: "done", result: {} };
    saveSettings();
    refresh();

    if (uiState.playingContent) {
      loadSubtitles(uiState.playingContent).catch(reportRejection);
    }
  } catch (error) {
    uiState.loginState = { state: "failed" };
  }
};

const updateReporting = (allowReporting: boolean) => {
  if (!uiState.settings.enableReporting && allowReporting) {
    initSentry();
  } else if (uiState.settings.enableReporting && !allowReporting) {
    deinitSentry();
  }
  uiState.settings.enableReporting = allowReporting;
  saveSettings();
  refresh();
}

const MainComponent: React.SFC<{ state: UiState }> = (props) => {
  let downloadArea: JSX.Element;

  if (props.state.settings.openSubtitlesCredentials !== null) {
    downloadArea =
      <div>
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
  } else {
    downloadArea =
      <div className="opensubtitles-login-message">
        <h3>UPDATE</h3>
        <p>
        As of April 24 2020, OpenSubtitles <a href="https://forum.opensubtitles.org/viewtopic.php?f=11&amp;t=17110" target="_blank">requires</a> users to sign in to use their service. 😔
        </p>
        <p>
        Please follow these steps to keep using this extension:
        </p>
        <ol>
          <li><a href="https://www.opensubtitles.org/newuser" target="_blank">Register</a> on OpenSubtitles (if you don't already have an account)</li>
          <li><a href="#" onClick={openAbout}>Log in</a> in this extension</li>
        </ol>
      </div>;
  }

  return <div>
    <div id="opensubtitles-dialog" style={{visibility: props.state.subtitleDialogOpen ? "visible" : "hidden"}}>
      <div id="netflix-opensubtitles-buttons">
        {OS_SENTRY_DSN !== null &&
          <a className="netflix-opensubtitles-button" href="#" onClick={reportProblem}>Report a problem</a>
        }
        <a className="netflix-opensubtitles-button" href="https://ko-fi.com/R6R0XQSG" target="_blank">Buy me a coffee</a>
        <a className="netflix-opensubtitles-button" href="#" onClick={openAbout}>Settings &amp; About</a>
        <a className="netflix-opensubtitles-button" href="#" onClick={closeSubtitleDialog}>⨯</a>
      </div>

      { downloadArea }

    </div>

    <div id="opensubtitles-about-dialog" style={{visibility: props.state.aboutDialogOpen ? "visible" : "hidden"}}>
      <div id="netflix-opensubtitles-buttons">
        <a className="netflix-opensubtitles-button" href="#" onClick={closeAbout}>⨯</a>
      </div>

      <form>
        <label>OpenSubtitles login (optional, leave blank for anonymous user)</label>
        <div>
          <input
            type="text"
            placeholder="Username"
            value={props.state.tentativeUsername}
            onChange={ev => { props.state.tentativeUsername = ev.target.value; refresh(); }}
            />
        </div>
        <div>
          <input
            type="password"
            placeholder="Password"
            value={props.state.tentativePassword}
            onChange={ev => { props.state.tentativePassword = ev.target.value; refresh(); }}
            />
        </div>
        <div>
          <input type="submit" onClick={ev => { ev.preventDefault(); tryNewLogIn().catch(reportRejection); }} disabled={props.state.loginState.state === "downloading"} value="Log in" />
          &nbsp;
          {props.state.loginState.state === "downloading" ? <span>Logging in...</span> :
           props.state.loginState.state === "failed" ? <span style={{ 'fontWeight': 'bold', color: 'red' }}>Login failed.</span> :
           props.state.loginState.state === "done" ? <span style={{ 'fontWeight': 'bold', color: 'green' }}>Login successful.</span> :
           null
           }
        </div>
      </form>

      {OS_SENTRY_DSN !== null &&
        <div>
          <hr />
          <label>
            <input type="checkbox" checked={uiState.settings.enableReporting} onChange={ev => { updateReporting(ev.target.checked); }} />
            &nbsp;Automatically report errors if something goes wrong
          </label>
        </div>
      }

      <hr />

      <p>
        Subtitles service powered by
      </p>
      <a href="http://www.opensubtitles.org/" target="_blank"><img id="netflix-opensubtitles-os-logo" src={opensubtitlesLogo} /></a>
      <div className="netflix-opensubtitles-about-section">Icons made by <a href="https://www.flaticon.com/authors/smashicons" title="Smashicons" target="_blank">Smashicons</a> from <a href="https://www.flaticon.com/" title="Flaticon" target="_blank">www.flaticon.com</a> is licensed by <a href="http://creativecommons.org/licenses/by/3.0/" title="Creative Commons BY 3.0" target="_blank">CC 3.0 BY</a></div>
      <div className="netflix-opensubtitles-about-section">Report bugs and contribute on <a href="https://github.com/chpatrick/opensubtitles-netflix" target="_blank">GitHub</a></div>
    </div>
  </div>
};

const refresh = () => {
  ReactDOM.render(<MainComponent state={uiState} />, container);
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
      toggleSubtitleDialog();
    }
  }
});

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

$(() => {
  container = document.createElement('div');

  $(document.body)
    .append(container)
    .on('keydown', ev => {
      if (ev.key.toLowerCase() === "d") {
        toggleSubtitleDialog();
      }
    });

  setInterval(checkPlaying, 250);
});