// backend/src/config.js - 统一读取环境变量
try { require('dotenv').config(); } catch (e) {} // 云函数环境无 .env 也不报错
const path = require('path');

// 大模型默认 DeepSeek（OpenAI 兼容接口）。API Key 由开发者在 .env 自行填写。
// 注意：DeepSeek 不提供 embedding 接口，因此向量化默认走「本地 keyless 方案」，
// 这样整套系统只用一个 DeepSeek Key 即可跑通；如需更高质量检索可切 API embedding。
const embeddingKey = process.env.EMBEDDING_API_KEY;
const embeddingProvider = process.env.EMBEDDING_PROVIDER || (embeddingKey ? 'api' : 'local');

module.exports = {
  port: process.env.PORT || 3000,
  llm: {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0'),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '800', 10),
    // 超时与重试：429/5xx/网络错误默认重试 1 次，避免偶发抖动把错误抛给家长
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '1', 10),
  },
  embedding: {
    provider: embeddingProvider,            // 'local'(默认, 免 key) | 'api'(OpenAI 兼容 /embeddings)
    apiKey: embeddingKey,
    baseUrl: process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    dim: parseInt(
      process.env.EMBEDDING_DIM || (embeddingProvider === 'local' ? '512' : '1536'),
      10
    ),
    // 超时与重试（api provider 用，与 llm 同款策略：429/5xx/网络错误重试 1 次）
    timeoutMs: parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10),
    maxRetries: parseInt(process.env.EMBEDDING_MAX_RETRIES || '1', 10),
  },
  retrieval: {
    topK: parseInt(process.env.RETRIEVAL_TOP_K || '6', 10),
    // 混合检索权重：score = weightVector*余弦 + weightBm25*BM25归一分（两项均约 [0,1]）
    weightVector: parseFloat(process.env.RETRIEVAL_WEIGHT_VECTOR || '0.5'),
    weightBm25: parseFloat(process.env.RETRIEVAL_WEIGHT_BM25 || '0.5'),
    // 融合分阈值：低于此值视为"知识库无相关内容"，直接拒答不调模型。
    // local 向量化默认 0.50（2026-08-30 知识库扩至 107 条后实测校准：范围内最低 0.551、
    // 出范围漏拦最高 0.449，0.50 居中）、api 向量化默认 0.45；改配置或换 embedding 后
    // 务必用 `node tools/eval.js` 实测校准（输出在/出范围分数分布与建议阈值）。
    threshold: parseFloat(
      process.env.RETRIEVAL_THRESHOLD || (embeddingProvider === 'local' ? '0.50' : '0.45')
    ),
    // 覆盖率门控（可选，默认关闭=0）：问题关键词在语料中的 IDF 加权覆盖率。
    // 注意：口语化提问（"出院后多久复查一次"）的日常用词同样查不到，覆盖率天然偏低，
    // 无法与"糖尿病饮食"这类近邻问题统计分隔，因此只作为 eval 观测指标；
    // 近邻问题由"严格提示词拒答 + 生成后护栏"两道防线兜底。数值 >0 时启用整题拒答。
    minCoverage: parseFloat(process.env.RETRIEVAL_MIN_COVERAGE || '0'),
    strict: (process.env.STRICT_RETRIEVAL || 'true') === 'true',
    // OCR 化验单解读：化验参考条目仅 ~14 条，直接全部作为上下文 grounding，
    // 确保每条异常值都能被引用、且严格基于诊断标准。topK 取大值、阈值置 0。
    ocrTopK: parseInt(process.env.OCR_RETRIEVAL_TOP_K || '50', 10),
    ocrThreshold: parseFloat(process.env.OCR_RETRIEVAL_THRESHOLD || '0'),
  },
  guard: {
    // 生成后护栏：关键数字（带单位/含小数/>20）必须能在知识库命中条目中找到原文，
    // 否则整条回答判为不可信并拒答。医学安全优先，默认开启。
    checkNumbers: (process.env.GUARD_CHECK_NUMBERS || 'true') === 'true',
    // 回答至少含一处有效 [来源N] 引用；缺失时带强化指令重试一次，仍缺失则拒答
    requireCitations: (process.env.GUARD_REQUIRE_CITATIONS || 'true') === 'true',
  },
  kb: {
    // 上线前务必设为 true：仅向家长展示导师已审核的内容，未审核演示数据不进检索库
    onlyReviewed: (process.env.KB_ONLY_REVIEWED || 'false') === 'true',
  },
  ocr: {
    // 化验单 OCR 识别服务（可插拔）
    // 'mock'    : 默认，免 key，返回一份代表性演示化验单文本，便于无 OCR key 时跑通整条管线
    // 'tencent' : 腾讯云 OCR（通用印刷体 GeneralBasicOCR），需 TENCENT_SECRET_ID/KEY，
    //             在腾讯云控制台开通「文字识别」服务后填写；经费不是问题直接开。
    provider: process.env.OCR_PROVIDER || 'mock',
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
    region: process.env.TENCENT_OCR_REGION || 'ap-guangzhou',
  },
  paths: {
    kbDir: process.env.KB_DIR || path.join(__dirname, '..', 'data', 'knowledge_base'),
    indexFile: process.env.INDEX_FILE || path.join(__dirname, '..', 'data', 'index.json'),
  },
};
