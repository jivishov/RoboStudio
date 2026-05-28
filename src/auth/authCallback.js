import { authConfig, currentAppPath, isSupabaseConfigured, resolveAppUrl } from "./authConfig.js";
import { getCanonicalLocalUrl } from "./localAuthOrigin.js";
import { authSupabase } from "./supabaseClient.js";

let authCallbackCompletion = null;
let lastCompletedSession = null;

export function getCurrentAuthCallbackSnapshot() {
  return createAuthCallbackSnapshot();
}

export function hasActionableAuthCallbackSignal(snapshot) {
  return snapshot.hasCode || snapshot.hasHashToken || snapshot.hasProviderError;
}

export function isAuthCallbackSnapshot(snapshot) {
  return snapshot.path === authConfig.callbackPath && hasActionableAuthCallbackSignal(snapshot);
}

export async function completeAuthCallbackIfPresent(snapshot = getCurrentAuthCallbackSnapshot()) {
  if (!isSupabaseConfigured || typeof window === "undefined") return null;
  if (!isAuthCallbackSnapshot(snapshot)) return null;
  authCallbackCompletion ??= completeAuthCallback();
  return authCallbackCompletion;
}

export function resetAuthState(storage) {
  authCallbackCompletion = null;
  lastCompletedSession = null;
  const storages = storage ? [storage] : getBrowserAuthStorages();
  for (const authStorage of storages) removeAppAuthStorageKeys(authStorage);
}

export function rememberAuthSession(session) {
  if (session && isUsableSession(session)) lastCompletedSession = session;
}

export function readAuthSessionFallback() {
  if (lastCompletedSession && isUsableSession(lastCompletedSession)) return lastCompletedSession;
  return readStoredSession();
}

export function hasStoredAuthState() {
  if (readStorageItem(authConfig.storageKey) !== null || readStorageItem(`${authConfig.storageKey}-code-verifier`) !== null) {
    return true;
  }
  for (const storage of getBrowserAuthStorages()) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && isAppAuthStorageKey(key)) return true;
      }
    } catch {
      // Ignore unavailable storage.
    }
  }
  return false;
}

export function isUsableSession(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.access_token !== "string" || !value.access_token.trim()) return false;
  if (typeof value.expires_at === "number" && value.expires_at * 1000 < Date.now() - 60000) {
    return false;
  }
  return true;
}

async function completeAuthCallback() {
  const url = new URL(window.location.href);
  const hashParams = parseUrlHash(url);
  const providerError = readProviderError(url, hashParams);
  if (providerError) {
    clearAuthCallbackUrl(url);
    throw new Error(providerError);
  }

  try {
    const code = url.searchParams.get("code");
    if (code) {
      lastCompletedSession = await exchangeCodeForSession(code);
      return lastCompletedSession;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (accessToken && refreshToken) {
      const { data, error } = await authSupabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) throw new Error(error.message);
      lastCompletedSession = data?.session ?? null;
      return lastCompletedSession;
    }
    return null;
  } finally {
    clearAuthCallbackUrl(url);
  }
}

async function exchangeCodeForSession(code) {
  const codeVerifier = readCodeVerifier();
  if (!codeVerifier) {
    const storedSession = readStoredSession();
    if (storedSession) return storedSession;
    throw new Error(readMissingCodeVerifierMessage());
  }

  const { data, error } = await authSupabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (isMissingCodeVerifierError(error)) throw new Error(readMissingCodeVerifierMessage());
    throw new Error(error.message);
  }

  const session = data?.session ?? null;
  if (!session) throw new Error("Google sign-in returned an invalid session.");
  lastCompletedSession = session;
  return session;
}

