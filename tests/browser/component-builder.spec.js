import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { HARDWARE_ENTRY_IDS } from "../../src/parts/hardware.js";
import { HOLE_STANDARD_ISO_METRIC } from "../../src/parts/holes.js";
import { createPartLibraryItem } from "../../src/parts/library.js";
import { addBody, normalizePartProject } from "../../src/parts/projectState.js";
import { componentDimensionMm } from "../../src/parts/standards/components.js";
import { clearanceHoleDiameterMm, minEdgeDistanceMm } from "../../src/parts/standards/fasteners.js";
import { fitBoreMm } from "../../src/parts/standards/fits.js";
import { undercutLimitProfileShift } from "../../src/parts/standards/gears.js";
import { createBodyFromTemplate } from "../../src/parts/templates.js";
import {
  CIRCUIT_DESIGN_STORE_NAME,
  CURRENT_PART_PROJECT_KEY,
  CURRENT_SNAPSHOT_KEY,
  DESIGN_STORE_NAME,
  PART_LIBRARY_STORE_NAME,
  PART_PROJECT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  WORKSPACE_DB_NAME,
  WORKSPACE_DB_VERSION
} from "../../src/workspaceDb.js";

const consoleByPage = new WeakMap();

const CURRENT_STORE_NAMES = [
  SNAPSHOT_STORE_NAME,
  DESIGN_STORE_NAME,
  PART_LIBRARY_STORE_NAME,
  CIRCUIT_DESIGN_STORE_NAME,
  PART_PROJECT_STORE_NAME
];

// The store set a version-4 database had, before this cycle added part-projects.
const VERSION_FOUR_STORE_NAMES = [
  SNAPSHOT_STORE_NAME,
  DESIGN_STORE_NAME,
  PART_LIBRARY_STORE_NAME,
  CIRCUIT_DESIGN_STORE_NAME
];

// A real library entry, built through the same factory the page uses, so the version-4
// upgrade test proves an entry a version-4 profile could actually hold survives.
const VERSION_FOUR_LIBRARY_ITEM = (() => {
  const project = addBody(
    normalizePartProject({ updatedAt: "2026-07-27T09:00:00.000Z" }),
    createBodyFromTemplate("base_plate", { existingIds: new Set() }),
    { updatedAt: "2026-07-27T09:00:01.000Z" }
  );
  return createPartLibraryItem(project, project.selectedBodyId, {
    name: "Saved base",
    updatedAt: "2026-07-27T09:00:02.000Z"
  });
})();

// Seeding runs on a blank same-origin page so it never races the Component Builder bootstrap.
async function seedWorkspace(page, options = {}) {
  const version = options.version ?? WORKSPACE_DB_VERSION;
  const storeNames = options.storeNames ?? CURRENT_STORE_NAMES;
  const entries = options.entries ?? [];

  await page.goto("/__workspace-seed.html");
  await page.evaluate(async ({ dbName, dbVersion, stores, seededEntries }) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.addEventListener("success", resolve);
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () => reject(new Error("IndexedDB delete was blocked.")));
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, dbVersion);
      request.addEventListener("upgradeneeded", () => {
        for (const storeName of stores) {
          if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    if (seededEntries.length) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(stores, "readwrite");
        for (const entry of seededEntries) {
          transaction.objectStore(entry.storeName).put(entry.value, entry.key);
        }
        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("error", () => reject(transaction.error));
        transaction.addEventListener("abort", () => reject(transaction.error));
      });
    }
    db.close();
  }, { dbName: WORKSPACE_DB_NAME, dbVersion: version, stores: storeNames, seededEntries: entries });
}

// Reads the persisted record straight out of IndexedDB, so assertions about what was written
// never go through the code that wrote it.
async function readPersistedRecord(page, storeName, key) {
  return page.evaluate(async ({ dbName, store, recordKey }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    try {
      if (!db.objectStoreNames.contains(store)) return { missingStore: true };
      const value = await new Promise((resolve, reject) => {
        const request = db.transaction(store, "readonly").objectStore(store).get(recordKey);
        request.addEventListener("success", () => resolve(request.result ?? null));
        request.addEventListener("error", () => reject(request.error));
      });
      return { missingStore: false, version: db.version, value };
    } finally {
      db.close();
    }
  }, { dbName: WORKSPACE_DB_NAME, store: storeName, recordKey: key });
}

async function openComponentBuilder(page) {
  await page.goto("/parts.html");
  await expect(page).toHaveTitle("Robotic Component Builder");
  await page.waitForFunction(() => Boolean(window.__partsPersistence && window.__partsCompile));
  // The restore attempt has to land before anything is asserted about project state.
  await page.waitForFunction(() => window.__partsPersistence.ready());
}

// The compile is debounced and runs in a worker, so "settled" means no request is in
// flight and every body has a cached result. Never sleep.
async function waitForCompileSettled(page) {
  await expect
    .poll(() => page.evaluate(() => {
      const bodyIds = window.__partsPersistence.project().bodies.map((body) => body.id);
      const results = new Set(window.__partsCompile.resultBodyIds());
      return !window.__partsCompile.compiling() && bodyIds.every((bodyId) => results.has(bodyId));
    }), { timeout: 60_000 })
    .toBe(true);
}

async function addTemplateBody(page) {
  const before = await page.locator("#body-list .body-row").count();
  await page.locator("#add-template").click();
  await expect(page.locator("#body-list .body-row")).toHaveCount(before + 1);
  return page.locator("#body-list .body-row").nth(before).locator(".body-row__name").innerText();
}

// Autosave is debounced, so waiting for the write generation to advance is the observable
// signal that the project has reached IndexedDB. Never sleep and never assume a click landed.
//
// `baselineGeneration` exists because the 700 ms debounce can elapse during the assertions
// between an edit and this call, in which case the write has already landed and the
// generation will never advance again - autosave skips an unchanged write by design. A
// caller that does other work in between must capture the generation *before* its edit and
// pass it here, rather than this helper weakening to "not dirty" and stopping proving that
// a write happened at all. A caller that forgets is told so by name on timeout, because
// otherwise this and a real persistence failure are the same 15 s hang.
async function waitForAutosave(page, baselineGeneration = null) {
  const before = baselineGeneration ?? (await page.evaluate(() => window.__partsPersistence.generation()));
  try {
    await expect
      .poll(() => page.evaluate(() => window.__partsPersistence.generation()), { timeout: 15_000 })
      .toBeGreaterThan(before);
  } catch (error) {
    // A missed baseline and a genuine persistence failure both surface here as the same
    // 15 s timeout, so name which one this is rather than leaving the next reader to
    // rediscover the debounce race. Diagnosis must never replace the failure: if this read
    // cannot be taken, the original error is the honest one and is rethrown untouched.
    let state = null;
    try {
      state = await page.evaluate(() => ({
        generation: window.__partsPersistence.generation(),
        dirty: window.__partsPersistence.dirty(),
        ...window.__partsPersistence.stats()
      }));
    } catch {
      throw error;
    }
    // Observed, not inferred: nothing was written since `before` and nothing is outstanding.
    // A write that failed re-queues its payload, so it would leave the project dirty.
    const quietAndUnwritten = state.generation === before && !state.dirty;
    const counters = `(generation ${state.generation}, writes ${state.writes}, `
      + `unchanged ${state.unchanged}, failures ${state.failures})`;
    if (quietAndUnwritten && baselineGeneration == null) {
      throw new Error(
        "waitForAutosave: no write landed and nothing is pending. The 700 ms debounce very "
        + "likely elapsed during the assertions before this call, so the write had already "
        + "landed and the generation read here was taken after it. Capture the generation "
        + `before the edit and pass it as \`baselineGeneration\`. ${counters}`
      );
    }
    if (quietAndUnwritten) {
      throw new Error(
        "waitForAutosave: no write landed since the supplied baseline and nothing is pending, "
        + `so the edit under test never reached autosave. ${counters}`
      );
    }
    throw error;
  }
  await expect.poll(() => page.evaluate(() => window.__partsPersistence.dirty())).toBe(false);
}

// Dispatching the event is the only way to observe the unload guard: Playwright dismisses the
// real prompt without reporting whether one was raised. `defaultPrevented` is exactly the
// signal the browser reads to decide whether to interrupt the user.
async function dispatchBeforeUnload(page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function bodyNames(page) {
  return page.locator("#body-list .body-row__name").allInnerTexts();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/__workspace-seed.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Workspace seed</title>"
  }));
  await page.route(/^https:\/\/fonts\.googleapis\.com\//u, (route) => route.fulfill({
    status: 200,
    contentType: "text/css",
    body: ""
  }));
  const consoleMessages = [];
  consoleByPage.set(page, consoleMessages);
  page.on("console", (message) => {
    if (message.type() === "error") consoleMessages.push(message.text());
  });
  page.on("pageerror", (error) => consoleMessages.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(consoleByPage.get(page) ?? []).toEqual([]);
});

