import React, { useMemo } from "react";
import Cover from "./Cover.jsx";

// 艺人视图：按艺人分组的卡片网格
export function ArtistsView({ tracks, port, onPick }) {
  const artists = useMemo(() => {
    const map = new Map();
    for (const t of tracks) {
      if (!map.has(t.artist)) map.set(t.artist, { name: t.artist, count: 0, coverId: null, coverExt: null });
      const a = map.get(t.artist);
      a.count++;
      if (!a.coverId && t.coverId) {
        a.coverId = t.coverId;
        a.coverExt = t.coverExt;
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [tracks]);

  return (
    <div className="grid-view">
      {artists.map((a) => (
        <div key={a.name} className="grid-card" onClick={() => onPick(a.name)} title={a.name}>
          <Cover track={a} port={port} size={92} rounded={0.5} />
          <div className="grid-name">{a.name}</div>
          <div className="grid-sub">{a.count} 首</div>
        </div>
      ))}
      {artists.length === 0 && <div className="empty">曲库为空</div>}
    </div>
  );
}

// 专辑视图：按专辑分组的卡片网格
export function AlbumsView({ tracks, port, onPick }) {
  const albums = useMemo(() => {
    const map = new Map();
    for (const t of tracks) {
      const key = t.album || "未知专辑";
      if (!map.has(key)) map.set(key, { name: key, artist: t.artist, count: 0, coverId: null, coverExt: null });
      const a = map.get(key);
      a.count++;
      if (!a.coverId && t.coverId) {
        a.coverId = t.coverId;
        a.coverExt = t.coverExt;
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [tracks]);

  return (
    <div className="grid-view">
      {albums.map((a) => (
        <div key={a.name} className="grid-card" onClick={() => onPick(a.name)} title={a.name}>
          <Cover track={a} port={port} size={92} rounded={0.5} />
          <div className="grid-name">{a.name}</div>
          <div className="grid-sub">{a.artist} · {a.count} 首</div>
        </div>
      ))}
      {albums.length === 0 && <div className="empty">曲库为空</div>}
    </div>
  );
}
