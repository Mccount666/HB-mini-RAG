// backend/src/rag/sanitize.js - 问答输入清洗（自托管后端与云函数共用）
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_TURNS = 6;

function sanitizeMessage(message) {
  return String(message || '').trim().slice(0, MAX_MESSAGE_LEN);
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((h) => ({ role: h.role, content: h.content.slice(0, MAX_MESSAGE_LEN) }));
}

module.exports = { MAX_MESSAGE_LEN, MAX_HISTORY_TURNS, sanitizeMessage, sanitizeHistory };
