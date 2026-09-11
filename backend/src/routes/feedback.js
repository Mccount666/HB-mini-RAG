// backend/src/routes/feedback.js - 反馈收集接口（网页测试版）
// POST /api/feedback { q, rating, comment, mode, ts } → 追加记录（内存 + 尽力写文件）
// GET  /api/feedback → 查看已收集的反馈，需管理令牌（x-admin-token 匹配 ADMIN_TOKEN），
//      未配置 ADMIN_TOKEN 时直接关闭该端点（避免反馈内容被匿名拉取）。
// 注意：免费托管平台（如 Render 免费层）磁盘是临时的，重启后文件会丢；
//      反馈同时会存在访客浏览器本地（可导出）。正式收集建议后续接数据库。
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const memory = [];
const FEEDBACK_FILE = path.join(__dirname, '..', '..', 'data', 'feedback.json');

// 管理令牌校验（timingSafeEqual 防时序攻击）
function adminAuthorized(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const got = String(req.headers['x-admin-token'] || '');
  if (got.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token));
  } catch (e) {
    return false;
  }
}

router.post('/feedback', (req, res) => {
  const { q, rating, comment, mode, topicKey, topicLabel } = req.body || {};
  if (!rating || !['good', 'bad'].includes(rating)) {
    return res.status(400).json({ message: 'rating 必须为 good 或 bad' });
  }
  const rec = {
    q: String(q || '').slice(0, 300),
    rating,
    comment: String(comment || '').slice(0, 500),
    mode: mode === 'ai' ? 'ai' : 'demo',
    topicKey: String(topicKey || '').slice(0, 40),
    topicLabel: String(topicLabel || '').slice(0, 40),
    ts: new Date().toISOString(),
  };
  let persisted = false;
  try {
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(rec) + '\n');
    persisted = true;
  } catch (e) {
    memory.push(rec);
  }
  res.json({ ok: true, persisted });
});

router.get('/feedback', (req, res) => {
  if (!adminAuthorized(req)) {
    return res.status(401).json({ message: '查看反馈需配置 ADMIN_TOKEN 并携带 x-admin-token 请求头' });
  }
  let lines = [];
  try {
    lines = fs.readFileSync(FEEDBACK_FILE, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { /* 文件不存在时仅返回内存 */ }
  const feedback = [...lines, ...memory];
  const topicStats = feedback.reduce((acc, item) => {
    const label = item.topicLabel || '未分类';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  res.json({ total: feedback.length, feedback, topicStats });
});

module.exports = router;
