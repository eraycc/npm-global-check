# npm-global-check

检查全局安装的 npm 包是否有新版本，并支持交互式 / 命令行升级。

- **跨平台**：兼容 Windows / Linux
- **精确版本比较**：使用 `semver` 包精确比较，正确识别 pre-release 版本更新
- **并发查询**：默认 12 路并发查询最新版本，可自定义
- **多种模式**：列表 / 检查 / 升级 / 交互
- **安全预览**：`--dry-run` 预览将执行的命令，不真正安装
- **脚本集成**：`--json` 结构化输出，stdout 纯 JSON，方便 CI / 脚本处理

## 安装

```bash
npm install -g npm-global-check
```

安装后可直接运行 `npm-global-check` 命令。

## 环境要求

- Node.js ≥ 14
- 已安装 `npm`，且全局包列表可访问（`npm list -g` 正常）

## 命令选项

### 模式选项

| 选项 | 说明 |
|------|------|
| `--list` | 列出所有全局包（有更新的在前 + 无更新的），不交互 |
| `--check` | 仅显示有更新的包 |
| `--update` | 检查并升级指定包（逗号分隔多包），或 `all` 升级全部有更新的 |

### 通用选项（可与任意模式组合）

| 选项 | 说明 |
|------|------|
| `-c, --cc <N>` | 设置并发查询数（默认 12） |
| `--dry-run` | 预览将执行的安装命令，不真正安装（配合 `--update`） |
| `--json` | 以 JSON 结构化输出（配合 `--list/--check/--update`，stdout 纯 JSON） |
| `-h, --help` | 显示帮助 |

## 模式说明

### 1. 交互模式（默认，不带模式参数）

```bash
npm-global-check
```

先列出全部包，然后进入交互。输入以下任一格式（多个用英文逗号分隔）：

| 输入 | 效果 |
|------|------|
| `1` | 按序号升级（自动用最新版本） |
| `@dbx-app/mcp-server` | 按包名升级（自动用最新版本） |
| `@dbx-app/mcp-server@latest` | 升级到最新 |
| `@dbx-app/mcp-server@0.4.77` | 升级到指定版本 |
| `1,2,opencode-ai,pnpm@latest` | 混合多参数 |
| `all` | 升级列表中全部有更新的包 |
| `1,2,all,opencode-ai` | 含 `all` 时忽略其他参数，执行全部更新 |
| `q` / `quit` / `exit` | 退出 |

每次升级完成后，**仅重新查询已升级的包**的最新版本并刷新列表（不重查未变更的包，节省时间）。刷新后列表重新排序，**序号始终绑定最新列表**，避免输入序号错位。

### 2. `--list` 列出全部

```bash
npm-global-check --list
```

显示全部全局包，有更新的排前面，无更新的排在后面。

### 3. `--check` 仅看有更新的

```bash
npm-global-check --check
```

只显示有更新的包。

### 4. `--update` 命令行升级

```bash
npm-global-check --update all                  # 升级全部有更新的
npm-global-check --update opencode-ai          # 升级指定包
npm-global-check --update opencode-ai,pnpm     # 多个包（逗号分隔）
npm-global-check --update pnpm@latest          # 指定升级到最新
npm-global-check --update pnpm@11.25.0         # 指定升级到固定版本
npm-global-check --update @dbx-app/mcp-server@0.4.77
```

- 多个包支持**逗号分隔**，也支持空格分隔
- 含 `all` 或无参数时，升级所有有更新的包
- 只查询涉及到的包（去重），不查全部，速度更快
- 升级前会展示计划并要求确认（输入 `y` 确认）
- 批量升级时若个别包失败，会**汇总列出失败的包**

## `--dry-run` 安全预览

配合 `--update` 使用，只展示将执行的安装命令，不真正安装、不要求确认：

```bash
npm-global-check --update all --dry-run
npm-global-check --update pnpm@11.25.0 --dry-run
```

