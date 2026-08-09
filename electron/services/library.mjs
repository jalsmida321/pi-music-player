// 曲库扫描：遍历文件夹、解析标签、提取封面
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { parseFile } from "music-metadata";
import { randomUUID } from "node:crypto";
import { neteaseSearchSong } from "./lyrics.mjs";

const AUDIO_EXTS = new Set([".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma"]);

export class Library {
  constructor(store, userDataDir) {
    this.store = store;
    this.coverDir = join(userDataDir, "covers");
    if (!existsSync(this.coverDir)) mkdirSync(this.coverDir, { recursive: true });
  }

  walk(dir, out) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) this.walk(p, out);
      else if (AUDIO_EXTS.has(extname(e.name).toLowerCase())) out.push(p);
    }
  }

  async scanAll(onProgress) {
    const folders = this.store.getFolders();
    const state = this.store.getScanState();
    const tracks = [];
    let files = [];
    for (const f of folders) {
      const batch = [];
      this.walk(f, batch);
      files = files.concat(batch);
    }
    const seen = new Set();
    for (const t of this.store.getTracks()) if (existsSync(t.path)) seen.add(t.path);
    let i = 0;
    for (const file of files) {
      i++;
      if (onProgress) onProgress(i, files.length, file);
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      const key = file;
      const sig = `${st.size}:${Math.round(st.mtimeMs)}`;
      const cached = seen.has(file) && state[key] === sig && this.store.getTrack(file);
      if (cached) {
        tracks.push(cached);
        continue;
      }
      try {
        const meta = await parseFile(file, { duration: true, skipCovers: false });
        const common = meta.common || {};
        let coverId = null;
        if (common.picture && common.picture.length > 0) {
          const pic = common.picture[0];
          const ext = pic.format.includes("png") ? ".png" : pic.format.includes("webp") ? ".webp" : ".jpg";
          coverId = this.hash(file);
          writeFileSync(join(this.coverDir, coverId + ext), pic.data);
        }
        tracks.push({
          id: file,
          path: file,
          title: common.title || basename(file, extname(file)),
          artist: common.artist || (common.artists && common.artists[0]) || "未知艺人",
          album: common.album || "未知专辑",
          genre: (common.genre && common.genre[0]) || "",
          year: common.year || "",
          duration: meta.format.duration ? Math.round(meta.format.duration) : 0,
          coverId,
          coverExt: coverId ? (common.picture[0].format.includes("png") ? "png" : common.picture[0].format.includes("webp") ? "webp" : "jpg") : null,
          tags: [],
          liked: false,
          addedAt: Date.now(),
        });
        // 保留旧记录的 喜欢/标签/入库时间
        const old = this.store.getTrack(file);
        if (old) {
          tracks[tracks.length - 1].liked = !!old.liked;
          tracks[tracks.length - 1].tags = old.tags || [];
          tracks[tracks.length - 1].addedAt = old.addedAt || tracks[tracks.length - 1].addedAt;
        }
        state[file] = sig;
      } catch {
        // 解析失败的文件跳过（保留旧记录）
        const old = this.store.getTrack(file);
        if (old) tracks.push(old);
      }
    }
    this.store.setScanState(state);
    this.store.setTracks(tracks);
    return { tracks, folders: this.store.getFolders() };
  }

  hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  coverPath(track) {
    if (!track || !track.coverId) return null;
    const p = join(this.coverDir, `${track.coverId}.${track.coverExt || "jpg"}`);
    return existsSync(p) ? p : null;
  }

  // 从网易云自动补封面（搜索歌曲 → 专辑图下载 → 存本地 + 更新曲目）
  async fetchCover(track) {
    if (!track) return { ok: false };
    if (track.coverId && existsSync(join(this.coverDir, `${track.coverId}.${track.coverExt || "jpg"}`))) {
      return { ok: true, coverId: track.coverId, coverExt: track.coverExt };
    }
    try {
      const song = await neteaseSearchSong(track);
      if (!song || !song.picUrl) return { ok: false };
      const res = await fetch(song.picUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { ok: false };
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = buf[0] === 0xff && buf[1] === 0xd8 ? "jpg" : buf[0] === 0x89 ? "png" : "jpg";
      const coverId = "net_" + this.hash(track.path);
      if (!existsSync(this.coverDir)) mkdirSync(this.coverDir, { recursive: true });
      writeFileSync(join(this.coverDir, coverId + "." + ext), buf);
      const tracks = this.store.getTracks();
      const t = tracks.find((x) => x.id === track.id);
      if (t) {
        t.coverId = coverId;
        t.coverExt = ext;
        this.store.setTracks(tracks);
      }
      return { ok: true, coverId, coverExt: ext };
    } catch {
      return { ok: false };
    }
  }
}
