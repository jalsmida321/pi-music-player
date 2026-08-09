// 简单 JSON 持久化存储（用户数据目录）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.file = join(userDataDir, "data.json");
    this.data = { folders: [], tracks: [], playlists: [], agent: null, settings: { selfModify: true, acr: { host: "", accessKey: "", accessSecret: "" } }, scanState: {} };
    this.load();
  }

  load() {
    if (existsSync(this.file)) {
      try {
        const d = JSON.parse(readFileSync(this.file, "utf-8"));
        this.data = { ...this.data, ...d };
      } catch {
        // 损坏则重置
      }
    }
  }

  save() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf-8");
  }

  getTracks() {
    return this.data.tracks;
  }
  getTrack(id) {
    return this.data.tracks.find((t) => t.id === id);
  }
  setTracks(tracks) {
    this.data.tracks = tracks;
    this.save();
  }
  getFolders() {
    return this.data.folders;
  }
  addFolder(folder) {
    if (!this.data.folders.includes(folder)) {
      this.data.folders.push(folder);
      this.save();
    }
  }
  removeFolder(folder) {
    this.data.folders = this.data.folders.filter((f) => f !== folder);
    this.data.tracks = this.data.tracks.filter((t) => !t.path.startsWith(folder));
    this.save();
  }
  getPlaylists() {
    return this.data.playlists;
  }
  savePlaylists(playlists) {
    this.data.playlists = playlists;
    this.save();
  }
  getSettings() {
    return this.data.settings;
  }
  setSettings(s) {
    this.data.settings = s;
    this.save();
  }
  getAgent() {
    return this.data.agent;
  }
  setAgent(cfg) {
    this.data.agent = cfg;
    this.save();
  }
  getScanState() {
    return this.data.scanState || {};
  }
  setScanState(state) {
    this.data.scanState = state;
    this.save();
  }
}
