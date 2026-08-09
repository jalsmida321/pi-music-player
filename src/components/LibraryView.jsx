import React, { useMemo, useState } from "react";
import { Button, Dropdown, Input, message, Tag, Tooltip } from "antd";
import { HeartFilled, HeartOutlined } from "@ant-design/icons";
import { fmt } from "../App.jsx";
import Cover from "./Cover.jsx";

export default function LibraryView({
  tracks, playlists, current, playing, port, onPlay, onRefresh,
  title = "曲库", subtitle, filterDesc, onClearFilter, onToggleLike,
}) {
  const [q, setQ] = useState("");
  const [filling, setFilling] = useState(false);

  const list = useMemo(() => {
    if (!q.trim()) return tracks;
    const s = q.trim().toLowerCase();
    return tracks.filter((t) =>
      [t.title, t.artist, t.album, t.genre, t.year, (t.tags || []).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(s)
    );
  }, [tracks, q]);

  const missing = tracks.filter((t) => !t.coverId).length;

  const fillCovers = async () => {
    if (filling) return;
    setFilling(true);
    const missingTracks = tracks.filter((t) => !t.coverId).slice(0, 30);
    let done = 0;
    for (const t of missingTracks) {
      const r = await window.api.cover.fetch(t);
      if (r.ok) done++;
      await new Promise((res) => setTimeout(res, 250));
    }
    setFilling(false);
    onRefresh();
    message.success(done > 0 ? `已补全 ${done} 首封面` : "没有找到更多封面");
  };

  const like = async (t) => {
    await window.api.library.toggleLike(t.id);
    onRefresh();
  };

  const addToPlaylist = async (plId, trackId) => {
    await window.api.playlist.addTracks(plId, [trackId]);
    onRefresh();
    message.success("已加入歌单");
  };

  const rowMenu = (track) => ({
    items: [
      { key: "play", label: "立即播放" },
      { key: "like", label: track.liked ? "取消喜欢" : "我喜欢" },
      { type: "divider" },
      ...playlists.map((p) => ({ key: "pl_" + p.id, label: `加入歌单：${p.name}` })),
    ],
    onClick: ({ key }) => {
      if (key === "play") onPlay(track.id);
      else if (key === "like") like(track);
      else if (key.startsWith("pl_")) addToPlaylist(key.slice(3), track.id);
    },
  });

  return (
    <div className="view">
      <div className="view-title">
        {title}
        {filterDesc && (
          <Tag
            closable
            color="cyan"
            onClose={onClearFilter}
            style={{ marginLeft: 10, verticalAlign: 3, fontSize: 12 }}
          >
            {filterDesc}
          </Tag>
        )}
      </div>
      <div className="view-sub">{subtitle ?? `${tracks.length} 首歌曲 · 双击播放 · 右键更多操作`}</div>
      <div className="toolbar">
        <Input
          className="searchbar"
          placeholder="搜索歌曲 / 艺人 / 专辑 / 风格 / 标签…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          allowClear
          style={{ width: 320, marginBottom: 0 }}
        />
        <Button onClick={onRefresh}>刷新</Button>
        <Button type="primary" onClick={fillCovers} loading={filling}>
          补全封面
        </Button>
        {missing > 0 && <span style={{ color: "var(--faint)", fontSize: 12 }}>还有 {missing} 首缺封面</span>}
      </div>
      <div className="tracks-wrap">
        {list.length === 0 ? (
          <div className="empty">
            {tracks.length === 0
              ? "曲库为空\n点击左侧「＋ 添加文件夹」导入你的音乐"
              : "没有匹配的歌曲"}
          </div>
        ) : (
          <table className="tracks">
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th style={{ width: 30 }}></th>
                <th style={{ width: 34 }}>#</th>
                <th>标题</th>
                <th style={{ width: "20%" }}>艺人</th>
                <th style={{ width: "18%" }}>专辑</th>
                <th style={{ width: "14%" }}>标签</th>
                <th style={{ width: 56 }}>时长</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t, i) => (
                <Dropdown key={t.id} menu={rowMenu(t)} trigger={["contextMenu"]}>
                  <tr
                    className={"track" + (current?.id === t.id ? " playing" : "")}
                    onDoubleClick={() => onPlay(t.id)}
                  >
                    <td className="t-cover">
                      <Cover track={t} port={port} size={30} />
                    </td>
                    <td className="t-like" onClick={(e) => { e.stopPropagation(); like(t); }}>
                      <Tooltip title={t.liked ? "取消喜欢" : "我喜欢"}>
                        {t.liked ? (
                          <HeartFilled style={{ color: "#e0607c", fontSize: 13 }} />
                        ) : (
                          <HeartOutlined style={{ color: "var(--faint)", fontSize: 13 }} />
                        )}
                      </Tooltip>
                    </td>
                    <td className="t-num">{current?.id === t.id && playing ? "▶" : i + 1}</td>
                    <td className="t-title">{t.title}</td>
                    <td className="t-dim">{t.artist}</td>
                    <td className="t-dim">{t.album}</td>
                    <td className="t-tags">
                      {(t.tags || []).slice(0, 3).map((g) => (
                        <span key={g}>{g}</span>
                      ))}
                    </td>
                    <td className="t-dur">{fmt(t.duration)}</td>
                  </tr>
                </Dropdown>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
