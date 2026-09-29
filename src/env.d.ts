declare global {
  interface Env {
    /** Firebase project ID, for example "medly-prod". This is not a secret. */
    FIREBASE_PROJECT_ID?: string;
    /** Comma-separated browser origins allowed to call the API. */
    CORS_ORIGINS?: string;
    /** Cloudflare account that owns the private R2 bucket. */
    R2_ACCOUNT_ID?: string;
    /** R2 bucket name. Defaults to the configured Medly production bucket. */
    R2_BUCKET_NAME?: string;
    /** R2 S3 API credentials used only to mint short-lived upload URLs. */
    R2_S3_ACCESS_KEY_ID?: string;
    R2_S3_SECRET_ACCESS_KEY?: string;
  }
}

export {};