test("a body added to the project survives a reload", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await expect(page.locator("#body-list .body-row")).toHaveCount(0);
  await expect(page.locator("#body-list .empty-note")).toBeVisible();

  const addedName = await addTemplateBody(page);
  await waitForAutosave(page);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__partsPersistence));
  await page.waitForFunction(() => window.__partsPersistence.ready());

  await expect(page.locator("#body-list .body-row")).toHaveCount(1);
  await expect(page.locator("#body-list .body-row__name")).toHaveText(addedName);
  await expect(page.locator("#body-count")).toHaveText("1");
  await expect(page.locator("#selected-body-summary")).toContainText(addedName);
  await expect(page.locator("#part-status")).toContainText("Restored saved project with 1 body");
});

test("the persisted record holds project state only and no undo or redo history", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);

  await addTemplateBody(page);
  await addTemplateBody(page);
  await waitForAutosave(page);
  // Two commits, so a writer that leaked history would have something to leak.
  expect(await page.evaluate(() => window.__partsPersistence.historyDepth())).toEqual({ undo: 2, redo: 0 });
  await expect(page.locator("#undo-project")).toBeEnabled();

  const record = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  expect(record.missingStore).toBe(false);
  expect(record.version).toBe(WORKSPACE_DB_VERSION);
  expect(Object.keys(record.value).sort()).toEqual(["bodies", "selectedBodyId", "units", "updatedAt", "version"]);
  // The body-level key set is asserted for the same reason as the project-level one:
  // every field added to a persisted body is a storage decision, and it must be a
  // deliberate one. `materialId` was added by cycle 03 and `processId` by cycle 06;
  // derived mass properties and manufacturability findings were deliberately not, so
  // no volume, area, mass or finding key may appear here.
  expect(Object.keys(record.value.bodies[0]).sort()).toEqual([
    "color",
    "extrudeDepthMm",
    "id",
    "materialId",
    "name",
    "processId",
    "sketch",
    "source",
    "transform"
  ]);
  expect(JSON.stringify(record.value)).not.toContain("volumeMm3");
  expect(JSON.stringify(record.value)).not.toContain("massProperties");
  expect(record.value.version).toBe(1);
  expect(record.value.units).toBe("mm");
  expect(record.value.bodies).toHaveLength(2);
  expect(JSON.stringify(record.value)).not.toContain("undoStack");
  expect(JSON.stringify(record.value)).not.toContain("redoStack");

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__partsPersistence));
  await page.waitForFunction(() => window.__partsPersistence.ready());

  await expect(page.locator("#body-list .body-row")).toHaveCount(2);
  // Bodies come back; the history that produced them does not.
  expect(await page.evaluate(() => window.__partsPersistence.historyDepth())).toEqual({ undo: 0, redo: 0 });
  await expect(page.locator("#undo-project")).toBeDisabled();
  await expect(page.locator("#redo-project")).toBeDisabled();
});

test("Send Assembly keeps the project across the handoff navigation", async ({ page }) => {
  // Stub the Assembly Studio so this spec measures the handoff, not the studio's own bootstrap.
  await page.route(
    (url) => url.pathname === "/" && url.searchParams.get("fromParts") === "1",
    (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Assembly Studio stub</title><p id='handoff-landing'>arrived</p>"
    })
  );

  await seedWorkspace(page);
  await openComponentBuilder(page);
  const addedName = await addTemplateBody(page);
  await waitForAutosave(page);

  await expect(page.locator("#send-assembly")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#send-assembly").click();
  await expect(page.locator("#handoff-landing")).toHaveText("arrived");

  const snapshot = await readPersistedRecord(page, SNAPSHOT_STORE_NAME, CURRENT_SNAPSHOT_KEY);
  expect(snapshot.value).not.toBeNull();

  await openComponentBuilder(page);
  await expect(page.locator("#body-list .body-row")).toHaveCount(1);
  await expect(page.locator("#body-list .body-row__name")).toHaveText(addedName);
});

test("a header page link flushes the project before leaving the page", async ({ page }) => {
  await page.route("**/circuits.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Circuit Lab stub</title><p id='circuit-landing'>arrived</p>"
  }));

  await seedWorkspace(page);
  await openComponentBuilder(page);
  const addedName = await addTemplateBody(page);
  // Deliberately not waiting for the debounce: the click has to flush the dirty project.
  expect(await page.evaluate(() => window.__partsPersistence.dirty())).toBe(true);

  await page.getByRole("link", { name: "Open Circuit Lab" }).click();
  await expect(page.locator("#circuit-landing")).toHaveText("arrived");

  await openComponentBuilder(page);
  await expect(page.locator("#body-list .body-row__name")).toHaveText(addedName);
});

test("the unload guard interrupts a dirty project and goes quiet once the write has landed", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);

  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());
  await addTemplateBody(page);

  // Reload and tab close cannot await a write, so prompting is the only honest option while
  // the project is dirty.
  expect(await page.evaluate(() => window.__partsPersistence.dirty())).toBe(true);
  expect(await dispatchBeforeUnload(page)).toBe(true);

  await waitForAutosave(page, generationBefore);

  // "Quiet" has to mean the work is safe, not merely that a flag cleared, so the record is
  // read back before the guard is asked again.
  const record = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  expect(record.value.bodies).toHaveLength(1);

  // The other direction: with nothing outstanding the same guard must not interrupt the user.
  expect(await dispatchBeforeUnload(page)).toBe(false);
});

test("an unchanged project is not rewritten and leaves nothing to flush", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForAutosave(page);

  const statsAfterAdd = await page.evaluate(() => window.__partsPersistence.stats());
  // Load-bearing for the whole unchanged-write skip. Re-selecting the already-selected body
  // re-timestamps the project, so this passes only while `parts.js` hands autosave a
  // fingerprint that blanks `updatedAt`; a caller that drops that option falls back to
  // `serialize` (autosave.js) and the skip becomes dead code with no other test failing.
  await page.locator("#body-list .body-row").first().click();
  await expect(page.locator("#part-status")).toContainText("Selected");
  await page.evaluate(() => window.__partsPersistence.flush());

  const statsAfterReselect = await page.evaluate(() => window.__partsPersistence.stats());
  expect(statsAfterReselect.writes).toBe(statsAfterAdd.writes);
  // Not merely "no write happened": the skip path is the thing that ran.
  expect(statsAfterReselect.unchanged).toBeGreaterThan(statsAfterAdd.unchanged);
  expect(await page.evaluate(() => window.__partsPersistence.dirty())).toBe(false);
});

test("New asks before replacing a saved project and persists the empty one once accepted", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForAutosave(page);

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#new-project").click();
  // Dismissed: the project is untouched, so there is nothing to write.
  await expect(page.locator("#body-list .body-row")).toHaveCount(1);
  expect(await page.evaluate(() => window.__partsPersistence.dirty())).toBe(false);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#new-project").click();
  await expect(page.locator("#body-list .body-row")).toHaveCount(0);
  await waitForAutosave(page);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__partsPersistence));
  await page.waitForFunction(() => window.__partsPersistence.ready());
  await expect(page.locator("#body-list .body-row")).toHaveCount(0);
});

test("an unreadable saved project keeps the page usable and the record untouched", async ({ page }) => {
  const corruptRecord = "{ this is not a PartProject";
  await seedWorkspace(page, {
    entries: [{ storeName: PART_PROJECT_STORE_NAME, key: CURRENT_PART_PROJECT_KEY, value: corruptRecord }]
  });

  await openComponentBuilder(page);

  await expect(page.locator("#part-status")).toContainText("could not be read");
  expect(await page.evaluate(() => window.__partsPersistence.savedProjectUnreadable())).toBe(true);
  // A usable page: the starter project, not a blank one.
  await expect(page.locator("#body-list .empty-note")).toBeVisible();
  await expect(page.locator("#template-select")).toBeVisible();
  await expect(page.locator("#body-count")).toHaveText("0");

  // Nothing was written over the unreadable record before the user acted.
  const untouched = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  expect(untouched.value).toBe(corruptRecord);
  expect(await page.evaluate(() => window.__partsPersistence.stats().writes)).toBe(0);

  // And the page still works: an edit saves and restores normally from here.
  const addedName = await addTemplateBody(page);
  await waitForAutosave(page);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__partsPersistence));
  await page.waitForFunction(() => window.__partsPersistence.ready());
  await expect(page.locator("#body-list .body-row__name")).toHaveText(addedName);
});

test("a base plate reports a printed mass and switching material never recompiles", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  const materialSelect = page.locator("#mass-properties select[data-body-prop='materialId']");
  await expect(materialSelect).toHaveValue("pla");

  // A 120 x 80 x 6 plate with rounded corners and four M3 holes is about 57 cm3, so
  // PLA at 1.24 g/cm3 is about 70 g. Plausible, and read from the page rather than
  // recomputed here.
  const plaMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));
  expect(plaMass).toBeGreaterThan(50);
  expect(plaMass).toBeLessThan(95);
  expect(Number((await page.locator("#body-volume-value").innerText()))).toBeGreaterThan(50);
  await expect(page.locator("#mass-summary")).toContainText("g");
  await expect(page.locator("#mass-method-note")).toContainText("Exact profile integral");

  const messagesBefore = await page.evaluate(() => window.__partsCompile.workerMessages());
  const requestsBefore = await page.evaluate(() => window.__partsCompile.requests().length);
  // Captured before the edit: the assertions below take longer than the 700 ms autosave
  // debounce, so by the time `waitForAutosave` runs the write has already landed.
  const generationBeforeMaterial = await page.evaluate(() => window.__partsPersistence.generation());

  await materialSelect.selectOption("petg");
  await expect(page.locator("#mass-properties select[data-body-prop='materialId']")).toHaveValue("petg");
  const petgMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));
  // PETG is 1.27 against PLA's 1.24, so the mass has to rise by about 2.4 percent.
  expect(petgMass).toBeGreaterThan(plaMass);
  expect(petgMass / plaMass).toBeCloseTo(1.27 / 1.24, 3);

  // The whole point of the density-free worker result: no message was posted at all.
  await waitForCompileSettled(page);
  expect(await page.evaluate(() => window.__partsCompile.workerMessages())).toBe(messagesBefore);
  expect(await page.evaluate(() => window.__partsCompile.requests().length)).toBe(requestsBefore);

  // The material is project state, so it survives a reload and the mass comes back.
  await waitForAutosave(page, generationBeforeMaterial);
  await page.reload();
  await openComponentBuilder(page);
  await waitForCompileSettled(page);
  await expect(page.locator("#mass-properties select[data-body-prop='materialId']")).toHaveValue("petg");
  expect(Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""))).toBeCloseTo(petgMass, 1);
});

