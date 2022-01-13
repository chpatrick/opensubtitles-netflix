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
import * as iconv from "iconv-lite";
import * as chardet from "chardet";
import * as Protocol from "./protocol";
import create from 'zustand'

const pendingCalls: {
  [ requestId: number ]: [ (response: any) => void, (error: any) => void ]
} = {};

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
  SubEncoding: string;
}

interface ConvertedSub {
  baseSub: SubMetadata | null;
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

  setSettings: (value: Settings) => void;
  setPlayingContent: (value: VideoInfo | null) => void;
  setSubtitleDialogOpen: (value: boolean) => void;
  setAboutDialogOpen: (value: boolean) => void;
  setSubtitles: (value: DownloadState<Subtitles>) => void;
  setConvertedSub: (value: DownloadState<ConvertedSub>) => void;
  setTentativeUsername: (value: string) => void;
  setTentativePassword: (value: string) => void;
  setLoginState: (value: DownloadState<{}>) => void;
  setOpensubtitlesToken: (value: string | null) => void;

  applyResyncOffset: (newOffset: number) => void;
  updateSettings: (update: (settings: Settings) => void) => void;
}

interface Query {
  query?: string;
  season?: string;
  episode?: string;
}

const useStore = create<UiState>(set => ({
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
  tentativePassword: '',

  setSettings: (value: Settings) => set(state => { state.settings = value; }),
  setPlayingContent: (value: VideoInfo | null) => set(state => { state.playingContent = value; }),
  setSubtitleDialogOpen: (value: boolean) => set(state => { state.subtitleDialogOpen = value; }),
  setAboutDialogOpen: (value: boolean) => set(state => { state.aboutDialogOpen = value; }),
  setSubtitles: (value: DownloadState<Subtitles>) => set(state => { state.subtitles = value; }),
  setConvertedSub: (value: DownloadState<ConvertedSub>) => set(state => { state.convertedSub = value; }),
  setTentativeUsername: (value: string) => set(state => { state.tentativeUsername = value; }),
  setTentativePassword: (value: string) => set(state => { state.tentativePassword = value; }),
  setLoginState: (value: DownloadState<{}>) => set(state => { state.loginState = value; }),
  setOpensubtitlesToken: (value: string | null) => set(state => { state.opensubtitlesToken = value; }),

  applyResyncOffset: (newOffset: number) => set(uiState => {
    if (uiState.convertedSub.state === 'done') {
      uiState.convertedSub.result.resyncOffset = newOffset;
      uiState.convertedSub.result.url = srtToDfxp(Srt.resync(uiState.convertedSub.result.baseSrt, newOffset * 1000));
    }
  }),

  updateSettings: (update: (settings: Settings) => void) => set(uiState => {
    update(uiState.settings);
  }),
}));

