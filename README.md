# PI Music Player

基于 **pi 框架**（`@earendil-works/pi-coding-agent`）的 AI 本地智能音乐播放器。
界面采用浅色、低信息密度的本地播放器设计，无广告。

**核心卖点：BYOK —— 用户自带大模型 API Key，数据全部留在本地。**

## 功能

- 🎵 **本地播放器**：导入音乐文件夹、播放/暂停/切歌/进度拖动/音量、封面显示
- 🔁 **播放模式**：顺序播放 / 列表循环 / 单曲循环 / 随机播放（播放条一键切换）
- 🖼️ **封面自动补全**：无内嵌封面时自动从网易云下载专辑封面（当前曲目自动补 + 曲库一键批量补全）
- 🎨 **莉风风格浅色界面**：白底低密度、浅灰侧栏、青色点缀、列表带封面缩略图（Ant Design 组件）
- 🛠️ **AI 自我修改**：开启开发者选项后，AI 可按反馈直接改界面/功能（每次修改弹窗确认 → 自动构建 → 一键重启生效）
- 🎯 **结果即点即播**：AI 生成的歌单/找到的歌曲直接在聊天里以卡片呈现，一键播放（本地曲库自动匹配）
- 💾 **会话记忆**：聊天记录自动保存，重启应用后对话上下文和记录都还在
- 🎤 **哼唱找歌**：录音 10 秒哼一段旋律，ACRCloud 识别歌名（免费档 500 次/天）
- 🔎 **空耳找歌**：只记得歌词片段（哪怕听错），AI 也能搜出候选歌曲
- 📺 **桌面歌词**：透明置顶歌词窗，**逐行滚动**（当前行居中高亮 + 上下行预览，平滑滚动动画），支持置顶切换
- ⬇️ **歌词自动下载**：播放时若没有 `.lrc`，自动获取同步歌词并写入歌曲同目录 + 本地缓存；数据源：**Lrclib.net（公版/CC 授权）→ 网易云兜底**（逆向接口，仅个人播放展示使用）；无同步歌词时降级显示纯文本
- 🪟 **小窗模式**：迷你置顶播放窗（封面/进度/控制），可随时切回主窗口
- 📂 **曲库管理**：自动解析标签（标题/艺人/专辑/风格/时长/封面），搜索，打标签
- ◇ **唱片修复台**：集中检查缺失封面、歌词和异常元数据，支持逐首或批量补全；修复流程不改写原音频标签
- 📑 **歌单**：手动建歌单，或让 AI 用一句话生成
- 💾 **安全备份与迁移**：导出歌单、喜欢状态、标签和必要设置；不包含音频、本机路径、API Key 或聊天内容
- 🔗 **Deep Link**：安装后支持 `pimusic://open/library`、`pimusic://open/repair` 和白名单播放控制
- 🤖 **AI 助手（pi 大脑）**：
  - 按风格/年代/心情自动分桶建歌单
  - 重复歌曲检测
  - 自动打标签
  - 曲库统计与推荐
- 🔑 **BYOK**：填入任意 OpenAI 兼容 API（DeepSeek / 通义千问 / Kimi / 智谱 / Ollama 本地…）

## 安装与首次使用

从 GitHub Releases 下载以下任一文件：

- `PI Music Player-0.1.0-x64-Setup.exe`：Windows 安装程序，可选择安装目录。
- `PI Music Player-0.1.0-x64-Portable.zip`：免安装版，解压后运行 `PI Music Player.exe`。

首次启动后：

1. 点击左侧“添加文件夹”导入本地音乐；应用不会下载或上传你的音乐文件。
2. 如需 AI 助手，在“设置”填写你自己的 OpenAI 兼容 Base URL、API Key 和模型 ID。
3. 如需哼唱识别，在设置中填写你自己的 ACRCloud 项目凭据。

> 当前公开构建未进行 Windows 代码签名，SmartScreen 可能显示“未知发布者”。请只从本仓库 Releases 下载并核对文件来源。
>
> AI 自我修改功能只在源码开发模式可用；安装版代码位于只读包中，因此该功能会自动禁用。

## 源码开发

要求 Node.js 22+ 和 Windows 10/11：

```bash
npm install --include=dev
npm run dev
```

> 若 Electron 二进制下载失败（国内网络），设置镜像后重装：
> ```bash
> ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
> ```

## 测试与打包

```bash
npm test            # 备份脱敏、导入匹配和 Deep Link 白名单测试
npm run build       # 前端生产构建
npm run smoke       # Electron 集成冒烟测试
npm run pack:win    # 生成未安装的 win-unpacked 目录
npm run dist:win    # 生成 NSIS 安装包（免安装 ZIP 由 release/win-unpacked 压缩）
```

产物位于 `release/`。GitHub Actions 也可在推送 `v*` 标签时自动构建并附加到 Release。

## 数据与隐私

用户设置、曲库索引、聊天会话、API 凭据、歌词和封面缓存在 Windows 当前用户的 Electron 应用数据目录中，默认通常为：

```text
%APPDATA%\PI Music Player
```

API Key 不会提交到源码仓库。只有在主动使用对应功能时，查询内容才会发往用户配置的大模型服务、歌词服务或 ACRCloud。卸载程序默认保留这些本地数据。

设置页的备份文件不包含音乐文件、音乐目录绝对路径、AI/ACRCloud 凭据或聊天记录。修复台下载的歌词只写入应用缓存；正常播放时原有自动歌词流程仍可能在可写的歌曲目录旁创建同名 `.lrc`。

## 架构

```
electron/
├── main.mjs            # 窗口 + IPC + 服务装配（主窗/小窗/歌词窗）
├── preload.cjs         # contextBridge（window.api）
├── mini.html           # 小窗 UI（置顶迷你播放器）
├── lyrics.html         # 桌面歌词 UI（透明置顶）
└── services/
    ├── store.mjs       # JSON 持久化（用户数据目录）
    ├── library.mjs     # 曲库扫描 + music-metadata 标签解析 + 封面提取
    ├── lyrics.mjs      # LRC 解析 + 本地加载 + 在线下载（Lrclib → 网易云兜底）
    ├── backup.mjs      # 版本化备份、脱敏与本地歌曲匹配
    ├── deeplink.mjs    # pimusic:// 协议白名单解析
    ├── server.mjs      # 本地音频流（支持 Range 拖动）+ 封面服务
    └── agent.mjs       # pi AgentSession + BYOK（models.json/auth.json）+ 5 个音乐工具
src/                    # React 渲染端（曲库/歌单/AI 助手/设置 + 播放条）
```

**pi 集成方式**：`ModelRuntime.create({ modelsPath, authPath })` 加载用户自己的
OpenAI 兼容 provider；`createAgentSession({ customTools, resourceLoader })` 注入
5 个音乐工具（search_music / create_playlist / detect_duplicates /
get_library_stats / tag_songs）；事件流实时推送渲染端。

## 版权与许可

仅管理用户本地已有的音乐文件，不提供下载、翻唱、破解服务。在线歌词与封面仅用于个人本地展示，请遵守数据源条款和所在地法律。

源代码采用 [MIT License](LICENSE)。第三方依赖保留各自许可证。
