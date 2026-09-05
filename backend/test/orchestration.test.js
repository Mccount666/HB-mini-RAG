// backend/test/orchestration.test.js - 问答编排层集成测试（本地 mock LLM，不触外网）
// 通过把 LLM_BASE_URL 指向本地 http 服务，真实跑通 answerQuestion 全流程：
// 机械未命中 → judge 三分支（可答/待学习/不相关）→ 生成 + 护栏。
// 文件内 RETRIEVAL_THRESHOLD=0.99 使所有问题都走 judge 分支（分支可控、断言确定）。
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 在 require 任何 config 依赖模块之前设置环境变量
process.env.EMBEDDING_PROVIDER = 'local';
process.env.KB_ONLY_REVIEWED = 'false';
process.env.RETRIEVAL_THRESHOLD = '0.99'; // 全部走 judge 分支
process.env.LLM_MAX_RETRIES = '0';

// 可变 mock 行为：每个用例前设置 verdict / chatReply
const mock = { verdict: { related: true, answerable: true }, chatReply: '', failLLM: false };

function startMockLLM() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (mock.failLLM) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mock failure' }));
          return;
        }
        const parsed = JSON.parse(body || '{}');
        const sys = (parsed.messages && parsed.messages[0] && parsed.messages[0].content) || '';
        let reply;
        if (sys.includes('意图判定器')) {
          reply = JSON.stringify(mock.verdict);
        } else if (mock.chatReply) {
          reply = mock.chatReply; // 用例显式指定（如构造护栏拦截）
        } else {
          // 默认：回显第一条来源的回答片段（数字逐字来自知识库，天然通过数字溯源）
          const m = sys.match(/回答：([\s\S]{1,80}?。)/);
          reply = m ? `根据知识库：${m[1]} [来源1]` : '根据知识库 [来源1]。';
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let server;
let answerQuestion;
let tmpIndex;

test.before(async () => {
  server = await startMockLLM();
  process.env.LLM_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  // 惰性 require：确保 config 读到上面设置的环境变量
  const { buildItems } = require('../src/kb/ingest');
  const answerMod = require('../src/rag/answer');
  answerQuestion = answerMod.answerQuestion;
  // 内存构建全量索引写入临时文件（retriever 按调用时 INDEX_FILE 读取）
  const items = await buildItems({ onlyReviewed: false });
  tmpIndex = path.join(os.tmpdir(), `hb-test-index-${process.pid}.json`);
  fs.writeFileSync(tmpIndex, JSON.stringify({ dim: items[0].embedding.length, items }));
  process.env.INDEX_FILE = tmpIndex;
});

test.after(() => {
  server.close();
  if (tmpIndex) fs.unlinkSync(tmpIndex);
});

test('judge：相关且可答 → 用候选生成并通过护栏', async () => {
  mock.verdict = { related: true, answerable: true };
  mock.chatReply = ''; // 默认回显知识库片段（带 [来源1]，天然通过护栏）
  mock.failLLM = false;
  const r = await answerQuestion('儿童肝肿瘤的罕见类型是什么？');
  assert.equal(r.refused, undefined);
  assert.ok(r.answer.includes('[来源1]'));
  assert.ok(r.sources.length >= 1);
  assert.ok(!r.learning);
});

test('judge：相关但知识库不足 → 学习话术 + learning 标记', async () => {
  mock.verdict = { related: true, answerable: false };
  const r = await answerQuestion('儿童肝肿瘤的罕见类型是什么？');
  assert.equal(r.learning, true);
  assert.equal(r.refused, true);
  assert.ok(r.learnQuestion);
});

test('judge：不相关 → 直接拒答', async () => {
  mock.verdict = { related: false, answerable: false };
  const r = await answerQuestion('儿童肝肿瘤的罕见类型是什么？');
  assert.equal(r.refused, true);
  assert.equal(r.judge, 'unrelated');
  assert.ok(!r.learning);
});

test('judge：相关可答但生成数字无出处 → 护栏拒答转学习回路', async () => {
  mock.verdict = { related: true, answerable: true };
  mock.chatReply = '建议每日服用 500mg 维生素 [来源1]。'; // 知识库无此数字
  const r = await answerQuestion('儿童肝肿瘤的罕见类型是什么？');
  assert.equal(r.learning, true);
  assert.equal(r.refused, true);
});

test('judge LLM 异常 → 降级为机械拒答（judge=fail）', async () => {
  mock.verdict = { related: true, answerable: true };
  mock.failLLM = true;
  const r = await answerQuestion('儿童肝肿瘤的罕见类型是什么？');
  assert.equal(r.refused, true);
  assert.equal(r.judge, 'fail');
});
