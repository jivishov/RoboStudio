import { authConfig } from "../auth/authConfig.js";
import { authSupabase } from "../auth/supabaseClient.js";
import { mergePartLibraryItems, normalizePartLibraryItem } from "./library.js";

export function requireSupabaseUser(session) {
  const userId = session?.user?.id;
  if (!userId) throw new Error("Sign in before syncing the part library.");
  return userId;
}

export function partLibraryItemToRow(itemInput, session) {
  const userId = requireSupabaseUser(session);
  const item = normalizePartLibraryItem(itemInput);
  return {
    user_id: userId,
    item_id: item.id,
    name: item.name,
    item,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

export function rowsToPartLibraryItems(rows = []) {
  const items = [];
  for (const row of rows ?? []) {
    try {
      items.push(normalizePartLibraryItem(row.item));
    } catch (error) {
      console.warn("Ignoring invalid Supabase part library row", error);
    }
  }
  return items;
}

export function mergeLibraryItemsByUpdatedAt(localItems = [], remoteItems = []) {
  const byId = new Map();
  for (const itemInput of [...localItems, ...remoteItems]) {
    const item = normalizePartLibraryItem(itemInput);
    const existing = byId.get(item.id);
    if (!existing || Date.parse(item.updatedAt) >= Date.parse(existing.updatedAt)) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt));
}

export async function readSupabasePartLibrary(session, options = {}) {
  const userId = requireSupabaseUser(session);
  const client = options.client ?? authSupabase;
  const table = options.table ?? authConfig.partLibraryTable;
  const { data, error } = await client
    .from(table)
    .select("item")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message || "Supabase part library could not be loaded.");
  return rowsToPartLibraryItems(data ?? []);
}

export async function upsertSupabasePartLibraryItem(session, item, options = {}) {
  const client = options.client ?? authSupabase;
  const table = options.table ?? authConfig.partLibraryTable;
  const row = partLibraryItemToRow(item, session);
  const { error } = await client
    .from(table)
    .upsert(row, { onConflict: "user_id,item_id" });
  if (error) throw new Error(error.message || "Supabase part library item could not be saved.");
  return row;
}

export async function deleteSupabasePartLibraryItem(session, itemId, options = {}) {
  const userId = requireSupabaseUser(session);
  const client = options.client ?? authSupabase;
  const table = options.table ?? authConfig.partLibraryTable;
  const { error } = await client
    .from(table)
    .delete()
    .eq("user_id", userId)
    .eq("item_id", itemId);
  if (error) throw new Error(error.message || "Supabase part library item could not be deleted.");
}

export async function syncPartLibraryWithSupabase(session, localItems, options = {}) {
  const remoteItems = await readSupabasePartLibrary(session, options);
  const mergedItems = mergeLibraryItemsByUpdatedAt(mergePartLibraryItems([], localItems), remoteItems);
  for (const item of mergedItems) {
    await upsertSupabasePartLibraryItem(session, item, options);
  }
  return mergedItems;
}
