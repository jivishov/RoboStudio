const viteEnv = import.meta.env ?? {};

export const authConfig = {
  supabaseUrl: readOptionalEnv(viteEnv.VITE_SUPABASE_URL),
  supabaseAnonKey: readOptionalEnv(viteEnv.VITE_SUPABASE_ANON_KEY),
  storageKey: readEnv(viteEnv.VITE_AUTH_STORAGE_KEY, "robotic-arm-studio.auth"),
  callbackPath: normalizePath(readEnv(viteEnv.VITE_AUTH_CALLBACK_PATH, "/auth-callback.html")),
  returnPath: normalizePath(readEnv(viteEnv.VITE_AUTH_RETURN_PATH, "/parts.html")),
  googleOAuthQueryParams: {
    prompt: readEnv(viteEnv.VITE_GOOGLE_OAUTH_PROMPT, "select_account")
  },
  operationTimeoutMs: readPositiveIntEnv(viteEnv.VITE_AUTH_OPERATION_TIMEOUT_MS, 20000),
  localDev: {
    canonicalHost: readEnv(viteEnv.VITE_AUTH_LOCAL_CANONICAL_HOST, "127.0.0.1"),
    enforceSingleOrigin: readBooleanEnv(viteEnv.VITE_AUTH_ENFORCE_LOCAL_ORIGIN, true)
  },
  partLibraryTable: readEnv(viteEnv.VITE_SUPABASE_PART_LIBRARY_TABLE, "part_library_items")
};

export const isSupabaseConfigured = Boolean(
  authConfig.supabaseUrl
    && authConfig.supabaseAnonKey
    && !authConfig.supabaseUrl.includes("YOUR_PROJECT")
    && authConfig.supabaseAnonKey !== "replace-with-anon-key"
);

export function resolveAppUrl(path) {
  if (typeof window === "undefined") return path;
  const base = viteEnv.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(`${normalizedBase}${normalizePath(path).replace(/^\/+/, "")}`, window.location.origin).toString();
}

export function currentAppPath() {
  if (typeof window === "undefined") return "";
  const pathname = window.location?.pathname || "/";
  const base = viteEnv.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!normalizedBase || normalizedBase === "/") return normalizePath(pathname);
  if (!pathname.startsWith(normalizedBase)) return normalizePath(pathname);
  return normalizePath(pathname.slice(normalizedBase.length));
}

export function normalizePath(path) {
  const normalized = `/${String(path ?? "").replace(/^\/+/, "")}`.replace(/\/+$/, "");
  return normalized || "/";
}

function readOptionalEnv(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEnv(value, fallback) {
  return readOptionalEnv(value) ?? fallback;
}

function readPositiveIntEnv(value, fallback) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBooleanEnv(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
