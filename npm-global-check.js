#!/usr/bin/env node
/**
 * npm-global-check
 * 检查全局安装的 npm 包是否有新版本，并交互式/命令行升级
 *
 * 用法:
 *   npm-global-check                    # 列出所有包（有更新的在前）+ 交互升级
 *   npm-global-check --list             # 列出所有包（有更新的在前 + 无更新的），不交互
 *   npm-global-check --check            # 仅显示有更新的包
 *   npm-global-check --update all       # 检查并升级所有有更新的包
 *   npm-global-check --update pkg1,pkg2 # 检查并升级指定包（逗号分隔）
 */

const { execSync, exec, spawnSync } = require('child_process');
const readline = require('readline');

// ---------- 工具函数 ----------

/** 跨平台执行 npm 命令（同步），返回 { ok, stdout, stderr, code } */
function runNpm(args) {
  // 用字符串拼接交给 shell 执行，Windows 上能正确解析 npm.cmd
  const cmd = ['npm', ...args].join(' ');
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout || '', stderr: '', code: 0 };
  } catch (e) {
    return {
      ok: false,
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
      code: e.status || 1,
    };
  }
}

/** 跨平台执行 npm 命令（异步），返回 Promise<{ ok, stdout, stderr, code }> */
function runNpmAsync(args) {
  const cmd = ['npm', ...args].join(' ');
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').toString(),
        stderr: (stderr || '').toString(),
        code: err ? (err.code || 1) : 0,
      });
    });
  });
}

