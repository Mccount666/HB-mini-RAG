// backend/src/routes/chat.js - 问答接口（流程实现见 src/rag/answer.js）
// 自托管后端：当答案带 learning 标记（相关但知识库未收录）时，把问题追加到
// data/learn_queue.jsonl，供工程师定期查看、补充知识（与云函数 learn_queue 集合同义）。
const express = require('express');
const fs = require('fs');
const path = require('path');
const { answerQuestion } = require('../rag/answer');

const router = express.Router();
const LEARN_FILE = path.join(__dirname, '..', '..', 'data', 'learn_queue.jsonl');

function recordLearn(question) {
  const rec = { question: String(question || '').slice(0, 500), status: 'pending', ts: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(LEARN_FILE), { recursive: true });
    fs.appendFileSync(LEARN_FILE, JSON.stringify(rec) + '\n');
  } catch (e) { /* 只读文件系统时忽略（云函数走数据库集合） */ }
}

router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: 'message 不能为空' });
    }
    const result = await answerQuestion(String(message), history || []);
    if (result.learning && result.learnQuestion) {
      recordLearn(result.learnQuestion);
    }
    res.json(result);
  } catch (err) {
    console.error('[/api/chat] error:', err);
    res.status(500).json({ message: '服务内部错误', detail: err.message });
  }
});

module.exports = router;
