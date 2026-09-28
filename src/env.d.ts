declare global {
  interface Env {
    /** Firebase project ID, for example "medly-prod". This is not a secret. */
    FIREBASE_PROJECT_ID?: string;
    /** Comma-separated browser origins allowed to call the API. */
    CORS_ORIGINS?: string;
  }
}

export {};
