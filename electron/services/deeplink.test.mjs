import test from "node:test";
import assert from "node:assert/strict";
import { findDeepLink, parseDeepLink } from "./deeplink.mjs";

test("accepts whitelisted navigation and playback actions", () => {
  assert.deepEqual(parseDeepLink("pimusic://open/repair"), { type: "open", view: "repair" });
  assert.deepEqual(parseDeepLink("pimusic://play/toggle"), { type: "player", action: "toggle" });
  assert.deepEqual(parseDeepLink("pimusic://play/previous"), { type: "player", action: "previous" });
});

test("rejects unknown, malformed and privileged actions", () => {
  assert.equal(parseDeepLink("pimusic://open/admin"), null);
  assert.equal(parseDeepLink("pimusic://shell/run?cmd=calc"), null);
  assert.equal(parseDeepLink("https://example.com"), null);
  assert.equal(parseDeepLink("not a url"), null);
});

test("finds protocol argument in process argv", () => {
  assert.equal(findDeepLink(["electron.exe", ".", "pimusic://open/library"]), "pimusic://open/library");
  assert.equal(findDeepLink(["electron.exe", "."]), null);
});
