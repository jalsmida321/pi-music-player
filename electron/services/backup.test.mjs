import test from "node:test";
import assert from "node:assert/strict";
import { applyBackup, createBackup, findTrackMatch, validateBackup } from "./backup.mjs";

const track = {
  id: "D:/Private/Music/song.mp3",
  path: "D:/Private/Music/song.mp3",
  title: "Song A",
  artist: "Artist A",
  album: "Album",
  duration: 180,
  liked: true,
  tags: ["夜晚"],
};

test("backup excludes paths and credentials", () => {
  const backup = createBackup({
    tracks: [track],
    playlists: [{ id: "p1", name: "Mix", trackIds: [track.id] }],
    settings: {
      acr: { accessKey: "key", accessSecret: "secret" },
      chatSessionFile: "C:/Private/chat.jsonl",
      lyricsWindowSize: { width: 900, height: 200 },
    },
  }, "0.1.0");
  const text = JSON.stringify(backup);
  assert.equal(text.includes(track.path), false);
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("chat.jsonl"), false);
  assert.deepEqual(backup.settings.lyricsWindowSize, { width: 900, height: 200 });
  assert.equal(validateBackup(backup), backup);
});

test("import matches conservatively and keeps local credentials", () => {
  const backup = createBackup({ tracks: [track], playlists: [{ name: "Mix", trackIds: [track.id] }] });
  const result = applyBackup(backup, {
    tracks: [{ ...track, liked: false, tags: [] }],
    playlists: [],
    settings: { acr: { accessSecret: "keep" } },
  });
  assert.equal(result.summary.playlistTracksMatched, 1);
  assert.equal(result.tracks[0].liked, true);
  assert.deepEqual(result.tracks[0].tags, ["夜晚"]);
  assert.equal(result.settings.acr.accessSecret, "keep");
});

test("validation rejects malformed nested playlist data", () => {
  assert.throws(() => validateBackup({
    format: "pi-music-backup",
    version: 1,
    library: [],
    playlists: [{ name: "Broken", tracks: "not-an-array" }],
  }), /歌单数据结构无效/);
});

test("track matching rejects wrong artist and distant duration", () => {
  const local = [{ ...track, id: "a" }];
  assert.equal(findTrackMatch({ ...track, artist: "Another Artist" }, local), null);
  assert.equal(findTrackMatch({ ...track, duration: 220 }, local), null);
  assert.equal(findTrackMatch({ ...track, duration: 184 }, local)?.id, "a");
});

test("re-import updates same-name playlist instead of duplicating it", () => {
  const backup = createBackup({ tracks: [track], playlists: [{ name: "Mix", trackIds: [track.id] }] });
  const result = applyBackup(backup, {
    tracks: [track],
    playlists: [{ id: "existing", name: "Mix", trackIds: [] }],
    settings: {},
  });
  assert.equal(result.playlists.length, 1);
  assert.equal(result.playlists[0].id, "existing");
  assert.deepEqual(result.playlists[0].trackIds, [track.id]);
});
