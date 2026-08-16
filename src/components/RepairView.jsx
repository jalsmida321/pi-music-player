import React, { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Progress, Segmented, message } from "antd";
import { FileImageOutlined, FileTextOutlined, ReloadOutlined, ToolOutlined } from "@ant-design/icons";
import Cover from "./Cover.jsx";
import { fmt } from "../App.jsx";

const isUnknown = (value, kind) => {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === `未知${kind}` || text === "unknown" || text === "unknown artist" || text === "unknown album";
};

export default function RepairView({ tracks, port, onRefresh }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState([]);
  const [running, setRunning] = useState(false);
  const [inspecting, setInspecting] = useState(true);
  const [lyricsStatus, setLyricsStatus] = useState({});
  const [progress, setProgress] = useState({ done: 0, total: 0, covers: 0, lyrics: 0 });

  const inspect = async () => {
    setInspecting(true);
    setLyricsStatus(await window.api.repair.inspect());
    setInspecting(false);
  };
  useEffect(() => {
    inspect();
  }, [tracks]);

  const issues = useMemo(() => tracks.map((track) => ({
    track,
    cover: !track.coverId,
    lyrics: !lyricsStatus[track.id] || lyricsStatus[track.id] === "missing" || lyricsStatus[track.id] === "notfound",
    metadata: isUnknown(track.artist, "艺人") || isUnknown(track.album, "专辑"),
  })).filter((item) => item.cover || item.lyrics || item.metadata), [tracks, lyricsStatus]);

  const visible = issues.filter((item) => filter === "all" || item[filter]);
  const counts = {
    all: issues.length,
    cover: issues.filter((item) => item.cover).length,
    lyrics: issues.filter((item) => item.lyrics).length,
    metadata: issues.filter((item) => item.metadata).length,
  };

  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.includes(item.track.id));

  const repair = async (ids) => {
    const targets = issues.filter((item) => ids.includes(item.track.id) && (item.cover || item.lyrics));
    if (!targets.length || running) return;
    setRunning(true);
    setProgress({ done: 0, total: targets.length, covers: 0, lyrics: 0 });
    let covers = 0;
    let lyrics = 0;
    for (let index = 0; index < targets.length; index++) {
      const item = targets[index];
      const result = await window.api.repair.track(item.track.id);
      if (result.coverAdded) covers++;
      if (result.lyricsAdded) lyrics++;
      setProgress({ done: index + 1, total: targets.length, covers, lyrics });
    }
    setRunning(false);
    setSelected([]);
    await onRefresh();
    await inspect();
    message.success(`修复完成：封面 ${covers} 首，歌词 ${lyrics} 首`);
  };

  return (
    <div className="view repair-view">
      <div className="view-title">唱片修复台</div>
      <div className="view-sub">补全封面和歌词，标记需要人工确认的元数据；不会改写原音乐文件</div>

      <div className="repair-summary">
        <div><FileImageOutlined /><strong>{counts.cover}</strong><span>缺少封面</span></div>
        <div><FileTextOutlined /><strong>{counts.lyrics}</strong><span>未缓存歌词</span></div>
        <div><ToolOutlined /><strong>{counts.metadata}</strong><span>元数据待整理</span></div>
      </div>

      <div className="toolbar repair-toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { label: `全部 ${counts.all}`, value: "all" },
            { label: `封面 ${counts.cover}`, value: "cover" },
            { label: `歌词 ${counts.lyrics}`, value: "lyrics" },
            { label: `元数据 ${counts.metadata}`, value: "metadata" },
          ]}
        />
        <Button
          icon={<ReloadOutlined />}
          type="primary"
          disabled={!selected.some((id) => issues.some((item) => item.track.id === id && (item.cover || item.lyrics))) || running}
          loading={running}
          onClick={() => repair(selected)}
        >
          修复所选 {selected.length || ""}
        </Button>
        <Button disabled={!visible.some((item) => item.cover || item.lyrics) || running} onClick={() => repair(visible.map((item) => item.track.id))}>
          修复当前列表
        </Button>
      </div>

      {running && (
        <div className="repair-progress">
          <Progress percent={Math.round((progress.done / Math.max(1, progress.total)) * 100)} size="small" />
          <span>{progress.done}/{progress.total} · 封面 {progress.covers} · 歌词 {progress.lyrics}</span>
        </div>
      )}

      <div className="tracks-wrap">
        {inspecting ? (
          <div className="empty">正在检查本地歌词与缓存…</div>
        ) : visible.length === 0 ? (
          <div className="empty">当前分类没有需要处理的歌曲</div>
        ) : (
          <table className="tracks">
            <thead>
              <tr>
                <th style={{ width: 42 }}>
                  <Checkbox
                    checked={allVisibleSelected}
                    indeterminate={visible.some((item) => selected.includes(item.track.id)) && !allVisibleSelected}
                    onChange={() => setSelected(allVisibleSelected ? selected.filter((id) => !visible.some((item) => item.track.id === id)) : [...new Set([...selected, ...visible.map((item) => item.track.id)])])}
                  />
                </th>
                <th style={{ width: 48 }}></th>
                <th>歌曲</th>
                <th style={{ width: "22%" }}>艺人</th>
                <th style={{ width: "25%" }}>需要处理</th>
                <th style={{ width: 62 }}>时长</th>
                <th style={{ width: 78 }}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr className="track" key={item.track.id}>
                  <td><Checkbox checked={selected.includes(item.track.id)} onChange={() => toggle(item.track.id)} /></td>
                  <td><Cover track={item.track} port={port} size={32} /></td>
                  <td className="t-title">{item.track.title}</td>
                  <td className="t-dim">{item.track.artist}</td>
                  <td className="repair-issues">
                    {item.cover && <span>封面</span>}
                    {item.lyrics && <span>歌词</span>}
                    {item.metadata && <span className="manual">元数据需确认</span>}
                  </td>
                  <td className="t-dur">{fmt(item.track.duration)}</td>
                  <td>
                    {item.cover || item.lyrics ? (
                      <Button size="small" disabled={running} onClick={() => repair([item.track.id])}>修复</Button>
                    ) : (
                      <span className="repair-manual-label">人工确认</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