test("a non-uniform placement scale renders a dash for surface area, not an interpolation", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  // Asserted on the rendered text, never on the property. The property is `null` either
  // way - it was already `null` when cycle 04's fabricated zero shipped. What broke was
  // the step after it, where a unit conversion applied ahead of the absence check turns
  // `null` into a perfectly finite `0` (`parts.js:2333`). Only the DOM distinguishes the
  // two, so only the DOM can say what the user was told.
  await expect(page.locator("#body-area-value")).not.toHaveText("-");
  const messagesBefore = await page.evaluate(() => window.__partsCompile.workerMessages());

  const scaleX = page.locator("#body-properties input[data-transform-kind='scale'][data-axis='0']");
  const scaleZ = page.locator("#body-properties input[data-transform-kind='scale'][data-axis='2']");
  await scaleX.fill("2");
  await scaleX.blur();
  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].transform.scale.join(",")))
    .toBe("2,1,1");
  await waitForCompileSettled(page);

  // Stretching the profile in its own plane turns every corner arc into an ellipse, and
  // the perimeter of an ellipse has no closed form to scale by. The card says nothing.
  await expect(page.locator("#body-area-value")).toHaveText("-");
  // Volume and mass do scale in closed form, so they stay numbers: the dash belongs to
  // the one quantity that cannot be stated, not to everything downstream of a scale.
  await expect(page.locator("#body-volume-value")).not.toHaveText("-");
  await expect(page.locator("#body-mass-value")).not.toHaveText("-");

  // The negative control. Scaling Z to match keeps the profile's shape inside the sketch
  // plane, so the exact 2D path can state an area again - without this half, a card that
  // dashed unconditionally would pass every assertion above.
  await scaleZ.fill("2");
  await scaleZ.blur();
  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].transform.scale.join(",")))
    .toBe("2,1,2");
  await waitForCompileSettled(page);
  await expect(page.locator("#body-area-value")).not.toHaveText("-");

  // Placement scale is absent from the compile signature, so all of this was folded into
  // the density-free worker result on the main thread and posted nothing.
  expect(await page.evaluate(() => window.__partsCompile.workerMessages())).toBe(messagesBefore);
});

test("editing one body of two recompiles that body only", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  const bodyIds = await page.evaluate(() => window.__partsPersistence.project().bodies.map((body) => body.id));
  expect(bodyIds).toHaveLength(2);
  const requestsBefore = await page.evaluate(() => window.__partsCompile.requests().length);

  // The second body is the selected one after being added. The inspector commits on
  // `change`, so the field has to lose focus for the edit to land.
  const depthInput = page.locator("#body-properties input[data-body-prop='extrudeDepthMm']");
  await depthInput.fill("9");
  await depthInput.blur();
  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[1].extrudeDepthMm))
    .toBe(9);
  await waitForCompileSettled(page);

  expect(await page.evaluate(() => window.__partsCompile.requests().length)).toBe(requestsBefore + 1);
  expect(await page.evaluate(() => window.__partsCompile.lastRequest())).toMatchObject({ bodyIds: [bodyIds[1]] });
  // Both bodies still have results: the untouched one came from the cache.
  expect((await page.evaluate(() => window.__partsCompile.resultBodyIds())).sort()).toEqual([...bodyIds].sort());

  // Selecting the other body is not a geometry change, so it posts nothing either.
  const messagesAfterEdit = await page.evaluate(() => window.__partsCompile.workerMessages());
  await page.locator("#body-list .body-row").first().click();
  await expect(page.locator("#part-status")).toContainText("Selected");
  await waitForCompileSettled(page);
  expect(await page.evaluate(() => window.__partsCompile.workerMessages())).toBe(messagesAfterEdit);
});

test("a partial revolve angle survives save and restore", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await page.locator("#add-revolve-body").click();
  await expect(page.locator("#body-list .body-row")).toHaveCount(1);
  await waitForCompileSettled(page);

  const angleInput = page.locator("#body-properties input[data-body-prop='revolveAngleDeg']");
  await expect(angleInput).toHaveValue("360.0");
  const fullMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));

  // A recompile and a mass comparison sit between this edit and the wait, either of which can
  // outlast the 700 ms debounce, so the baseline is taken here rather than at the wait.
  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());
  await angleInput.fill("180");
  await angleInput.blur();
  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].revolve.angleDeg))
    .toBe(180);
  await waitForCompileSettled(page);
  const halfMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));
  // Half the sweep is half the material, so the printed mass has to follow.
  expect(halfMass / fullMass).toBeCloseTo(0.5, 1);

  await waitForAutosave(page, generationBefore);
  await page.reload();
  await openComponentBuilder(page);
  await waitForCompileSettled(page);

  await expect(page.locator("#body-properties input[data-body-prop='revolveAngleDeg']")).toHaveValue("180.0");
  expect(await page.evaluate(() => window.__partsPersistence.project().bodies[0].revolve.angleDeg)).toBe(180);
  expect(Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""))).toBeCloseTo(halfMass, 1);
});

/** The inspector card for one cut profile, by its zero-based index. */
function cutCard(page, index = 0) {
  return page.locator("#cut-profile-fields .cut-card").nth(index);
}

function holeControl(page, prop, index = 0) {
  return cutCard(page, index).locator(`[data-hole-prop='${prop}']`);
}

/** Adds a body, then a circular hole, and returns once the inspector shows its card. */
async function addBodyWithCircularHole(page) {
  const name = await addTemplateBody(page);
  const before = await page.locator("#cut-profile-fields .cut-card").count();
  await page.locator("#add-circular-hole").click();
  await expect(page.locator("#cut-profile-fields .cut-card")).toHaveCount(before + 1);
  return { name, index: before };
}

test("a cut profile takes an M3 clearance diameter from the standards picker", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const { index } = await addBodyWithCircularHole(page);

  // Before a standard is chosen the radius is the author's own editable number.
  await expect(cutCard(page, index).locator("input[data-profile-prop='radius']")).toBeVisible();
  await expect(holeControl(page, "standard", index)).toHaveValue("");

  await holeControl(page, "standard", index).selectOption(HOLE_STANDARD_ISO_METRIC);
  await expect(holeControl(page, "size", index)).toHaveValue("M3");
  await expect(holeControl(page, "fit", index)).toHaveValue("normal");
  await expect(holeControl(page, "style", index)).toHaveValue("through");

  // The number comes from the fastener table's accessor, not from a literal in this
  // spec, so a wrong table row fails here rather than being copied alongside it.
  const expectedRadius = clearanceHoleDiameterMm("M3", "normal") / 2;
  await expect
    .poll(() => page.evaluate((cutIndex) => window.__partsPersistence.project().bodies[0].sketch.cutProfiles[cutIndex].radius, index))
    .toBe(expectedRadius);

  // The radius field is now an output: the standard owns the number, and an input the
  // next normalization would overwrite would be a lie.
  await expect(cutCard(page, index).locator("input[data-profile-prop='radius']")).toHaveCount(0);
  await expect(cutCard(page, index).locator("output")).toHaveText(expectedRadius.toFixed(2));
  await expect(cutCard(page, index).locator("strong")).toContainText("M3 through hole, normal fit");
  await expect(cutCard(page, index).locator("[data-hole-note]")).toContainText(
    `Pilot diameter ${clearanceHoleDiameterMm("M3", "normal").toFixed(2)} mm`
  );

  // Switching fit moves the diameter to the table's other published column.
  await holeControl(page, "fit", index).selectOption("loose");
  await expect
    .poll(() => page.evaluate((cutIndex) => window.__partsPersistence.project().bodies[0].sketch.cutProfiles[cutIndex].radius, index))
    .toBe(clearanceHoleDiameterMm("M3", "loose") / 2);

  await waitForCompileSettled(page);
});

