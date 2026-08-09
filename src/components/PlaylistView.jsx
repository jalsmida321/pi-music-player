import React, { useState } from "react";
import { Button, Input, Modal, Popconfirm, message } from "antd";
import { fmt } from "../App.jsx";

export default function PlaylistView({ tracks, playlists, current, playing, port, onPlay, onRefresh, selectedId }) {
  const [sel, setSel] = useState(selectedId || playlists[0]?.id || null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null); // 正在重命名的歌单 id
  const [renameVal, setRenameVal] = useState("");

  const pl = playlists.find((p) => p.id === sel);
  const list = (pl ? pl.trackIds : [])
    .map((id) => tracks.find((t) => t.id === id))
    .filter(Boolean);

  const create = async () => {
    if (!newName.trim()) return;
    const p = await window.api.playlist.create(newName.trim());
    setNewName("");
    setSel(p.id);
    onRefresh();
    message.success(`已创建歌单「${p.name}」`);
  };

  const del = async (p) => {
    await window.api.playlist.delete(p.id);
    onRefresh();
    message.success(`已删除歌单「${p.name}」`);
    setSel(null);
  };

  const rename = async () => {
    if (!renameVal.trim()) return;
    await window.api.playlist.rename(renaming, renameVal.trim());
    setRenaming(null);
    onRefresh();
    message.success("已重命名");
  };

  return (
    <div className="view">
      <div className="view-title">歌单</div>
      <div className="view-sub">右键歌曲可从歌单移除 · 悬停歌单可重命名/删除</div>
      <div className="toolbar">
        <Input
          style={{ width: 220, marginBottom: 0 }}
          placeholder="新建歌单名称…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={create}
        />
        <Button type="primary" onClick={create}>新建</Button>
      </div>
      <div style={{ display: "flex", gap: 14, flex: 1, minHeight: 0 }}>
        <div style={{ width: 200, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {playlists.length === 0 && <div className="empty" style={{ padding: "20px 0", fontSize: 12 }}>还没有歌单</div>}
          {playlists.map((p) => (
            <div key={p.id} className="pl-row-wrap" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div
                className="nav-item"
                style={{ fontSize: 12.5, padding: "8px 11px", flex: 1, minWidth: 0 }}
                onClick={() => setSel(p.id)}
              >
                <span style={{ color: "var(--accent)", flexShrink: 0 }}>♪</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--faint)", fontSize: 11, flexShrink: 0 }}>{p.trackIds.length}</span>
              </div>
              <div className="pl-ops" style={{ display: "none", gap: 2, flexShrink: 0 }}>
                <Button
                  size="small"
                  type="text"
                  title="重命名"
                  onClick={() => { setRenaming(p.id); setRenameVal(p.name); }}
                >
                  ✎
                </Button>
                <Popconfirm title={`删除歌单「${p.name}」？`} onConfirm={() => del(p)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                  <Button size="small" type="text" title="删除" style={{ color: "var(--danger)" }}>✕</Button>
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
        <div className="tracks-wrap" style={{ flex: 1 }}>
          {!pl ? (
            <div className="empty">选择一个歌单</div>
          ) : list.length === 0 ? (
            <div className="empty">这个歌单还是空的</div>
          ) : (
            <table className="tracks">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th>标题</th>
                  <th style={{ width: "24%" }}>艺人</th>
                  <th style={{ width: "24%" }}>专辑</th>
                  <th style={{ width: 56 }}>时长</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t, i) => (
                  <tr
                    key={t.id}
                    className={"track" + (current?.id === t.id ? " playing" : "")}
                    onDoubleClick={() => onPlay(list, t.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      window.api.playlist.removeTracks(pl.id, [t.id]).then(() => { onRefresh(); message.success("已移除"); });
                    }}
                  >
                    <td className="t-num">{current?.id === t.id && playing ? "▶" : i + 1}</td>
                    <td className="t-title">{t.title}</td>
                    <td className="t-dim">{t.artist}</td>
                    <td className="t-dim">{t.album}</td>
                    <td className="t-dur">{fmt(t.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <Modal
        open={!!renaming}
        title="重命名歌单"
        onCancel={() => setRenaming(null)}
        onOk={rename}
        okText="保存"
        cancelText="取消"
        width={360}
      >
        <Input
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onPressEnter={rename}
          autoFocus
          placeholder="新名称"
        />
      </Modal>
    </div>
  );
}
