// cloudfunctions/qa/index.js - 微信云开发云函数入口
// 复用 backend/src/rag 的同一套 RAG 管线（防幻觉逻辑单一来源）。
// 支持三种调用：
//   1. 小程序直调  wx.cloud.callFunction({name:'qa'})
//      · 文本问答 : { message, history }
//      · 化验单   : { type:'ocr', fileID }
//      · 反馈     : { type:'feedback', q, rating:'good'|'bad', comment }
//   2. HTTP 访问服务（云接入）——供网页版（GitHub Pages / 静态托管）跨域调用：
//      POST /api/chat     body {"message": "...", "history": []}   头部 x-hb-secret（若配置）
//      POST /api/feedback body {"q": "...", "rating": "good|bad", "comment": "..."}
//      GET  任意路径 → 健康检查；OPTIONS → CORS 预检
// 部署前运行 tools/sync-cloudfunction.js，把 rag / ocr 模块与 config 同步进本目录。
//
// ===== HTTP 端点防护（云开发控制台配置环境变量）=====
//   HTTP_SHARED_SECRET : 共享密钥；配置后 POST 必须带 x-hb-secret 头（网页版已带），空 = 不校验
//   HTTP_RATE_LIMIT    : 每 IP 每分钟 POST 上限（默认 20），超出返回 429
//   HTTP_CORS_ORIGINS  : 允许跨域的网页版来源（逗号分隔）；未配置 = 全放行（仅限演示期）
const path = require('path');
const crypto = require('crypto');

// 云函数自带 data/index.json；优先级：环境变量 INDEX_FILE > 本目录 data/index.json
process.env.INDEX_FILE = process.env.INDEX_FILE || path.join(__dirname, 'data', 'index.json');

const { answerQuestion } = require('./src/rag/answer');
const { sanitizeMessage, sanitizeHistory } = require('./src/rag/sanitize');
const { ocrFromBuffer } = require('./src/ocr/ocr');
const { interpretLabReport } = require('./src/ocr/interpret');

let cloudInited = false;
function getCloud() {
  const cloud = require('wx-server-sdk');
  if (!cloudInited) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    cloudInited = true;
  }
  return cloud;
}

// ===== 业务处理（小程序直调事件） =====
function callIdentity(event = {}, context = {}) {
  const wxContext = context && context.OPENID ? context : (getCloud().getWXContext ? getCloud().getWXContext() : {});
  return wxContext.OPENID || event.openid || 'anonymous';
}

function validCloudFileID(fileID) {
  const s = String(fileID || '');
  // 小程序上传入口固定使用 lab-reports/<timestamp>-<rand>.jpg；直调只允许读取这类临时化验单图片，
  // 防止传入环境内其他云存储 fileID 让云函数以 admin 身份越权下载。
  return /^cloud:\/\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/lab-reports\/[0-9]{10,}-[0-9]{1,6}\.(?:jpg|jpeg|png)$/i.test(s);
}

