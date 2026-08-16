// backend/src/routes/chat.js - 问答接口（流程实现见 src/rag/answer.js）
const express = require('express');
const { answerQuestion } = require('../rag/answer');

const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: 'message 不能为空' });
    }
    const result = await answerQuestion(String(message), history || []);
    res.json(result);
  } catch (err) {
    console.error('[/api/chat] error:', err);
    res.status(500).json({ message: '服务内部错误', detail: err.message });
  }
});

module.exports = router;