```
检测到 2 个包需要升级:
  - @deepseek-harness-tui/dsh-tui: 0.10.0-beta.1 → 0.10.0-beta.4
  - npm: 11.17.0 → 12.0.2

[dry-run] 以下为将执行的命令，不会真正安装

[dry-run] 将执行: npm install -g @deepseek-harness-tui/dsh-tui@0.10.0-beta.4
[dry-run] 将执行: npm install -g npm@12.0.2

完成: 2/2 个包升级成功
```

## `--json` 结构化输出

配合 `--list` / `--check` / `--update` 使用，stdout 输出纯 JSON（进度提示走 stderr，不污染 JSON）：

```bash
npm-global-check --check --json
npm-global-check --list --json
npm-global-check --update all --dry-run --json
```

`--check --json` 输出：

```json
[
  { "name": "npm", "installed": "11.17.0", "latest": "12.0.2", "hasUpdate": true },
  { "name": "@deepseek-harness-tui/dsh-tui", "installed": "0.10.0-beta.1", "latest": "0.10.0-beta.4", "hasUpdate": true }
]
```

`--update --json` 输出：

```json
{
  "updated": [ { "name": "pnpm", "from": "11.23.0", "to": "11.25.0" } ],
  "failed": [],
  "dryRun": false
}
```

> 适合 CI / 脚本集成：`npm-global-check --check --json 2>/dev/null | jq '.[].name'` 即可拿到有更新的包名列表。

## 并发查询

默认 12 路并发查询最新版本，可用 `-c` / `--cc` 调整：

```bash
npm-global-check --check -c 20     # 20 路并发（更快）
npm-global-check --check --cc 2    # 2 路并发（更保守）
```

实测 14 个包：并发 12 约 10s，并发 2 约 19s。

> 查询是只读操作，可安全并发；**安装是串行**的（全局包写同一目录，并发安装会冲突损坏）。

## 典型示例

```bash
# 看看哪些包有更新
npm-global-check --check

# 升级全部有更新的包
npm-global-check --update all

# 只升级某一个包到最新
npm-global-check --update @dbx-app/mcp-server

# 预览将要升级什么（不真正安装）
npm-global-check --update all --dry-run

# 交互式：先列出，再逐个/批量升级
npm-global-check
```

## 输出示例

```
正在并发查询最新版本（并发数 12，共 14 个包）...

  [1/14] @dbx-app/mcp-server → 0.4.77
  [2/14] npm → 12.0.2
  ...

查询完成，耗时 10.3s

============================================================================================
序号  包名                          已安装版本    最新版本      状态
------------------------------------------------------------------------------------------
  1   @deepseek-harness-tui/dsh-tui   0.10.0-beta.1   0.10.0-beta.4  ⬆ 有更新
  2   npm                             11.17.0         12.0.2         ⬆ 有更新
  ...
 14   nrm                             2.1.0           2.1.0          ✓ 最新
============================================================================================
```

## 工作原理

1. `npm list -g --json` 获取全部全局包及已安装版本
2. 并发执行 `npm view <pkg> dist-tags.latest --json` 查询每个包的 latest tag
3. 用 `semver` 精确比较版本（保留 pre-release 标签），标记 `hasUpdate`
4. 按「有更新在前」排序展示
5. 升级时执行 `npm install -g <pkg>@<version>`（流式输出进度）

## 版本比较说明

使用 `semver` 包做精确比较：
- 先 `semver.valid` 严格解析（保留 pre-release 标签，如 `0.10.0-beta.1`）
- 若版本格式不规范（如带 `v` 前缀），回退 `semver.coerce` 兜底
- 正确识别 `0.10.0-beta.1 < 0.10.0-beta.4`、`1.0.0-alpha < 1.0.0` 等场景

> 早期版本用简化的数字段比较，会把 `1.0.0-alpha` 和 `1.0.0` 判为相等（漏判 pre-release 更新）。本版本已用 semver 彻底修复。

## 文件

- `npm-global-check.js` — 主脚本
- `package.json` — 包配置（依赖 `semver`）