async function handleCall(event = {}, context = {}) {
  const { type, message, history, fileID } = event || {};

  // ===== 反馈分支（小程序直调）：{ type:'feedback', q, rating:'good'|'bad', comment } =====
  // 与网页版共用 handleFeedback，写入云数据库 feedback 集合
  if (type === 'feedback') {
    return handleFeedback(event);
  }

  // ===== OCR 化验单解读分支（两段式：先提取文字 → 前端确认 → 再解读） =====
  // 第一段 step='extract'：下载图片 → OCR 只提取文字返回，不解读。
  // 第二段 step='interpret'：接收用户确认/修正后的 text → 严格解读。
  if (type === 'ocr') {
    const step = event.step || 'extract';
    try {
      if (step === 'interpret') {
        const text = String(event.text || '').trim();
        if (!text) return { type: 'ocr', step: 'interpret', error: 'text 不能为空（请先提取或输入化验单文字）' };
        const { interpretation, sources } = await interpretLabReport(text, history || []);
        return { type: 'ocr', step: 'interpret', rawText: text, interpretation, sources };
      }
      // extract（默认）：云存储图片下载到内存 Buffer，OCR 全程不落盘
      if (!fileID) return { type: 'ocr', error: 'fileID 不能为空' };
      if (!validCloudFileID(fileID)) return { type: 'ocr', error: 'fileID 格式非法' };
      const cloud = getCloud();
      const res = await cloud.downloadFile({ fileID });
      if (res.statusCode !== 200) throw new Error('下载图片失败: ' + res.statusCode);
      const rawText = await ocrFromBuffer(res.fileContent);
      return { type: 'ocr', step: 'extract', rawText, interpretation: '', sources: [] };
    } catch (err) {
      console.error('[qa.ocr] error:', err);
      // 不向客户端回传 err.message（可能含上游接口/存储细节）；用户可见文案已含在 interpretation
      return { type: 'ocr', step, rawText: '', interpretation: '化验单处理失败，请重试或咨询医护。', sources: [], error: 'OCR_PROCESS_FAILED' };
    }
  }

  // ===== 文本问答分支 =====
  if (!message || !String(message).trim()) {
    return { answer: '', sources: [], error: 'message 不能为空' };
  }
  try {
    // 全流程（混合检索 → 机械命中或 LLM 语义判定 → 严格提示词 → 大模型 → 生成后护栏）
    // 见 src/rag/answer.js；相关但知识库未收录时返回 learning:true + learnQuestion
    const result = await answerQuestion(sanitizeMessage(message), sanitizeHistory(history));
    if (result.learning && result.learnQuestion) {
      await pushLearnQueue(result.learnQuestion, 'text');
    }
    return result;
  } catch (err) {
    console.error('[qa] error:', err);
    // 不向客户端回传 err.message（LLM 错误原文/路径等内部细节）；前端本就展示固定兜底文案
    return { answer: '', sources: [], error: '服务繁忙，请稍后重试' };
  }
}

// ===== 知识积累队列：相关但未收录的问题 → 写入 learn_queue 集合 =====
// 供后端/导师定期查看，按问题补充知识库条目，实现迭代积累。
// 集合不存在时降级为日志输出（可在云开发控制台创建 learn_queue 集合）。
async function pushLearnQueue(question, mode = 'text') {
  const rec = {
    question: String(question || '').slice(0, 500),
    mode, // text=问答追问 | ocr=化验单相关疑问（预留）
    status: 'pending', // pending → 已收录后可置 done
    ts: new Date().toISOString(),
  };
  try {
    const db = getCloud().database();
    await db.collection('learn_queue').add({ data: rec });
    console.log('[learn_queue] 已入队', JSON.stringify(rec));
  } catch (err) {
    // 集合未创建或数据库异常：记录日志并照样返回（不影响问答主流程）
    console.warn('[learn_queue] 入队失败（可在云开发控制台创建 learn_queue 集合）:', err.message);
  }
}

// ===== 网页版反馈入库（写入云开发数据库 feedback 集合，控制台可直接查看） =====
async function handleFeedback(data = {}) {
  const rec = {
    q: String(data.q || '').slice(0, 300),
    rating: data.rating === 'good' ? 'good' : 'bad',
    comment: String(data.comment || '').slice(0, 500),
    mode: data.mode === 'ai' ? 'ai' : 'demo',
    ts: new Date().toISOString(),
  };
  try {
    const db = getCloud().database();
    await db.collection('feedback').add({ data: rec });
  } catch (err) {
    // 集合不存在或数据库异常时：记录日志并照样返回成功（访客浏览器本地还有一份）
    console.warn('[qa.feedback] 入库失败（可在云开发控制台创建 feedback 集合）:', err.message);
  }
  console.log('[feedback]', JSON.stringify(rec));
  return { ok: true };
}

// ===== HTTP 访问服务（云接入）适配层 =====
const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-hb-secret',
};

