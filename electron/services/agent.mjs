// pi 大脑：BYOK（用户自带 API Key）→ models.json/auth.json → AgentSession + 音乐工具
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  defineTool,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { neteaseLyricSearch } from "./lyrics.mjs";

const SYSTEM_PROMPT = `你是「PI Music Player」内置的音乐管家。用户有一个本地音乐库，你可以通过工具搜索歌曲、创建歌单、检测重复、查看统计、给歌曲打标签。

工作原则：
1. 回复使用简体中文，简洁友好，像朋友聊天。
2. 用户提出"整理/分桶/建歌单"类需求时，先调用 search_music 或 get_library_stats 了解曲库，再 create_playlist 落地。
3. 创建歌单时给歌单起一个好听的名字，description 用空格分隔的关键词写清楚筛选条件（风格、艺人、年代、心情等），例如"周杰伦 慢歌"。若曲库没有匹配的歌，不要创建空歌单，改用 search_music 或 get_library_stats 了解曲库后再试。
4. 涉及版权、下载、翻唱的问题：明确告知"本播放器只管理用户本地已有的音乐文件，不提供下载服务"。
5. 不要编造曲库中不存在的歌曲信息，一切以工具返回为准。
6. 用户只记得歌词片段/空耳内容时，用 find_song_by_ear 帮他找歌。`;

// 自我修改模式的系统提示增强
const MODIFY_SYSTEM_PROMPT = `\n\n【应用开发者模式】\n用户允许你修改这个播放器应用本身（源码在 cwd）。当用户提出界面/功能修改反馈时：\n1. 先 read 相关文件理解现状，再 edit/write 修改。\n2. 修改后运行 bash: npm run build，确认构建成功（输出含 built in）。\n3. 构建成功后调用 finish_modify 工具告知用户，用户重启后生效。\n4. 一次只做一件事，保持改动最小。`;

export class AgentService {
  constructor(store, library, userDataDir, options = {}) {
    this.store = store;
    this.library = library;
    this.agentDir = join(userDataDir, "pi-agent");
    this.modelsPath = join(this.agentDir, "models.json");
    this.authPath = join(this.agentDir, "auth.json");
    this.session = null;
    this.runtime = null;
    this.onEvent = null; // (event) => void
    this.onConfirmRequest = null; // async (toolName, input) => boolean
    this.projectRoot = options.projectRoot || null;
    this.sessionDir = join(this.agentDir, "sessions");
    this.sessionFile = this.store.getSettings?.()?.chatSessionFile || join(this.sessionDir, "chat.jsonl");
    if (!existsSync(this.agentDir)) mkdirSync(this.agentDir, { recursive: true });
    if (!existsSync(this.sessionDir)) mkdirSync(this.sessionDir, { recursive: true });
  }

  getConfig() {
    return this.store.getAgent();
  }

