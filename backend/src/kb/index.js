// backend/src/kb/index.js - 知识库加载
// 读取 data/knowledge_base 下所有 .json，每条结构：
// { id, category, question, answer, source, reviewed, reviewedBy, reviewedAt }
// reviewed=true 且 reviewedBy 非空 表示导师已终审通过。
const fs = require('fs');
const path = require('path');
const config = require('../config');

function loadKnowledge({ onlyReviewed = config.kb.onlyReviewed } = {}) {
  const dir = config.paths.kbDir;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const entries = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    for (const item of arr) {
      const reviewed = !!item.reviewed;
      // 上线门控：onlyReviewed=true 时丢弃未审核条目，避免演示数据流向家长
      if (onlyReviewed && !reviewed) continue;
      entries.push({
        id: item.id,
        category: item.category || '',
        text: `问题：${item.question}\n回答：${item.answer}`,
        title: item.question,
        excerpt: (item.answer || '').slice(0, 120),
        source: item.source || '',
        reviewed,
        reviewedBy: item.reviewedBy || '',
        reviewedAt: item.reviewedAt || '',
      });
    }
  }
  return entries;
}

module.exports = { loadKnowledge };
