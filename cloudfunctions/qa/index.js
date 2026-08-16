// cloudfunctions/qa/index.js - 微信云开发云函数入口
// 复用 backend/src/rag 的同一套 RAG 管线（防幻觉逻辑单一来源）。
// 支持两种调用：
//   type 缺省/'chat' : { message, history } → 文本问答
//   type:'ocr'       : { fileID }          → 化验单 OCR 识别 + 解读
// 部署前运行 tools/sync-cloudfunction.js，把 rag / ocr 模块与 config 同步进本目录。
const path = require('path');

// 云函数自带 data/index.json；优先级：环境变量 INDEX_FILE > 本目录 data/index.json
process.env.INDEX_FILE = process.env.INDEX_FILE || path.join(__dirname, 'data', 'index.json');

const { answerQuestion } = require('./src/rag/answer');
const { ocrFromFile } = require('./src/ocr/ocr');
const { interpretLabReport } = require('./src/ocr/interpret');

let cloudInited = false;
// 从云存储下载图片到临时文件（仅在 OCR 分支调用，wx-server-sdk 懒加载以避免本地缺包报错）
async function downloadFromCloud(fileID) {
  const cloud = require('wx-server-sdk');
  if (!cloudInited) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    cloudInited = true;
  }
  const res = await cloud.downloadFile({ fileID });
  if (res.statusCode !== 200) throw new Error('下载图片失败: ' + res.statusCode);
  return res.tempFilePath;
}

exports.main = async (event = {}, context = {}) => {
  const { type, message, history, fileID } = event || {};

  // ===== OCR 化验单解读分支 =====
  if (type === 'ocr') {
    try {
      if (!fileID) return { type: 'ocr', error: 'fileID 不能为空' };
      const tempFilePath = await downloadFromCloud(fileID);
      const rawText = await ocrFromFile(tempFilePath);
      const { interpretation, sources } = await interpretLabReport(rawText, history || []);
      return { type: 'ocr', rawText, interpretation, sources };
    } catch (err) {
      console.error('[qa.ocr] error:', err);
      return { type: 'ocr', rawText: '', interpretation: '化验单处理失败，请重试或咨询医护。', sources: [], error: err.message };
    }
  }

  // ===== 文本问答分支 =====
  if (!message || !String(message).trim()) {
    return { answer: '', sources: [], error: 'message 不能为空' };
  }
  try {
    // 全流程（混合检索 → 门控 → 严格提示词 → 大模型 → 生成后护栏）见 src/rag/answer.js
    const result = await answerQuestion(String(message), history || []);
    return result;
  } catch (err) {
    console.error('[qa] error:', err);
    return { answer: '', sources: [], error: err.message };
  }
};
