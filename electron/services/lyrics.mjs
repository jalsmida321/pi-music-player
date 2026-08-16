// LRC 歌词：解析 + 本地加载 + 在线自动下载（Lrclib.net）
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function parseLrc(text) {
  const lines = [];
  const timeTag = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const times = [...line.matchAll(timeTag)].map((m) => {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      let ms = 0;
      if (m[3]) {
        const d = m[3];
        ms = d.length === 1 ? parseInt(d, 10) * 100 : d.length === 2 ? parseInt(d, 10) * 10 : parseInt(d, 10);
      }
      return min * 60 + sec + ms / 1000;
    });
    if (times.length === 0) continue;
    const text = line
      .replace(timeTag, "")
      .replace(/^\s*\[(ti|ar|al|by|offset|length|re|ve):[^\]]*\]\s*/gi, "")
      .trim();
    if (!text) continue;
    for (const t of times) lines.push({ t, text });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
}

export function loadLrcForTrack(trackPath) {
  const lrcPath = String(trackPath).replace(/\.[^.]+$/, ".lrc");
  try {
    if (existsSync(lrcPath)) return parseLrc(readFileSync(lrcPath, "utf-8"));
  } catch {
    // 读取失败返回空
  }
  return [];
}

// 从 Lrclib.net 搜索歌词（公版/CC 授权，开放 API，无需 Key）
export async function fetchLyricsFromLrclib(track) {
  const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  if (track.album) params.set("album_name", track.album);
  const res = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
    headers: { "User-Agent": "PIMusicPlayer/0.1 (local music player; auto lyrics)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const list = await res.json();
  if (!Array.isArray(list) || list.length === 0) return null;
  // 优先：有同步歌词 + 时长接近（API 已按匹配度排序，取第一个符合的）
  for (const it of list) {
    if (it.syncedLyrics) {
      if (track.duration && it.duration && Math.abs(it.duration - track.duration) > 20) continue;
      return { synced: it.syncedLyrics, plain: null };
    }
  }
  const any = list.find((it) => it.plainLyrics);
  if (any) return { synced: null, plain: any.plainLyrics };
  return null;
}

// 空耳找歌：直接把用户记得的片段（可能听错）丢给网易云搜索
// 策略：原文搜索 + 常见空耳替换变体，返回候选列表
const EAR_REPLACEMENTS = [
  [/小苹果/g, "小苹果"],
];

export async function neteaseLyricSearch(text) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: "https://music.163.com/",
    Cookie: "appver=2.0.2",
  };
  const queries = [String(text).trim()];
  const seen = new Set(queries);
  for (const [re] of EAR_REPLACEMENTS) {
    const alt = String(text).replace(re, re.source);
    if (!seen.has(alt)) {
      seen.add(alt);
      queries.push(alt);
    }
  }
  const out = [];
  for (const q of queries.slice(0, 2)) {
    const res = await fetch("https://music.163.com/api/cloudsearch/pc", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: `s=${encodeURIComponent(q)}&type=1&limit=8&offset=0`,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const songs = data?.result?.songs;
    if (Array.isArray(songs)) {
      for (const s of songs) {
        out.push({
          title: s.name,
          artists: (s.ar || []).map((a) => a.name),
          album: s.al?.name || null,
          duration: s.duration ? Math.round(s.duration / 1000) : null,
        });
      }
    }
  }
  return out.slice(0, 8);
}

// 网易云搜索歌曲（歌词/封面共用；接口为逆向，仅供个人播放场景）
export async function neteaseSearchSong(track) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: "https://music.163.com/",
    Cookie: "appver=2.0.2",
  };
  const q = `${track.title} ${track.artist}`;
  const searchRes = await fetch("https://music.163.com/api/cloudsearch/pc", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: `s=${encodeURIComponent(q)}&type=1&limit=5&offset=0`,
    signal: AbortSignal.timeout(10000),
  });
  if (!searchRes.ok) return null;
  const data = await searchRes.json();
  const songs = data?.result?.songs;
  if (!Array.isArray(songs) || songs.length === 0) return null;
  // 选时长最接近的候选，避免同名错歌
  let song = songs[0];
  if (track.duration) {
    let bestDiff = Infinity;
    for (const s of songs) {
      const d = s.duration ? Math.abs(s.duration / 1000 - track.duration) : Infinity;
      if (d < bestDiff) {
        bestDiff = d;
        song = s;
      }
    }
  }
  return {
    id: song.id,
    duration: song.duration ? song.duration / 1000 : null,
    name: song.name,
    artists: (song.ar || []).map((a) => a.name),
    album: song.al?.name || null,
    picUrl: song.al?.picUrl || null,
  };
}