/** 解析版本号，简单比较（支持 semver 基本场景） */
function compareVersions(a, b) {
  const parse = (v) => v.replace(/^v/, '').split('.').map((s) => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 获取全局已安装包列表 */
function getGlobalPackages() {
  const res = runNpm(['list', '-g', '--json']);
  if (!res.ok) {
    console.error('获取全局包列表失败:', res.stderr);
    process.exit(1);
  }
  const data = JSON.parse(res.stdout);
  const deps = data.dependencies || {};
  return Object.entries(deps).map(([name, info]) => ({
    name,
    installed: info.version || 'unknown',
  }));
}

/** 查询包的最新版本（异步） */
async function getLatestVersion(pkgName) {
  const res = await runNpmAsync(['view', pkgName, 'version']);
  if (res.ok && res.stdout.trim()) {
    return res.stdout.trim().split('\n').pop().trim();
  }
  return null;
}

/**
 * 对一组包并发查询最新版本
 * @param {Array} pkgs  包列表（会被原地写入 latest / hasUpdate）
 * @param {number} [concurrency=12] 并发数
 * @param {boolean} [verbose=true]  是否打印每条进度
 */
async function checkUpdates(pkgs, concurrency = 12, verbose = true) {
  const total = pkgs.length;
  if (total === 0) return;
  if (verbose) {
    console.log(`正在并发查询最新版本（并发数 ${concurrency}，共 ${total} 个包）...\n`);
  }
  const t0 = Date.now();
  let done = 0;

  // 并发池
  const results = await new Promise((resolve) => {
    const out = new Array(pkgs.length);
    let next = 0;
    const workers = [];
    for (let i = 0; i < Math.min(concurrency, pkgs.length); i++) {
      workers.push((async () => {
        while (next < pkgs.length) {
          const idx = next++;
          const name = pkgs[idx].name;
          const latest = await getLatestVersion(name);
          out[idx] = { name, latest };
          done++;
          if (verbose) {
            console.log(`  [${done}/${total}] ${name} → ${latest || '获取失败'}`);
          }
        }
      })());
    }
    Promise.all(workers).then(() => resolve(out));
  });

  // 收集结果
  for (let i = 0; i < pkgs.length; i++) {
    const { latest } = results[i];
    pkgs[i].latest = latest;
    pkgs[i].hasUpdate = latest ? compareVersions(pkgs[i].installed, latest) < 0 : false;
  }

  if (verbose) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n查询完成，耗时 ${elapsed}s\n`);
  }
}

/** 排序：有更新的排前面 */
function sortByUpdate(pkgs) {
  return pkgs.sort((a, b) => {
    if (a.hasUpdate && !b.hasUpdate) return -1;
    if (!a.hasUpdate && b.hasUpdate) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** 打印列表 */
function printList(pkgs, { showAll = true, numbered = true } = {}) {
  const display = showAll ? pkgs : pkgs.filter((p) => p.hasUpdate);
  if (display.length === 0) {
    console.log('  （无需要更新的包）');
    return;
  }
  console.log('='.repeat(92));
  console.log('序号  包名                          已安装版本    最新版本      状态');
  console.log('-'.repeat(92));
  display.forEach((pkg, i) => {
    const seq = String(i + 1).padStart(3);
    const name = pkg.name.padEnd(30);
    const installed = pkg.installed.padEnd(14);
    const latest = (pkg.latest || '?').padEnd(13);
    const status = pkg.hasUpdate ? '⬆ 有更新' : '✓ 最新';
    console.log(`${seq}   ${name}  ${installed}  ${latest}  ${status}`);
  });
  console.log('='.repeat(92));
}

/** 执行升级安装（流式输出 npm 进度） */
function installPackage(name, version) {
  const target = version ? `${name}@${version}` : name;
  console.log(`\n正在执行: npm install -g ${target} ...`);
  const cmd = `npm install -g ${target}`;
  const res = spawnSync(cmd, {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (res.status === 0) {
    console.log(`\n✅ ${name} 安装/升级成功`);
    return true;
  }
  console.error(`\n❌ 安装失败 (exit ${res.status})`);
  return false;
}

/**
 * 解析多参数输入（英文逗号分隔）
 * 支持：序号 / 包名 / 包名@版本 / all
 * 如果包含 all，忽略其他参数，返回 { all: true }
 * 否则返回 { all: false, targets: [{pkg, version}] }
 *
 * @param {string} input  用户输入
 * @param {Array} pkgs   当前包列表（序号引用）
 */
function parseInput(input, pkgs) {
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 检查 all
  if (parts.some((p) => p.toLowerCase() === 'all')) {
    return { all: true };
  }

  const targets = [];
  for (const raw of parts) {
    // 序号
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10);
      if (n >= 1 && n <= pkgs.length) {
        targets.push({ pkg: pkgs[n - 1], version: null });
      } else {
        return { all: false, error: `无效序号: ${raw}` };
      }
      continue;
    }
    // 包名@版本 或 包名
    const atIdx = raw.lastIndexOf('@');
    if (atIdx > 0) {
      const name = raw.slice(0, atIdx);
      const ver = raw.slice(atIdx + 1);
      const found = pkgs.find((p) => p.name === name);
      if (found) {
        targets.push({ pkg: found, version: ver === 'latest' ? found.latest : ver });
      } else {
        // 未安装的包也允许（带版本时）
        targets.push({ pkg: { name, installed: '(未安装)', latest: null, hasUpdate: false }, version: ver === 'latest' ? 'latest' : ver });
      }
    } else {
      const found = pkgs.find((p) => p.name === raw);
      if (found) {
        targets.push({ pkg: found, version: null });
      } else {
        return { all: false, error: `找不到包: ${raw}` };
      }
    }
  }

  if (targets.length === 0) return { all: false, error: '无有效参数' };
  return { all: false, targets };
}

// ---------- 交互模式 ----------

async function interactiveUpgrade(pkgs, concurrency) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log('\n支持输入: 序号 / 包名 / 包名@版本 / all，多个用英文逗号分隔');
  console.log('例: 1,2,opencode-ai,pnpm@latest | 若含 all 则忽略其他，执行全部更新 | q 退出');

  let active = true;
  while (active) {
    const input = (await ask('> ')).trim();
    if (input.toLowerCase() === 'q' || input === 'quit' || input === 'exit') {
      active = false;
      break;
    }
    if (!input) continue;

    // 解析多参数
    const parsed = parseInput(input, pkgs);
    if (parsed.error) {
      console.log(`❌ ${parsed.error}，请重新输入。`);
      continue;
    }

    // 确定要升级的列表
    let toUpdate;
    if (parsed.all) {
      toUpdate = pkgs.filter((p) => p.hasUpdate).map((p) => ({ pkg: p, version: null }));
    } else {
      toUpdate = parsed.targets;
    }

    if (toUpdate.length === 0) {
      console.log('没有需要更新的包。');
      continue;
    }

    // 展示计划
    console.log(`\n即将升级以下 ${toUpdate.length} 个包:`);
    for (const { pkg, version } of toUpdate) {
      const ver = version || pkg.latest || '?';
      console.log(`  - ${pkg.name}: ${pkg.installed} → ${ver}`);
    }
    const confirm = (await ask(`\n确认升级? [y/N] `)).trim().toLowerCase();
    if (confirm !== 'y' && confirm !== 'yes') {
      console.log('已取消。');
      continue;
    }

    // 执行升级
    let success = 0;
    const upgraded = [];
    for (const { pkg, version } of toUpdate) {
      const ver = version || pkg.latest;
      if (!ver) {
        console.log(`❌ ${pkg.name} 无法确定版本，跳过`);
        continue;
      }
      if (installPackage(pkg.name, ver)) {
        pkg.installed = ver;
        pkg.hasUpdate = false;
        success++;
        upgraded.push(pkg);
      }
    }
    console.log(`\n完成: ${success}/${toUpdate.length} 个包升级成功`);

    // 刷新列表（仅重新查询已升级的包的最新版本）
    if (upgraded.length > 0) {
      console.log('\n刷新列表（重新查询已升级包的最新版本）...');
      await checkUpdates(upgraded, concurrency, false);
      sortByUpdate(pkgs);
      console.log('\n当前列表:\n');
      printList(pkgs, { showAll: true });
    }
  }

  rl.close();
  console.log('\n再见 👋');
}

/** 打印使用帮助 */
function showHelp() {
  console.log(`
npm-global-check — 检查全局 npm 包更新并升级

用法:
  npm-global-check [选项] [包名...]

安装:
  npm install -g npm-global-check

模式选项（可组合，-c/--cc 可单独使用）:
  --list         列出所有全局包（有更新的在前 + 无更新的），不交互
  --check        仅显示有更新的包
  --update       检查并升级指定包（逗号分隔多包），或 all 升级全部有更新的
  -c, --cc <N>   设置并发查询数（默认 12）
  -h, --help     显示本帮助

交互模式（不带 --list/--check/--update 时进入）:
  输入序号 / 包名 / 包名@版本 / all，多个用英文逗号分隔
  例: 1,2,opencode-ai,pnpm@latest
  若含 all 则忽略其他参数，执行全部更新
  q 退出

示例:
  npm-global-check --list
  npm-global-check --check -c 20
  npm-global-check --update all
  npm-global-check --update opencode-ai,pnpm@latest
  npm-global-check --update @dbx-app/mcp-server@0.4.77
  npm-global-check                     # 交互模式

跨平台: 兼容 Windows / Linux
`);
  process.exit(0);
}

/** 从参数中解析并发数（-c N 或 --cc N），默认 12 */
function parseConcurrency(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '--cc') {
      const n = parseInt(args[i + 1], 10);
      if (!isNaN(n) && n > 0) return n;
      console.error(`并发数无效: ${args[i + 1]}，使用默认值 12`);
      return 12;
    }
  }
  return 12;
}

// ---------- 主流程 ----------

async function main() {
  const args = process.argv.slice(2);
  const isList = args.includes('--list');
  const isCheck = args.includes('--check');
  const isUpdate = args.includes('--update');
  const isInteractive = !isList && !isCheck && !isUpdate;
  const concurrency = parseConcurrency(args);

  // 帮助
  if (args.includes('-h') || args.includes('--help')) {
    showHelp();
  }

  console.log('正在获取全局安装的包...\n');
  const allPkgs = getGlobalPackages();

  if (allPkgs.length === 0) {
    console.log('没有发现全局安装的包。');
    return;
  }

  // --update: 解析多参数（逗号分隔）
  let updateTargets = null; // [{pkg, version}]
  if (isUpdate) {
    const idx = args.indexOf('--update');
    const rawArgs = args.slice(idx + 1).filter((a) => !a.startsWith('--'));
    // 支持逗号分隔（如 opencode-ai,pnpm@latest）和空格分隔
    const allTokens = [];
    for (const a of rawArgs) {
      a.split(',').forEach((t) => { if (t.trim()) allTokens.push(t.trim()); });
    }

    if (allTokens.length === 0 || allTokens.some((t) => t.toLowerCase() === 'all')) {
      // all 或无参数：升级所有有更新的包
      updateTargets = allPkgs.map((p) => ({ pkg: p, version: null }));
    } else {
      // 逐个解析：包名@版本 或 包名
      updateTargets = [];
      for (const raw of allTokens) {
        const atIdx = raw.lastIndexOf('@');
        if (atIdx > 0) {
          const name = raw.slice(0, atIdx);
          const ver = raw.slice(atIdx + 1);
          const found = allPkgs.find((p) => p.name === name);
          if (found) {
            updateTargets.push({ pkg: found, version: ver === 'latest' ? found.latest : ver });
          } else {
            updateTargets.push({ pkg: { name, installed: '(未安装)', latest: null, hasUpdate: false }, version: ver === 'latest' ? 'latest' : ver });
          }
        } else {
          const found = allPkgs.find((p) => p.name === raw);
          if (found) {
            updateTargets.push({ pkg: found, version: null });
          } else {
            console.log(`警告: 包未全局安装，跳过: ${raw}`);
          }
        }
      }
      if (updateTargets.length === 0) {
        console.log('没有匹配的包需要检查。');
        return;
      }
    }
  }

  // --update: 只查询涉及到的包（去重），其他模式查全部
  let pkgsToCheck;
  if (isUpdate) {
    const names = [...new Set(updateTargets.map((t) => t.pkg.name))];
    pkgsToCheck = allPkgs.filter((p) => names.includes(p.name));
  } else {
    pkgsToCheck = allPkgs;
  }

  // 查询最新版本（并发）
  await checkUpdates(pkgsToCheck, concurrency);

  // 排序
  sortByUpdate(allPkgs);

  // --update: 直接升级
  if (isUpdate) {
    // 过滤：带指定版本的直接升级；无版本且 latest 为 latest 的升级；无版本且已是最新的跳过
    const toUpdate = updateTargets.filter(({ pkg, version }) => {
      if (version) {
        // 有指定版本，直接升级（除非版本相同）
        return version !== pkg.installed;
      }
      // 无指定版本：升级到 latest（如果有更新）
      return pkg.hasUpdate;
    });

    if (toUpdate.length === 0) {
      console.log('\n没有需要更新的包。');
      return;
    }
    console.log(`\n检测到 ${toUpdate.length} 个包需要升级:`);
    toUpdate.forEach(({ pkg, version }) => {
      const ver = version || pkg.latest;
      console.log(`  - ${pkg.name}: ${pkg.installed} → ${ver}`);
    });
    const confirm = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((resolve) => confirm.question('\n确认升级? [y/N] ', resolve));
    confirm.close();
    if (ans.trim().toLowerCase() !== 'y' && ans.trim().toLowerCase() !== 'yes') {
      console.log('已取消。');
      return;
    }
    let success = 0;
    for (const { pkg, version } of toUpdate) {
      const ver = version || pkg.latest;
      if (installPackage(pkg.name, ver)) {
        pkg.installed = ver;
        pkg.hasUpdate = false;
        success++;
      }
    }
    console.log(`\n完成: ${success}/${toUpdate.length} 个包升级成功`);
    return;
  }

  // --list: 显示全部（有更新的在前 + 无更新的）
  if (isList) {
    printList(allPkgs, { showAll: true });
    return;
  }

  // --check: 只显示有更新的
  if (isCheck) {
    console.log('\n有更新的包:');
    printList(allPkgs, { showAll: false });
    return;
  }

  // 交互模式: 显示全部 + 进入交互
  printList(allPkgs, { showAll: true });
  await interactiveUpgrade(allPkgs, concurrency);
}

main().catch((err) => {
  console.error('发生错误:', err);
  process.exit(1);
});
