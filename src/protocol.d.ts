interface NetflixOpensubtitlesMessage {
  tag: "netflix-opensubtitles-message";
  payload: NetflixOpensubtitlesPayload;
  direction: "to-background" | "from-background";
}

type NetflixOpensubtitlesPayload
  = { type: "show-page-action" }
  | { type: "hide-page-action" }
  | { type: "page-action-clicked" }

declare module "*.css" {
  const content: any;
  export default content;
}

declare module "*.svg" {
  const content: string;
  export default content;
}

// User agent passed in from configuration.
declare const OS_USER_AGENT: string;
declare const OS_PAYLOAD_SRC: string;
declare const OS_SENTRY_DSN: string | null;