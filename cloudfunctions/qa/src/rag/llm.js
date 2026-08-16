// backend/src/rag/llm.js - 可插拔大模型（OpenAI 兼容 /chat/completions）
// 用 node:http/https 直连而非 fetch：微信云函数运行时可能是 Node 16（无全局 fetch），
// http 模块方案在 10/16/18/20+ 全版本可用。
// 带超时与可重试错误的重试（429/5xx/网络中断/超时各默认重试 1 次），
// 避免云函数偶发网络抖动直接把"服务暂时不可用"抛给焦虑的家长。
const http = require('http');
const https = require('https');
const config = require('../config');

function postJson(urlStr, headers, bodyStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(new Error('LLM_BASE_URL 不合法: ' + urlStr));
    }
    const mod = u.protocol === 'http:' ? http : https;
    const data = Buffer.from(bodyStr, 'utf-8');
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': data.length },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf-8') })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      const err = new Error('LLM 请求超时');
      err.code = 'TIMEOUT';
      req.destroy(err);
    });
    req.write(data);
    req.end();
  });
}

function isRetryable(err) {
  if (!err) return false;
  const status = err.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return ['TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(err.code);
}

async function chatOnce(messages) {
  const res = await postJson(
    `${config.llm.baseUrl}/chat/completions`,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    JSON.stringify({
      model: config.llm.model,
      temperature: config.llm.temperature,
      max_tokens: config.llm.maxTokens,
      messages,
    }),
    config.llm.timeoutMs
  );
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`LLM API ${res.status}: ${res.text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  let data;
  try {
    data = JSON.parse(res.text);
  } catch (e) {
    throw new Error('LLM 返回非 JSON: ' + res.text.slice(0, 200));
  }
  const content =
    data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('LLM 返回内容为空');
  return content;
}

async function chat(messages) {
  let lastErr;
  for (let attempt = 0; attempt <= config.llm.maxRetries; attempt++) {
    try {
      return await chatOnce(messages);
    } catch (err) {
      lastErr = err;
      if (attempt < config.llm.maxRetries && isRetryable(err)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); // 指数退避
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { chat };
