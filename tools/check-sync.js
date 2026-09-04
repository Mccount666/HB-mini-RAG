// tools/check-sync.js - 校验 backend/src 与 cloudfunctions/qa/src 是否一致（防漂移）
// 背景：云函数复用 backend/src/rag + ocr + config.js 的同一套代码，靠 tools/sync-cloudfunction.js
// 拷贝。若改了 backend 忘了同步（或忘了重新上传云函数），线上/本地行为会静默分叉。
// 用法：node tools/check-sync.js   （exit 1 = 有漂移；npm run predeploy 会先 sync 再校验）
const fs = require('fs');
const path = require('path');

// 路径拼接辅助：只接受本文件内置常量与 readdir 结果，不接触任何外部输入
function p(...parts) {
  return parts.filter((s) => s !== '').join(path.sep);
}

const root = p(__dirname, '..');
const pairs = [
  ['backend/src/rag', 'cloudfunctions/qa/src/rag'],
  ['backend/src/ocr', 'cloudfunctions/qa/src/ocr'],
  ['backend/src/config.js', 'cloudfunctions/qa/src/config.js'],
];

function listFiles(dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) out.push(...listFiles(p(dir, d.name)).map((r) => d.name + '/' + r));
    else out.push(d.name);
  }
  return out;
}

let drift = 0;
for (const [src, dst] of pairs) {
  const srcFull = p(root, src);
  const dstFull = p(root, dst);
  if (!fs.existsSync(dstFull)) {
    console.error(`✗ 缺失目录/文件：${dst}（先运行 node tools/sync-cloudfunction.js）`);
    drift++;
    continue;
  }
  // 单文件对直接比对；目录对逐文件比对
  const srcIsFile = fs.statSync(srcFull).isFile();
  const srcFiles = srcIsFile ? [] : listFiles(srcFull);
  const dstFiles = srcIsFile ? [] : listFiles(dstFull);
  if (srcIsFile) {
    if (fs.readFileSync(srcFull).toString() !== fs.readFileSync(dstFull).toString()) {
      console.error(`✗ 内容不一致：${src} ≠ ${dst}`);
      drift++;
    }
    continue;
  }
  for (const f of srcFiles) {
    const a = p(srcFull, f);
    const b = p(dstFull, f);
    if (!fs.existsSync(b)) {
      console.error(`✗ ${dst}/${f} 缺失`);
      drift++;
    } else if (fs.readFileSync(a).toString() !== fs.readFileSync(b).toString()) {
      console.error(`✗ 内容不一致：${src}/${f} ≠ ${dst}/${f}`);
      drift++;
    }
  }
  for (const f of dstFiles) {
    if (!srcFiles.includes(f)) {
      console.warn(`⚠ ${dst}/${f} 在源目录中不存在（同步会删除，请确认是否为遗留文件）`);
    }
  }
}

if (drift) {
  console.error(`\n共 ${drift} 处漂移。请运行 node tools/sync-cloudfunction.js 后重新上传云函数。`);
  process.exit(1);
}
console.log('✓ backend/src 与 cloudfunctions/qa/src 完全一致');
