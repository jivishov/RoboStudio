import { authConfig, isSupabaseConfigured, resolveAppUrl } from "./authConfig.js";
import { getCanonicalLocalOrigin } from "./localAuthOrigin.js";
import { authSupabase } from "./supabaseClient.js";

export async function signInWithGoogle() {
  if (!isSupabaseConfigured) {
    throw new Error("Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before using Google sign-in.");
  }
  if (redirectToCanonicalLocalOriginIfNeeded()) return;

  const { error } = await withTimeout(
    authSupabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: resolveAppUrl(authConfig.callbackPath),
        queryParams: authConfig.googleOAuthQueryParams
      }
    }),
    authConfig.operationTimeoutMs,
    "Google sign-in timed out."
  );
  if (error) throw new Error(resolveOAuthStartErrorMessage(error.message));
}

export async function signOutOfGoogle() {
  if (!isSupabaseConfigured) return;
  await authSupabase.auth.signOut();
}

export async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function redirectToCanonicalLocalOriginIfNeeded() {
  if (typeof window === "undefined") return false;
  const canonicalOrigin = getCanonicalLocalOrigin(window.location.origin);
  if (canonicalOrigin === window.location.origin) return false;
  window.location.replace(new URL(`${window.location.pathname}${window.location.search}${window.location.hash}`, canonicalOrigin).toString());
  return true;
}

function resolveOAuthStartErrorMessage(message) {
  const trimmed = String(message ?? "").trim();
  const suffix = typeof window === "undefined" ? "" : ` Confirm Supabase Auth redirect URLs include ${resolveAppUrl(authConfig.callbackPath)}.`;
  if (/redirect|allow.?list|not allowed|site url/i.test(trimmed)) {
    return `${trimmed || "Google sign-in could not start."}${suffix}`;
  }
  return trimmed || "Google sign-in could not start.";
}
