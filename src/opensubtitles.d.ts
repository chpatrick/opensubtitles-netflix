export interface Query {
  query?: string;
  season?: string;
  episode?: string;
}

export interface SubMetadata {
  SubFileName: string;
  SubDownloadLink: string;
  ISO639: string;
  LanguageName: string;
  IDSubtitle: string;
  SubTranslator: string;
  SubFormat: string;
  SubEncoding: string;
}

export interface SearchSubtitlesResult {
  data: SubMetadata[];
}

export interface LogInResult {
  token: string;
  status: string;
}

export class OS {
  constructor(endpoint: string | undefined, ssl: boolean);

  LogIn(username: string, password: string, language: string, useragent: string): Promise<LogInResult>;
  SearchSubtitles(token: string, array_queries: Query[]): Promise<SearchSubtitlesResult>;
}