// tools/qa-gw-test.js - 云函数 HTTP 网关防护端到端验证（只读验证，不修改任何云端资源）
// 覆盖：健康检查 / 共享密钥 401 / 带密钥 200 / CORS 白名单回显 / 预检 / 限速 429。
// 密钥运行时从 web/config.js 解析（与云函数环境变量 HTTP_SHARED_SECRET 保持一致），不在本文件硬编码。
// 用法：node tools/qa-gw-test.js [网关地址]   （默认取 web/config.js 的 API_BASE）
// 注意：限速用例会连续发 24 个快速请求（空 message，不触发 LLM）。本机 IP 触顶 429 后约 1 分钟内
// 其他用例也会 429，因此每个关键用例遇到 429 会自动等待 61 秒重试一次（最多 2 次）。
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 关键用例撞 429（限速窗口未过）时等待后重试，保证单脚本可重复执行
async function withQuotaRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fn();
    if (!r || r.status !== 429) return r;
    if (i < tries - 1) {
      console.log('  … 触发限速 429，等待 61 秒重试（' + (i + 1) + '/' + (tries - 1) + '）');
      await sleep(61000);
    }
  }
  return fn();
}

const cfgText = fs.readFileSync(path.join(__dirname, '..', 'web', 'config.js'), 'utf-8');
const apiBase = (process.argv[2] ||
  (cfgText.match(/API_BASE:\s*'([^']+)'/) || [])[1] ||
  '').replace(/\/+$/, '');
// 目标主机白名单：本脚本只允许打本项目自己的云函数网关/静态站点，杜绝被指向任意主机（SSRF 防线）
let baseOk = false;
try {
  const u = new URL(apiBase);
  baseOk =
    u.protocol === 'https:' &&
    ['tcloudbaseapp.com', 'app.tcloudbase.com', 'github.io'].some(
      (d) => u.hostname === d || u.hostname.endsWith('.' + d)
    );
} catch (e) { /* 非法 URL */ }
if (!baseOk) {
  console.error('网关地址不在白名单内（仅允许 *.tcloudbaseapp.com / *.app.tcloudbase.com / *.github.io）:', apiBase);
  process.exit(2);
}
const SECRET = (cfgText.match(/HTTP_SHARED_SECRET:\s*'([^']*)'/) || [])[1] || '';
if (!SECRET) {
  console.error('web/config.js 未配置 HTTP_SHARED_SECRET，服务端也应为空（否则网页 AI 模式不可用）');
  process.exit(2);
}
// 静态站点 Origin：由网关主机名推导（cloud1-xxx-<uin>.ap-shanghai.app.tcloudbase.com
// → https://cloud1-xxx-<uin>.tcloudbaseapp.com），与云函数 HTTP_CORS_ORIGINS 白名单一致
let SITE_ORIGIN = 'https://unknown-origin.example.com';
try {
  const host = new URL(apiBase).hostname;
  const m = host.match(/^(.+)\.ap-shanghai\.app\.tcloudbase\.com$/);
  if (m) SITE_ORIGIN = `https://${m[1]}.tcloudbaseapp.com`;
} catch (e) { /* apiBase 已过白名单校验，此处不会触发 */ }
const BAD_ORIGIN = 'https://evil.example.com';

const results = [];
function log(name, pass, detail) {
  results.push(pass);
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + detail);
}

async function req(method, urlPath, { headers = {}, body } = {}) {
  const target = new URL(urlPath, apiBase);
  const res = await fetch(target, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, headers: res.headers, json };
}

(async () => {
  console.log('网关:', apiBase, '\n');

  const health = await req('GET', '/');
  log('GET 健康检查（免密钥）',
    health.status === 200 && health.json && health.json.ok === true && health.json.service === 'hb-qa',
    `${health.status} ${JSON.stringify(health.json)}`);

  const noSecret = await req('POST', '/api/chat', {
    headers: { 'Content-Type': 'application/json' },
    body: { message: '肝母细胞瘤是什么？' },
  });
  log('POST 无密钥 → 401', noSecret.status === 401, `${noSecret.status} ${JSON.stringify(noSecret.json)}`);

  const badSecret = await req('POST', '/api/chat', {
    headers: { 'Content-Type': 'application/json', 'x-hb-secret': SECRET + 'x' },
    body: { message: '肝母细胞瘤是什么？' },
  });
  log('POST 错误密钥 → 401', badSecret.status === 401, `${badSecret.status} ${JSON.stringify(badSecret.json)}`);

  const ok = await withQuotaRetry(() => req('POST', '/api/chat', {
    headers: { 'Content-Type': 'application/json', 'x-hb-secret': SECRET, Origin: SITE_ORIGIN },
    body: { message: '肝母细胞瘤是什么？' },
  }));
  const hasCite = !!(ok.json && ok.json.answer && ok.json.answer.includes('[来源'));
  log('POST 带密钥 + 白名单 Origin → 200 带引用',
    ok.status === 200 && hasCite,
    `${ok.status} answer含引用=${hasCite} CORS=${ok.headers.get('access-control-allow-origin')}`);

  log('CORS 白名单精确回显',
    ok.headers.get('access-control-allow-origin') === SITE_ORIGIN,
    `access-control-allow-origin=${ok.headers.get('access-control-allow-origin')}`);

  const pre = await withQuotaRetry(() => req('OPTIONS', '/api/chat', {
    headers: {
      Origin: SITE_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-hb-secret',
    },
  }));
  log('OPTIONS 预检',
    pre.status === 204 &&
      pre.headers.get('access-control-allow-origin') === SITE_ORIGIN &&
      (pre.headers.get('access-control-allow-headers') || '').includes('x-hb-secret'),
    `${pre.status} allow-headers=${pre.headers.get('access-control-allow-headers')}`);

  const badOrigin = await req('POST', '/api/chat', {
    headers: { 'Content-Type': 'application/json', 'x-hb-secret': SECRET, Origin: BAD_ORIGIN },
    body: { message: '测试' },
  });
  log('非白名单 Origin 不回 CORS 头（浏览器将拦截）',
    !badOrigin.headers.get('access-control-allow-origin'),
    `status=${badOrigin.status} allow-origin=${badOrigin.headers.get('access-control-allow-origin')}`);

  // 限速：密钥有效但空 message（服务端快速校验失败，不产生 LLM 调用），连发 24 次 → 后段应出现 429
  const statuses = [];
  for (let i = 0; i < 24; i++) {
    const r = await req('POST', '/api/chat', {
      headers: { 'Content-Type': 'application/json', 'x-hb-secret': SECRET },
      body: { message: ' ' },
    });
    statuses.push(r.status);
  }
  const n429 = statuses.filter((s) => s === 429).length;
  log('限速触发 429（HTTP_RATE_LIMIT=20/分，前面用例已消耗少量配额）',
    n429 > 0,
    statuses.join(',') + ` (429×${n429})`);

  const pass = results.filter(Boolean).length;
  console.log(`\n结果: ${pass}/${results.length} 通过`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('脚本异常:', e.message);
  process.exit(2);
});
