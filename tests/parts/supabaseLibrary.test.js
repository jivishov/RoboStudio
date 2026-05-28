import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeLibraryItemsByUpdatedAt,
  partLibraryItemToRow,
  readSupabasePartLibrary,
  rowsToPartLibraryItems,
  syncPartLibraryWithSupabase,
  upsertSupabasePartLibraryItem
} from "../../src/parts/supabaseLibrary.js";
import { createPartLibraryItem } from "../../src/parts/library.js";
import { createPartProject } from "../../src/parts/contracts.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";

const session = { user: { id: "user-1", email: "user@example.com" } };

function libraryItem(id, updatedAt) {
  const body = createBodyFromTemplate("link_bar");
  return createPartLibraryItem(
    createPartProject({ bodies: [body], selectedBodyId: body.id, updatedAt }),
    body.id,
    { id, createdAt: updatedAt, updatedAt }
  );
}

test("maps part library items to Supabase rows scoped by user id", () => {
  const item = libraryItem("saved_link", "2026-05-27T12:00:00.000Z");
  const row = partLibraryItemToRow(item, session);

  assert.equal(row.user_id, "user-1");
  assert.equal(row.item_id, "saved_link");
  assert.equal(row.name, item.name);
  assert.deepEqual(row.item, item);
  assert.throws(() => partLibraryItemToRow(item, null), /Sign in before syncing/);
});

test("normalizes Supabase rows and keeps newer item revisions during merge", () => {
  const older = libraryItem("saved_link", "2026-05-27T12:00:00.000Z");
  const newer = { ...older, name: "Updated link", updatedAt: "2026-05-27T12:05:00.000Z" };
  const invalid = { item: { version: 1, id: "bad", primaryBodyId: "missing", bodies: [] } };

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    assert.deepEqual(rowsToPartLibraryItems([{ item: older }, invalid]), [older]);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(mergeLibraryItemsByUpdatedAt([older], [newer]), [newer]);
});

test("reads and upserts part library items through the Supabase table contract", async () => {
  const item = libraryItem("saved_link", "2026-05-27T12:00:00.000Z");
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            eq(column, value) {
              calls.push(["eq", column, value]);
              return {
                order(column, options) {
                  calls.push(["order", column, options]);
                  return { data: [{ item }], error: null };
                }
              };
            }
          };
        },
        upsert(row, options) {
          calls.push(["upsert", row, options]);
          return { error: null };
        }
      };
    }
  };

  assert.deepEqual(await readSupabasePartLibrary(session, { client, table: "part_library_items" }), [item]);
  await upsertSupabasePartLibraryItem(session, item, { client, table: "part_library_items" });

  assert.deepEqual(calls[0], ["from", "part_library_items"]);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "user_id" && call[2] === "user-1"));
  assert.ok(calls.some((call) => call[0] === "upsert" && call[2].onConflict === "user_id,item_id"));
});

test("sync merges local and remote libraries then writes the merged set back", async () => {
  const local = libraryItem("local_link", "2026-05-27T12:00:00.000Z");
  const remote = libraryItem("remote_link", "2026-05-27T12:05:00.000Z");
  const upserts = [];
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return { data: [{ item: remote }], error: null };
                }
              };
            }
          };
        },
        upsert(row) {
          upserts.push(row.item_id);
          return { error: null };
        }
      };
    }
  };

  const merged = await syncPartLibraryWithSupabase(session, [local], { client });

  assert.deepEqual(merged.map((item) => item.id), ["remote_link", "local_link"]);
  assert.deepEqual(new Set(upserts), new Set(["remote_link", "local_link"]));
});
