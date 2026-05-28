import { createClient } from "@supabase/supabase-js";
import { authConfig, isSupabaseConfigured } from "./authConfig.js";

if (!isSupabaseConfigured && typeof window !== "undefined") {
  console.warn("Missing Supabase frontend environment variables.");
}

export const authSupabase = createClient(
  authConfig.supabaseUrl ?? "https://example.supabase.co",
  authConfig.supabaseAnonKey ?? "missing",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
      detectSessionInUrl: false,
      storageKey: authConfig.storageKey
    }
  }
);