test("a standards hole survives save and restore, read from the IndexedDB record", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const { index } = await addBodyWithCircularHole(page);

  // Captured before the edits for the same reason as the material spec: several of these
  // steps together can outlast the 700 ms autosave debounce.
  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());
  await holeControl(page, "standard", index).selectOption(HOLE_STANDARD_ISO_METRIC);
  await holeControl(page, "size", index).selectOption("M4");
  await holeControl(page, "style", index).selectOption("counterbore");
  await expect(holeControl(page, "process", index)).toHaveValue("fdm");
  await holeControl(page, "fromFace", index).selectOption("bottom");
  await waitForAutosave(page, generationBefore);

  const record = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  const cut = record.value.bodies[0].sketch.cutProfiles[index];

  // The profile-level key set, asserted for the same reason as the body-level one
  // above: a field on a persisted profile is a storage decision and must be deliberate.
  // `hole` is registered as of cycle 05; nothing derived from it may appear beside it.
  expect(Object.keys(cut).sort()).toEqual(["hole", "id", "radius", "type", "x", "z"]);
  expect(Object.keys(cut.hole).sort()).toEqual([
    "fit",
    "fromFace",
    "lockSize",
    "process",
    "size",
    "standard",
    "style"
  ]);
  expect(cut.hole).toMatchObject({ standard: HOLE_STANDARD_ISO_METRIC, size: "M4", style: "counterbore", fromFace: "bottom" });
  expect(cut.radius).toBe(clearanceHoleDiameterMm("M4", "normal") / 2);
  // Resolved geometry is derived, so no pocket diameter or depth reaches the record.
  expect(JSON.stringify(record.value)).not.toContain("pilotDiameterMm");
  expect(JSON.stringify(record.value)).not.toContain("pocket");

  await page.reload();
  await openComponentBuilder(page);
  await waitForCompileSettled(page);

  await expect(holeControl(page, "size", index)).toHaveValue("M4");
  await expect(holeControl(page, "style", index)).toHaveValue("counterbore");
  await expect(holeControl(page, "fromFace", index)).toHaveValue("bottom");
  // A counterbored plate is not a prism, so the mass comes from the mesh path.
  await expect(page.locator("#mass-method-note")).toContainText("Measured from the built mesh");
});

test("resizing the plate by two leaves the M3 hole at its standard diameter", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const { index } = await addBodyWithCircularHole(page);

  // Moved off centre first, so "the centre moves proportionally" is a real assertion
  // rather than 0 times 2.
  const centerX = cutCard(page, index).locator("input[data-profile-prop='x']");
  await centerX.fill("18");
  await centerX.blur();
  await expect
    .poll(() => page.evaluate((cutIndex) => window.__partsPersistence.project().bodies[0].sketch.cutProfiles[cutIndex].x, index))
    .toBe(18);

  await holeControl(page, "standard", index).selectOption(HOLE_STANDARD_ISO_METRIC);

  const expectedRadius = clearanceHoleDiameterMm("M3", "normal") / 2;
  const cutBefore = await page.evaluate(
    (cutIndex) => window.__partsPersistence.project().bodies[0].sketch.cutProfiles[cutIndex],
    index
  );
  expect(cutBefore.radius).toBe(expectedRadius);

  // Unchecking "Keep hole sizes" is the setting that used to scale a hole radius by
  // sqrt(|scaleX * scaleZ|). The standards hole must ignore it.
  const keepCutSizes = page.locator("#body-properties input[data-resize-option='keepCutSizes']");
  await expect(keepCutSizes).toBeChecked();
  await keepCutSizes.uncheck();
  await expect(page.locator(".parts-resize-note").first()).toContainText("except holes locked to a fastener standard");

  const widthBefore = await page.evaluate(() => window.__partsPersistence.project().bodies[0].sketch.outerProfile.width);
  const targetX = page.locator("#body-properties input[data-resize-target-axis='0']");
  await targetX.fill(String(widthBefore * 2));
  await targetX.blur();

  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].sketch.outerProfile.width))
    .toBe(widthBefore * 2);
  const cutAfter = await page.evaluate(
    (cutIndex) => window.__partsPersistence.project().bodies[0].sketch.cutProfiles[cutIndex],
    index
  );

  expect(cutAfter.radius).toBe(expectedRadius);
  // The centre still moves proportionally: uniform resize doubles every axis.
  expect(cutAfter.x).toBeCloseTo(cutBefore.x * 2, 6);
  expect(cutAfter.z).toBeCloseTo(cutBefore.z * 2, 6);
  await waitForCompileSettled(page);
});

test("a hole with no published value is refused with a reason and produces no geometry", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const { index } = await addBodyWithCircularHole(page);

  await holeControl(page, "standard", index).selectOption(HOLE_STANDARD_ISO_METRIC);
  await holeControl(page, "style", index).selectOption("heatSetInsert");
  // M3 has a verified Ruthex bore, so this resolves - and the radius it leaves behind
  // is the baseline the refusal must not disturb. Reading the *original* 4.8 mm here
  // would be asserting the wrong thing: "no geometry is produced" means the profile is
  // untouched by the refusal, not that it reverts to whatever it was before the picker.
  const radiusBefore = await page.evaluate(
    (cutIndex) => window.__partsPersistence.project().bodies[0].sketch.cutProfiles[cutIndex].radius,
    index
  );
  expect(radiusBefore).toBe(clearanceHoleDiameterMm("M3", "normal") / 2);

  // M2.5 has no published Ruthex bore, and the value is not interpolated from the M2
  // and M4 bores that surround it.
  await holeControl(page, "size", index).selectOption("M2.5");

  const note = cutCard(page, index).locator("[data-hole-note]");
  await expect(note).toContainText("No published heat-set insert bore");
  await expect(note).toContainText("M2.5");
  await expect(note).toContainText("vendor specifications, not a standard");

  // The refusal changes no geometry: the author's radius is untouched, and the body
  // still compiles - a refused hole is a warning, never a compile gate.
  await waitForCompileSettled(page);
  expect(await page.evaluate(
    (cutIndex) => window.__partsPersistence.project().bodies[0].sketch.cutProfiles[cutIndex].radius,
    index
  )).toBe(radiusBefore);
  await expect(page.locator("#body-mass-value")).not.toHaveText("-");
  // The finding is a Build-panel warning beside the disconnected-solid and
  // watertight reports, not a validation issue: `#validation-list` stays clean.
  await expect(page.locator("#compile-list")).toContainText("could not be resolved from the fastener table");
  await expect(page.locator("#validation-list")).not.toContainText("fastener table");
});

test("a counterbored plate weighs less than the plate it was cut from", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const { index } = await addBodyWithCircularHole(page);
  await holeControl(page, "standard", index).selectOption(HOLE_STANDARD_ISO_METRIC);
  await waitForCompileSettled(page);

  await expect(page.locator("#mass-method-note")).toContainText("Exact profile integral");
  const throughMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));
  expect(throughMass).toBeGreaterThan(0);

  await holeControl(page, "style", index).selectOption("counterbore");
  await waitForCompileSettled(page);

  // The path that states the volume changes with the geometry: the plate is no longer
  // a prism, so the exact 2D integral steps aside for the mesh that was actually built.
  await expect(page.locator("#mass-method-note")).toContainText("Measured from the built mesh");
  const counterboredMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));
  expect(counterboredMass).toBeLessThan(throughMass);
  // And it is not a dash: a blind pocket leaves a closed surface, so the mesh path is
  // entitled to state a volume.
  await expect(page.locator("#body-volume-value")).not.toHaveText("-");
});

async function openExportMenu(page) {
  await expect(page.locator("#export-menu-toggle")).toBeEnabled();
  await page.locator("#export-menu-toggle").click();
  await expect(page.locator("#export-menu-panel")).toBeVisible();
}

/** Click one export format and return the downloaded bytes. */
async function downloadExport(page, formatId) {
  await openExportMenu(page);
  const row = page.locator(`#export-menu-panel [data-export-format='${formatId}']`);
  await expect(row).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await row.click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error(`${formatId} export produced no local artifact.`);
  return { bytes: await readFile(path), suggestedFilename: download.suggestedFilename() };
}

test("the export menu lists every format and says why an unavailable one is unavailable", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);

  // Nothing selected: the menu is closed and the trigger is disabled rather than
  // opening onto five dead rows.
  await expect(page.locator("#export-menu-toggle")).toBeDisabled();
  await expect(page.locator("#export-menu-panel")).toBeHidden();

  await addTemplateBody(page);
  await waitForCompileSettled(page);
  await openExportMenu(page);

  const rows = page.locator("#export-menu-panel [data-export-format]");
  await expect(rows).toHaveCount(5);
  for (const formatId of ["binaryStl", "asciiStl", "dxf", "threeMf"]) {
    await expect(page.locator(`#export-menu-panel [data-export-format='${formatId}']`)).toBeEnabled();
  }

  // ⚠ STEP used to be refused for a sketch body outright - "STEP export needs an advanced
  // CAD recipe body" - because the bridge read `body.advancedCadRecipe` and nothing else.
  // Cycle 10 gave it an exact payload per body kind, so the only remaining question is
  // whether a bridge answered, and the answer depends on the machine this runs on.
  //
  // So the assertion is that the row **agrees with the probe**, in whichever direction
  // the probe went. Asserting only the no-build123d branch would pass on a tree where the
  // other branch is unreachable, which is exactly the vacuous shape audit A3 is about.
  const backend = await page.evaluate(() => window.__partsCadBackend.probe());
  expect(["available", "unavailable"]).toContain(backend.state);

  const step = page.locator("#export-menu-panel [data-export-format='step']");
  if (backend.state === "available") {
    await expect(step).toBeEnabled();
    await expect(page.locator("#export-menu-toggle")).toHaveText("Export (5)");
  } else {
    await expect(step).toBeDisabled();
    // The bridge's own sentence, not a generic "unavailable" - which is the diagnostic a
    // user can act on and the thing flattening six outcomes into a boolean would lose.
    await expect(step.locator(".parts-export__reason")).toContainText("build123d");
    await expect(page.locator("#export-menu-toggle")).toHaveText("Export (4)");
  }

  // And the page's own table agrees with what the row shows, both directions.
  const availability = await page.evaluate(() => window.__partsCadBackend.exportAvailability("step"));
  expect(availability.available).toBe(backend.state === "available");

  // Escape closes it, so a keyboard user is not trapped in the popover.
  await page.keyboard.press("Escape");
  await expect(page.locator("#export-menu-panel")).toBeHidden();
});

