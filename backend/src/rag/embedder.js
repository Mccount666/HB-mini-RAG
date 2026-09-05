// backend/src/rag/embedder.js - 可插拔向量化
// provider='api'  : 调用 OpenAI 兼容的 /embeddings 接口（需 EMBEDDING_API_KEY）
// provider='local': 本地哈希词袋向量（免 key，默认）。适用于演示与中小知识库，
//                   对中文按「单字 + 相邻二字」分词，TF 加权并 L2 归一化，足以支撑
//                   检索优先 + 阈值门控的防幻觉逻辑。生产如需更高质量再切 API embedding。
const config = require('../config');
// 复用 llm.js 的 node:http/https 直连 + 超时 + 可重试错误判定（云函数 Node16 无全局 fetch）
const { postJson, isRetryable } = require('./llm');

const LOCAL_DIM = config.embedding.dim;

function tokenize(text) {
  const tokens = [];
  const lower = String(text || '').toLowerCase();
  // 英文 / 数字词
  const en = lower.match(/[a-z0-9]+/g);
  if (en) tokens.push(...en);
  // 中文：保留汉字，取「单字 + 相邻 bigram」以捕捉局部语义重叠
  const cn = lower.replace(/[^一-龥]/g, '');
  for (const ch of cn) tokens.push(ch);
  for (let i = 0; i < cn.length - 1; i++) tokens.push(cn.slice(i, i + 2));
  return tokens;
}

function hashDim(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % LOCAL_DIM;
}

function localEmbed(text) {
  const vec = new Array(LOCAL_DIM).fill(0);
  const freq = {};
  for (const t of tokenize(text)) freq[t] = (freq[t] || 0) + 1;
  for (const t in freq) vec[hashDim(t)] += 1 + Math.log(freq[t]); // tf 加权
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

async function apiEmbedOnce(text) {
  const res = await postJson(
    `${config.embedding.baseUrl}/embeddings`,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.embedding.apiKey}`,
    },
    JSON.stringify({ input: text, model: config.embedding.model }),
    config.embedding.timeoutMs
  );
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Embedding API ${res.status}: ${res.text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = JSON.parse(res.text);
  const vec = data.data && data.data[0] && data.data[0].embedding;
  if (!Array.isArray(vec)) throw new Error('Embedding API 返回格式异常');
  return vec;
}

async function apiEmbed(text) {
  let lastErr;
  for (let attempt = 0; attempt <= config.embedding.maxRetries; attempt++) {
    try {
      return await apiEmbedOnce(text);
    } catch (err) {
      lastErr = err;
      if (attempt < config.embedding.maxRetries && isRetryable(err)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); // 指数退避
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function embed(text) {
  if (config.embedding.provider === 'local' || !config.embedding.apiKey) {
    return localEmbed(text);
  }
  return apiEmbed(text);
}

module.exports = { embed, localEmbed, tokenize };
