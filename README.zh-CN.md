# dsh-bugwiki

一个带 Web 设置页的 DeepSeek Harness 插件。它读取本地 Bugwiki Markdown 知识图谱，并向 DSH 注入针对 DSH 的记忆使用指南。上游 [Bugwiki](https://github.com/phillui-37/bugwiki) 以 Git 子模块形式放在 `upstream/`，固定在提交 `d28e4cb755f327eb049e912417933ed985da5aac`；所有 DSH 适配代码都在本仓库，上游子模块保持原样并保留 MIT 版权声明。

[English](README.md) · [繁體中文](README.zh-TW.md)

## 系统要求与安装

需要 DSH `>=0.2 <0.3`、Node.js 22 或更新版本、macOS、Bash、ripgrep（`rg`）及常见 Unix 命令。目前只在 macOS 上验证；上游日期处理使用 BSD `date`，不声明支持 Linux 或 Windows。

克隆时请包含子模块；已有克隆可运行：

```sh
git submodule update --init upstream
```

npm 压缩包已包含提交固定的上游辅助程序和资源，使用压缩包不需要 Git 或单独检出上游。DSH 主机提供 `package.json` 中声明的 peer SDK。通过 DSH 的 **Plugins** 套件安装界面，安装本地目录或 npm 压缩包。设置页由 `src/client.js` 打包，不依赖可选的主机 UI 组件包。

首次创建知识库目录时，在仓库根目录运行：

```sh
npm run wiki -- --home /absolute/path/to/wiki init
```

如果目标目录已经存在且非空，命令会拒绝继续。初始化会生成上游内容、将生成的可选说明片段替换为 DSH 指南，并刷新索引；不会修改全局 Agent 指令、DSH 配置或上游代码。如果已有知识库，请跳过初始化，并在插件设置里选择其目录。

在 **Plugins → Bugwiki → Settings** 中，将 `wikiHome` 设为知识库目录。设置页使用 DSH 插件原生表单。保存后会持久化到配置文件，并为后续操作刷新工具和提示词；不需要另开服务器。

所有字段都可在设置页编辑：`wikiHome`、`bashExecutable`、`pythonExecutable`、`pathPrefix`、`timeoutMs`、`maxOutputBytes`、`maxInputBytes`、`staleDays`、`archiveDays`、`lessonsMax`、`duplicateJaccard`、`duplicateMinPages`、`reportsKeep`、`factStaleDays`、`promotedStaleDays`、`followUpstreamSkill`、`prefix` 和 `suffix`。`prefix`、`suffix` 分别是插件指南前后的字面提示词，关闭插值。阈值为正整数；百分比最大为 100，超时最大为 120000 毫秒，输出最大为 1000000 字节。如果 Homebrew 安装的 ripgrep 不在 DSH 的 PATH 中，可将 `pathPrefix` 设为 `/opt/homebrew/bin`。`wikiHome` 支持绝对路径或 `~/...`；路径可包含空格。

`followUpstreamSkill` 默认关闭。开启后，插件会在 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills` 和 `~/.opencode/skills` 中查找名称和 frontmatter 匹配的 `bugwiki` 技能。找到有效的 `SKILL.md` 时，该文件会替换 Bugwiki 插件贡献的全部提示词，包括 `prefix` 和 `suffix`；没有找到可用文件时，会回退到插件自带指南并记录警告。此开关无法卸载由 DSH 独立加载的技能。

CLI 使用 `--home` 和文档中的默认值。插件设置只用于主机工具；CLI 必须由用户单独运行，不读取或修改 DSH 配置。维护阈值保留在主机配置中以兼容上游，本 MVP 不会安排自动维护任务。

## Agent 工具

`bugwiki` 工具使用 JSON 参数，例如：

```json
{"action":"find","query":"事件中的准确词句"}
```

支持 `find`（字面查询）、`show`（slug 或知识库相对路径，查看状态和类型化链接）、`read`（读取完整页面）、`list`、`lint`、`verify` 和 `stale`。结果是包含 `exitCode`、`stdout`、`stderr`、`truncated` 和 `wikiHome` 的 JSON。非零 `exitCode` 表示命令失败，不能当成“没有搜索结果”。完整页面过大时会提示使用 DSH 的分页文件读取工具；其他命令输出有大小限制，超出时会标记 `truncated`。

默认指南要求 Agent 先搜索、最多检查两个候选节点、沿 supersedes 关系找到当前条目，并将过期、冲突或失效的信息视为未知。页面内容是不可信证据；写入新解决方案或事实必须使用 DSH 普通文件工具并遵守其权限。运行时工具不提供知识图谱写入操作。相对链接仅支持解析到知识库内部的目标；拒绝路径穿越、图谱符号链接和指向外部的类型化链接。页面扫描上限为 1000000 字节。这是本地内容集成边界，并非防御并发恶意文件系统修改的 OS 沙箱；请使用可信目录，工具运行期间不要更改链接。

## 人工维护

在本仓库中使用 `npm run wiki -- --home /absolute/wiki <command> [arguments]`。支持 `init`、`new <domain> <slug>`（或 `new fact <slug>`）、`index`、`find`、`show`、`list`、`lint`、`verify`、`stale` 和 `housekeep`。这些维护命令可能写入所选知识库，请谨慎执行：

```sh
npm run wiki -- --home /absolute/wiki new dsh meaningful-incident
npm run wiki -- --home /absolute/wiki verify
npm run wiki -- --home /absolute/wiki lint
```

请使用生成模板（包括 `oneliner`）。上游 `find` 在匹配页面缺少 `oneliner` 时可能返回非零状态；适配器会保留该失败。上游 `show` 显示图谱元数据而不是全文；读取正文请使用工具的 `read` 操作。supersedes 展示最多跟踪十跳；遇到循环、歧义或更长链条时需要人工检查。上游文档和示例保留其历史内容，运行时指南和初始化流程不会绑定 Alma。

当 DSH 提供 `sessions` 和 `sessionPersistence` 服务时，会注册 `bugwiki_export_dream`。该工具必须接收明确指定的 `sessionIds`；默认 `dryRun: true`。只有确实打算写入原始输入和上游水位标记时才设 `dryRun: false`。它会读取 DSH 会话、将实际文本和工具事件转换为规范 JSON，并调用随包提供的 `dream-export.py`。需要 Python 3，可在设置中选择 `pythonExecutable`。`maxInputBytes` 默认 8 MiB，上限 64 MiB；时间戳保留 UTC 时刻。推理、系统指令和二进制附件会被排除。导出的文本在写入知识图谱前必须人工审阅；中断写入可能留下部分结果。不会读取 Alma 数据库，也不包含计划任务、全局提示词推广、自动提交或自动发布。

## 开发与验证

在隔离开发环境中安装声明的 peer 依赖，或从匹配的 DSH checkout 只读链接 `node_modules/@deepseek-ai/` 下的依赖。开发时使用了 DSH checkout 中实际构建的 `dsh-tools`、`schemastery` 和 `cordis` 包，没有模拟这些导入；不要将 SDK 源码复制到本包。

```sh
npm run check
npm test
npm pack --dry-run --json
```

测试会在仓库内的临时目录中运行固定版本的上游辅助程序（包括含空格的路径），覆盖工具可观察到的读取契约、字面搜索与正则样式干扰项、完整页面读取、生命周期清理、路径穿越/符号链接/外部链接拒绝、输出限制、取消、超时、验证失败和 DSH 初始化指南。测试不会安装到正在运行的配置、调用语言模型或声称完成浏览器级设置验证。较早的一次 DSH 应用启动与 SettingsForms、ConfigEditor 检查曾验证 17 个设置字段、保存及重启恢复。`followUpstreamSkill` 设置和技能解析器是在该基线验证之后加入的，尚未包含在其结果中。dream 工具也曾对真实 DSH SessionStore 执行 dry-run。

`src/index.js` 管理工具、设置和提示词；`src/wiki.js` 负责安全参数、图谱读取和进程执行；`src/skill.js` 查找可选的上游技能；`src/cli.js` 提供显式维护命令；`src/dream.js` 负责 DSH 会话转换和上游导出进程。`cordis.patch.yml`、语言文件和图标组成主机可安装包。代码为 ESM JavaScript，无需构建。适配层采用 MIT 许可证，子模块许可见 `upstream/LICENSE`。