test("DXF export emits analytic circles for holes, not tessellated polylines", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  const { bytes, suggestedFilename } = await downloadExport(page, "dxf");
  const text = bytes.toString("utf8");

  expect(suggestedFilename).toBe("base_plate.dxf");
  expect(text).toContain("AC1009");
  expect(text).toContain("$INSUNITS");
  // Four mount holes, four CIRCLE entities. A polyline here would mean the machine
  // cuts a 32-sided hole where an M3 clearance hole was drawn.
  expect(text.match(/\r\nCIRCLE\r\n/gu)).toHaveLength(4);
  expect(text).not.toContain("\r\nPOLYLINE\r\n");
  expect(text).toContain("OUTER");
  expect(text).toContain("CUTS");
  expect(text.trimEnd().endsWith("EOF")).toBe(true);
  await expect(page.locator("#part-status")).toContainText("DXF");
});

test("binary STL is exactly 84 + 50 bytes per triangle and 3MF is a millimetre zip", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  const stl = await downloadExport(page, "binaryStl");
  expect(stl.suggestedFilename).toBe("base_plate.stl");
  const triangleCount = stl.bytes.readUInt32LE(80);
  expect(triangleCount).toBeGreaterThan(0);
  expect(stl.bytes.byteLength).toBe(84 + 50 * triangleCount);
  // A binary STL beginning with "solid" is parsed as ASCII by sniffing readers.
  expect(stl.bytes.subarray(0, 5).toString("ascii")).not.toBe("solid");

  const threeMf = await downloadExport(page, "threeMf");
  expect(threeMf.suggestedFilename).toBe("base_plate.3mf");
  // "PK" plus the local file header signature: a real zip, not a renamed XML file.
  expect(threeMf.bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const container = threeMf.bytes.toString("latin1");
  expect(container).toContain("[Content_Types].xml");
  expect(container).toContain("3D/3dmodel.model");
});

test("a non-uniform sketch-plane scale makes DXF unavailable with both numbers named", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  // Scaling X and Z differently turns every hole into an ellipse, which DXF R12
  // cannot state. The alternative to refusing is a silent nominal-size file.
  const scaleX = page.locator("#body-properties input[data-transform-kind='scale'][data-axis='0']");
  const scaleZ = page.locator("#body-properties input[data-transform-kind='scale'][data-axis='2']");
  await expect(scaleX).toBeVisible();
  await scaleX.fill("2");
  await scaleX.blur();
  await scaleZ.fill("1.5");
  await scaleZ.blur();
  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].transform.scale.join(",")))
    .toBe("2,1,1.5");
  await waitForCompileSettled(page);

  await openExportMenu(page);
  const dxf = page.locator("#export-menu-panel [data-export-format='dxf']");
  await expect(dxf).toBeDisabled();
  await expect(dxf.locator(".parts-export__reason")).toContainText("2 by 1.5");
  // The mesh formats do not care, so they stay available.
  await expect(page.locator("#export-menu-panel [data-export-format='binaryStl']")).toBeEnabled();
});

test("a version-4 workspace upgrades in place and keeps its part library", async ({ page }) => {
  const libraryItem = VERSION_FOUR_LIBRARY_ITEM;
  await seedWorkspace(page, {
    version: 4,
    storeNames: VERSION_FOUR_STORE_NAMES,
    entries: [{ storeName: PART_LIBRARY_STORE_NAME, key: libraryItem.id, value: libraryItem }]
  });

  await openComponentBuilder(page);

  // The upgrade must not have taken the destructive repair path.
  await expect(page.locator("#library-count")).toHaveText("1");
  await expect(page.locator("#library-list")).toContainText("Saved base");

  const beforeWrite = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  expect(beforeWrite.missingStore).toBe(false);
  expect(beforeWrite.version).toBe(WORKSPACE_DB_VERSION);
  expect(beforeWrite.value).toBeNull();

  const addedName = await addTemplateBody(page);
  await waitForAutosave(page);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__partsPersistence));
  await page.waitForFunction(() => window.__partsPersistence.ready());

  expect(await bodyNames(page)).toEqual([addedName]);
  await expect(page.locator("#library-count")).toHaveText("1");
});

/*
 * Cycle 06: manufacturability.
 *
 * The claim these specs exist to hold is that a finding is a report. Everything
 * below adds a feature the chosen process cannot make and then checks that the
 * page still validates, still builds and still offers its exports.
 */

/** The manufacturability findings currently on the page, by code. */
async function dfmCodes(page) {
  return page.evaluate(() => window.__partsDfm.findings().map((finding) => finding.code));
}

test("the Manufacturability panel is its own section with a visible process picker", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);

  await expect(page.locator("#process-select")).toBeDisabled();
  await expect(page.locator("#dfm-list")).toContainText("Add a body to check it against a process.");

  await addTemplateBody(page);
  await expect(page.locator("#process-select")).toBeEnabled();
  await expect(page.locator("#process-select")).toHaveValue("fdm");
  await expect(page.locator("#process-select option")).toHaveCount(3);
  // The shipped starter geometry is clean, so the panel says so rather than sitting
  // permanently full of findings nobody reads.
  await expect(page.locator("#dfm-count")).toHaveText("OK");
  await expect(page.locator("#dfm-list")).toContainText("Every feature is makeable");
  // And it is a separate list from Build, which reports the built solid.
  await expect(page.locator("#compile-list")).not.toContainText("makeable");
});

test("a hole too close to the edge is reported without blocking anything", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const { index } = await addBodyWithCircularHole(page);

  await holeControl(page, "standard", index).selectOption(HOLE_STANDARD_ISO_METRIC);
  await expect.poll(() => dfmCodes(page)).not.toContain("dfm-hole-edge-distance");

  // The base plate is 120 wide, so 58 puts an M3 centre 2 mm from the edge against
  // the fastener table's 4.5 mm practice figure.
  const centerX = cutCard(page, index).locator("input[data-profile-prop='x']");
  await centerX.fill("58");
  await centerX.blur();

  await expect.poll(() => dfmCodes(page)).toContain("dfm-hole-edge-distance");
  await expect(page.locator("#dfm-list")).toContainText("M3");
  await expect(page.locator("#dfm-list")).toContainText(`${minEdgeDistanceMm("M3").toFixed(1)} mm`);
  await expect(page.locator("#dfm-count")).not.toHaveText("OK");

  // Nothing is blocked. Validation is still clean, the solid still builds, and the
  // export menu still offers the formats it offered before.
  await expect(page.locator("#validation-list")).toContainText("Project validates");
  expect(await page.evaluate(() => window.__partsDfm.validationIssues())).toEqual([]);
  await waitForCompileSettled(page);
  await expect(page.locator("#build-count")).toHaveText("OK");
  // Five, not four: this spec never opens the export menu, so the build123d probe has
  // never been asked, and an unasked question is not a negative answer. STEP is offered
  // with "the local build123d backend has not answered yet" on the row, and the export
  // itself reports the real outcome. That is A2 applied to a sentence rather than a zero.
  await expect(page.locator("#export-menu-toggle")).toHaveText("Export (5)");
  expect(await page.evaluate(() => window.__partsCadBackend.snapshot().state)).toBe("unknown");
});

test("changing the process changes the findings, and the choice survives a reload", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const { index } = await addBodyWithCircularHole(page);

  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());
  await holeControl(page, "standard", index).selectOption(HOLE_STANDARD_ISO_METRIC);
  await holeControl(page, "style", index).selectOption("counterbore");
  await expect.poll(() => dfmCodes(page)).not.toContain("dfm-pocket-unsupported-by-process");

  // A laser cuts through the stock or not at all, so the same counterbore becomes
  // something this process cannot make - and PLA must not be laser cut at all.
  await page.locator("#process-select").selectOption("laser");
  await expect(page.locator("#part-status")).toContainText("Laser cutting");
  await expect.poll(() => dfmCodes(page)).toContain("dfm-pocket-unsupported-by-process");
  await expect(page.locator("#dfm-list")).toContainText("must not be laser cut");
  await expect(page.locator("#dfm-list li[data-dfm-severity='error']").first()).toBeVisible();

  await waitForAutosave(page, generationBefore);
  const record = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  expect(record.value.bodies[0].processId).toBe("laser");

  await page.reload();
  await openComponentBuilder(page);
  await expect(page.locator("#process-select")).toHaveValue("laser");
  expect(await page.evaluate(() => window.__partsDfm.processId("base_plate"))).toBe("laser");
  await expect.poll(() => dfmCodes(page)).toContain("dfm-pocket-unsupported-by-process");

  // And the body still compiles and exports under a process that cannot make it.
  await waitForCompileSettled(page);
  await expect(page.locator("#build-count")).toHaveText("OK");
});

