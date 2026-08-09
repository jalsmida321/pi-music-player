// Electron 主进程：窗口 + IPC + 各服务装配
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./services/store.mjs";
import { Library } from "./services/library.mjs";
import { MediaServer } from "./services/server.mjs";
import { AgentService } from "./services/agent.mjs";
import { LyricsService } from "./services/lyrics.mjs";
import { acrCloudIdentify } from "./services/hum.mjs";
import { createHash } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
let win = null;
let miniWin = null;
let lyricsWin = null;
let store, library, mediaServer, agent, lyricsService;
let latestPlayerState = null;
let latestLyricsData = null;
const pendingConfirms = new Map();
let confirmSeq = 0;

const PRELOAD = join(__dirname, "preload.cjs");
const DEFAULT_LYRICS_SIZE = { width: 1100, height: 250 };
const MIN_LYRICS_SIZE = { width: 480, height: 140 };
const winPrefs = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  backgroundThrottling: false,
};

// ---------- 小窗 / 桌面歌词 ----------
function createMiniWindow() {
  if (miniWin) {
    miniWin.show();
    miniWin.focus();
    return;
  }
  miniWin = new BrowserWindow({
    width: 360,
    height: 96,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#14171c",
    webPreferences: winPrefs,
  });
  miniWin.setAlwaysOnTop(true, "floating");
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniWin.webContents.once("did-finish-load", () => {
    if (latestPlayerState && miniWin && !miniWin.isDestroyed()) {
      miniWin.webContents.send("mini:state", latestPlayerState);
    }
  });
  miniWin.loadFile(join(__dirname, "mini.html"));
  miniWin.on("closed", () => {
    miniWin = null;
    // 小窗关闭 → 恢复主窗口（任何关闭路径都回到主界面）
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
    broadcastAux();
  });
  broadcastAux();
}

function createLyricsWindow() {
  if (lyricsWin) {
    lyricsWin.show();
    lyricsWin.focus();
    return;
  }
  const saved = store?.getSettings()?.lyricsWindowSize || DEFAULT_LYRICS_SIZE;
  const width = Math.max(MIN_LYRICS_SIZE.width, Number(saved.width) || DEFAULT_LYRICS_SIZE.width);
  const height = Math.max(MIN_LYRICS_SIZE.height, Number(saved.height) || DEFAULT_LYRICS_SIZE.height);
  lyricsWin = new BrowserWindow({
    width,
    height,
    minWidth: MIN_LYRICS_SIZE.width,
    minHeight: MIN_LYRICS_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: winPrefs,
  });
  lyricsWin.setAlwaysOnTop(true, "screen-saver");
  lyricsWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lyricsWin.webContents.once("did-finish-load", () => {
    if (!lyricsWin || lyricsWin.isDestroyed()) return;
    if (latestLyricsData) {
      lyricsWin.webContents.send("lyrics:set", {
        ...latestLyricsData,
        currentTime: latestPlayerState?.progress || latestLyricsData.currentTime || 0,
      });
    }
    if (latestPlayerState) {
      lyricsWin.webContents.send("lyrics:time", {
        currentTime: latestPlayerState.progress || 0,
        playing: !!latestPlayerState.playing,
      });
    }
  });
  lyricsWin.loadFile(join(__dirname, "lyrics.html"));
  let saveSizeTimer = null;
  lyricsWin.on("resize", () => {
    clearTimeout(saveSizeTimer);
    saveSizeTimer = setTimeout(() => {
      if (!lyricsWin || lyricsWin.isDestroyed() || !store) return;
      const [w, h] = lyricsWin.getSize();
      store.setSettings({ ...store.getSettings(), lyricsWindowSize: { width: w, height: h } });
    }, 250);
  });
  lyricsWin.on("closed", () => {
    clearTimeout(saveSizeTimer);
    lyricsWin = null;
    broadcastAux();
  });
  broadcastAux();
}

