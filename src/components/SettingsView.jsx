import React, { useEffect, useState } from "react";
import { Button, Input, Switch, message, Tag } from "antd";

export default function SettingsView() {
  const [cfg, setCfg] = useState({ baseUrl: "", apiKey: "", modelId: "" });
  const [settings, setSettings] = useState({ selfModify: true, acr: { accessKey: "", accessSecret: "" } });
  const [status, setStatus] = useState({ state: "idle", text: "" });
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [appInfo, setAppInfo] = useState({ isPackaged: false, version: "" });

  useEffect(() => {
    window.api.app.info().then(setAppInfo);
    window.api.agent.getConfig().then((c) => {
      if (c) setCfg({ baseUrl: c.baseUrl || "", apiKey: c.apiKey || "", modelId: c.modelId || "" });
      setLoaded(true);
    });
    window.api.settings.get().then((s) => {
      if (s) setSettings({ selfModify: !!s.selfModify, acr: { host: s.acr?.host || "", accessKey: s.acr?.accessKey || "", accessSecret: s.acr?.accessSecret || "" } });
    });
  }, []);

  const save = async () => {
    setStatus({ state: "busy", text: "正在保存并初始化模型…" });
    const r = await window.api.agent.configure(cfg);
    if (r.ok) setStatus({ state: "ok", text: "配置已保存，AI 助手已就绪" });
    else setStatus({ state: "err", text: r.error });
  };

  const test = async () => {
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.modelId) {
      setStatus({ state: "err", text: "请先填写完整配置" });
      return;
    }
    setTesting(true);
    setStatus({ state: "busy", text: "测试连接中…" });
    const r = await window.api.agent.configure(cfg);
    if (!r.ok) {
      setStatus({ state: "err", text: "连接失败：" + r.error });
      setTesting(false);
      return;
    }
    const chat = await window.api.agent.chat("请只回复两个字：正常");
    setTesting(false);
    if (chat.ok) setStatus({ state: "ok", text: "✅ 连接成功，模型可以正常回复" });
    else setStatus({ state: "err", text: "模型回复失败：" + (chat.error || "") });
  };

  const saveSettings = async () => {
    const s = await window.api.settings.set(settings);
    setSettings(s);
    message.success("已保存（自我修改开关下次对话生效）");
  };

  return (
    <div className="view">
      <div className="view-title">设置</div>
      <div className="view-sub">数据全部保存在本地 · 模型由你自己的 API Key 驱动</div>
      <div className="settings">
        <div className="set-card">
          <h3>大模型接入（BYOK）</h3>
          <div className="desc">
            填入任意 <b>OpenAI 兼容</b> 的 API 地址。支持 DeepSeek、通义千问、Kimi、智谱、Ollama 本地模型等。
          </div>
          <div className="form-row">
            <label>Base URL</label>
            <Input
              placeholder="https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1"
              value={cfg.baseUrl}
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>API Key</label>
            <Input.Password
              placeholder="sk-…（仅保存在本机）"
              value={cfg.apiKey}
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>模型 ID</label>
            <Input
              placeholder="deepseek-chat / qwen-plus / glm-4-flash / llama3"
              value={cfg.modelId}
              onChange={(e) => setCfg({ ...cfg, modelId: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button type="primary" onClick={save} disabled={testing || !loaded}>保存配置</Button>
            <Button onClick={test} disabled={testing || !loaded}>
              {testing ? "测试中…" : "测试连接"}
            </Button>
            {status.state !== "idle" && (
              <span className="status-line">
                <span className={"dot" + (status.state === "ok" ? " ok" : status.state === "err" ? " err" : "")} />
                <span style={{ color: status.state === "err" ? "#d9534f" : status.state === "ok" ? "#4caf7d" : "var(--dim)" }}>
                  {status.text}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="set-card">
          <h3>开发者选项：AI 可修改应用</h3>
          <div className="desc">
            {appInfo.isPackaged
              ? "安装版代码受保护，AI 自我修改仅在源码开发模式下可用。"
              : "开启后，AI 助手可以根据你的反馈直接修改本应用界面/功能（每次修改前会弹窗征求你的确认）。"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <Switch
              checked={!appInfo.isPackaged && settings.selfModify}
              disabled={appInfo.isPackaged}
              onChange={(v) => setSettings({ ...settings, selfModify: v })}
            />
            <span style={{ color: "var(--dim)", fontSize: 12.5 }}>
              {appInfo.isPackaged ? "安装版不可用" : settings.selfModify ? "已开启（修改需确认 + 重启生效）" : "已关闭"}
            </span>
          </div>
          <Button size="small" onClick={saveSettings} disabled={appInfo.isPackaged}>保存开发者设置</Button>
        </div>

        <div className="set-card">
          <h3>哼唱识别（ACRCloud）</h3>
          <div className="desc">
            在 <b>console.acrcloud.com</b> 免费注册（500 次/天），创建<b>音频识别（AVR）</b>项目：
            ① Audio Engine 勾选 <b>Cover Song (humming) Identification</b>；② 控制台项目页复制 Host / Access Key / Access Secret 填到下面。之后 AI 助手页可用 🎤 哼唱找歌。
          </div>
          <div className="form-row">
            <label>Host（控制台 → 你的项目 → Host）</label>
            <Input
              placeholder="例如 identify-eu-west-1.acrcloud.com（不填会自动尝试区域节点）"
              value={settings.acr.host}
              onChange={(e) => setSettings({ ...settings, acr: { ...settings.acr, host: e.target.value } })}
            />
          </div>
          <div className="form-row">
            <label>Access Key</label>
            <Input
              value={settings.acr.accessKey}
              onChange={(e) => setSettings({ ...settings, acr: { ...settings.acr, accessKey: e.target.value } })}
            />
          </div>
          <div className="form-row">
            <label>Secret Key（控制台里的 Secret key，与 Access Key 配对）</label>
            <Input.Password
              value={settings.acr.accessSecret}
              onChange={(e) => setSettings({ ...settings, acr: { ...settings.acr, accessSecret: e.target.value } })}
            />
          </div>
          <Button size="small" type="primary" onClick={saveSettings}>保存</Button>
        </div>

        <div className="set-card">
          <h3>关于 AI 助手</h3>
          <div className="desc">
            播放器内置的 AI 助手基于 <b>pi 框架</b>（@earendil-works/pi-coding-agent）运行。
            它只能访问你的本地曲库，可帮你：
          </div>
          <div className="hint">
            · 按风格 / 年代 / 心情自动整理歌单（智能分桶）<br />
            · 检测疑似重复的歌曲、给歌曲打标签<br />
            · 空耳找歌（记得歌词片段就能搜）<br />
            · 生成曲库统计和听歌推荐<br />
            · 修改应用界面与功能（开发者模式）
          </div>
        </div>
      </div>
    </div>
  );
}
