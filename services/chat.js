// services/chat.js - 调用云函数 qa 进行 RAG 问答（云开发后端）
// 若改为自托管 Express 后端，把本文件内部换成 utils/request 的 POST /api/chat 即可。
const ask = (message, history = []) => {
  return new Promise((resolve, reject) => {
    if (!message || !message.trim()) {
      reject(new Error('问题不能为空'));
      return;
    }
    if (!wx.cloud) {
      reject(new Error('云能力未初始化，请确认已开通云开发'));
      return;
    }
    wx.cloud.callFunction({
      name: 'qa',
      data: { message, history: history.slice(-6) }, // 仅带最近若干轮作为上下文
      success: (res) => {
        const result = res.result || {};
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        resolve({
          answer: result.answer,
          sources: result.sources || [],
          confidence: result.confidence,
        });
      },
      fail: (err) => reject(err),
    });
  });
};

// 化验单 OCR 解读：上传到云存储后得到 fileID，调用云函数 qa（type:'ocr'）
const analyzeReport = (fileID) => {
  return new Promise((resolve, reject) => {
    if (!fileID) {
      reject(new Error('fileID 不能为空'));
      return;
    }
    if (!wx.cloud) {
      reject(new Error('云能力未初始化，请确认已开通云开发'));
      return;
    }
    wx.cloud.callFunction({
      name: 'qa',
      data: { type: 'ocr', fileID },
      success: (res) => {
        const result = res.result || {};
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        resolve({
          rawText: result.rawText,
          interpretation: result.interpretation,
          sources: result.sources || [],
        });
      },
      fail: (err) => reject(err),
    });
  });
};

// 对某条回答评价 👍/👎：写入云数据库 feedback 集合（与网页版同表）
// data: { q: 用户问题, rating: 'good'|'bad', comment?: '' }
const sendFeedback = (data) => {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('云能力未初始化，请确认已开通云开发'));
      return;
    }
    wx.cloud.callFunction({
      name: 'qa',
      data: { type: 'feedback', comment: '', mode: 'ai', ...data },
      success: (res) => {
        const result = res.result || {};
        if (result.ok) {
          resolve(result);
        } else {
          reject(new Error(result.error || '反馈提交失败'));
        }
      },
      fail: (err) => reject(err),
    });
  });
};

module.exports = { ask, analyzeReport, sendFeedback };