function broadcastAux() {
  if (win && !win.isDestroyed()) {
    win.webContents.send("aux:state", { mini: !!miniWin, lyrics: !!lyricsWin });
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: "#0e1013",
    title: "PI Music Player",
    webPreferences: winPrefs,
  });
  win.removeMenu();

  const devUrl = "http://127.0.0.1:5173";
  const distIndex = join(__dirname, "..", "dist", "index.html");
  if (process.env.NODE_ENV === "development" || !existsSync(distIndex)) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(distIndex);
  }
  if (process.env.SMOKE_TEST) {
    win.webContents.on("did-finish-load", async () => {
      try {
        const res = await win.webContents.executeJavaScript(`({
          api: typeof window.api,
          title: document.title,
          rootChildren: document.getElementById('root')?.children.length ?? -1,
        })`);
        console.log("SMOKE_RENDERER", JSON.stringify(res));
        const lib = await win.webContents.executeJavaScript(`window.api.library.get()`);
        console.log("SMOKE_LIBRARY", JSON.stringify({ tracks: lib.tracks.length, folders: lib.folders.length, playlists: lib.playlists.length }));
        const scanned = await library.scanAll();
        if (scanned.tracks.length === 0) {
          // 冒烟测试：自动加入 testdata 目录再扫一次
          const td = join(__dirname, "..", "testdata");
          if (existsSync(td)) {
            store.addFolder(td);
            const s2 = await library.scanAll();
            console.log("SMOKE_SCAN2", JSON.stringify({ tracks: s2.tracks.length, first: s2.tracks[0] && { title: s2.tracks[0].title, dur: s2.tracks[0].duration } }));
          }
        } else {
          console.log("SMOKE_SCAN", JSON.stringify({ tracks: scanned.tracks.length }));
        }
        console.log("SMOKE_PORT", mediaServer.port);
        // 音频流 Range 测试
        const track = store.getTracks()[0];
        if (track) {
          const url = `http://127.0.0.1:${mediaServer.port}/stream?p=${encodeURIComponent(track.path)}`;
          const r = await fetch(url, { headers: { Range: "bytes=0-99" } });
          const buf = await r.arrayBuffer();
          console.log("SMOKE_STREAM", JSON.stringify({ status: r.status, contentRange: r.headers.get("content-range"), bytes: buf.byteLength }));
        }
        // pi agent 会话构建（离线，仅验证本地装配）
        try {
          await agent.configure({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-smoke-test", modelId: "smoke-model" });
          const s = await agent.ensureSession();
          console.log("SMOKE_AGENT", JSON.stringify({ model: s.model && s.model.id, provider: s.model && s.model.provider, tools: typeof s.getAllTools === "function" ? s.getAllTools().map((t) => t.name) : "n/a" }));
          const hist0 = agent.getHistory();
          // 写入两条消息，验证持久化 + 历史读取
          const sm = s.sessionManager;
          sm.appendMessage({ role: "user", content: [{ type: "text", text: "测试消息" }], timestamp: Date.now() });
          sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "测试回复" }], timestamp: Date.now() });
          const hist1 = agent.getHistory();
          // 重建会话（模拟重启）→ 应恢复同一文件
          await agent.disposeSession();
          const s2 = await agent.ensureSession();
          const hist2 = agent.getHistory();
          console.log("SMOKE_SESSION", JSON.stringify({
            fileStable: s.sessionManager.getSessionFile() === s2.sessionManager.getSessionFile(),
            before: hist0.length,
            afterWrite: hist1.length,
            afterRestart: hist2.length,
            last: hist2[hist2.length - 1]?.text,
          }));
        } catch (e) {
          console.log("SMOKE_AGENT_ERR", String(e).slice(0, 200));
        }
        // 设置读写
        try {
          const st = store.getSettings();
          console.log("SMOKE_SETTINGS", JSON.stringify({ selfModify: st.selfModify, hasAcr: !!st.acr }));
        } catch (e) {
          console.log("SMOKE_SETTINGS_ERR", String(e).slice(0, 120));
        }
        // 哼唱识别链路（假 key：验证请求能到达服务端并被处理）
        try {
          const { acrCloudIdentify } = await import("./services/hum.mjs");
          const r = await acrCloudIdentify(Buffer.alloc(80000, 0), { host: "", accessKey: "fake-key", accessSecret: "fake-secret" });
          console.log("SMOKE_HUM", JSON.stringify({ ok: r.ok, err: r.error ? r.error.slice(0, 80) : null }));
        } catch (e) {
          console.log("SMOKE_HUM_ERR", String(e).slice(0, 150));
        }
        // 空耳找歌（网络可用时）
        try {
          const { neteaseLyricSearch } = await import("./services/lyrics.mjs");
          const hits = await neteaseLyricSearch("戴森球");
          console.log("SMOKE_EAR", JSON.stringify({ count: hits.length, first: hits[0] && `${hits[0].title} - ${hits[0].artists.join("/")}` }));
        } catch (e) {
          console.log("SMOKE_EAR_ERR", String(e).slice(0, 120));
        }
        // 歌词解析 + 小窗/歌词窗
        try {
          const lrc = await import("./services/lyrics.mjs").then((m) => m.parseLrc("[00:00.00]a\n[00:01.5]b\n[00:02.75][00:03.20]c\n[ti:x]meta"));
          console.log("SMOKE_LRC", JSON.stringify(lrc));
        } catch (e) {
          console.log("SMOKE_LRC_ERR", String(e).slice(0, 120));
        }
        // Lrclib 在线歌词（网络可用时）
        try {
          const r = await lyricsService.getForTrack({ path: "Z:/nonexistent/nonexistent.mp3", title: "Yesterday", artist: "The Beatles", album: "Help!", duration: 125 });
          console.log("SMOKE_LRCLIB", JSON.stringify({ status: r.status, lines: r.lines ? r.lines.length : 0, plain: r.plain ? r.plain.length : 0 }));
        } catch (e) {
          console.log("SMOKE_LRCLIB_ERR", String(e).slice(0, 120));
        }
        // 网易云封面下载（网络可用时）
        try {
          const fakeTrack = { id: "Z:/nonexistent/nonexistent.mp3", path: "Z:/nonexistent/nonexistent.mp3", title: "Yesterday", artist: "The Beatles", duration: 125 };
          const r = await library.fetchCover(fakeTrack);
          console.log("SMOKE_COVER", JSON.stringify(r));
          if (r.ok && existsSync(library.coverPath({ coverId: r.coverId, coverExt: r.coverExt }))) {
            console.log("SMOKE_COVER_FILE", "ok");
          }
        } catch (e) {
          console.log("SMOKE_COVER_ERR", String(e).slice(0, 120));
        }
        try {
          createMiniWindow();
          createLyricsWindow();
          await new Promise((r) => setTimeout(r, 1200));
          const s = { track: { title: "t", artist: "a", album: "al", coverId: null }, progress: 1.5, duration: 3, playing: true };
          if (miniWin) miniWin.webContents.send("mini:state", s);
          if (lyricsWin) {
            lyricsWin.webContents.send("lyrics:set", { lines: [{ t: 0, text: "a" }, { t: 1, text: "b" }, { t: 2, text: "c" }], currentTime: 0, status: "online" });
            await new Promise((r) => setTimeout(r, 350));
            lyricsWin.webContents.send("lyrics:time", { currentTime: 1.5 });
            await new Promise((r) => setTimeout(r, 500));
          }
          console.log("SMOKE_AUX", JSON.stringify({ mini: !!miniWin, lyrics: !!lyricsWin }));
          const miniText = miniWin ? await miniWin.webContents.executeJavaScript(`document.getElementById('title').textContent`) : null;
          const miniCoverUI = miniWin ? await miniWin.webContents.executeJavaScript(`({ tag: document.getElementById('cover-img')?.tagName, placeholder: document.getElementById('cover-ph')?.textContent })`) : null;
          const lyrUI = lyricsWin
            ? await lyricsWin.webContents.executeJavaScript(`({ n: document.querySelectorAll('.li').length, cur: document.querySelector('.li.cur')?.textContent, y: document.getElementById('list').style.transform })`)
            : null;
          console.log("SMOKE_AUX_UI", JSON.stringify({ miniText, miniCoverUI, lyrUI }));
          const lyrSizeBefore = lyricsWin ? lyricsWin.getSize() : null;
          ipcMain.emit("lyrics:resizeBy", {}, -120, -40);
          await new Promise((r) => setTimeout(r, 500));
          const lyrSizeAfter = lyricsWin ? lyricsWin.getSize() : null;
          console.log("SMOKE_LYRICS_RESIZE", JSON.stringify({ before: lyrSizeBefore, after: lyrSizeAfter }));
          if (miniWin) miniWin.close();
          if (lyricsWin) lyricsWin.close();
          await new Promise((r) => setTimeout(r, 400));
          // 实际顺序：歌曲/歌词状态先产生，副窗口后打开，应立即回放缓存
          await win.webContents.executeJavaScript(`{
            window.__smokePush = setInterval(() => window.api.player.pushState({ track: { id: 'smoke', title: '窗口后开测试', artist: '艺人', album: '专辑', coverId: null }, progress: 1.5, duration: 10, playing: true }), 80);
            window.api.lyrics.set({ lines: [{ t: 0, text: '缓存第一行' }, { t: 1, text: '缓存第二行' }], currentTime: 1.5, status: 'online' });
          }`);
          await new Promise((r) => setTimeout(r, 150));
          createMiniWindow();
          createLyricsWindow();
          await new Promise((r) => setTimeout(r, 1000));
          const replayMini = miniWin ? await miniWin.webContents.executeJavaScript(`document.getElementById('title').textContent`) : null;
          const replayLyrics = lyricsWin ? await lyricsWin.webContents.executeJavaScript(`({ n: document.querySelectorAll('.li').length, cur: document.querySelector('.li.cur')?.textContent })`) : null;
          console.log("SMOKE_AUX_REPLAY", JSON.stringify({ mini: replayMini, lyrics: replayLyrics }));
          await win.webContents.executeJavaScript(`clearInterval(window.__smokePush)`);
          if (miniWin) miniWin.close();
          if (lyricsWin) lyricsWin.close();
          await new Promise((r) => setTimeout(r, 400));
          // 小窗模式 = 主窗口隐藏 + 小窗显示；退出恢复
          ipcMain.emit("window:toggleMini");
          await new Promise((r) => setTimeout(r, 800));
          const s1 = { mini: !!miniWin, mainVisible: win && win.isVisible() };
          ipcMain.emit("mini:cmd", {}, { type: "expand" });
          await new Promise((r) => setTimeout(r, 600));
          const s2 = { mini: !!miniWin, mainVisible: win && win.isVisible() };
          console.log("SMOKE_MINI_MODE", JSON.stringify({ entered: s1, exited: s2 }));
          // 真实链路：渲染端 pushState → 主进程 → 小窗/歌词窗
          createMiniWindow();
          createLyricsWindow();
          await new Promise((r) => setTimeout(r, 1200));
          await win.webContents.executeJavaScript(`window.api.player.pushState({ track: { title: '真实链路测试', artist: '艺人', album: '专辑', coverId: null }, progress: 1.5, duration: 10, playing: true })`);
          await new Promise((r) => setTimeout(r, 600));
          // 歌词链：渲染端 lyrics.set + 时间推进
          await win.webContents.executeJavaScript(`window.api.lyrics.set({ lines: [{ t: 0, text: '第一行' }, { t: 1, text: '第二行' }, { t: 2, text: '第三行' }], currentTime: 0, status: 'online' })`);
          await new Promise((r) => setTimeout(r, 400));
          await win.webContents.executeJavaScript(`window.api.player.pushState({ track: null, progress: 1.5, duration: 10, playing: true })`);
          await new Promise((r) => setTimeout(r, 1500));
          const chainMini = miniWin ? await miniWin.webContents.executeJavaScript(`document.getElementById('title').textContent`) : null;
          const chainLyr = lyricsWin ? await lyricsWin.webContents.executeJavaScript(`({ n: document.querySelectorAll('.li').length, cur: document.querySelector('.li.cur')?.textContent, y: document.getElementById('list').style.transform, log: window.__lyrLog || [] })`) : null;
          console.log("SMOKE_CHAIN", JSON.stringify({ mini: chainMini, lyrics: chainLyr }));
          if (miniWin) miniWin.close();
          if (lyricsWin) lyricsWin.close();
        } catch (e) {
          console.log("SMOKE_AUX_ERR", String(e).slice(0, 200));
        }
      } catch (e) {
        console.error("SMOKE_FAIL", String(e));
        process.exitCode = 1;
      }
      setTimeout(() => app.quit(), 800);
    });
  }
  return win;
}

