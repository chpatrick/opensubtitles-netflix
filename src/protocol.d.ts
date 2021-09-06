import { Query, LogInResult, SearchSubtitlesResult } from "./opensubtitles";

interface NetflixOpensubtitlesMessage {
  tag: "netflix-opensubtitles-message";
  payload: NetflixOpensubtitlesPayload;
  direction: "to-background" | "from-background";
}

interface LoginRequest {
  username: string;
  password: string;
  language: string;
  useragent: string;
}

interface SearchSubtitlesRequest {
  token: string,
  array_queries: Query[],
}

type Method = 'LogIn' | 'SearchSubtitles'

interface RequestForMethod {
  LogIn: LoginRequest,
  SearchSubtitles: SearchSubtitlesRequest
}

interface ResponseForMethod {
  LogIn: LogInResult,
  SearchSubtitles: SearchSubtitlesResult
}

type Response = { type: "error", error: any } | { type: "success", value: LogInResult | SearchSubtitlesResult }

type OpenSubtitlesResponse
  = {
    method: 'LogIn',
  } & LogInResult
  | {
      method: 'SearchSubtitles',
  } & SearchSubtitlesResult

type NetflixOpensubtitlesPayload
  = { type: "show-page-action" }
  | { type: "hide-page-action" }
  | { type: "page-action-clicked" }
  | { type: "opensubtitles-call", requestId: number, method: Method, request: LoginRequest | SearchSubtitlesRequest }
  | { type: "opensubtitles-response", requestId: number, method: Method, response: Response }