// 网易云兜底：搜索 + 歌词接口（个人播放场景通用做法；接口为逆向，仅供个人使用）
export async function fetchLyricsFromNetease(track) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: "https://music.163.com/",
    Cookie: "appver=2.0.2",
  };
  const song = await neteaseSearchSong(track);
  if (!song) return null;
  // 取歌词
  const lyrRes = await fetch(`https://music.163.com/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!lyrRes.ok) return null;
  const lyrData = await lyrRes.json();
  const lrc = lyrData?.lrc?.lyric;
  if (!lrc || !lrc.trim()) return null;
  return lrc;
}

// 过滤“纯音乐/暂无歌词”这类无效歌词
function isInstrumentalLines(lines) {
  if (lines.length > 2) return false;
  const t = lines.map((l) => l.text).join("");
  return /纯音乐|暂无歌词|此歌曲为没有填词的/.test(t);
}

export class LyricsService {
  constructor(userDataDir) {
    this.cacheDir = join(userDataDir, "lyrics");
    if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true });
    this.negativeCache = new Set(); // 本次会话内未找到的曲目，避免重复请求
  }

  hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  cachePath(track) {
    return join(this.cacheDir, this.hash(`${track.title}|${track.artist}`) + ".lrc");
  }

  plainCachePath(track) {
    return join(this.cacheDir, this.hash(`${track.title}|${track.artist}`) + ".txt");
  }

  inspectTrack(track) {
    if (!track) return "missing";
    try {
      const localPath = String(track.path).replace(/\.[^.]+$/, ".lrc");
      if (existsSync(localPath) && statSync(localPath).size > 0) return "local";
      const syncedPath = this.cachePath(track);
      if (existsSync(syncedPath) && statSync(syncedPath).size > 0) return "cache";
      const plainPath = this.plainCachePath(track);
      if (existsSync(plainPath) && statSync(plainPath).size > 0) return "cache";
    } catch {
      // 损坏或不可读按缺失处理
    }
    return track.lyricsStatus && track.lyricsStatus !== "notfound" ? track.lyricsStatus : "missing";
  }

  /**
   * 获取歌词：本地 .lrc → 缓存 → Lrclib → 网易云兜底（下载并保存）
   * 返回 { lines?, plain?, status: "local"|"cache"|"online"|"notfound"|"loading" }
   */
  async getForTrack(track, options = {}) {
    if (!track) return { status: "notfound" };
    // 1) 本地 .lrc（歌曲同目录）
    const local = loadLrcForTrack(track.path);
    if (local.length > 0) return { lines: local, status: "local" };
    // 2) 应用缓存
    const cp = this.cachePath(track);
    try {
      if (existsSync(cp)) {
        const cached = parseLrc(readFileSync(cp, "utf-8"));
        if (cached.length > 0) return { lines: cached, status: "cache" };
      }
      const plainPath = this.plainCachePath(track);
      if (existsSync(plainPath)) {
        const plain = readFileSync(plainPath, "utf-8").trim();
        if (plain) return { plain, status: "cache" };
      }
    } catch {
      // 缓存损坏忽略
    }
    // 3) 在线获取（本会话已失败过则跳过，修复台可主动重试）
    const key = `${track.title}|${track.artist}`;
    if (options.force) this.negativeCache.delete(key);
    if (this.negativeCache.has(key)) return { status: "notfound" };
    let hit = null;
    try {
      hit = await fetchLyricsFromLrclib(track);
    } catch {
      hit = null;
    }
    let lrcText = hit?.synced || null;
    let plain = hit?.plain || null;
    // Lrclib 无结果 → 网易云兜底
    if (!lrcText && !plain) {
      try {
        const ne = await fetchLyricsFromNetease(track);
        if (ne) lrcText = ne;
      } catch {
        // 网络失败
      }
    }
    if (lrcText) {
      const lines = parseLrc(lrcText);
      if (lines.length > 0 && !isInstrumentalLines(lines)) {
        this.persist(track, lrcText, { cacheOnly: !!options.cacheOnly });
        return { lines, status: "online" };
      }
    }
    if (plain) {
      try {
        mkdirSync(this.cacheDir, { recursive: true });
        writeFileSync(this.plainCachePath(track), plain, "utf-8");
      } catch {
        // 缓存写入失败不阻塞
      }
      return { plain, status: "online" };
    }
    this.negativeCache.add(key);
    return { status: "notfound" };
  }

  // 默认存缓存并写入歌曲同目录；修复台使用 cacheOnly，避免改动用户音乐目录
  persist(track, lrcText, options = {}) {
    const cp = this.cachePath(track);
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(cp, lrcText, "utf-8");
    } catch {
      // 缓存写入失败不阻塞
    }
    if (!options.cacheOnly) {
      const lrcPath = String(track.path).replace(/\.[^.]+$/, ".lrc");
      try {
        writeFileSync(lrcPath, lrcText, "utf-8");
      } catch {
        // 目录不可写，忽略
      }
    }
  }
}
