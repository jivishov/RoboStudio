import { authConfig, isSupabaseConfigured } from "./authConfig.js";
import { signInWithGoogle, signOutOfGoogle, withTimeout } from "./authActions.js";
import {
  completeAuthCallbackIfPresent,
  getCurrentAuthCallbackSnapshot,
  hasStoredAuthState,
  isAuthCallbackSnapshot,
  isUsableSession,
  readAuthSessionFallback,
  rememberAuthSession,
  resetAuthState
} from "./authCallback.js";
import { authSupabase } from "./supabaseClient.js";

export function createAuthSessionController() {
  const listeners = new Set();
  let operationId = 0;
  let state = {
    status: isSupabaseConfigured ? "checking" : "error",
    step: isSupabaseConfigured ? "checking_existing_session" : "idle",
    session: null,
    user: null,
    error: isSupabaseConfigured ? null : "Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  };

  function emit(nextState) {
    state = {
      ...state,
      ...nextState,
      user: nextState.session ? nextState.session.user ?? null : nextState.session === null ? null : state.user
    };
    for (const listener of listeners) listener(state);
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  async function refresh() {
    operationId += 1;
    const currentOperation = operationId;
    const snapshot = getCurrentAuthCallbackSnapshot();
    const isCallback = isAuthCallbackSnapshot(snapshot);
    emit({ status: "checking", step: isCallback ? "completing_google_callback" : "checking_existing_session", error: null });

    try {
      if (!isSupabaseConfigured) {
        if (currentOperation === operationId) {
          emit({ status: "error", step: "idle", session: null, error: "Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." });
        }
        return state;
      }

      if (isCallback) {
        await withTimeout(completeAuthCallbackIfPresent(snapshot), authConfig.operationTimeoutMs, "Google sign-in timed out.");
      }

      if (currentOperation !== operationId) return state;
      emit({ status: "checking", step: "reading_google_session", error: null });

      const session = await readCurrentSession();
      if (currentOperation !== operationId) return state;
      if (session) {
        rememberAuthSession(session);
        emit({ status: "authenticated", step: "idle", session, error: null });
        return state;
      }

      emit({
        status: "signed_out",
        step: "idle",
        session: null,
        error: isCallback ? "Google sign-in returned to the app, but no Supabase session was stored. Reset sign-in and try again." : null
      });
    } catch (error) {
      if (currentOperation === operationId) {
        emit({
          status: "error",
          step: "idle",
          session: null,
          error: error instanceof Error && error.message.trim() ? error.message : "Google sign-in could not be completed."
        });
      }
    }
    return state;
  }

  async function signIn() {
    await signInWithGoogle();
  }

  async function reset() {
    operationId += 1;
    emit({ status: "checking", step: "resetting", error: null });
    try {
      if (isSupabaseConfigured) await signOutOfGoogle();
    } finally {
      resetAuthState();
      emit({ status: "signed_out", step: "idle", session: null, error: null });
    }
  }

  function dispose() {
    listeners.clear();
  }

  let subscription = null;
  if (isSupabaseConfigured) {
    const { data } = authSupabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        window.setTimeout(() => refresh().catch(() => undefined), 0);
      }
    });
    subscription = data?.subscription ?? null;
  }

  return {
    getState: () => state,
    subscribe,
    refresh,
    signIn,
    signOut: reset,
    reset,
    dispose: () => {
      subscription?.unsubscribe?.();
      dispose();
    }
  };
}

async function readCurrentSession() {
  const fallback = readAuthSessionFallback();
  if (fallback) return fallback;
  if (!hasStoredAuthState()) return null;

  const { data } = await withTimeout(
    authSupabase.auth.getSession(),
    authConfig.operationTimeoutMs,
    "Session check timed out."
  );
  const session = data.session ?? null;
  return session && isUsableSession(session) ? session : null;
}
