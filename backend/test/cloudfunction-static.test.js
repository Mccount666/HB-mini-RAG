// backend/test/cloudfunction-static.test.js - 云函数入口关键防刷逻辑静态回归 + 行为级绕过测试
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const QA_ENTRY = require.resolve('../../cloudfunctions/qa/index.js');

test('cloudfunctions/qa feedback 匿名兜底不再共用 fb:anonymous 单桶', () => {
  const src = fs.readFileSync(QA_ENTRY, 'utf8');
  assert.match(src, /function feedbackRateIdentity\(identity = '', data = \{\}\)/);
  assert.match(src, /id !== 'anonymous' && id !== 'unknown'/);
  assert.match(src, /crypto\.createHash\('sha256'\)\.update\(fallback\)/);
  assert.doesNotMatch(src, /rateLimited\('fb:' \+ \(identity \|\| 'anonymous'\)/);
});

test('cloudfunctions/qa feedback 限速不得仅依赖内容哈希（须有全局兜底桶）', () => {
  const src = fs.readFileSync(QA_ENTRY, 'utf8');
  // 层 2 全局兜底桶必须存在且读取独立环境变量（审查报告待办 H：内容哈希桶可被变体绕过）
  assert.match(src, /rateLimited\('fb:__global__'/);
  assert.match(src, /FEEDBACK_RATE_LIMIT_GLOBAL/);
  // 层 1（内容桶）必须先于层 2 判断，保证同一内容刷屏仍返回「提交过于频繁」
  const idxContent = src.indexOf("rateLimited('fb:' + feedbackRateIdentity");
  const idxGlobal = src.indexOf("rateLimited('fb:__global__'");
  assert.ok(idxContent !== -1, '层1 内容桶限速缺失');
  assert.ok(idxGlobal !== -1, '层2 全局兜底桶缺失');
  assert.ok(idxContent < idxGlobal, '层1 内容桶应先于层2 全局兜底判断');
});

test('feedback 双层限速：内容变体攻击被全局桶拦下，同内容刷屏被层1拦下', async () => {
  delete require.cache[QA_ENTRY];
  const qa = require('../../cloudfunctions/qa/index.js');
  const origWarn = console.warn;
  console.warn = () => {}; // 测试环境无 wx-server-sdk，入库降级日志会刷屏，静音
  const envBackup = { ...process.env };
  try {
    process.env.FEEDBACK_RATE_LIMIT = '3';
    process.env.FEEDBACK_RATE_LIMIT_GLOBAL = '10';
    process.env.HTTP_RATE_LIMIT = '100000'; // 中和 HTTP 层每 IP 限速，聚焦 feedback 双层

    const post = async (body) => {
      const res = await qa.main({
        httpMethod: 'POST',
        path: '/api/feedback',
        body: JSON.stringify(body),
        // 不带 requestContext → getSourceIp 退化为 'unknown'，即匿名攻击者场景
      });
      return JSON.parse(res.body);
    };

    // 场景1（层1）：同一匿名身份 + 相同内容连发 → 第 4 次起「提交过于频繁」
    for (let i = 0; i < 3; i++) {
      const r = await post({ q: '固定问题', rating: 'bad', comment: '刷屏' });
      assert.equal(r.ok, true, `同内容第 ${i + 1} 次应放行`);
    }
    const flood = await post({ q: '固定问题', rating: 'bad', comment: '刷屏' });
    assert.equal(flood.ok, false);
    assert.equal(flood.error, '提交过于频繁');

    // 场景2（层2）：固定匿名身份 + 内容变体（攻击者手法，每轮改内容换新桶）
    // 全局桶已用 3 个额度，剩余 7 个 → 50 次变体只应放行 7 次，其余「服务繁忙」
    let allowed = 0;
    let busy = 0;
    for (let i = 0; i < 50; i++) {
      const r = await post({ q: `变体问题-${i}-${Math.random()}`, rating: 'bad', comment: `变体${i}` });
      if (r.ok === true) allowed++;
      else {
        assert.equal(r.error, '服务繁忙，请稍后再试');
        busy++;
      }
    }
    assert.equal(allowed, 7, '变体攻击放行数应恰好等于全局兜底剩余额度');
    assert.equal(busy, 43, '变体攻击其余请求应被全局桶拦截');
  } finally {
    console.warn = origWarn;
    process.env.FEEDBACK_RATE_LIMIT = envBackup.FEEDBACK_RATE_LIMIT;
    process.env.FEEDBACK_RATE_LIMIT_GLOBAL = envBackup.FEEDBACK_RATE_LIMIT_GLOBAL;
    process.env.HTTP_RATE_LIMIT = envBackup.HTTP_RATE_LIMIT;
  }
});
