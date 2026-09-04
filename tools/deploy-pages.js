// tools/deploy-pages.js - 把 web/ 发布到 GitHub Pages（gh-pages 分支）
// 用法：node tools/deploy-pages.js [--api=https://你的后端地址]
// 可选 --api 会同时更新 web/config.js 的默认后端地址（AI 模式对所有访客生效）
// 前置：git 已配置远程 origin；本机有 gh 认证或 git 凭据管理器。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'web');
const tmp = path.join(root, '.gh-pages-tmp');

// git 一律走 execFileSync（不经 shell，参数不会被解释，杜绝命令注入）
function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function tryGit(args) {
  try { git(args); return true; } catch (e) { return false; }
}

// 可选：更新默认后端地址（只允许 http(s) URL 字符集，防注入 config.js）
const apiArg = process.argv.find((a) => a.startsWith('--api='));
if (apiArg) {
  const api = apiArg.slice(6).replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=-]*)?$/.test(api)) {
    console.error('非法 --api 地址（仅支持 http/https URL）:', api);
    process.exit(1);
  }
  const cfgPath = path.join(webDir, 'config.js');
  const cfg = fs.readFileSync(cfgPath, 'utf-8').replace(/API_BASE: '.*'/, `API_BASE: '${api}'`);
  fs.writeFileSync(cfgPath, cfg);
  console.log(`已设置默认后端地址：${api}`);
}

const curBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
const sha = git(['rev-parse', 'HEAD']).trim().slice(0, 7);
if (!/^[0-9a-f]{7}$/.test(sha)) throw new Error('git SHA 格式异常，中止');
console.log(`从分支 ${curBranch}@${sha} 发布 web/ → gh-pages`);

tryGit(['worktree', 'remove', '--force', tmp]);
git(['worktree', 'add', '--detach', tmp, 'HEAD']);

try {
  process.chdir(tmp);
  // 安全护栏：后续的 git rm 只允许发生在临时 worktree 里
  if (process.cwd() !== tmp) throw new Error('worktree 目录切换失败，中止');
  tryGit(['branch', '-D', 'gh-pages']);
  git(['checkout', '--orphan', 'gh-pages']);
  tryGit(['rm', '-rf', '-q', '.']);
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
  git(['add', '-A']);
  git(['commit', '-q', '-m', `deploy web @ ${sha}`]);
  git(['-c', 'credential.helper=!gh auth git-credential', 'push', '-f', 'origin', 'gh-pages']);
  console.log('✓ gh-pages 分支已推送。');
} finally {
  // 无论如何都回到主仓库再清理 worktree
  process.chdir(root);
  tryGit(['worktree', 'remove', '--force', tmp]);
}
console.log('GitHub Pages 将在 1-2 分钟内自动更新。');
