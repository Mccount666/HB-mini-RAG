// cloudfunctions/qa/index.js - 微信云开发云函数入口
// 复用 backend/src/rag 的同一套 RAG 管线（防幻觉逻辑单一来源）。
// 支持三种调用：
//   1. 小程序直调  wx.cloud.callFunction({name:'qa'})
//      · 文本问答 : { message, history }
//      · 化验单   : { type:'ocr', fileID }
//      · 反馈     : { type:'feedback', q, rating:'good'|'bad', comment }
//   2. HTTP 访问服务（云接入）——供网页版（GitHub Pages / 静态托管）跨域调用：
//      POST /api/chat     body {"message": "...", "history": []}
//      POST /api/feedback body {"q": "...", "rating": "good|bad", "comment": "..."}
//      GET  任意路径 → 健康检查；OPTIONS → CORS 预检
// 部署前运行 tools/sync-cloudfunction.js，把 rag / ocr 模块与 config 同步进本目录。
const path = require('path');
const fs = require('fs');
const os = require('os');

// 云函数自带 data/index.json；优先级：环境变量 INDEX_FILE > 本目录 data/index.json
process.env.INDEX_FILE = process.env.INDEX_FILE || path.join(__dirname, 'data', 'index.json');

const { answerQuestion } = require('./src/rag/answer');
const { ocrFromFile } = require('./src/ocr/ocr');
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

// 从云存储下载图片到临时文件（仅在 OCR 分支调用，wx-server-sdk 懒加载以避免本地缺包报错）
// 注意：wx-server-sdk 的 downloadFile 返回 fileContent（Buffer），没有小程序端的 tempFilePath，
// 必须落盘成临时文件再交给 OCR（tencentOcr 内部按路径 readFileSync）。
async function downloadFromCloud(fileID) {
  const cloud = getCloud();
  const res = await cloud.downloadFile({ fileID });
  if (res.statusCode !== 200) throw new Error('下载图片失败: ' + res.statusCode);
  const ext = path.extname(String(fileID).split('?')[0]) || '.png';
  const tmp = path.join(os.tmpdir(), 'ocr-' + Date.now() + ext);
  fs.writeFileSync(tmp, res.fileContent);
  return tmp;
}

// ===== 业务处理（小程序直调事件） =====
async function handleCall(event = {}) {
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
      // extract（默认）
      if (!fileID) return { type: 'ocr', error: 'fileID 不能为空' };
      const tempFilePath = await downloadFromCloud(fileID);
      const rawText = await ocrFromFile(tempFilePath);
      return { type: 'ocr', step: 'extract', rawText, interpretation: '', sources: [] };
    } catch (err) {
      console.error('[qa.ocr] error:', err);
      return { type: 'ocr', step, rawText: '', interpretation: '化验单处理失败，请重试或咨询医护。', sources: [], error: err.message };
    }
  }

  // ===== 文本问答分支 =====
  if (!message || !String(message).trim()) {
    return { answer: '', sources: [], error: 'message 不能为空' };
  }
  try {
    // 全流程（混合检索 → 机械命中或 LLM 语义判定 → 严格提示词 → 大模型 → 生成后护栏）
    // 见 src/rag/answer.js；相关但知识库未收录时返回 learning:true + learnQuestion
    const result = await answerQuestion(String(message), history || []);
    if (result.learning && result.learnQuestion) {
      await pushLearnQueue(result.learnQuestion, 'text');
    }
    return result;
  } catch (err) {
    console.error('[qa] error:', err);
    return { answer: '', sources: [], error: err.message };
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
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function httpJson(obj, statusCode = 200) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
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
  // CORS 预检
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  // 健康检查（浏览器打开网址即可验证服务在线）
  if (event.httpMethod === 'GET') {
    return httpJson({ ok: true, service: 'hb-qa', time: new Date().toISOString() });
  }
  if (event.httpMethod !== 'POST') {
    return httpJson({ error: '仅支持 POST' }, 405);
  }

  let data;
  try {
    data = parseHttpBody(event);
  } catch (e) {
    return httpJson({ error: '请求体必须是合法 JSON' }, 400);
  }

  // 路由：按路径或请求体特征区分（body 带 rating 一律视为反馈，与网关路径改写无关）
  const p = String(event.path || '');
  const isFeedback = p.includes('feedback') || (data && data.rating);
  if (isFeedback) {
    return httpJson(await handleFeedback(data));
  }
  const result = await handleCall(data);
  return httpJson(result);
}

exports.main = async (event = {}, context = {}) => {
  // 云接入事件带 httpMethod/body；小程序直调事件是业务数据本身
  if (event && event.httpMethod) {
    try {
      return await handleHttp(event);
    } catch (err) {
      console.error('[qa.http] error:', err);
      return httpJson({ answer: '', sources: [], error: '服务内部错误：' + err.message }, 500);
    }
  }
  return handleCall(event);
};
