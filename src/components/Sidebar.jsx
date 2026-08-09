import React from "react";

const ICONS = { library: "♪", playlists: "▤", chat: "✦", settings: "⚙" };

export default function Sidebar({ view, setView, folders, scanning, onAddFolder, onRemoveFolder, playlistCount }) {
  const navs = [
    { id: "library", label: "曲库" },
    { id: "playlists", label: "歌单" + (playlistCount ? ` ${playlistCount}` : "") },
    { id: "chat", label: "AI 助手" },
    { id: "settings", label: "设置" },
  ];
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">π</div>
        <div>
          <div className="logo-name">PI Music</div>
          <div className="logo-sub">本地智能播放器</div>
        </div>
      </div>
      {navs.map((n) => (
        <div
          key={n.id}
          className={"nav-item" + (view === n.id ? " active" : "")}
          onClick={() => setView(n.id)}
        >
          <span className="nav-ico">{ICONS[n.id]}</span>
          {n.label}
        </div>
      ))}
      <div className="side-sep" />
      <div className="side-label">音乐文件夹</div>
      {folders.map((f) => (
        <div key={f} className="folder-item" title={f}>
          📁 {f.replace(/\\/g, "/").split("/").slice(-2).join("/")}
          <span
            className="x"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`移除文件夹？\n${f}\n（仅从曲库移除，不删除文件）`)) onRemoveFolder(f);
            }}
          >
            ✕
          </span>
        </div>
      ))}
      <div className="folder-item" onClick={onAddFolder}>
        {scanning ? "⏳ 扫描中…" : "＋ 添加文件夹"}
      </div>
    </aside>
  );
}
