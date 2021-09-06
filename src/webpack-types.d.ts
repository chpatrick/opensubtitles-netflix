declare module "*.css" {
    const content: any;
    export default content;
  }

declare module "*.svg" {
  const path: string;
  export default path;
}

declare module "*.webp" {
  const path: string;
  export default path;
}

// User agent passed in from configuration.
declare const OS_USER_AGENT: string;
declare const OS_PAYLOAD_SRC: string;
declare const OS_SENTRY_DSN: string | null;