function registerIpc() {
  // ---- 曲库 ----
  ipcMain.handle("library:scan", async (_e, onProgress) => {
    return library.scanAll();
  });
  ipcMain.handle("library:get", async () => ({
    tracks: store.getTracks(),
    folders: store.getFolders(),
    playlists: store.getPlaylists(),
  }));
  ipcMain.handle("library:addFolder", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "选择音乐文件夹",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const folder = r.filePaths[0];
    store.addFolder(folder);
    const res = await library.scanAll();
    return { ok: true, ...res };
  });
  ipcMain.handle("library:removeFolder", async (_e, folder) => {
    store.removeFolder(folder);
    return { tracks: store.getTracks(), folders: store.getFolders() };
  });
  ipcMain.handle("library:toggleLike", async (_e, trackId) => {
    const tracks = store.getTracks();
    const t = tracks.find((x) => x.id === trackId);
    if (t) t.liked = !t.liked;
    store.setTracks(tracks);
    return tracks;
  });

  // ---- 歌单 ----
  ipcMain.handle("playlist:create", async (_e, name) => {
    const playlists = store.getPlaylists();
    const pl = { id: "pl_" + Date.now().toString(36), name, description: "", trackIds: [], createdAt: Date.now() };
    playlists.unshift(pl);
    store.savePlaylists(playlists);
    return pl;
  });
  ipcMain.handle("playlist:delete", async (_e, id) => {
    store.savePlaylists(store.getPlaylists().filter((p) => p.id !== id));
    return store.getPlaylists();
  });
  ipcMain.handle("playlist:rename", async (_e, id, name) => {
    const playlists = store.getPlaylists();
    const pl = playlists.find((p) => p.id === id);
    if (pl && name && name.trim()) pl.name = name.trim();
    store.savePlaylists(playlists);
    return playlists;
  });
  ipcMain.handle("playlist:addTracks", async (_e, id, trackIds) => {
    const playlists = store.getPlaylists();
    const pl = playlists.find((p) => p.id === id);
    if (pl) pl.trackIds = [...new Set([...pl.trackIds, ...trackIds])];
    store.savePlaylists(playlists);
    return playlists;
  });
  ipcMain.handle("playlist:removeTracks", async (_e, id, trackIds) => {
    const playlists = store.getPlaylists();
    const pl = playlists.find((p) => p.id === id);
    if (pl) pl.trackIds = pl.trackIds.filter((x) => !trackIds.includes(x));
    store.savePlaylists(playlists);
    return playlists;
  });

  // ---- 服务器 ----
  ipcMain.handle("server:port", async () => mediaServer.port);

  // ---- AI Agent ----
  ipcMain.handle("agent:getConfig", async () => agent.getConfig());
  ipcMain.handle("agent:configure", async (_e, cfg) => {
    try {
      await agent.configure(cfg);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("agent:chat", async (_e, text) => {
    try {
      const r = await agent.chat(text);
      return r;
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("agent:abort", async () => agent.abort());
  ipcMain.handle("chat:history", async () => agent.getHistory());

  // ---- 设置 / 自我修改 / 哼唱 ----
  ipcMain.handle("settings:get", async () => store.getSettings());
  ipcMain.handle("settings:set", async (_e, s) => {
    const previous = store.getSettings() || {};
    const next = {
      ...previous,
      ...s,
      acr: { ...(previous.acr || {}), ...(s?.acr || {}) },
    };
    store.setSettings(next);
    // 自我修改开关变化 → 重建 agent 会话
    if (next.selfModify !== previous.selfModify) {
      await agent.disposeSession();
    }
    return store.getSettings();
  });
  ipcMain.handle("app:info", async () => ({ isPackaged: app.isPackaged, version: app.getVersion() }));
  ipcMain.handle("app:restart", async () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("hum:debugDir", async () => join(app.getPath("userData"), "debug"));
  ipcMain.handle("app:openPath", async (_e, p) => shell.openPath(p));
  ipcMain.handle("hum:identify", async (_e, wavBuffer) => {
    const buf = Buffer.from(wavBuffer);
    // 调试留档：每次识别保留 wav + 服务端响应，便于排查
    let debugDir = null;
    try {
      debugDir = join(app.getPath("userData"), "debug");
      mkdirSync(debugDir, { recursive: true });
      writeFileSync(join(debugDir, "hum_last.wav"), buf);
    } catch {
      // 留档失败不影响识别
    }
    try {
      const settings = store.getSettings() || {};
      const r = await acrCloudIdentify(buf, settings.acr || {});
      if (debugDir) {
        try {
          writeFileSync(join(debugDir, "hum_last_response.json"), JSON.stringify({ ...r, wavBytes: buf.length }, null, 2));
        } catch {
          // 忽略
        }
      }
      return r;
    } catch (e) {
      const err = { ok: false, error: String(e?.message || e) };
      if (debugDir) {
        try {
          writeFileSync(join(debugDir, "hum_last_response.json"), JSON.stringify({ ...err, wavBytes: buf.length }, null, 2));
        } catch {
          // 忽略
        }
      }
      return err;
    }
  });
  ipcMain.on("confirm:response", (_e, id, ok) => {
    const p = pendingConfirms.get(id);
    if (p) {
      pendingConfirms.delete(id);
      p(!!ok);
    }
  });

  // ---- 小窗 / 桌面歌词 ----
  ipcMain.on("player:state", (_e, state) => {
    latestPlayerState = state;
    if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send("mini:state", state);
    if (lyricsWin && !lyricsWin.isDestroyed()) {
      lyricsWin.webContents.send("lyrics:time", { currentTime: state.progress || 0, playing: !!state.playing });
    }
  });
  ipcMain.on("lyrics:set", (_e, data) => {
    latestLyricsData = data;
    if (lyricsWin && !lyricsWin.isDestroyed()) lyricsWin.webContents.send("lyrics:set", data);
  });
  ipcMain.handle("lyrics:load", (_e, track) => lyricsService.getForTrack(track));
  ipcMain.handle("cover:fetch", async (_e, track) => library.fetchCover(track));
  ipcMain.on("lyrics:close", () => {
    if (lyricsWin) lyricsWin.close();
  });
  ipcMain.on("lyrics:setPinned", (_e, pinned) => {
    if (lyricsWin) lyricsWin.setAlwaysOnTop(pinned, "screen-saver");
  });
  ipcMain.on("lyrics:resizeBy", (_e, dw, dh) => {
    if (!lyricsWin || lyricsWin.isDestroyed()) return;
    const [w, h] = lyricsWin.getSize();
    lyricsWin.setSize(
      Math.max(MIN_LYRICS_SIZE.width, w + Number(dw || 0)),
      Math.max(MIN_LYRICS_SIZE.height, h + Number(dh || 0)),
      true
    );
  });
  ipcMain.on("lyrics:resetSize", () => {
    if (!lyricsWin || lyricsWin.isDestroyed()) return;
    lyricsWin.setSize(DEFAULT_LYRICS_SIZE.width, DEFAULT_LYRICS_SIZE.height, true);
  });
  ipcMain.on("mini:cmd", (_e, cmd) => {
    if (cmd && cmd.type === "expand") {
      if (miniWin) miniWin.close();
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
      return;
    }
    if (win && !win.isDestroyed()) win.webContents.send("player:cmd", cmd);
  });
  ipcMain.on("mini:close", () => {
    if (miniWin) miniWin.close();
  });
  ipcMain.on("window:toggleMini", () => {
    if (miniWin) {
      miniWin.close(); // closed 处理器会恢复主窗口
    } else {
      win.hide(); // 主窗口隐藏，整体切换为小窗
      createMiniWindow();
    }
  });
  ipcMain.on("window:toggleLyrics", () => {
    if (lyricsWin) lyricsWin.close();
    else createLyricsWindow();
  });
}

app.whenReady().then(async () => {
  // 冒烟测试用独立数据目录，避免污染真实用户数据
  if (process.env.SMOKE_TEST) {
    app.setPath("userData", join(app.getPath("temp"), "pi-music-smoke-" + Date.now()));
  }
  const userData = app.getPath("userData");
  store = new Store(userData);
  library = new Library(store, userData);
  mediaServer = new MediaServer(library);
  await mediaServer.start();
  // 安装版代码位于只读 app.asar；仅开发环境允许 AI 修改源码
  agent = new AgentService(store, library, userData, { projectRoot: app.isPackaged ? null : join(__dirname, "..") });
  lyricsService = new LyricsService(userData);
  agent.onConfirmRequest = (toolName, input) =>
    new Promise((resolve) => {
      const id = "c" + ++confirmSeq;
      pendingConfirms.set(id, resolve);
      if (win && !win.isDestroyed()) {
        win.webContents.send("confirm:request", { id, toolName, input });
      } else {
        resolve(false);
      }
    });
  agent.onEvent = (ev) => {
    if (win && !win.isDestroyed()) win.webContents.send("agent:event", ev);
  };
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
