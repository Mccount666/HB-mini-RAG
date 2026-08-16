// tools/deploy-pages.js - 把 web/ 发布到 GitHub Pages（gh-pages 分支）
// 用法：node tools/deploy-pages.js [--api=https://你的后端地址]
// 可选 --api 会同时更新 web/config.js 的默认后端地址（AI 模式对所有访客生效）
// 前置：git 已配置远程 origin；本机有 gh 认证或 git 凭据管理器。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'web');
const tmp = path.join(root, '.gh-pages-tmp');

function run(cmd) {
  // 注意：不传 cwd，让命令跟随 process.chdir 的当前目录（曾在默认参数里固定 root，
  // 导致 git rm 在主仓库执行、误删工作区文件——已修复并加防护，勿改回）
  return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function tryRun(cmd) {
  try { run(cmd); return true; } catch (e) { return false; }
}

// 可选：更新默认后端地址
const apiArg = process.argv.find((a) => a.startsWith('--api='));
if (apiArg) {
  const api = apiArg.slice(6).replace(/\/+$/, '');
  const cfgPath = path.join(webDir, 'config.js');
  const cfg = fs.readFileSync(cfgPath, 'utf-8').replace(/API_BASE: '.*'/, `API_BASE: '${api}'`);
  fs.writeFileSync(cfgPath, cfg);
  console.log(`已设置默认后端地址：${api}`);
}

const curBranch = run('git rev-parse --abbrev-ref HEAD').trim();
const sha = run('git rev-parse HEAD').trim().slice(0, 7);
console.log(`从分支 ${curBranch}@${sha} 发布 web/ → gh-pages`);

tryRun(`git worktree remove --force "${tmp}"`);
run(`git worktree add --detach "${tmp}" HEAD`);

try {
  process.chdir(tmp);
  // 安全护栏：后续的 git rm 只允许发生在临时 worktree 里
  if (process.cwd() !== tmp) throw new Error('worktree 目录切换失败，中止');
  tryRun('git branch -D gh-pages');
  run('git checkout --orphan gh-pages');
  tryRun('git rm -rf -q .');
  // 复制 web/ 全部内容
  for (const f of fs.readdirSync(webDir)) {
    const from = path.join(webDir, f);
    if (fs.statSync(from).isDirectory()) {
      fs.cpSync(from, path.join(tmp, f), { recursive: true });
    } else {
      fs.copyFileSync(from, path.join(tmp, f));
    }
  }
  fs.writeFileSync(path.join(tmp, 'DEPLOYED-BY.txt'),
    `自动发布自 ${curBranch}@${sha}（${new Date().toISOString()}），勿手改本分支\n`);
  run('git add -A');
  run(`git commit -q -m "deploy web @ ${sha}"`);
  run('git -c credential.helper="!gh auth git-credential" push -f origin gh-pages');
  console.log('✓ gh-pages 分支已推送。');
} finally {
  // 无论如何都回到主仓库再清理 worktree
  process.chdir(root);
  tryRun(`git worktree remove --force "${tmp}"`);
}
console.log('GitHub Pages 将在 1-2 分钟内自动更新。');
