// backend/src/kb/index.js - 知识库加载
// 读取 data/knowledge_base 下所有 .json，每条结构：
// { id, category, question, answer, source, reviewed, reviewedBy, reviewedAt }
// reviewed===true 且 reviewedBy 非空 表示导师已终审通过（终审契约，见 REVIEW.md）。
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 终审判定：reviewed 严格等于 true 且 reviewedBy 非空，两条缺一不可
function isReviewed(item) {
  return Boolean(item && item.reviewed === true && item.reviewedBy && String(item.reviewedBy).trim());
}

function loadKnowledge({ onlyReviewed = config.kb.onlyReviewed } = {}) {
  const dir = config.paths.kbDir;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const entries = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    for (const item of arr) {
      const reviewed = isReviewed(item);
      // 上线门控：onlyReviewed=true 时只保留导师终审条目；化验参考标准
      //（lab_reference 分类）属客观参考区间数据，非科普演示，始终保留（OCR 解读依赖）。
      if (onlyReviewed && !reviewed && item.category !== 'lab_reference') continue;
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

module.exports = { loadKnowledge, isReviewed };