test("choosing a process saves the project without posting a compile", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  const messagesBefore = await page.evaluate(() => window.__partsCompile.workerMessages());
  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());

  await page.locator("#process-select").selectOption("cnc");
  await expect(page.locator("#process-select")).toHaveValue("cnc");
  await waitForAutosave(page, generationBefore);

  // Same property `materialId` has: the compiled solid stays nominal, so the process is
  // absent from the compile signature. Cycle 09 re-decided this rather than inheriting
  // it - kerf and printer compensation could have made the solid process-dependent, and
  // the reason they did not is that STL and 3MF export from this cached mesh.
  expect(await page.evaluate(() => window.__partsCompile.workerMessages())).toBe(messagesBefore);
  await expect(page.locator("#build-count")).toHaveText("OK");
});

/* ------------------------------------- cycle 09: fits and printer compensation */

test("the page states what a process will make of a drawn hole, and never one number for both", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);

  // The card says something before there is a body, rather than showing two dashes and
  // no explanation.
  await expect(page.locator("#compensation-note")).toContainText("Select a body");
  await expect(page.locator("#compensation-nominal")).toHaveText("-");

  await addTemplateBody(page);

  // FDM. The base plate's M3 clearance holes are 3.4 mm drawn, and a nozzle lays a bead
  // wider than it is told to, so the hole comes out narrower. Both figures are on the
  // page under their own labels and they are different numbers.
  const drawnMm = clearanceHoleDiameterMm("M3", "normal");
  await expect(page.locator("#compensation-nominal")).toHaveText(drawnMm.toFixed(3));
  const asMade = Number(await page.locator("#compensation-as-made").textContent());
  expect(asMade).toBeLessThan(drawnMm);
  expect(asMade).toBeGreaterThan(drawnMm - 0.5);
  await expect(page.locator("#compensation-note")).toContainText("FDM");
  await expect(page.locator("#compensation-note")).toContainText("narrower than drawn");

  // The hole inspector says the same thing about the same hole, and attributes each
  // number: the drawn one to the fastener table and the as-made one to the process.
  await expect(page.locator("[data-hole-note]").first()).toContainText("as drawn");
  await expect(page.locator("[data-hole-note]").first()).toContainText("FDM 3D printing has made it");

  // Laser. A kerf takes material off both sides of every cut, so the same hole comes out
  // wider than drawn - the opposite sign, from the same one number.
  await page.locator("#process-select").selectOption("laser");
  await expect(page.locator("#compensation-nominal")).toHaveText(drawnMm.toFixed(3), { timeout: 5000 });
  expect(Number(await page.locator("#compensation-as-made").textContent())).toBeGreaterThan(drawnMm);
  await expect(page.locator("#compensation-note")).toContainText("kerf");
  await expect(page.locator("#compensation-note")).toContainText("wider than drawn");

  // CNC publishes no compensation, and the page says so in words. Audit A2: the absence
  // must not render as a second number equal to the first, and must not render as 0.000.
  await page.locator("#process-select").selectOption("cnc");
  await expect(page.locator("#compensation-note")).toContainText("publishes no compensation");
  await expect(page.locator("#compensation-note")).toContainText("not a measurement of zero");
  await expect(page.locator("#compensation-as-made")).toHaveText("-");
  await expect(page.locator("#compensation-as-made")).not.toHaveText("0.000");
  await expect(page.locator("#compensation-nominal")).toHaveText(drawnMm.toFixed(3));
  await expect(page.locator("[data-hole-note]").first()).not.toContainText("has made it");
});

test("a bearing seat on the page is the published fit, not a hand-fit allowance", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);

  await page.locator("#hardware-entry-select").selectOption("bearing_seat_608");
  await page.locator("#apply-hardware-pattern").click();
  await expect(page.locator("#part-status")).toContainText("608 bearing seat");

  // Asserted through the fits accessor rather than against 22.0105, and against the
  // retired 0.2 mm allowance as the defect being fixed: an H7 bore over a 22 mm race is
  // an order of magnitude tighter than the number cycle 08 shipped.
  const seatRadius = await page.evaluate(
    () => window.__partsPersistence.project().bodies[0].sketch.cutProfiles
      .find((cut) => cut.id === "bearing_608_seat").radius
  );
  const race = componentDimensionMm("bearing608", "outerDiameterMm");
  expect(seatRadius).toBeCloseTo(fitBoreMm("H7/h6", race).drawnDiameterMm / 2, 10);
  expect(seatRadius * 2).toBeGreaterThan(race);
  expect(seatRadius * 2 - race).toBeLessThan(0.2);

  await waitForCompileSettled(page);
  await expect(page.locator("#validation-count")).toContainText("OK");
});

test("two overlapping holes are reported once, on the page rather than at export time", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const first = await addBodyWithCircularHole(page);
  await page.locator("#add-circular-hole").click();
  await expect(page.locator("#cut-profile-fields .cut-card")).toHaveCount(first.index + 2);

  // Two 16 mm holes 6 mm apart overlap. Before cycle 06 the only way to hear about
  // this was to export a DXF and read the status line.
  for (const [index, x] of [[first.index, -3], [first.index + 1, 3]]) {
    const radius = cutCard(page, index).locator("input[data-profile-prop='radius']");
    await radius.fill("8");
    await radius.blur();
    const centerX = cutCard(page, index).locator("input[data-profile-prop='x']");
    await centerX.fill(String(x));
    await centerX.blur();
  }

  await expect.poll(() => dfmCodes(page)).toContain("dfm-overlapping-cut-profiles");
  const findings = await page.evaluate(() => window.__partsDfm.findings());
  expect(findings.filter((finding) => finding.code === "dfm-overlapping-cut-profiles")).toHaveLength(1);
  await expect(page.locator("#dfm-list")).toContainText("merge into one opening");

  // The DXF still exports, and it no longer says the same thing a second time.
  await waitForCompileSettled(page);
  const { bytes } = await downloadExport(page, "dxf");
  expect(bytes.toString("utf8")).toContain("CIRCLE");
  await expect(page.locator("#part-status")).not.toContainText("merge into one opening");
});

/* ------------------------------------------------ cycle 08: hardware patterns */

test("the Advanced card applies a NEMA 17 pattern whose numbers come from the standard", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);

  // Disabled until there is a sketch body to cut, like the two pattern buttons beside it.
  await expect(page.locator("#apply-hardware-pattern")).toBeDisabled();
  await addTemplateBody(page);
  await expect(page.locator("#apply-hardware-pattern")).toBeEnabled();

  // Every catalogue entry is offered, and the picker states what each one cuts.
  await expect(page.locator("#hardware-entry-select option")).toHaveCount(HARDWARE_ENTRY_IDS.length);
  await page.locator("#hardware-entry-select").selectOption("nema17_face");
  await expect(page.locator("#hardware-entry-note")).toContainText("pilot boss");

  const before = await page.evaluate(() => window.__partsPersistence.project().bodies[0].sketch.cutProfiles.length);
  await page.locator("#apply-hardware-pattern").click();
  await expect(page.locator("#part-status")).toContainText("NEMA 17 motor face");

  // Five cuts: the pilot bore plus the four bolt holes, at the published square and the
  // table's own M3 clearance. Asserted through the accessors, never against literals.
  const applied = await page.evaluate(() => {
    const cuts = window.__partsPersistence.project().bodies[0].sketch.cutProfiles;
    return cuts.slice(-5).map((cut) => ({ id: cut.id, x: cut.x, z: cut.z, radius: cut.radius, hole: cut.hole ?? null }));
  });
  expect(applied).toHaveLength(5);
  expect(before + 5).toBe(await page.evaluate(() => window.__partsPersistence.project().bodies[0].sketch.cutProfiles.length));

  const half = componentDimensionMm("nema17", "boltSpacingMm") / 2;
  const bolts = applied.filter((cut) => cut.hole);
  expect(bolts).toHaveLength(4);
  for (const bolt of bolts) {
    expect(Math.abs(bolt.x)).toBeCloseTo(half, 10);
    expect(bolt.radius).toBe(clearanceHoleDiameterMm("M3", "normal") / 2);
    expect(bolt.hole.size).toBe("M3");
  }
  const [pilot] = applied.filter((cut) => !cut.hole);
  expect(pilot.radius * 2).toBeGreaterThan(componentDimensionMm("nema17", "pilotDiameterMm"));

  // Ordinary cuts, so the body still compiles and validation stays clean.
  await waitForCompileSettled(page);
  await expect(page.locator("#validation-count")).toContainText("OK");
});

