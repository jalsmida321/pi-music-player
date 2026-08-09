import React, { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import LibraryView from "./components/LibraryView.jsx";
import PlaylistView from "./components/PlaylistView.jsx";
import ChatView from "./components/ChatView.jsx";
import SettingsView from "./components/SettingsView.jsx";
import PlayerBar from "./components/PlayerBar.jsx";

const fmt = (s) => {
  if (!s || s <= 0 || !isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
};

export default function App() {
  const [view, setView] = useState("library");
  const [tracks, setTracks] = useState([]);
  const [folders, setFolders] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [port, setPort] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [scanning, setScanning] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [mode, setMode] = useState("list-loop"); // order | list-loop | single-loop | shuffle
  const audioRef = useRef(null);
  const playerStateRef = useRef({ track: null, progress: 0, duration: 0, playing: false });

  const refresh = async () => {
    const d = await window.api.library.get();
    setTracks(d.tracks);
    setFolders(d.folders);
    setPlaylists(d.playlists);
  };

  useEffect(() => {
    refresh();
    window.api.server.port().then(setPort);
    window.api.window.onAuxState((s) => {
      setMiniOpen(!!s.mini);
      setLyricsOpen(!!s.lyrics);
    });
  }, []);

  const playQueue = (list, index) => {
    setQueue(list);
    setCurrentIndex(index);
  };

  const current = currentIndex >= 0 ? queue[currentIndex] : null;

  const playFromTracks = (list, id) => {
    const i = list.findIndex((t) => t.id === id);
    if (i >= 0) playQueue(list, i);
  };

  const next = (auto = false) => {
    if (queue.length === 0) return;
    if (mode === "shuffle") {
      setCurrentIndex(Math.floor(Math.random() * queue.length));
      return;
    }
    if (mode === "single-loop" && auto) {
      const a = audioRef.current;
      if (a) {
        a.currentTime = 0;
        a.play().catch(() => {});
      }
      return;
    }
    let i = currentIndex + 1;
    if (i >= queue.length) {
      if (mode === "list-loop" || (mode === "single-loop" && !auto)) i = 0;
      else if (auto) return; // 顺序播放：播完停止
      else i = currentIndex;
    }
    setCurrentIndex(i);
  };
  const prev = () => {
    if (queue.length === 0) return;
    if (progress > 3) {
      if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }
    setCurrentIndex(Math.max(0, currentIndex - 1));
  };

  const onEnded = () => next(true);

  // 红心（列表/播放条共用）
  const toggleLike = async (t) => {
    await window.api.library.toggleLike(t.id);
    setQueue((q) => q.map((x) => (x.id === t.id ? { ...x, liked: !x.liked } : x)));
    refresh();
  };

  // 自动补封面（当前播放曲目无内嵌封面时，从网易云获取）
  useEffect(() => {
    if (!current || current.coverId) return;
    const id = current.id;
    window.api.cover.fetch(current).then((r) => {
      // 防竞态：切歌后丢弃旧结果
      if (currentTrackIdRef.current === id && r.ok) {
        setQueue((q) => q.map((t) => (t.id === id ? { ...t, coverId: r.coverId, coverExt: r.coverExt } : t)));
        refresh();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // ---- 小窗 / 桌面歌词 ----
  // 切歌时加载歌词（本地 .lrc → 缓存 → 在线自动下载）
  const currentTrackIdRef = useRef(null);
  useEffect(() => {
    if (!current) {
      currentTrackIdRef.current = null;
      window.api.lyrics.set({ lines: [], plain: null, status: "notfound", currentTime: 0 });
      return;
    }
    const id = current.id;
    currentTrackIdRef.current = id;
    window.api.lyrics.set({
      lines: [],
      plain: null,
      status: "loading",
      trackId: id,
      currentTime: 0,
    });
    window.api.lyrics.load(current).then((r) => {
      // 防竞态：慢返回时用户已切歌则丢弃
      if (currentTrackIdRef.current === id) {
        window.api.lyrics.set({ ...r, trackId: id, currentTime: audioRef.current?.currentTime || 0 });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // 始终保存最新播放快照，供稳定定时器和副窗口使用
  playerStateRef.current = {
    track: current
      ? { id: current.id, title: current.title, artist: current.artist, album: current.album, coverId: current.coverId }
      : null,
    progress,
    duration,
    playing,
  };

  // 小窗/歌词窗口命令
  useEffect(() => {
    const dispose = window.api.player.onCmd((cmd) => {
      if (!cmd) return;
      const a = audioRef.current;
      if (cmd.type === "playpause") {
        if (!current) return;
        if (a.paused) a.play();
        else a.pause();
      } else if (cmd.type === "next") next();
      else if (cmd.type === "prev") prev();
      else if (cmd.type === "seekRatio") {
        if (a && duration > 0) a.currentTime = cmd.value * duration;
      }
    });
    return dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, duration]);

  // 切歌和播放状态变化时立即推送；稳定定时器持续同步真实进度
  useEffect(() => {
    window.api.player.pushState(playerStateRef.current);
  }, [current?.id, playing, duration]);
  useEffect(() => {
    const push = () => window.api.player.pushState(playerStateRef.current);
    push();
    const t = setInterval(push, 250);
    return () => clearInterval(t);
  }, []);

  const renderMain = () => {
    switch (view) {
      case "library":
        return (
          <LibraryView
            tracks={tracks}
            playlists={playlists}
            current={current}
            playing={playing}
            port={port}
            onPlay={(id) => playFromTracks(tracks, id)}
            onRefresh={refresh}
            onToggleLike={toggleLike}
          />
        );
      case "playlists":
        return (
          <PlaylistView
            tracks={tracks}
            playlists={playlists}
            current={current}
            playing={playing}
            port={port}
            onPlay={(list, id) => playFromTracks(list, id)}
            onRefresh={refresh}
          />
        );
      case "chat":
        return (
          <ChatView
            tracks={tracks}
            onPlaylistCreated={refresh}
            onPlayTracks={(list) => playFromTracks(list, list[0]?.id)}
            onPlayTrack={(id) => playFromTracks(tracks, id)}
            onOpenPlaylists={() => setView("playlists")}
          />
        );
      case "settings":
        return <SettingsView />;
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <div className="app-body">
        <Sidebar
          view={view}
          setView={setView}
          folders={folders}
          scanning={scanning}
          playlistCount={playlists.length}
          onAddFolder={async () => {
            setScanning(true);
            const r = await window.api.library.addFolder();
            if (r.ok) {
              setTracks(r.tracks);
              setFolders(r.folders);
            }
            setScanning(false);
            refresh();
          }}
          onRemoveFolder={async (f) => {
            const r = await window.api.library.removeFolder(f);
            setTracks(r.tracks);
            setFolders(r.folders);
          }}
        />
        <div className="main">{renderMain()}</div>
      </div>
      <PlayerBar
        audioRef={audioRef}
        current={current}
        playing={playing}
        setPlaying={setPlaying}
        progress={progress}
        setProgress={setProgress}
        duration={duration}
        setDuration={setDuration}
        volume={volume}
        setVolume={setVolume}
        port={port}
        onPrev={prev}
        onNext={() => next()}
        onEnded={onEnded}
        onLike={() => current && toggleLike(current)}
        mode={mode}
        setMode={setMode}
        miniOpen={miniOpen}
        lyricsOpen={lyricsOpen}
        onToggleMini={() => window.api.window.toggleMini()}
        onToggleLyrics={() => window.api.window.toggleLyrics()}
      />
    </div>
  );
}

export { fmt };
