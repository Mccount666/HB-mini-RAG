// tools/sync-cloudfunction.js
// 把共享的 RAG 核心（backend/src/rag + config.js）和向量索引（index.json）
// 同步进云函数目录 cloudfunctions/qa/src，保持单一来源、避免云函数上传时缺文件。
// 用法：node tools/sync-cloudfunction.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcRag = path.join(root, 'backend', 'src', 'rag');
const srcOcr = path.join(root, 'backend', 'src', 'ocr');
const srcConfig = path.join(root, 'backend', 'src', 'config.js');
const dstRag = path.join(root, 'cloudfunctions', 'qa', 'src', 'rag');
const dstOcr = path.join(root, 'cloudfunctions', 'qa', 'src', 'ocr');
const dstConfig = path.join(root, 'cloudfunctions', 'qa', 'src', 'config.js');
const srcIndex = path.join(root, 'backend', 'data', 'index.json');
const dstIndex = path.join(root, 'cloudfunctions', 'qa', 'data', 'index.json');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log('  ✓', path.relative(root, to));
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const ff = path.join(from, f);
    const tf = path.join(to, f);
    if (fs.statSync(ff).isDirectory()) copyDir(ff, tf);
    else copyFile(ff, tf);
  }
}

console.log('同步 RAG + OCR 核心 → cloudfunctions/qa/src …');
copyDir(srcRag, dstRag);
copyDir(srcOcr, dstOcr);
copyFile(srcConfig, dstConfig);
if (fs.existsSync(srcIndex)) {
  copyFile(srcIndex, dstIndex);
} else {
  console.log('  ! 未找到 backend/data/index.json，请先运行：npm run ingest');
}
console.log('完成。接下来在微信开发者工具中右键 cloudfunctions/qa → 上传并部署（云端安装依赖）。');
