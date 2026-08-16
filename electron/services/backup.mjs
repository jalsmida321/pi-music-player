import { randomUUID } from "node:crypto";

export const BACKUP_FORMAT = "pi-music-backup";
export const BACKUP_VERSION = 1;

const cleanText = (value) => String(value || "").trim();
const normalize = (value) => cleanText(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

export function portableTrack(track) {
  return {
    title: cleanText(track.title),
    artist: cleanText(track.artist),
    album: cleanText(track.album),
    duration: Number(track.duration) || 0,
    liked: !!track.liked,
    tags: Array.isArray(track.tags) ? track.tags.map(cleanText).filter(Boolean).slice(0, 50) : [],
  };
}

function safeSettings(settings = {}) {
  const out = {};
  if (settings.lyricsWindowSize) {
    out.lyricsWindowSize = {
      width: Number(settings.lyricsWindowSize.width) || 1100,
      height: Number(settings.lyricsWindowSize.height) || 250,
    };
  }
  return out;
}

export function createBackup(data, appVersion = "0.0.0") {
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    library: tracks.map(portableTrack),
    playlists: (Array.isArray(data.playlists) ? data.playlists : []).map((playlist) => ({
      name: cleanText(playlist.name) || "未命名歌单",
      description: cleanText(playlist.description),
      createdAt: Number(playlist.createdAt) || Date.now(),
      tracks: (Array.isArray(playlist.trackIds) ? playlist.trackIds : [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(portableTrack),
    })),
    settings: safeSettings(data.settings),
  };
}

export function validateBackup(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("备份文件不是有效对象");
  if (input.format !== BACKUP_FORMAT) throw new Error("不是 PI Music Player 备份文件");
  if (input.version !== BACKUP_VERSION) throw new Error(`暂不支持备份版本 ${input.version}`);
  if (!Array.isArray(input.library) || !Array.isArray(input.playlists)) throw new Error("备份文件结构不完整");
  if (input.library.length > 200000 || input.playlists.length > 10000) throw new Error("备份数据规模异常");
  const validTrack = (track) => track && typeof track === "object" && !Array.isArray(track) && typeof track.title === "string" && typeof track.artist === "string";
  if (!input.library.every(validTrack)) throw new Error("曲库数据结构无效");
  for (const playlist of input.playlists) {
    if (!playlist || typeof playlist !== "object" || typeof playlist.name !== "string" || !Array.isArray(playlist.tracks)) {
      throw new Error("歌单数据结构无效");
    }
    if (playlist.tracks.length > 200000 || !playlist.tracks.every(validTrack)) throw new Error(`歌单「${cleanText(playlist.name)}」歌曲结构无效`);
  }
  return input;
}

export function findTrackMatch(descriptor, localTracks) {
  const title = normalize(descriptor?.title);
  const artist = normalize(descriptor?.artist);
  const artistIsKnown = artist && !["未知艺人", "unknown", "unknownartist"].includes(artist);
  if (!title) return null;
  let best = null;
  let bestScore = -1;
  for (const track of localTracks) {
    const localTitle = normalize(track.title);
    const localArtist = normalize(track.artist);
    if (localTitle !== title) continue;
    const artistMatches = localArtist === artist || (artist && localArtist && (localArtist.includes(artist) || artist.includes(localArtist)));
    if (artistIsKnown && !artistMatches) continue;
    let score = 60 + (artistMatches ? 30 : 0);
    const wantedDuration = Number(descriptor.duration) || 0;
    const localDuration = Number(track.duration) || 0;
    if (wantedDuration && localDuration) {
      const diff = Math.abs(wantedDuration - localDuration);
      if (diff > 15) continue;
      if (diff <= 3) score += 10;
      else if (diff <= 10) score += 4;
    }
    if (score > bestScore) {
      best = track;
      bestScore = score;
    }
  }
  return bestScore >= 60 ? best : null;
}

export function applyBackup(input, currentData) {
  const backup = validateBackup(input);
  const tracks = Array.isArray(currentData.tracks) ? currentData.tracks.map((track) => ({ ...track })) : [];
  const existingPlaylists = Array.isArray(currentData.playlists) ? currentData.playlists.map((playlist) => ({ ...playlist })) : [];
  const matchedLibraryIds = new Set();

  for (const descriptor of backup.library) {
    const match = findTrackMatch(descriptor, tracks);
    if (!match) continue;
    matchedLibraryIds.add(match.id);
    match.liked = !!match.liked || !!descriptor.liked;
    const importedTags = Array.isArray(descriptor.tags) ? descriptor.tags.map(cleanText).filter(Boolean) : [];
    match.tags = [...new Set([...(match.tags || []), ...importedTags])].slice(0, 50);
  }

  let matchedPlaylistTracks = 0;
  let missingPlaylistTracks = 0;
  const importedPlaylists = backup.playlists.map((playlist) => {
    const trackIds = [];
    for (const descriptor of playlist.tracks || []) {
      const match = findTrackMatch(descriptor, tracks);
      if (match) {
        trackIds.push(match.id);
        matchedPlaylistTracks++;
      } else {
        missingPlaylistTracks++;
      }
    }
    const name = cleanText(playlist.name) || "导入歌单";
    const existing = existingPlaylists.find((item) => cleanText(item.name) === name);
    return {
      id: existing?.id || `pl_import_${randomUUID()}`,
      name,
      description: cleanText(playlist.description),
      trackIds: [...new Set(trackIds)],
      createdAt: Number(existing?.createdAt || playlist.createdAt) || Date.now(),
      importedAt: Date.now(),
    };
  });
  const importedIds = new Set(importedPlaylists.map((playlist) => playlist.id));

  return {
    tracks,
    playlists: [...importedPlaylists, ...existingPlaylists.filter((playlist) => !importedIds.has(playlist.id))],
    settings: { ...(currentData.settings || {}), ...safeSettings(backup.settings) },
    summary: {
      libraryMatched: matchedLibraryIds.size,
      libraryMissing: Math.max(0, backup.library.length - matchedLibraryIds.size),
      playlistsImported: importedPlaylists.length,
      playlistTracksMatched: matchedPlaylistTracks,
      playlistTracksMissing: missingPlaylistTracks,
    },
  };
}