  async configure(cfg) {
    if (!cfg?.baseUrl || !cfg?.apiKey || !cfg?.modelId) {
      throw new Error("请完整填写 Base URL、API Key、模型 ID");
    }
    this.store.setAgent(cfg);
    // 写 app 专属 models.json / auth.json（BYOK，与其他 pi 配置隔离）
    writeFileSync(
      this.modelsPath,
      JSON.stringify(
        {
          providers: {
            byok: {
              name: "用户配置",
              baseUrl: cfg.baseUrl,
              api: "openai-completions",
              models: [
                {
                  id: cfg.modelId,
                  name: cfg.modelId,
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 128000,
                  maxTokens: 16384,
                },
              ],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    writeFileSync(
      this.authPath,
      JSON.stringify({ byok: { type: "api_key", key: cfg.apiKey } }, null, 2),
      "utf-8"
    );
    await this.disposeSession();
    await this.ensureSession();
  }

  async ensureSession() {
    if (this.session) return this.session;
    const cfg = this.store.getAgent();
    if (!cfg) throw new Error("尚未配置大模型 API，请先到「设置」填写");
    this.runtime = await ModelRuntime.create({
      modelsPath: this.modelsPath,
      authPath: this.authPath,
    });
    const model = this.runtime.getModel("byok", cfg.modelId);
    if (!model) throw new Error(`模型 ${cfg.modelId} 未注册，请检查配置`);

    // 会话持久化：优先恢复已有会话文件，否则新建
    let sessionManager;
    if (existsSync(this.sessionFile)) {
      try {
        sessionManager = SessionManager.open(this.sessionFile, this.sessionDir);
      } catch {
        sessionManager = SessionManager.create(this.agentDir, this.sessionDir);
      }
    } else {
      sessionManager = SessionManager.create(this.agentDir, this.sessionDir);
    }
    this.sessionFile = sessionManager.getSessionFile() || this.sessionFile;
    const persistedSettings = this.store.getSettings ? this.store.getSettings() || {} : {};
    if (persistedSettings.chatSessionFile !== this.sessionFile) {
      this.store.setSettings({ ...persistedSettings, chatSessionFile: this.sessionFile });
    }

    const settings = this.store.getSettings ? this.store.getSettings() : {};
    const selfModify = !!settings.selfModify && this.projectRoot;
    const tools = this.buildTools();
    let toolNames = tools.map((t) => t.name);
    let cwd = this.agentDir;
    let systemPrompt = SYSTEM_PROMPT;
    const loaderOpts = {
      cwd: selfModify ? this.projectRoot : this.agentDir,
      agentDir: this.agentDir,
      systemPrompt,
      noContextFiles: true,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    };
    if (selfModify) {
      toolNames = [...toolNames, "read", "edit", "write", "bash", "ls", "grep"];
      cwd = this.projectRoot;
      systemPrompt = SYSTEM_PROMPT + MODIFY_SYSTEM_PROMPT;
      loaderOpts.systemPrompt = systemPrompt;
      // 修改类工具先征求用户确认
      loaderOpts.extensionFactories = [
        {
          name: "app-modify-gate",
          factory: (pi) => {
            pi.on("tool_call", async (event) => {
              if (["edit", "write", "bash"].includes(event.toolName)) {
                const ok = await this.confirm(event.toolName, event.input);
                if (!ok) return { block: true, reason: "用户拒绝本次修改" };
              }
            });
          },
        },
      ];
    }
    const loader = new DefaultResourceLoader(loaderOpts);
    await loader.reload();

    const result = await createAgentSession({
      model,
      modelRuntime: this.runtime,
      sessionManager,
      resourceLoader: loader,
      customTools: tools,
      tools: toolNames,
      cwd,
    });
    this.session = result.session;
    this.session.subscribe((ev) => this.forward(ev));
    return this.session;
  }

  async confirm(toolName, input) {
    if (!this.onConfirmRequest) return true;
    try {
      const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 180000));
      return await Promise.race([this.onConfirmRequest(toolName, input), timeout]);
    } catch {
      return false;
    }
  }

  forward(ev) {
    if (!this.onEvent) return;
    try {
      if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
        this.onEvent({ type: "delta", text: ev.assistantMessageEvent.delta });
      } else if (ev.type === "tool_execution_start") {
        this.onEvent({ type: "tool", tool: ev.toolName });
      } else if (ev.type === "tool_execution_end") {
        // 结构化工具结果 → 渲染端可点击卡片
        const data = this.extractToolResult(ev);
        if (data !== undefined) {
          this.onEvent({ type: "tool_end", tool: ev.toolName, data });
        }
      } else if (ev.type === "message_end") {
        this.onEvent({ type: "message_end" });
      }
    } catch {
      // 事件转发失败不阻塞
    }
  }

  // 从工具返回 content 里解析结构化数据
  extractToolResult(ev) {
    const result = ev.result;
    const text =
      result?.content?.find?.((c) => c.type === "text")?.text ||
      (Array.isArray(result?.content) ? result.content.map((c) => (c.type === "text" ? c.text : "")).join("") : null);
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  // 读取会话历史（供渲染端恢复显示）
  getHistory() {
    try {
      if (!existsSync(this.sessionFile)) return [];
      const lines = readFileSync(this.sessionFile, "utf-8").split(/\r?\n/).filter(Boolean);
      const out = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const msg = entry.message;
          if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
          const text = (Array.isArray(msg.content) ? msg.content : [])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");
          if (!text || /^\[工具结果|^Result of|^Tool result/.test(text)) continue;
          out.push({ role: msg.role, text });
        } catch {
          // 单行损坏跳过
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async chat(text) {
    const session = await this.ensureSession();
    try {
      await session.prompt(text);
      return { ok: true };
    } catch (e) {
      if (String(e?.message || e).includes("abort")) return { ok: true, aborted: true };
      throw e;
    }
  }

  async abort() {
    if (this.session) await this.session.abort().catch(() => {});
  }

  async disposeSession() {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
  }

  // ---------- 音乐工具（LLM 可调用） ----------
  buildTools() {
    const store = this.store;
    const normalize = (s) => String(s || "").toLowerCase().replace(/[\s·・,，.。!！?？'"()（）[\]【】\-_—]/g, "");

    const search = (query) => {
      const q = normalize(query);
      const terms = q
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2);
      if (terms.length === 0) return [];
      const hits = store
        .getTracks()
        .map((t) => {
          const hay = normalize(`${t.title} ${t.artist} ${t.album} ${t.genre} ${t.year} ${(t.tags || []).join(" ")}`);
          let score = 0;
          for (const term of terms) {
            if (hay.includes(term)) score += term.length;
          }
          return { t, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
      return hits.map((x) => ({
        id: x.t.id,
        title: x.t.title,
        artist: x.t.artist,
        album: x.t.album,
        genre: x.t.genre,
        year: x.t.year,
      }));
    };

    return [
      defineTool({
        name: "search_music",
        label: "搜索曲库",
        description: "按歌名/艺人/专辑/风格/年份/标签搜索本地曲库，返回匹配歌曲列表（最多30条）。参数 query 是任意关键词或自然语言描述。",
        parameters: Type.Object({
          query: Type.String({ description: "搜索关键词或描述，例如：周杰伦 慢歌" }),
        }),
        execute: async (_id, params) => ({
          content: [{ type: "text", text: JSON.stringify(search(params.query)) }],
          details: {},
        }),
      }),
      defineTool({
        name: "create_playlist",
        label: "创建歌单",
        description:
          "按自然语言描述从曲库中筛选歌曲并创建歌单。description 用空格分隔的关键词描述想听的风格/艺人/年代/场景（例如：周杰伦 慢歌 或 深夜 民谣 安静）。若没有匹配到任何歌曲，不要创建歌单，先调用 get_library_stats 或 search_music 了解曲库后调整关键词。",
        parameters: Type.Object({
          name: Type.String({ description: "歌单名称" }),
          description: Type.String({ description: "空格分隔的关键词，例如：周杰伦 慢歌" }),
        }),
        execute: async (_id, params) => {
          const hits = search(params.description);
          if (hits.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ matched: 0, error: "曲库中没有匹配到歌曲，请了解曲库后换关键词重试" }),
                },
              ],
              details: {},
            };
          }
          const playlists = store.getPlaylists();
          const pl = {
            id: "pl_" + Date.now().toString(36),
            name: params.name,
            description: params.description,
            trackIds: hits.map((h) => h.id),
            createdAt: Date.now(),
          };
          playlists.unshift(pl);
          store.savePlaylists(playlists);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ playlistId: pl.id, name: pl.name, matched: hits.length, tracks: hits.slice(0, 10) }),
              },
            ],
            details: {},
          };
        },
      }),
      defineTool({
        name: "detect_duplicates",
        label: "重复检测",
        description: "检测曲库中疑似重复的歌曲（同歌名同艺人），返回分组列表供用户确认清理。",
        parameters: Type.Object({}),
        execute: async () => {
          const groups = new Map();
          for (const t of store.getTracks()) {
            const key = `${normalize(t.title)}|${normalize(t.artist)}`;
            if (!t.title || !t.artist || t.artist === "未知艺人") continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration });
          }
          const dup = [...groups.entries()].filter(([, v]) => v.length > 1).map(([, v]) => v);
          return {
            content: [{ type: "text", text: JSON.stringify({ groups: dup.length, duplicates: dup }) }],
            details: {},
          };
        },
      }),
      defineTool({
        name: "get_library_stats",
        label: "曲库统计",
        description: "获取曲库统计：歌曲总数、艺人、专辑、风格、总时长。",
        parameters: Type.Object({}),
        execute: async () => {
          const tracks = store.getTracks();
          const artists = new Set(tracks.map((t) => t.artist));
          const albums = new Set(tracks.map((t) => t.album));
          const genres = new Set(tracks.filter((t) => t.genre).map((t) => t.genre));
          const totalSec = tracks.reduce((a, t) => a + (t.duration || 0), 0);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  total: tracks.length,
                  artists: artists.size,
                  albums: albums.size,
                  genres: [...genres].slice(0, 50),
                  totalHours: Math.round((totalSec / 3600) * 10) / 10,
                }),
              },
            ],
            details: {},
          };
        },
      }),
      defineTool({
        name: "tag_songs",
        label: "打标签",
        description: "给指定歌曲（按 id 列表）打标签，用于后续按标签检索。tags 例如：['深夜','开车','健身']",
        parameters: Type.Object({
          ids: Type.Array(Type.String(), { description: "歌曲 id 列表（来自 search_music）" }),
          tags: Type.Array(Type.String(), { description: "标签列表" }),
        }),
        execute: async (_id, params) => {
          const tracks = store.getTracks();
          let n = 0;
          for (const t of tracks) {
            if (params.ids.includes(t.id)) {
              t.tags = [...new Set([...(t.tags || []), ...params.tags])];
              n++;
            }
          }
          store.setTracks(tracks);
          return {
            content: [{ type: "text", text: JSON.stringify({ tagged: n, tags: params.tags }) }],
            details: {},
          };
        },
      }),
      defineTool({
        name: "find_song_by_ear",
        label: "空耳找歌",
        description:
          "用户只记得歌词片段、空耳听错的内容或旋律描述时，用这个工具搜索可能的歌曲。参数 text 是用户记得的任何片段。返回候选歌曲列表（歌名/艺人/专辑）。",
        parameters: Type.Object({
          text: Type.String({ description: "记得的歌词片段或空耳内容，例如：戴森球、你是我的小呀小苹果" }),
        }),
        execute: async (_id, params) => {
          const hits = await neteaseLyricSearch(params.text);
          return {
            content: [{ type: "text", text: JSON.stringify(hits || []) }],
            details: {},
          };
        },
      }),
      defineTool({
        name: "finish_modify",
        label: "完成修改",
        description: "开发者模式下，完成代码修改并构建成功后调用，通知用户重启应用生效。参数 message 是给用户的说明。",
        parameters: Type.Object({
          message: Type.String({ description: "修改内容说明" }),
        }),
        execute: async (_id, params) => {
          this.onEvent?.({ type: "modify_done", message: params.message });
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
            details: {},
          };
        },
      }),
    ];
  }
}
