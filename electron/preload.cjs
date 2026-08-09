const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  library: {
    scan: () => ipcRenderer.invoke("library:scan"),
    get: () => ipcRenderer.invoke("library:get"),
    addFolder: () => ipcRenderer.invoke("library:addFolder"),
    removeFolder: (folder) => ipcRenderer.invoke("library:removeFolder", folder),
    toggleLike: (trackId) => ipcRenderer.invoke("library:toggleLike", trackId),
  },
  playlist: {
    create: (name) => ipcRenderer.invoke("playlist:create", name),
    delete: (id) => ipcRenderer.invoke("playlist:delete", id),
    rename: (id, name) => ipcRenderer.invoke("playlist:rename", id, name),
    addTracks: (id, trackIds) => ipcRenderer.invoke("playlist:addTracks", id, trackIds),
    removeTracks: (id, trackIds) => ipcRenderer.invoke("playlist:removeTracks", id, trackIds),
  },
  server: {
    port: () => ipcRenderer.invoke("server:port"),
  },
  agent: {
    getConfig: () => ipcRenderer.invoke("agent:getConfig"),
    configure: (cfg) => ipcRenderer.invoke("agent:configure", cfg),
    chat: (text) => ipcRenderer.invoke("agent:chat", text),
    abort: () => ipcRenderer.invoke("agent:abort"),
    history: () => ipcRenderer.invoke("chat:history"),
    onEvent: (cb) => {
      ipcRenderer.on("agent:event", (_e, ev) => cb(ev));
    },
  },
  cover: {
    fetch: (track) => ipcRenderer.invoke("cover:fetch", track),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (s) => ipcRenderer.invoke("settings:set", s),
  },
  app: {
    restart: () => ipcRenderer.invoke("app:restart"),
    openPath: (p) => ipcRenderer.invoke("app:openPath", p),
    info: () => ipcRenderer.invoke("app:info"),
  },
  hum: {
    identify: (wavBuffer) => ipcRenderer.invoke("hum:identify", wavBuffer),
    debugDir: () => ipcRenderer.invoke("hum:debugDir"),
  },
  confirm: {
    onRequest: (cb) => ipcRenderer.on("confirm:request", (_e, d) => cb(d)),
    respond: (id, ok) => ipcRenderer.send("confirm:response", id, ok),
  },
  // 主窗口 → 副窗口状态推送
  player: {
    pushState: (state) => ipcRenderer.send("player:state", state),
    onCmd: (cb) => {
      const handler = (_e, cmd) => cb(cmd);
      ipcRenderer.on("player:cmd", handler);
      return () => ipcRenderer.removeListener("player:cmd", handler);
    },
  },
  // 小窗
  mini: {
    onState: (cb) => ipcRenderer.on("mini:state", (_e, s) => cb(s)),
    cmd: (cmd) => ipcRenderer.send("mini:cmd", cmd),
    close: () => ipcRenderer.send("mini:close"),
  },
  // 桌面歌词
  lyrics: {
    load: (trackPath) => ipcRenderer.invoke("lyrics:load", trackPath),
    set: (data) => ipcRenderer.send("lyrics:set", data),
    onSet: (cb) => ipcRenderer.on("lyrics:set", (_e, d) => cb(d)),
    onTime: (cb) => ipcRenderer.on("lyrics:time", (_e, d) => cb(d)),
    close: () => ipcRenderer.send("lyrics:close"),
    setPinned: (pinned) => ipcRenderer.send("lyrics:setPinned", pinned),
    resizeBy: (dw, dh) => ipcRenderer.send("lyrics:resizeBy", dw, dh),
    resetSize: () => ipcRenderer.send("lyrics:resetSize"),
  },
  // 窗口切换
  window: {
    toggleMini: () => ipcRenderer.send("window:toggleMini"),
    toggleLyrics: () => ipcRenderer.send("window:toggleLyrics"),
    onAuxState: (cb) => ipcRenderer.on("aux:state", (_e, s) => cb(s)),
  },
});
