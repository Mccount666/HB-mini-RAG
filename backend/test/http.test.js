// backend/test/http.test.js - 自托管 HTTP 接口集成测试（本地 mock LLM + 临时索引，不触外网）
// 覆盖：/api/chat 正常问答、输入校验、内部错误不泄露详情、/api/feedback 入库与查看鉴权。
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// 在 require 任何 config 依赖模块之前设置环境变量
process.env.EMBEDDING_PROVIDER = 'local';
process.env.KB_ONLY_REVIEWED = 'false';
process.env.LLM_MAX_RETRIES = '0';
delete process.env.ADMIN_TOKEN;

const mock = { chatReply: '', failLLM: false };

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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: mock.chatReply } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let llmServer;
let app;
let appServer;
let baseUrl;
let tmpIndex;

function api(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${urlPath}`,
      { method, headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(raw); } catch (e) { /* 非 JSON */ }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test.before(async () => {
  llmServer = await startMockLLM();
  process.env.LLM_BASE_URL = `http://127.0.0.1:${llmServer.address().port}/v1`;

  const { buildItems } = require('../src/kb/ingest');
  const items = await buildItems({ onlyReviewed: false });
  tmpIndex = path.join(os.tmpdir(), `hb-test-index-http-${process.pid}.json`);
  fs.writeFileSync(tmpIndex, JSON.stringify({ dim: items[0].embedding.length, items }));
  process.env.INDEX_FILE = tmpIndex;

  const chatRouter = require('../src/routes/chat');
  const feedbackRouter = require('../src/routes/feedback');
  app = express();
  app.use(express.json());
  app.use('/api', chatRouter);
  app.use('/api', feedbackRouter);
  await new Promise((resolve) => {
    appServer = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;
});

test.after(() => {
  llmServer.close();
  appServer.close();
  if (tmpIndex) fs.unlinkSync(tmpIndex);
});

const CITED_ANSWER = '肝母细胞瘤约占儿童肝脏肿瘤的 60%–70%，绝大多数发生在 5 岁以下 [来源1]。';

test('POST /api/chat 在范围问题返回带引用与来源的回答', async () => {
  mock.chatReply = CITED_ANSWER;
  mock.failLLM = false;
  const { status, data } = await api('POST', '/api/chat', { message: '肝母细胞瘤是什么病？' });
  assert.equal(status, 200);
  assert.ok(data.answer.includes('[来源1]'));
  assert.ok(Array.isArray(data.sources) && data.sources.length >= 1);
});

test('POST /api/chat 空 message 返回 400', async () => {
  const { status, data } = await api('POST', '/api/chat', { message: '   ' });
  assert.equal(status, 400);
  assert.match(data.message, /message 不能为空/);
});

test('POST /api/chat LLM 故障返回 500 且不泄露内部错误详情', async () => {
  mock.failLLM = true;
  const { status, data } = await api('POST', '/api/chat', { message: '肝母细胞瘤是什么病？' });
  assert.equal(status, 500);
  assert.equal(data.message, '服务内部错误，请稍后重试');
  assert.ok(!JSON.stringify(data).includes('mock failure'));
  mock.failLLM = false;
});

test('POST /api/chat 超长 message 被截断（不报错）', async () => {
  mock.chatReply = CITED_ANSWER;
  const long = '肝母细胞瘤'.repeat(1000); // 5000 字
  const { status, data } = await api('POST', '/api/chat', { message: long });
  assert.equal(status, 200);
  assert.ok(data.answer);
});

test('POST /api/feedback 正常入库；GET 未带管理令牌返回 401，带令牌可查看并汇总主题', async () => {
  const q = `测试问题-${Date.now()}-${Math.random()}`;
  const topicLabel = `化验指标-${Date.now()}-${Math.random()}`;
  const post = await api('POST', '/api/feedback', {
    q,
    rating: 'good',
    topicKey: 'lab',
    topicLabel,
  });
  assert.equal(post.status, 200);
  assert.equal(post.data.ok, true);

  const denied = await api('GET', '/api/feedback');
  assert.equal(denied.status, 401);

  process.env.ADMIN_TOKEN = 'test-admin-token';
  const ok = await api('GET', '/api/feedback', null, { 'x-admin-token': 'test-admin-token' });
  assert.equal(ok.status, 200);
  const saved = ok.data.feedback.filter((f) => f.q === q);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].topicKey, 'lab');
  assert.equal(saved[0].topicLabel, topicLabel);
  assert.equal(ok.data.topicStats[topicLabel], 1);
  assert.equal(ok.data.total, ok.data.feedback.length);
  delete process.env.ADMIN_TOKEN;
});
