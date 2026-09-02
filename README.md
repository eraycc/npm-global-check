# npm-global-check

检查全局安装的 npm 包是否有新版本，并支持交互式 / 命令行升级。

- **跨平台**：兼容 Windows / Linux
- **零依赖**：仅使用 Node.js 内置模块（`child_process`、`readline`）
- **并发查询**：默认 12 路并发查询最新版本，可自定义
- **多种模式**：列表 / 检查 / 升级 / 交互

## 安装

```bash
npm install -g npm-global-check
```

安装后可直接运行 `npm-global-check` 命令。

## 环境要求

- Node.js ≥ 14
- 已安装 `npm`，且全局包列表可访问（`npm list -g` 正常）

## 命令选项

| 选项 | 说明 |
|------|------|
| `--list` | 列出所有全局包（有更新的在前 + 无更新的），不交互 |
| `--check` | 仅显示有更新的包 |
| `--update` | 检查并升级指定包（逗号分隔多包），或 `all` 升级全部有更新的 |
| `-c, --cc <N>` | 设置并发查询数（默认 12） |
| `-h, --help` | 显示帮助 |

> `-c/--cc`、`-h/--help` 可与任意模式组合使用。

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

每次升级完成后，**仅重新查询已升级的包**的最新版本并刷新列表（不重查未变更的包，节省时间）。

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

## 并发查询

默认 12 路并发查询最新版本，可用 `-c` / `--cc` 调整：

```bash
npm-global-check --check -c 20     # 20 路并发（更快）
npm-global-check --check --cc 2    # 2 路并发（更保守）
```

实测 13 个包：并发 12 约 10s，并发 2 约 19s，并发 20 约 8s。

> 查询是只读操作，可安全并发；**安装是串行**的（全局包写同一目录，并发安装会冲突损坏）。

## 典型示例

```bash
# 看看哪些包有更新
npm-global-check --check

# 升级全部有更新的包
npm-global-check --update all

# 只升级某一个包到最新
npm-global-check --update @dbx-app/mcp-server

# 交互式：先列出，再逐个/批量升级
npm-global-check
```

## 输出示例

```
正在并发查询最新版本（并发数 12，共 13 个包）...

  [1/13] @dbx-app/mcp-server → 0.4.77
  [2/13] corepack → 0.36.0
  ...

查询完成，耗时 10.0s

============================================================================================
序号  包名                          已安装版本    最新版本      状态
------------------------------------------------------------------------------------------
  1   @dbx-app/mcp-server             0.4.75          0.4.77         ⬆ 有更新
  2   corepack                        0.35.0          0.36.0         ⬆ 有更新
  3   npm                             11.17.0         12.0.2         ⬆ 有更新
  ...
 13   nrm                             2.1.0           2.1.0          ✓ 最新
============================================================================================
```

## 工作原理

1. `npm list -g --json` 获取全部全局包及已安装版本
2. 并发执行 `npm view <pkg> version` 查询每个包的最新版本
3. 用 semver 基本规则比较版本，标记 `hasUpdate`
4. 按「有更新在前」排序展示
5. 升级时执行 `npm install -g <pkg>@<version>`（流式输出进度）

## 版本比较说明

使用简化的 semver 数字段比较（提取点分段后的整数逐段对比），支持：
- 常规版本：`1.2.3` vs `1.2.4`
- pre-release：`0.10.0-beta.1` vs `0.10.0-beta.4`、`0.1.1-rc.2` vs `1.0.0`

> 对于构建号等复杂 semver 场景，比较可能不完全精确；如需精确可替换为 `semver` 包。

## 文件

- `npm-global-check.js` — 主脚本
