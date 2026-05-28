import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isShellCardOpen,
  resetShellCardState,
  setShellCardOpen,
  toggleShellCardState
} from "../../src/shellCards.js";

test("shell card state defaults open and toggles by stable id", () => {
  resetShellCardState();
  assert.equal(isShellCardOpen("assembly-joint-card"), true);
  assert.equal(toggleShellCardState("assembly-joint-card"), false);
  assert.equal(isShellCardOpen("assembly-joint-card"), false);
  assert.equal(setShellCardOpen("assembly-joint-card", true), true);
  assert.equal(isShellCardOpen("assembly-joint-card"), true);
});

test("shell card state can default closed for explicit cards", () => {
  resetShellCardState();
  assert.equal(isShellCardOpen("advanced-card", false), false);
  assert.equal(toggleShellCardState("advanced-card", false), true);
});
