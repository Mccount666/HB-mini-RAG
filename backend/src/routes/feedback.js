// backend/src/routes/feedback.js - 反馈收集接口（网页测试版）
// POST /api/feedback { q, rating, comment, mode, ts } → 追加记录（内存 + 尽力写文件）
// GET  /api/feedback → 查看已收集的反馈（供开发者核对）
// 注意：免费托管平台（如 Render 免费层）磁盘是临时的，重启后文件会丢；
//      反馈同时会存在访客浏览器本地（可导出）。正式收集建议后续接数据库。
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const memory = [];
const FEEDBACK_FILE = path.join(__dirname, '..', '..', 'data', 'feedback.json');

router.post('/feedback', (req, res) => {
  const { q, rating, comment, mode } = req.body || {};
  if (!rating || !['good', 'bad'].includes(rating)) {
    return res.status(400).json({ message: 'rating 必须为 good 或 bad' });
  }
  const rec = {
    q: String(q || '').slice(0, 300),
    rating,
    comment: String(comment || '').slice(0, 500),
    mode: mode === 'ai' ? 'ai' : 'demo',
    ts: new Date().toISOString(),
  };
  memory.push(rec);
  try {
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(rec) + '\n');
  } catch (e) { /* 只读文件系统时忽略，内存中仍有 */ }
  res.json({ ok: true, total: memory.length });
});

router.get('/feedback', (req, res) => {
  let lines = [];
  try {
    lines = fs.readFileSync(FEEDBACK_FILE, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { /* 文件不存在时仅返回内存 */ }
  res.json({ total: lines.length + memory.length, feedback: [...lines, ...memory] });
});

module.exports = router;