function createAuthCallbackSnapshot() {
  if (typeof window === "undefined") {
    return { path: "", hasCode: false, hasHashToken: false, hasProviderError: false, hasEmptyHash: false };
  }
  const href = window.location.href || `http://localhost${window.location.pathname || "/"}`;
  const url = new URL(href);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash);
  return {
    path: currentAppPath(),
    hasCode: url.searchParams.has("code"),
    hasHashToken: hashParams.has("access_token") || hashParams.has("refresh_token"),
    hasProviderError:
      url.searchParams.has("error")
      || url.searchParams.has("error_code")
      || url.searchParams.has("error_description")
      || hashParams.has("error")
      || hashParams.has("error_description"),
    hasEmptyHash: href.includes("#") && hash === ""
  };
}

function parseUrlHash(url) {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(hash);
}

function readProviderError(url, hashParams) {
  const message = url.searchParams.get("error_description")
    ?? hashParams.get("error_description")
    ?? url.searchParams.get("error")
    ?? hashParams.get("error")
    ?? url.searchParams.get("error_code")
    ?? hashParams.get("error_code");
  return message ? `Google sign-in failed: ${message}` : null;
}

function clearAuthCallbackUrl(url) {
  for (const key of ["code", "state", "error", "error_code", "error_description"]) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
}

function readMissingCodeVerifierMessage() {
  const recoveryUrl = getCanonicalLocalUrl(resolveAppUrl(authConfig.returnPath)) ?? resolveAppUrl(authConfig.returnPath);
  return `Google sign-in could not be completed because this browser is missing the PKCE verifier. Return to ${recoveryUrl} and start sign-in again without switching host, browser profile, or private browsing state.`;
}

function isMissingCodeVerifierError(error) {
  const message = error.message?.toLowerCase() ?? "";
  const name = error.name?.toLowerCase() ?? "";
  return name.includes("pkce") || (message.includes("pkce") && message.includes("verifier"));
}

function readCodeVerifier() {
  const raw = readStorageItem(`${authConfig.storageKey}-code-verifier`);
  if (!raw) return null;
  const parsed = parseStoredJson(raw);
  const value = typeof parsed === "string" ? parsed : raw;
  const [codeVerifier] = value.split("/");
  return codeVerifier || null;
}

function readStorageItem(key) {
  for (const storage of getReadableAuthStorages()) {
    try {
      const value = storage.getItem(key);
      if (value) return value;
    } catch {
      // Ignore unavailable storage.
    }
  }
  return null;
}

function parseStoredJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readStoredSession() {
  for (const storage of getReadableAuthStorages()) {
    const session = readStoredSessionFrom(storage);
    if (session) return session;
  }
  return null;
}

function readStoredSessionFrom(storage) {
  try {
    const raw = storage.getItem(authConfig.storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = extractStoredSession(parsed);
    return session && isUsableSession(session) ? session : null;
  } catch {
    return null;
  }
}

function extractStoredSession(value) {
  if (!value || typeof value !== "object") return null;
  if (isUsableSession(value)) return value;
  if (isUsableSession(value.currentSession)) return value.currentSession;
  if (isUsableSession(value.session)) return value.session;
  return null;
}

function getBrowserAuthStorages() {
  if (typeof window === "undefined") return [];
  const storages = [];
  try {
    storages.push(window.localStorage);
  } catch {
    // Ignore unavailable storage.
  }
  try {
    storages.push(window.sessionStorage);
  } catch {
    // Ignore unavailable storage.
  }
  return storages;
}

function getReadableAuthStorages() {
  return getBrowserAuthStorages();
}

function removeAppAuthStorageKeys(storage) {
  const keys = new Set();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && isAppAuthStorageKey(key)) keys.add(key);
    }
  } catch {
    keys.add(authConfig.storageKey);
    keys.add(`${authConfig.storageKey}-code-verifier`);
  }

  for (const key of keys) safelyRemoveStorageKey(storage, key);
}

function safelyRemoveStorageKey(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore locked-down browser storage failures during recovery.
  }
}

function isAppAuthStorageKey(key) {
  return key === authConfig.storageKey || key.startsWith(`${authConfig.storageKey}-`);
}
