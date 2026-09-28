declare global {
  interface Env {
    /** Firebase project ID, for example "medly-prod". This is not a secret. */
    FIREBASE_PROJECT_ID?: string;
  }
}

export {};