const settingsKey = 'netflix-opensubtitles-settings';
const maybeSettings = localStorage.getItem(settingsKey);
if (maybeSettings !== null) {
  const uiState = useStore.getState();
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

if (OS_SENTRY_DSN !== null && useStore.getState().settings.enableReporting) {
  initSentry();
}


function saveSettings(settings: Settings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
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

const contentToQuery = (content: VideoInfo): Query => {
  const query: Query = {};
  if (content.type === "film") {
    query.query = content.title;
  } else {
    query.query = content.info.seriesTitle;
    query.season = content.info.season + '';
    query.episode = content.info.episode + '';
  }

  return query;
}

const loadSubtitles = async (uiState: UiState, query: Query) => {
  Sentry.addBreadcrumb({
    message: 'load-subtitles',
    data: {
      'query': JSON.stringify(query)
    }
  });

  uiState.setSubtitles({ state: "downloading" });

  try {
    await (uiState.opensubtitlesToken !== null ? Promise.resolve() : logIn(uiState, uiState.settings.openSubtitlesCredentials));
    const results: { data: SubMetadata[] } = await callOpenSubtitles("SearchSubtitles", {
      token: uiState.opensubtitlesToken!,
      array_queries: [ query ]
    });

    const subs = results.data.filter(sub => sub.SubFormat === 'srt');

    uiState.setSubtitles({ state: "done", result: {
      subtitles: subs
    }});

    const pinnedLanguages = new Set(uiState.settings.pinnedLanguages);
    const pinnedSubs = subs.filter((sub: SubMetadata) => pinnedLanguages.has(sub.ISO639));
    // If there's exactly one pinned sub, download it immediately.
    if (pinnedSubs.length == 1) {
      downloadSub(uiState, pinnedSubs[0]).catch(reportRejection);
    }
  } catch (error) {
    uiState.setSubtitles({ state: "failed" });
    throw error;
  }
}

const openSubtitleDialog = (uiState: UiState) => {
  if (uiState.playingContent === null) {
    return;
  }

  uiState.setSubtitleDialogOpen(true);
  if (uiState.subtitles.state !== "done" && uiState.settings.openSubtitlesCredentials !== null) {
    loadSubtitles(uiState, contentToQuery(uiState.playingContent)).catch(reportRejection);
  }
}

const closeSubtitleDialog = (uiState: UiState) => {
  uiState.setSubtitleDialogOpen(false);
}

const toggleSubtitleDialog = (uiState: UiState) => {
  if (uiState.subtitleDialogOpen) {
    closeSubtitleDialog(uiState);
  } else {
    openSubtitleDialog(uiState);
  }
}

const openAbout = (uiState: UiState) => {
  uiState.setAboutDialogOpen(true);
};

const closeAbout = (uiState: UiState) => {
  uiState.setAboutDialogOpen(false);
};

const activateClicked = (uiState: UiState) => {
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
  $('div.watch-video').get(0).dispatchEvent(b);

  uiState.setSubtitleDialogOpen(false);
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

const processSrtString = (uiState: UiState, srtString: string, baseFilename: string, opensubtitle: SubMetadata | null) => {
  try {
    const sub = Srt.parse(srtString);
    if (sub.length === 0 || sub.length === 1 && Object.keys(sub[0]).length == 0) {
      throw "Decoded SRT was empty.";
    }

    uiState.setConvertedSub({
      state: "done",
      result: {
        baseSub: opensubtitle,
        baseSrt: sub,
        url: srtToDfxp(sub),
        filename: baseFilename + ".dfxp",
        resyncOffset: 0
      }
    });
  } catch(error) {
    uiState.setConvertedSub({ state: "failed" });
    throw error;
  }
}

const downloadSub = async (uiState: UiState, opensubtitle: SubMetadata) => {
  Sentry.addBreadcrumb({
    message: 'download-sub',
    data: {
      'subtitle': JSON.stringify(opensubtitle)
    }
  });

  uiState.setConvertedSub({ state: "downloading" });

  const srtUrl = opensubtitle.SubDownloadLink.replace(/\.gz$/, "");
  let srtString: string;

  // Can we decode the subtitle ourselves?
  if (iconv.encodingExists(opensubtitle.SubEncoding)) {
    const subtitleArrayBuffer = await fetch(srtUrl).then(resp => resp.arrayBuffer());
    srtString = iconv.decode(Buffer.from(subtitleArrayBuffer), opensubtitle.SubEncoding);
  } else {
    // Try to get the UTF-8 subtitle from OpenSubtitles (can be unreliable).
    const utf8Url = srtUrl.replace('download/', 'download/subencoding-utf8/');
    srtString = await fetch(utf8Url).then(resp => resp.text())
  }

  const content = uiState.playingContent!;
  const contentName = content.type === "film" ? content.title : `${content.info.seriesTitle} - S${zeroPad(2, content.info.season)}E${zeroPad(2, content.info.episode)}`;
  processSrtString(uiState, srtString, `${contentName} - ${opensubtitle.LanguageName}`, opensubtitle);
}

const resyncChanged = (uiState: UiState) => (ev: React.ChangeEvent<HTMLInputElement>) => {
  const newOffset = (ev.target as HTMLInputElement).valueAsNumber;

  uiState.applyResyncOffset(newOffset);
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

const clickPin = (uiState: UiState, language: string, isPinned: boolean) => {
  const langs = new Set(uiState.settings.pinnedLanguages);
  if (isPinned) {
    langs.delete(language);
  } else {
    langs.add(language);
  }
  uiState.updateSettings(settings => { settings.pinnedLanguages = Array.from(langs); });
  saveSettings(uiState.settings);
}

const doSearch = (uiState: UiState, query: string) => {
  loadSubtitles(uiState, { query }).catch(reportRejection);
}

const SubtitleTable: React.SFC<{}> = props => {
  const uiState = useStore();
  const state = uiState.subtitles;

  let results: React.ReactElement;

  if (state.state === "idle") {
    results = <div className="opensubtitles-dark-box"></div>;
  } else if (state.state === "downloading") {
    results = <div className="opensubtitles-dark-box">Downloading subtitle list...</div>;
  } else if (state.state === "failed") {
    results = <div className="opensubtitles-dark-box">Failed to fetch subtitles :(</div>;
  } else {
    const pinnedLanguages = new Set(uiState.settings.pinnedLanguages);
    const isPinned = (sub: SubMetadata) => pinnedLanguages.has(sub.ISO639);

    const sortedSubs = state.result.subtitles.slice(0).sort(compareBy(comparing(sub => isPinned(sub) ? 0 : 1), comparing(sub => sub.LanguageName), comparing(sub => sub.SubFileName.toLowerCase())));

    const subtitleRows = sortedSubs.map(sub => {
      const isActive = uiState.convertedSub.state == "done" && uiState.convertedSub.result.baseSub?.IDSubtitle === sub.IDSubtitle;

      const className = isPinned(sub) ? "netflix-opensubtitles-pin-cell netflix-opensubtitles-pin-cell-pinned" : "netflix-opensubtitles-pin-cell";
      const pinTitle = isPinned(sub) ? "Click to not move this language to the top of the list" : "Click to move this language to the top of the list"

      return <tr key={sub.IDSubtitle}>
          <td className={className} onClick={() => clickPin(uiState, sub.ISO639, isPinned(sub))} title={pinTitle}></td>
          <td>{sub.LanguageName}</td>
          <td onClick={() => downloadSub(uiState, sub).catch(reportRejection)} className={isActive ? "netflix-opensubtitles-subtitle-row-chosen netflix-opensubtitles-subtitle-row" : "netflix-opensubtitles-subtitle-row"}>{sub.SubFileName}</td>
          <td>{sub.SubTranslator}</td>
        </tr>
    });

    results = <table id="netflix-opensubtitles-subtitle-table" className="opensubtitles-dark-box">
               <tbody>
                 {subtitleRows}
               </tbody>
             </table>;
  }

  const searchBox = React.useRef<HTMLInputElement>(null);

  return <div>
    <form>
      Custom query:
        &nbsp;<input type="text" ref={searchBox} placeholder="search query" />
        &nbsp;<input type="submit" value="Search" onClick={ev => { ev.preventDefault(); doSearch(uiState, searchBox.current!.value); }} />
        &nbsp;<input type="button" value="Search for current content" disabled={uiState.playingContent == null} onClick={() => loadSubtitles(uiState, contentToQuery(uiState.playingContent!)).catch(reportRejection)} />
    </form>
    {results}
    </div>
};

const FinishComponent: React.SFC<{ state: DownloadState<ConvertedSub> }> = (props) => {
  const uiState = useStore();
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
          <input id="netflix-opensubtitles-timing-adjuster" value={state.result.resyncOffset} type="number" step="0.1" onChange={resyncChanged(uiState)} /> seconds
        </div>
        <div className="netflix-opensubtitles-step">
          <strong>Step 3: </strong> <a href={state.result.url} download={state.result.filename} className="netflix-opensubtitles-button">Download</a>
        </div>
        <div className="netflix-opensubtitles-step">
          <strong>Step 4: </strong><a href="#" onClick={() => activateClicked(uiState)} className="netflix-opensubtitles-button">Activate</a>
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

const logIn = async (uiState: UiState, credentials: { username: string, password: string } | null) => {
  const result = await callOpenSubtitles("LogIn", {
    username: credentials?.username ?? '',
    password: credentials?.password ?? '',
    language: 'en',
    useragent: OS_USER_AGENT
  });
  if (!result.status.includes("200")) {
    throw new LoginError(credentials === null, result);
  }

  uiState.setOpensubtitlesToken(result.token);
}

const tryNewLogIn = async (uiState: UiState) => {
  try {
    uiState.setLoginState({ state: "downloading" });

    await logIn(uiState, { username: uiState.tentativeUsername, password: uiState.tentativePassword });
    if (uiState.tentativeUsername.trim() === '' && uiState.tentativePassword.trim() === '') {
      uiState.updateSettings(settings => { settings.openSubtitlesCredentials = null; });
    } else {
      uiState.updateSettings(settings => { 
        settings.openSubtitlesCredentials = {
          username: uiState.tentativeUsername,
          password: uiState.tentativePassword
        };
      });
    }
    uiState.setLoginState({ state: "done", result: {} });
    saveSettings(uiState.settings);

    if (uiState.playingContent) {
      loadSubtitles(uiState, contentToQuery(uiState.playingContent)).catch(reportRejection);
    }
  } catch (error) {
    uiState.setLoginState({ state: "failed" });
  }
};

const updateReporting = (uiState: UiState, allowReporting: boolean) => {
  if (!uiState.settings.enableReporting && allowReporting) {
    initSentry();
  } else if (uiState.settings.enableReporting && !allowReporting) {
    deinitSentry();
  }
  uiState.updateSettings(settings => { settings.enableReporting = allowReporting; });
  saveSettings(uiState.settings);
}

const onFileUploaded = (uiState: UiState) => async (ev: React.ChangeEvent<HTMLInputElement>) => {
  const file = ev.target.files![0];
  const fileBuf = new Buffer(await file.arrayBuffer());
  const guessedEncoding = chardet.detect(fileBuf);
  const srtString = iconv.decode(new Buffer(fileBuf), (guessedEncoding && iconv.encodingExists(guessedEncoding)) ? guessedEncoding : "utf-8");
  processSrtString(uiState, srtString, file.name.replace(/\.srt$/, ""), null);
};

const MainComponent: React.SFC<{}> = (props) => {
  const uiState = useStore();

  let subPicker: JSX.Element;
  if (uiState.settings.openSubtitlesCredentials !== null) {
    subPicker = <SubtitleTable />;
  } else {
    subPicker =
      <div className="opensubtitles-dark-box">
        <h3>UPDATE</h3>
        <p>
        As of April 24 2020, OpenSubtitles <a href="https://forum.opensubtitles.org/viewtopic.php?f=11&amp;t=17110" target="_blank">requires</a> users to sign in to use their service. 😔
        </p>
        <p>
        Please follow these steps to keep using this extension:
        </p>
        <ol>
          <li><a href="https://www.opensubtitles.org/newuser" target="_blank">Register</a> on OpenSubtitles (if you don't already have an account)</li>
          <li><a href="#" onClick={() => openAbout(uiState)}>Log in</a> in this extension</li>
        </ol>
      </div>;
  }

  return <div>
    <div id="opensubtitles-dialog" style={{visibility: uiState.subtitleDialogOpen ? "visible" : "hidden"}}>
      <div id="netflix-opensubtitles-buttons">
        {OS_SENTRY_DSN !== null &&
          <a className="netflix-opensubtitles-button" href="#" onClick={reportProblem}>Report a problem</a>
        }
        <a className="netflix-opensubtitles-button" href="https://ko-fi.com/R6R0XQSG" target="_blank">Buy me a coffee</a>
        <a className="netflix-opensubtitles-button" href="#" onClick={() =>openAbout(uiState)}>Settings &amp; About</a>
        <a className="netflix-opensubtitles-button" href="#" onClick={() =>closeSubtitleDialog(uiState)}>⨯</a>
      </div>

      <div>
        <div>
          <div>
            <h1>Download subtitles</h1>
            <h2>Step 1: select your preferred subtitles</h2>
          </div>
          {subPicker}
          <p>
          You can also upload your own .srt: <input type="file" onChange={onFileUploaded(uiState)} />
          </p>
        </div>

        <div>
          <FinishComponent state={uiState.convertedSub} />
        </div>
      </div>
    </div>

    <div id="opensubtitles-about-dialog" style={{visibility: uiState.aboutDialogOpen ? "visible" : "hidden"}}>
      <div id="netflix-opensubtitles-buttons">
        <a className="netflix-opensubtitles-button" href="#" onClick={() => closeAbout(uiState)}>⨯</a>
      </div>

      <form>
        <label>OpenSubtitles login (optional, leave blank for anonymous user)</label>
        <div>
          <input
            type="text"
            placeholder="Username"
            value={uiState.tentativeUsername}
            onChange={(ev) => { uiState.setTentativeUsername(ev.target.value); }}
            />
        </div>
        <div>
          <input
            type="password"
            placeholder="Password"
            value={uiState.tentativePassword}
            onChange={(ev) => { uiState.setTentativePassword(ev.target.value); }}
            />
        </div>
        <div>
          <input type="submit" onClick={ev => { ev.preventDefault(); tryNewLogIn(uiState).catch(reportRejection); }} disabled={uiState.loginState.state === "downloading"} value="Log in" />
          &nbsp;
          {uiState.loginState.state === "downloading" ? <span>Logging in...</span> :
           uiState.loginState.state === "failed" ? <span style={{ 'fontWeight': 'bold', color: 'red' }}>Login failed.</span> :
           uiState.loginState.state === "done" ? <span style={{ 'fontWeight': 'bold', color: 'green' }}>Login successful.</span> :
           null
           }
        </div>
      </form>

      {OS_SENTRY_DSN !== null &&
        <div>
          <hr />
          <label>
            <input type="checkbox" checked={uiState.settings.enableReporting} onChange={ev => { updateReporting(uiState, ev.target.checked); }} />
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

const sendMessageToBackground = (payload: Protocol.NetflixOpensubtitlesPayload) => {
  window.postMessage({
    'tag': 'netflix-opensubtitles-message',
    'direction': "to-background",
    'payload': payload
  } as Protocol.NetflixOpensubtitlesMessage, "*")
};

window.addEventListener('message', ev => {
  const uiState = useStore.getState();

  if (ev.data['tag'] === "netflix-opensubtitles-message" && ev.data['direction'] === "from-background") {
    const message = (ev.data as Protocol.NetflixOpensubtitlesMessage).payload;

    if (message.type == "page-action-clicked") {
      toggleSubtitleDialog(uiState);
    } else if (message.type == "opensubtitles-response") {
      const [ resolve, reject ] = pendingCalls[message.requestId];
      if (message.response.type === 'error') {
        reject(message.response.error);
      } else {
        resolve(message.response.value);
      }
      delete pendingCalls[message.requestId];
    }
  }
});

let currentRequestId = 0;

const callOpenSubtitles = <Method extends Protocol.Method>(method: Method, request: Protocol.RequestForMethod[Method]) =>
  new Promise<Protocol.ResponseForMethod[Method]>((resolve, reject) => {
  pendingCalls[currentRequestId] = [ resolve, reject ];
  sendMessageToBackground({
    type: "opensubtitles-call",
    requestId: currentRequestId,
    method: method,
    request: request,
  });
  currentRequestId++;
});

const checkPlaying = () => {
  let newPlayingEpisode: VideoInfo | null = null;

  const titleElem = $('[data-uia="video-title"]').get();
  if (titleElem.length !== 0) {
    const seriesTitleElem = $(titleElem).find('h4');
    const episodeNumAndTitleElem = $(titleElem).find('span');

    if (seriesTitleElem.length == 1 && episodeNumAndTitleElem.length == 2) {
      const seriesTitle = seriesTitleElem.text();
      const episodeNumString = episodeNumAndTitleElem.get(0).textContent;
      const episodeTitleString = episodeNumAndTitleElem.get(1).textContent;

      if (episodeNumString && episodeTitleString) {
        const episodeNumMatch = /(\d+)\D+(\d+)/.exec(episodeNumString);
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

  const uiState = useStore.getState();

  const oldEpisode = uiState.playingContent;
  if (!oldEpisode && newPlayingEpisode) {
    sendMessageToBackground({ type: "show-page-action" });
  }
  
  if (newPlayingEpisode) {
    if (JSON.stringify(newPlayingEpisode) !== JSON.stringify(oldEpisode)) {
      uiState.setPlayingContent(newPlayingEpisode);
      uiState.setSubtitleDialogOpen(false);
      uiState.setAboutDialogOpen(false);
      uiState.setSubtitles({ state: "idle" });
      uiState.setConvertedSub({ state: "idle" });
      sendMessageToBackground({ type: "hide-page-action" });
    }
  }

  // We don't reset playingContent to null because we don't know if the user has actually left the player
  // or if the toolbar was just hidden.
};

$(() => {
  const container = document.createElement('div');

  $(document.body)
    .append(container)
    .on('keydown', ev => {
      const uiState = useStore.getState();
      if (ev.key.toLowerCase() === "d" && !uiState.subtitleDialogOpen) {
        openSubtitleDialog(uiState);
      }
    });

  ReactDOM.render(<MainComponent />, container)

  setInterval(checkPlaying, 250);
});