/**
 * Local-only development switch loaded from `.dev.vars`.
 *
 * It is intentionally optional: deployed Workers do not receive this binding.
 */
declare global {
  interface Env {
    DEV_AUTH_ENABLED?: string;
  }
}

export {};
