// backend/src/rag/llm.js - 可插拔大模型（OpenAI 兼容 /chat/completions）
// 带超时（AbortController）与可重试错误的重试（429/5xx/网络中断各默认重试 1 次），
// 避免云函数偶发网络抖动直接把"服务暂时不可用"抛给焦虑的家长。
const config = require('../config');

function isRetryable(err) {
  if (!err) return false;
  const status = err.status || (err.response && err.response.status);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return err.name === 'AbortError' || err.name === 'TypeError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
}

async function chatOnce(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: config.llm.temperature,
        max_tokens: config.llm.maxTokens,
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`LLM API ${res.status}: ${await res.text()}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('LLM 返回内容为空');
    return content;
  } finally {
    clearTimeout(timer);
  }
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
