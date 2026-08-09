import React, { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Space, Alert, message, Tag, List } from "antd";
import { AudioOutlined, PlayCircleOutlined } from "@ant-design/icons";

const CHIPS = [
  "帮我整理一下曲库：按风格自动分桶建歌单",
  "检测一下有没有重复的歌曲",
  "给我看看曲库统计",
  "推荐一个今晚放松听的歌单",
  "空耳找歌：我只记得一段歌词，帮我找歌",
];

// 录音 → 8kHz 单声道 WAV（ACRCloud 哼唱识别要求）
async function webmToWav8k(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await ctx.decodeAudioData(buf);
  const rate = 8000;
  const len = Math.max(1, Math.round(audio.duration * rate));
  const off = new OfflineAudioContext(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const data = rendered.getChannelData(0);
  const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) pcm[i] = Math.max(-1, Math.min(1, data[i])) * 0x7fff;
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ws(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return buffer;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[\s·・,，.。!！?？'"()（）[\]【】\-_—]/g, "");

// 工具结果卡片：歌单 / 候选歌曲 / 曲库歌曲
export function ResultCard({ kind, data, tracks, onPlayTracks, onPlayTrack, onOpenPlaylists }) {
  if (kind === "playlist" && data) {
    const list = (data.tracks || []).map((x) => x.id).map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
    return (
      <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", maxWidth: 480 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>📑 歌单已创建：{data.name}</div>
        <div style={{ color: "var(--dim)", fontSize: 12, marginBottom: 8 }}>匹配 {data.matched} 首{list.length ? `（本地 ${list.length} 首）` : ""}</div>
        <Space>
          <Button size="small" type="primary" icon={<PlayCircleOutlined />} disabled={!list.length} onClick={() => onPlayTracks(list)}>
            播放歌单
          </Button>
          <Button size="small" onClick={onOpenPlaylists}>去歌单查看</Button>
        </Space>
      </div>
    );
  }
  if (kind === "songs" && Array.isArray(data)) {
    return (
      <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", maxWidth: 520 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>🔎 候选歌曲（来自网易云）</div>
        <List
          size="small"
          dataSource={data.slice(0, 6)}
          renderItem={(s) => {
            const local = tracks.find(
              (t) => norm(t.title) === norm(s.title) && norm(t.artist) === norm((s.artists || [])[0])
            );
            return (
              <List.Item style={{ padding: "6px 0" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.title}
                  </div>
                  <div style={{ color: "var(--dim)", fontSize: 12 }}>
                    {(s.artists || []).join(" / ")}
                    {s.album ? ` · 《${s.album}》` : ""}
                  </div>
                </div>
                {local ? (
                  <Space>
                    <Tag color="cyan" style={{ marginRight: 0 }}>曲库已有</Tag>
                    <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={() => onPlayTrack(local.id)}>
                      播放
                    </Button>
                  </Space>
                ) : (
                  <Tag style={{ marginRight: 0 }}>本地无此曲</Tag>
                )}
              </List.Item>
            );
          }}
        />
      </div>
    );
  }
  if (kind === "tracks" && Array.isArray(data)) {
    return (
      <div style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", maxWidth: 520 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>🎵 曲库匹配结果</div>
        <List
          size="small"
          dataSource={data.slice(0, 8)}
          renderItem={(t) => (
            <List.Item style={{ padding: "6px 0" }}>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ fontWeight: 500 }}>{t.title}</span>
                <span style={{ color: "var(--dim)", fontSize: 12 }}> · {t.artist}</span>
              </div>
              <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={() => onPlayTrack(t.id)}>
                播放
              </Button>
            </List.Item>
          )}
        />
      </div>
    );
  }
  return null;
}

export default function ChatView({ tracks, onPlaylistCreated, onPlayTracks, onPlayTrack, onOpenPlaylists }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  // AI 修改应用 → 用户确认
  const [confirm, setConfirm] = useState(null); // {id, toolName, input}
  // 修改完成 → 重启横幅
  const [modifyDone, setModifyDone] = useState(null); // message
  // 哼唱识别
  const [humOpen, setHumOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [humBusy, setHumBusy] = useState(false);
  const [humResult, setHumResult] = useState(null);
  const [humError, setHumError] = useState(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const stopTimerRef = useRef(null);

  useEffect(() => {
    // 恢复历史会话
    window.api.agent.history().then((h) => {
      if (Array.isArray(h) && h.length > 0) {
        setMsgs(h.map((m) => ({ role: m.role, text: m.text })));
      }
    });
    window.api.agent.onEvent((ev) => {
      if (ev.type === "delta") {
        setMsgs((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            last.text += ev.text;
          } else {
            copy.push({ role: "assistant", text: ev.text, streaming: true });
          }
          return copy;
        });
      } else if (ev.type === "tool") {
        setMsgs((m) => [...m, { role: "tool", text: `正在调用工具：${ev.tool}…` }]);
      } else if (ev.type === "tool_end") {
        // 工具结果 → 可点击卡片
        if (ev.tool === "create_playlist" && ev.data) {
          setMsgs((m) => [...m, { role: "card", kind: "playlist", data: ev.data }]);
        } else if (ev.tool === "find_song_by_ear" && Array.isArray(ev.data)) {
          setMsgs((m) => [...m, { role: "card", kind: "songs", data: ev.data }]);
        } else if (ev.tool === "search_music" && Array.isArray(ev.data)) {
          setMsgs((m) => [...m, { role: "card", kind: "tracks", data: ev.data }]);
        }
      } else if (ev.type === "message_end") {
        setMsgs((m) => m.map((x) => (x.streaming ? { ...x, streaming: false } : x)));
      } else if (ev.type === "modify_done") {
        setModifyDone(ev.message || "修改完成");
      }
    });
    window.api.confirm.onRequest((d) => setConfirm(d));
    return () => {};
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setBusy(true);
    const r = await window.api.agent.chat(t);
    if (!r.ok) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: "⚠️ " + (r.error || "调用失败，请检查设置里的 API 配置") },
      ]);
    }
    setBusy(false);
    onPlaylistCreated();
  };

  // ---- 哼唱识别 ----
  const startRec = async () => {
    setHumError(null);
    setHumResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 20000) {
          setHumError("录音太短，请哼 10 秒以上");
          return;
        }
        setHumBusy(true);
        try {
          const wav = await webmToWav8k(blob);
          const r = await window.api.hum.identify(wav);
          if (r.ok) setHumResult(r.result);
          else setHumError(r.error || "识别失败");
        } catch (e) {
          setHumError("录音处理失败：" + String(e.message || e));
        }
        setHumBusy(false);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      stopTimerRef.current = setTimeout(() => rec.stop(), 20000); // 最长 20 秒
    } catch {
      setHumError("无法访问麦克风，请检查权限");
    }
  };
  const stopRec = () => {
    clearTimeout(stopTimerRef.current);
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };

  return (
    <div className="view">
      <div className="view-title">AI 助手</div>
      <div className="view-sub">
        基于 pi 框架 · 你的 API Key · 可以帮你整理曲库，也能按你的反馈修改应用本身
      </div>
      {modifyDone && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message="应用已修改并构建完成"
          description={modifyDone}
          action={
            <Space>
              <Button size="small" onClick={() => window.api.app.restart()}>
                重启应用生效
              </Button>
              <Button size="small" onClick={() => setModifyDone(null)}>
                稍后
              </Button>
            </Space>
          }
        />
      )}
      <div className="chat-wrap">
        <div className="chips">
          {CHIPS.map((c) => (
            <button key={c} className="chip" onClick={() => send(c)} disabled={busy}>
              {c}
            </button>
          ))}
          <button className="chip" onClick={() => setHumOpen(true)} disabled={busy} style={{ color: "var(--accent-deep)" }}>
            🎤 哼唱找歌
          </button>
        </div>
        <div className="chat-msgs">
          {msgs.length === 0 && (
            <div className="empty" style={{ padding: "40px 0" }}>
              试试：<br />「把周杰伦的慢歌整理成一个歌单」
              <br />「这个播放器界面我不太满意，帮我改成圆角大一点的风格」
              <br />「我只记得歌词是 戴森球，帮我找歌」
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "tool" ? (
              <div key={i} className="msg-tool">
                <span className="spin" />
                {m.text}
              </div>
            ) : m.role === "card" ? (
              <div key={i} style={{ alignSelf: "flex-start", paddingLeft: 38 }}>
                <ResultCard
                  kind={m.kind}
                  data={m.data}
                  tracks={tracks}
                  onPlayTracks={onPlayTracks}
                  onPlayTrack={onPlayTrack}
                  onOpenPlaylists={onOpenPlaylists}
                />
              </div>
            ) : (
              <div key={i} className={"msg " + m.role}>
                <div className="msg-avatar">{m.role === "user" ? "我" : "π"}</div>
                <div className="msg-bubble">
                  {m.text}
                  {m.streaming && <span style={{ opacity: 0.5 }}>▍</span>}
                </div>
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>
        <div className="chat-input-row">
          <Input.TextArea
            className="chat-input"
            placeholder="用一句话管理音乐库，或告诉 AI 你想改什么…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
            autoSize={{ minRows: 1, maxRows: 4 }}
          />
          <Button type="primary" onClick={() => send()} disabled={busy} style={{ alignSelf: "flex-end" }}>
            {busy ? "生成中…" : "发送"}
          </Button>
          {busy && (
            <Button style={{ alignSelf: "flex-end" }} onClick={() => window.api.agent.abort()}>
              停止
            </Button>
          )}
        </div>
      </div>

      {/* AI 修改确认 */}
      <Modal
        open={!!confirm}
        title="AI 请求修改应用"
        width={640}
        onCancel={() => {
          if (confirm) window.api.confirm.respond(confirm.id, false);
          setConfirm(null);
        }}
        footer={
          <Space>
            <Button
              onClick={() => {
                window.api.confirm.respond(confirm.id, false);
                setConfirm(null);
                message.info("已拒绝本次修改");
              }}
            >
              拒绝
            </Button>
            <Button
              type="primary"
              danger
              onClick={() => {
                window.api.confirm.respond(confirm.id, true);
                setConfirm(null);
              }}
            >
              允许修改
            </Button>
          </Space>
        }
      >
        {confirm && (
          <div>
            <p style={{ color: "var(--dim)", marginBottom: 8 }}>
              AI 要执行 <Tag color="cyan">{confirm.toolName}</Tag> 操作，请确认：
            </p>
            <pre
              style={{
                background: "var(--panel2)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
                maxHeight: 240,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                color: "var(--text)",
              }}
            >
              {JSON.stringify(confirm.input, null, 2)}
            </pre>
            <p style={{ color: "var(--faint)", fontSize: 12, marginTop: 8 }}>
              允许后 AI 会直接修改本应用源码并重新构建，请仔细查看上面内容
            </p>
          </div>
        )}
      </Modal>

      {/* 哼唱识别 */}
      <Modal
        open={humOpen}
        title="🎤 哼唱找歌"
        onCancel={() => setHumOpen(false)}
        footer={null}
      >
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          {!recording && !humBusy && (
            <Button type="primary" size="large" icon={<AudioOutlined />} onClick={startRec}>
              开始录音（哼 10 秒以上效果更好）
            </Button>
          )}
          {recording && (
            <Space direction="vertical" size={12}>
              <Tag color="red" style={{ fontSize: 13 }}>● 录音中… 最长 20 秒</Tag>
              <Button danger onClick={stopRec}>停止并识别</Button>
            </Space>
          )}
          {humBusy && <Tag color="processing" style={{ fontSize: 13 }}>识别中…</Tag>}
          {humResult && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>🎵 {humResult.title}</div>
              <div style={{ color: "var(--dim)" }}>
                {humResult.artists.join(" / ")}
                {humResult.album ? ` · 《${humResult.album}》` : ""}
              </div>
              {humResult.score && (
                <div style={{ color: "var(--faint)", fontSize: 12, marginTop: 4 }}>
                  匹配度 {(humResult.score * 100).toFixed(1)}%
                </div>
              )}
            </div>
          )}
          {humError && (
            <div style={{ color: "var(--danger)", marginTop: 12, marginBottom: 8 }}>{humError}</div>
          )}
          {humError && (
            <Button
              size="small"
              onClick={async () => {
                const dir = await window.api.hum.debugDir();
                if (dir) window.api.app.openPath(dir);
              }}
            >
              📁 打开调试目录
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