// CORS：配置 HTTP_CORS_ORIGINS 白名单后仅回显允许的来源；未配置时全放行（仅限演示期）
function corsHeaders(origin) {
  const list = String(process.env.HTTP_CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return { ...CORS_BASE, 'Access-Control-Allow-Origin': '*' };
  if (origin && list.includes(origin)) {
    return { ...CORS_BASE, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return {}; // 非白名单来源：不带 CORS 头，浏览器将拦截响应
}

// 取请求头（云接入 headers 键可能为小写，统一小写查找）
function getHeader(event, name) {
  const headers = event.headers || {};
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return String(headers[k] || '');
  }
  return '';
}

// 提取调用方 IP（云接入 requestContext.http.sourceIp 优先，回退 x-forwarded-for）
function getSourceIp(event) {
  const rc = event.requestContext || {};
  const ip = rc.http && rc.http.sourceIp;
  if (ip) return String(ip);
  const fwd = getHeader(event, 'x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

// 共享密钥校验：配置 HTTP_SHARED_SECRET 后生效（timingSafeEqual 防时序攻击）
function secretOk(event) {
  const secret = process.env.HTTP_SHARED_SECRET;
  if (!secret) return true;
  const got = getHeader(event, 'x-hb-secret');
  if (got.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  } catch (e) {
    return false;
  }
}

// 每 IP 每分钟 POST 限速（实例内存计数；实例回收即清零，属尽力而为的防刷）
const rateBuckets = new Map(); // ip -> { count, ts }
function rateLimited(ip) {
  const limit = parseInt(process.env.HTTP_RATE_LIMIT || '20', 10);
  if (!(limit > 0)) return false;
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now - b.ts > 60000) {
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (now - v.ts > 60000) rateBuckets.delete(k);
    }
    rateBuckets.set(ip, { count: 1, ts: now });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

function httpJson(obj, statusCode = 200, cors = null) {
  return {
    statusCode,
    headers: {
      ...(cors !== null ? cors : corsHeaders('')),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(obj),
  };
}

function parseHttpBody(event) {
  if (!event.body) return {};
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf-8');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function handleHttp(event) {
  const origin = getHeader(event, 'origin');
  const cors = corsHeaders(origin);

  // CORS 预检
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  // 健康检查（浏览器打开网址即可验证服务在线；无敏感信息，不需要密钥）
  if (event.httpMethod === 'GET') {
    return httpJson({ ok: true, service: 'hb-qa', time: new Date().toISOString() }, 200, cors);
  }
  if (event.httpMethod !== 'POST') {
    return httpJson({ error: '仅支持 POST' }, 405, cors);
  }

  // 共享密钥：未带或不匹配 → 401（不区分两种情况，避免给攻击者提示）
  if (!secretOk(event)) {
    console.warn('[qa.http] 拒绝请求：x-hb-secret 缺失或不匹配', getSourceIp(event));
    return httpJson({ error: '未授权' }, 401, cors);
  }

  // 每 IP 限速 → 429
  const ip = getSourceIp(event);
  if (rateLimited(ip)) {
    console.warn('[qa.http] 限速触发：', ip);
    return httpJson({ error: '请求太频繁，请稍后再试' }, 429, cors);
  }

  let data;
  try {
    data = parseHttpBody(event);
  } catch (e) {
    return httpJson({ error: '请求体必须是合法 JSON' }, 400, cors);
  }

  // 路由：按路径或请求体特征区分（body 带 rating 一律视为反馈，与网关路径改写无关）
  const p = String(event.path || '');
  const isFeedback = p.includes('feedback') || (data && data.rating);
  if (isFeedback) {
    return httpJson(await handleFeedback(data), 200, cors);
  }
  const result = await handleCall(data);
  return httpJson(result, 200, cors);
}

exports.main = async (event = {}, context = {}) => {
  // 云接入事件带 httpMethod/body；小程序直调事件是业务数据本身
  if (event && event.httpMethod) {
    try {
      return await handleHttp(event);
    } catch (err) {
      console.error('[qa.http] error:', err);
      // 不向客户端泄露内部错误细节（堆栈/依赖路径等）
      return httpJson({ answer: '', sources: [], error: '服务内部错误，请稍后重试' }, 500, corsHeaders(getHeader(event, 'origin')));
    }
  }
  const id = callIdentity(event, context);
  if (rateLimited('call:' + id)) {
    return { answer: '', sources: [], error: '请求太频繁，请稍后再试' };
  }
  return handleCall(event, context);
};