test("an applied hardware pattern survives a reload as ordinary cut profiles", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);

  const generation = await page.evaluate(() => window.__partsPersistence.generation());
  await page.locator("#hardware-entry-select").selectOption("bearing_seat_608");
  await page.locator("#apply-hardware-pattern").click();
  await expect(page.locator("#part-status")).toContainText("608 bearing seat");
  await waitForAutosave(page, generation);

  // Read from the IndexedDB record rather than from page state: the claim is that
  // nothing about a hardware pattern needs persisting, so what reaches the store must be
  // a plain circle with no marker field of any kind.
  const record = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  expect(JSON.stringify(record.value)).not.toContain("hardware");
  const seat = record.value.bodies[0].sketch.cutProfiles.find((cut) => cut.id === "bearing_608_seat");
  expect(seat).toBeTruthy();
  expect(Object.keys(seat).sort()).toEqual(["id", "radius", "type", "x", "z"]);

  await page.reload();
  await openComponentBuilder(page);
  const restored = await page.evaluate(
    () => window.__partsPersistence.project().bodies[0].sketch.cutProfiles.find((cut) => cut.id === "bearing_608_seat")
  );
  expect(restored.radius).toBe(seat.radius);
});

test("a hardware entry the page cannot source refuses on the page, with the reason", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);

  // The picker cannot offer an unsourced component - that is the point of it not being
  // an entry - so this drives the action directly to prove the refusal reaches the user
  // as a sentence rather than as a silent no-op.
  const before = await page.evaluate(() => window.__partsPersistence.project().bodies[0].sketch.cutProfiles.length);
  await page.evaluate(() => {
    const select = document.querySelector("#hardware-entry-select");
    const option = document.createElement("option");
    option.value = "mg996r";
    option.textContent = "MG996R";
    select.append(option);
    select.value = "mg996r";
    document.querySelector("#apply-hardware-pattern").click();
  });

  await expect(page.locator("#part-status")).toContainText("no mg996r hardware pattern");
  await expect(page.locator("#part-status")).toContainText("disagree");
  expect(await page.evaluate(() => window.__partsPersistence.project().bodies[0].sketch.cutProfiles.length)).toBe(before);
});

test("the retrofitted base plate's mount holes are M3 clearance on the live page", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);

  const radii = await page.evaluate(
    () => window.__partsPersistence.project().bodies[0].sketch.cutProfiles.map((cut) => cut.radius)
  );
  expect(radii).toHaveLength(4);
  for (const radius of radii) expect(radius).toBe(clearanceHoleDiameterMm("M3", "normal") / 2);

  // And nothing about the corrected plate is reported as unmakeable, which is the
  // honest re-baseline of cycle 06's finding-free assertion.
  await waitForCompileSettled(page);
  await expect(page.locator("#validation-count")).toContainText("OK");
  expect(await dfmCodes(page)).toEqual([]);
});

/* -------------------------------------------------------------- cycle 07: gears */

/** A read-only inspector output, found by the label the user reads. */
function inspectorOutput(page, label) {
  return page.locator(`#body-properties label.parts-field:has(span:text-is("${label}")) output`);
}

function gearControl(page, prop) {
  return page.locator(`#body-properties [data-body-prop='${prop}']`);
}

async function addGear(page) {
  const before = await page.locator("#body-list .body-row").count();
  await page.locator("#add-spur-gear").click();
  await expect(page.locator("#body-list .body-row")).toHaveCount(before + 1);
  await waitForCompileSettled(page);
}

test("the gear inspector edits the pressure angle, and the geometry follows it", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addGear(page);

  // Before cycle 07 this control did not exist, because the value it holds reached no
  // geometry: the tooth was a polar trapezoid at a hard-coded inset.
  await expect(gearControl(page, "gearPressureAngleDeg")).toHaveValue("20.0");
  await expect(inspectorOutput(page, "Root land (mm)")).not.toHaveText("0.000");
  await expect(inspectorOutput(page, "Top land (mm)")).not.toHaveText("0.000");

  // At 20 degrees the page is entitled to say ISO 53, and it does - which is what
  // makes the note appearing below a statement rather than boilerplate.
  const rackDeviation = page.locator("[data-gear-rack-deviation]");
  await expect(rackDeviation).toHaveCount(0);

  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());
  const twentyMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));

  await gearControl(page, "gearPressureAngleDeg").fill("30");
  await gearControl(page, "gearPressureAngleDeg").blur();
  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].gear.pressureAngleDeg))
    .toBe(30);
  await waitForCompileSettled(page);

  // The tip and root radii are unchanged, so only the flank shape moved - and it moved
  // enough to change the printed mass, which is a measurement rather than a redraw.
  const thirtyMass = Number((await page.locator("#body-mass-value").innerText()).replace(" g", ""));
  expect(thirtyMass).toBeGreaterThan(twentyMass);

  // And the page stops claiming ISO 53, which fixes it stating a standard for a tooth
  // outside it. The involute is still exact; the proportions are the generalisation.
  await expect(rackDeviation).toHaveCount(1);
  await expect(rackDeviation).toContainText("ISO 53 fixes the profile angle at 20 degrees");
  await expect(rackDeviation).toContainText("30.0 degree tooth");
  const toothFormHint = page
    .locator(".parts-inspector-subsection__title", { hasText: "Tooth form" })
    .locator("small");
  await expect(toothFormHint).toContainText("generalised to this profile angle");

  await waitForAutosave(page, generationBefore);
  await page.reload();
  await openComponentBuilder(page);
  await waitForCompileSettled(page);
  await expect(gearControl(page, "gearPressureAngleDeg")).toHaveValue("30.0");
});

test("profile shift, backlash and root fillet are editable and survive a reload", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addGear(page);

  // The fillet field is blank by default, meaning "follow the basic rack", and the
  // placeholder states the rack's own coefficient rather than leaving it a mystery.
  await expect(gearControl(page, "gearRootFilletFactor")).toHaveValue("");
  await expect(gearControl(page, "gearRootFilletFactor")).toHaveAttribute("placeholder", "0.38");
  await expect(gearControl(page, "gearRackProfileId")).toHaveValue("A");

  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());
  for (const [prop, value] of [
    ["gearProfileShiftCoefficient", "0.3"],
    ["gearBacklashMm", "0.1"],
    ["gearRootFilletFactor", "0.25"],
    ["gearHelixAngleDeg", "15"]
  ]) {
    await gearControl(page, prop).fill(value);
    await gearControl(page, prop).blur();
  }
  await gearControl(page, "gearRackProfileId").selectOption("D");

  await expect
    .poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].gear))
    .toMatchObject({
      profileShiftCoefficient: 0.3,
      backlashMm: 0.1,
      rootFilletFactor: 0.25,
      helixAngleDeg: 15,
      rackProfileId: "D"
    });
  await waitForCompileSettled(page);
  await expect(page.locator("#build-count")).toHaveText("OK");
  // A helical gear states its normal-plane numbers, which are what a gauge measures.
  await expect(inspectorOutput(page, "Normal module")).not.toHaveText("0.000");

  await waitForAutosave(page, generationBefore);
  const record = await readPersistedRecord(page, PART_PROJECT_STORE_NAME, CURRENT_PART_PROJECT_KEY);
  expect(record.value.bodies[0].gear).toMatchObject({
    profileShiftCoefficient: 0.3,
    backlashMm: 0.1,
    rootFilletFactor: 0.25,
    helixAngleDeg: 15,
    rackProfileId: "D"
  });

  await page.reload();
  await openComponentBuilder(page);
  await expect(gearControl(page, "gearRootFilletFactor")).toHaveValue("0.250");
  await expect(gearControl(page, "gearRackProfileId")).toHaveValue("D");
});

test("a second gear turns on the mesh check, and a mismatched pair is refused", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addGear(page);
  await expect(page.locator("#body-properties")).toContainText("Add a second gear to check a pair");

  await gearControl(page, "gearToothCount").fill("20");
  await gearControl(page, "gearToothCount").blur();
  await expect.poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[0].gear.toothCount)).toBe(20);

  await addGear(page);
  await gearControl(page, "gearToothCount").fill("40");
  await gearControl(page, "gearToothCount").blur();
  await expect.poll(() => page.evaluate(() => window.__partsPersistence.project().bodies[1].gear.toothCount)).toBe(40);

  // A 40 and a 20 tooth gear of module 2 sit 60 mm apart and stay in contact through
  // more than one tooth pair at a time.
  await expect(page.locator("[data-gear-pair-partner]")).toHaveCount(1);
  await expect(inspectorOutput(page, "Centre distance (mm)")).toHaveText("60.000");
  const contactRatio = Number(await inspectorOutput(page, "Contact ratio").innerText());
  expect(contactRatio).toBeGreaterThan(1);
  await expect(inspectorOutput(page, "Ratio")).toHaveText("20:40");

  // Two gears of different module do not mesh, and the page says that instead of
  // printing a centre distance for a mechanism that cannot exist.
  await gearControl(page, "gearModuleMm").fill("3");
  await gearControl(page, "gearModuleMm").blur();
  await expect(page.locator("#body-properties")).toContainText("These gears do not mesh");
  await expect(inspectorOutput(page, "Centre distance (mm)")).toHaveCount(0);
});

