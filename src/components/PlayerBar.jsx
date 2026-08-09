import React, { useEffect, useRef, useState } from "react";
import { Button, Slider, Tooltip } from "antd";
import { fmt } from "../App.jsx";
import Cover from "./Cover.jsx";

const MODES = [
  { id: "order", icon: "▶", title: "顺序播放" },
  { id: "list-loop", icon: "🔁", title: "列表循环" },
  { id: "single-loop", icon: "🔂", title: "单曲循环" },
  { id: "shuffle", icon: "🔀", title: "随机播放" },
];

export default function PlayerBar({
  audioRef, current, playing, setPlaying, progress, setProgress, duration, setDuration,
  volume, setVolume, port, onPrev, onNext, onEnded, onLike,
  mode, setMode, miniOpen, lyricsOpen, onToggleMini, onToggleLyrics,
}) {
  const [loaded, setLoaded] = useState(false);
  const dragging = useRef(false);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  useEffect(() => {
    if (!current) return;
    const a = audioRef.current;
    setLoaded(false);
    a.src = `http://127.0.0.1:${port}/stream?p=${encodeURIComponent(current.path)}`;
    a.play().then(() => setPlaying(true)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, port]);

  useEffect(() => {
    const a = audioRef.current;
    const onTime = () => !dragging.current && setProgress(a.currentTime);
    const onDur = () => setDuration(a.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onCanPlay = () => setLoaded(true);
    const onErr = () => setLoaded(false);
    // 始终调用最新的 onEnded，避免闭包停留在首次渲染的空队列
    const onAudioEnded = () => endedRef.current?.();
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("canplay", onCanPlay);
    a.addEventListener("error", onErr);
    a.addEventListener("ended", onAudioEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("canplay", onCanPlay);
      a.removeEventListener("error", onErr);
      a.removeEventListener("ended", onAudioEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, audioRef]);

  const curMode = MODES.find((m) => m.id === mode) || MODES[1];

  const togglePlay = () => {
    const a = audioRef.current;
    if (!current) return;
    if (a.paused) a.play();
    else a.pause();
  };

  return (
    <div className="player-bar">
      <audio ref={audioRef} />
      {current ? (
        <Cover track={current} port={port} size={52} />
      ) : (
        <div className="pb-cover-ph" style={{ background: "#e6e6e9", color: "#b6afbc" }}>♪</div>
      )}
      <div className="pb-info">
        <div className="pb-title">{current ? current.title : "未在播放"}</div>
        <div className="pb-artist">{current ? `${current.artist} · ${current.album}` : "从曲库选择一首歌开始"}</div>
      </div>
      <button
        className="pb-heart"
        title={current?.liked ? "取消喜欢" : "我喜欢"}
        onClick={onLike}
        disabled={!current}
        style={{
          background: "none",
          border: "none",
          cursor: current ? "pointer" : "default",
          fontSize: 16,
          color: current?.liked ? "#e0607c" : "var(--faint)",
          flexShrink: 0,
          padding: 4,
        }}
      >
        {current?.liked ? "♥" : "♡"}
      </button>
      <div className="pb-controls">
        <Tooltip title={`播放模式：${curMode.title}（点击切换）`}>
          <Button
            type="text"
            style={{ fontSize: 15, color: "var(--dim)" }}
            onClick={() => {
              const idx = MODES.findIndex((m) => m.id === mode);
              setMode(MODES[(idx + 1) % MODES.length].id);
            }}
          >
            {curMode.icon}
          </Button>
        </Tooltip>
        <Tooltip title="上一首">
          <Button type="text" style={{ fontSize: 15, color: "var(--dim)" }} onClick={onPrev}>⏮</Button>
        </Tooltip>
        <Button
          type="primary"
          shape="circle"
          style={{ width: 40, height: 40 }}
          onClick={togglePlay}
        >
          {playing ? "❚❚" : "▶"}
        </Button>
        <Tooltip title="下一首">
          <Button type="text" style={{ fontSize: 15, color: "var(--dim)" }} onClick={onNext}>⏭</Button>
        </Tooltip>
      </div>
      <div className="pb-progress">
        <span className="pb-time">{fmt(progress)}</span>
        <Slider
          min={0}
          max={Math.max(duration, 1)}
          step={0.5}
          value={Math.min(progress, Math.max(duration, 1))}
          tooltip={{ formatter: null }}
          onChange={(v) => {
            dragging.current = true;
            setProgress(v);
            if (audioRef.current) audioRef.current.currentTime = v;
          }}
          onChangeComplete={() => (dragging.current = false)}
          disabled={!current}
          style={{ flex: 1, margin: "0 4px" }}
        />
        <span className="pb-time">{fmt(duration)}</span>
      </div>
      <div className="pb-volume">
        <span className="ico" style={{ fontSize: 13 }}>{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={setVolume}
          style={{ width: 76, margin: "0 4px", flex: "none" }}
        />
      </div>
      <div className="pb-side">
        <Tooltip title={lyricsOpen ? "关闭桌面歌词" : "桌面歌词"}>
          <Button
            type="text"
            style={{ color: lyricsOpen ? "var(--accent)" : "var(--dim)", fontSize: 15 }}
            onClick={onToggleLyrics}
          >
            ♪
          </Button>
        </Tooltip>
        <Tooltip title={miniOpen ? "关闭小窗" : "小窗模式"}>
          <Button
            type="text"
            style={{ color: miniOpen ? "var(--accent)" : "var(--dim)", fontSize: 15 }}
            onClick={onToggleMini}
          >
            ⛶
          </Button>
        </Tooltip>
      </div>
      {!loaded && current && (
        <span style={{ color: "var(--faint)", fontSize: 11, width: 36, flexShrink: 0 }}>加载…</span>
      )}
    </div>
  );
}
