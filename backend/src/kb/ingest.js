// backend/src/kb/ingest.js - 将知识库向量化，生成 data/index.json
// 运行：npm run ingest
// 仅收录：KB_ONLY_REVIEWED=true 时只向量化导师已审核条目（终审=reviewed===true 且 reviewedBy 非空）
// buildItems 同时导出给 tools/eval.js 复用（在内存中构建条目，不写盘）
const fs = require('fs');
const config = require('../config');
const { loadKnowledge } = require('./index');
const { embed } = require('../rag/embedder');

async function buildItems({ onlyReviewed = config.kb.onlyReviewed } = {}) {
  const entries = loadKnowledge({ onlyReviewed });
  const items = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    process.stdout.write(`  [${i + 1}/${entries.length}] ${e.id}\r`);
    const embedding = await embed(e.text);
    // 维度一致性校验：换 embedding provider/维度后未重 ingest 会静默错算（cosine 只遍历前 N 维）
    if (embedding.length !== config.embedding.dim) {
      throw new Error(
        `条目 ${e.id} 向量维度 ${embedding.length} 与配置 EMBEDDING_DIM=${config.embedding.dim} 不一致。` +
          '切换 embedding 配置后必须先清空旧索引并重新 npm run ingest。'
      );
    }
    items.push({ ...e, embedding });
  }
  process.stdout.write('\n');
  return items;
}

async function main() {
  const onlyReviewed = config.kb.onlyReviewed;
  console.log('读取知识库…', onlyReviewed ? '(仅已审核条目)' : '(含未审核演示条目)');
  const items = await buildItems({ onlyReviewed });

  const dim = items.length ? items[0].embedding.length : config.embedding.dim;
  fs.writeFileSync(
    config.paths.indexFile,
    JSON.stringify({ dim, onlyReviewed, generatedAt: new Date().toISOString(), items }, null, 2)
  );
  console.log(`向量索引已生成：${config.paths.indexFile}（维度 ${dim}，条目 ${items.length}）`);
  if (onlyReviewed && items.length === 0) {
    console.warn('⚠️ 当前 KB_ONLY_REVIEWED=true 但无已审核条目，检索库为空，家长将收到兜底拒答。');
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n摄入失败：', e.message);
    process.exit(1);
  });
}

module.exports = { buildItems };