test("picking a mesh partner neither saves the project nor posts a compile", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  const generationBeforeGears = await page.evaluate(() => window.__partsPersistence.generation());
  await addGear(page);
  await addGear(page);
  await addGear(page);
  // Three gear compiles easily outlast the debounce, so this wait needs the pre-edit
  // baseline or the write it is waiting for will already have landed.
  await waitForCompileSettled(page);
  // The additions leave a debounced write pending, and it would land during the assertions
  // below and be read as this selection having saved something. Let it land first, which is
  // what makes "the generation did not advance" mean anything.
  await waitForAutosave(page, generationBeforeGears);

  const partner = page.locator("[data-gear-pair-partner]");
  await expect(partner.locator("option")).toHaveCount(2);
  const messagesBefore = await page.evaluate(() => window.__partsCompile.workerMessages());
  const generationBefore = await page.evaluate(() => window.__partsPersistence.generation());
  const updatedAtBefore = await page.evaluate(() => window.__partsPersistence.project().updatedAt);

  await partner.selectOption({ index: 1 });
  await expect(inspectorOutput(page, "Centre distance (mm)")).toBeVisible();

  // A pair is a derived report and not a persisted entity, so which one is being
  // compared is presentation state: no commit, no autosave, no worker message.
  expect(await page.evaluate(() => window.__partsCompile.workerMessages())).toBe(messagesBefore);
  expect(await page.evaluate(() => window.__partsPersistence.generation())).toBe(generationBefore);
  expect(await page.evaluate(() => window.__partsPersistence.project().updatedAt)).toBe(updatedAtBefore);
  expect(await page.evaluate(() => window.__partsPersistence.dirty())).toBe(false);

  // And the mechanism still works, so the assertions above are not passing because
  // autosave stopped: a real gear edit does advance the generation.
  await gearControl(page, "gearToothCount").fill("30");
  await gearControl(page, "gearToothCount").blur();
  await waitForAutosave(page, generationBefore);
});

test("an undercut gear is reported in the Manufacturability panel and still builds", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addGear(page);
  await expect.poll(() => dfmCodes(page)).not.toContain("dfm-gear-undercut");

  // Ten teeth at 20 degrees is well below the classical minimum, so the generating
  // rack cuts into the involute near the root.
  await gearControl(page, "gearToothCount").fill("10");
  await gearControl(page, "gearToothCount").blur();
  await expect.poll(() => dfmCodes(page)).toContain("dfm-gear-undercut");
  await expect(page.locator("#dfm-list")).toContainText("undercuts");
  await expect(page.locator("#dfm-count")).not.toHaveText("OK");

  // Nothing is blocked: an undercut gear is manufacturable and merely weak.
  await expect(page.locator("#validation-list")).toContainText("Project validates");
  await waitForCompileSettled(page);
  await expect(page.locator("#build-count")).toHaveText("OK");
  expect(await page.evaluate(() => window.__partsDfm.validationIssues())).toEqual([]);
  await expect(page.locator("#body-mass-value")).not.toHaveText("-");

  // And a positive profile shift clears it, which is what the finding recommends. The
  // figure comes from the standards module's closed form rather than from a literal.
  const shift = undercutLimitProfileShift({ profileId: "A", pressureAngleDeg: 20, toothCount: 10 });
  await gearControl(page, "gearProfileShiftCoefficient").fill(String(Math.ceil(shift * 100) / 100));
  await gearControl(page, "gearProfileShiftCoefficient").blur();
  await expect.poll(() => dfmCodes(page)).not.toContain("dfm-gear-undercut");
});

/* ============================================================ cycle 11, stage A */

test("the Documents card lists what to make and what to buy", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  const parts = page.locator("#bom-parts-list li");
  await expect(parts).toHaveCount(1);
  // A mass, in grams, of a real material - not a placeholder and not a zero.
  await expect(parts.first()).toContainText("PLA");
  const mass = await parts.first().getAttribute("data-bom-mass");
  expect(Number(mass)).toBeGreaterThan(0);
  await expect(page.locator("#bom-total-mass")).not.toHaveText("- g");

  // The retrofitted base plate's mount holes are M3 clearance, so the buy side says so -
  // and it says a *minimum* length, because the stack-up this screw ends up in is not
  // something the project models.
  const purchased = page.locator("#bom-purchased-list li");
  await expect(purchased.first()).toContainText("M3 screw");
  await expect(purchased.first()).toContainText("At least");
  await expect(purchased.first()).not.toContainText("Length:");
  await expect(page.locator("#documents-summary")).toContainText("made");

  await expect(page.locator("#print-prep-list li")).toHaveCount(1);
  await expect(page.locator("#print-prep-summary")).toHaveText("No supports");
});

test("no BOM row ever renders a fabricated zero, built or not", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);

  // ⚠ Read **immediately**, with no retry, so this sees the page before the debounced
  // compile has produced a result for the body just added - which is the state where a
  // mass is legitimately absent. A Playwright text assertion would retry until the compile
  // landed and would only ever see the built branch, which is how this check would pass
  // while never once exercising the thing it exists for.
  await page.locator("#add-revolve-body").click();
  const beforeCompile = await page.evaluate(() =>
    [...document.querySelectorAll("#bom-parts-list li")].map((row) => ({
      mass: row.dataset.bomMass,
      text: row.innerText
    }))
  );
  expect(beforeCompile.length).toBe(2);
  for (const row of beforeCompile) {
    // Three negatives on the rendered value. This defect has shipped three times in this
    // project and was caught in review every time, never by a test.
    expect(row.mass).not.toBe("0");
    expect(row.mass).not.toBe("0.00");
    expect(row.mass).not.toBe("");
    // And an absent mass is never silently absent: the cell carries the reason.
    if (row.mass === "-") expect(row.text.length).toBeGreaterThan("- g".length + 10);
  }
  expect(beforeCompile.some((row) => row.mass === "-")).toBe(true);

  // Both rows survive the compile, and neither disappears once it has a number.
  await waitForCompileSettled(page);
  await expect(page.locator("#bom-parts-list li")).toHaveCount(2);
  const afterCompile = await page.evaluate(() =>
    [...document.querySelectorAll("#bom-parts-list li")].map((row) => row.dataset.bomMass)
  );
  for (const mass of afterCompile) expect(Number(mass)).toBeGreaterThan(0);
});

/* ============================================================ cycle 11, stage B */

test("the drawing sheet is A3, dimensioned from the sketch, and legible without colour", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await addTemplateBody(page);
  await waitForCompileSettled(page);

  const sheet = page.locator("#drawing-sheet svg.parts-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("viewBox", "0 0 420 297");
  await expect(page.locator("#drawing-summary")).toHaveText("A3, dimensioned");

  // The top view's extents are the sketch's, exactly - which is only possible because the
  // view is derived from the sketch rather than measured off the compiled mesh.
  const outer = await page.evaluate(() => window.__partsPersistence.project().bodies[0].sketch.outerProfile);
  const top = page.locator("#drawing-sheet [data-view='top']");
  await expect(top).toHaveAttribute("data-width-mm", String(outer.width));
  await expect(top).toHaveAttribute("data-height-mm", String(outer.height));

  // An M3 clearance hole is drawn at the standard's diameter.
  const diameters = await page.evaluate(() =>
    [...document.querySelectorAll("#drawing-sheet [data-diameter-mm]")].map((node) =>
      Number(node.dataset.diameterMm)
    )
  );
  expect(diameters).toContain(clearanceHoleDiameterMm("M3", "normal"));

  // The isometric drew the compiled mesh, so a body with a solid gets a picture of it.
  await expect(page.locator("#drawing-sheet [data-view='isometric']")).toHaveAttribute("data-faces", /\d+/);
  await expect(page.locator("#drawing-sheet [data-block='hole-table']")).not.toHaveAttribute("data-rows", "0");
  await expect(page.locator("#drawing-sheet")).toContainText("Nominal as drawn");

  // ⚠ Verified rather than asserted from the source: with colour removed entirely, the
  // three line roles are still told apart, because each has its own dash pattern and
  // weight. A drawing whose hidden lines vanish on a black-and-white printer is not a
  // drawing, and only a rendered page can answer whether they do.
  await page.emulateMedia({ forcedColors: "active" });
  const rendered = await page.evaluate(() => {
    const roles = ["visible", "hidden", "centre"];
    return roles.map((role) => {
      const node = document.querySelector(`#drawing-sheet [data-role='${role}']`);
      if (!node) return null;
      const style = getComputedStyle(node);
      return { role, dash: style.strokeDasharray, width: style.strokeWidth };
    });
  });
  const present = rendered.filter(Boolean);
  expect(present.length).toBeGreaterThanOrEqual(2);
  const signatures = new Set(present.map((entry) => `${entry.dash}|${entry.width}`));
  expect(signatures.size).toBe(present.length);
  await page.emulateMedia({ forcedColors: null });
});

test("a non-sketch body gets an isometric and says why it has no dimensioned views", async ({ page }) => {
  await seedWorkspace(page);
  await openComponentBuilder(page);
  await page.locator("#add-spur-gear").click();
  await waitForCompileSettled(page);

  await expect(page.locator("#drawing-summary")).toHaveText("A3, isometric only");
  // An honest gap, stated, beats an undimensioned view that reads as a bug. Same shape as
  // `dfm-source-kind-unchecked`, deliberately.
  await expect(page.locator("#drawing-sheet")).toContainText("derived from the 2D sketch");
  await expect(page.locator("#drawing-sheet [data-view='top'][data-available='false']")).toHaveCount(1);
  await expect(page.locator("#drawing-sheet [data-view='isometric']")).toHaveAttribute("data-faces", /\d+/);
  await expect(page.locator("#drawing-sheet")).toContainText("Extents");
});
