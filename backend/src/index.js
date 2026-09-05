// backend/src/index.js - 服务入口
const express = require('express');
const cors = require('cors');
const config = require('./config');
const chatRouter = require('./routes/chat');
const authRouter = require('./routes/auth');
const feedbackRouter = require('./routes/feedback');

const app = express();
app.use(express.json({ limit: '256kb' }));

// CORS 白名单：ALLOWED_ORIGINS 配置逗号分隔域名列表（如网页版部署域名）；
// 未配置时回退为全放行（仅限本地开发/演示，生产部署务必配置）。
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false); // 非白名单来源：不带 CORS 头，浏览器将拦截响应
    },
  })
);

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', authRouter);
app.use('/api', chatRouter);
app.use('/api', feedbackRouter);

app.listen(config.port, () => {
  console.log(`肝母细胞瘤 RAG 后端已启动: http://localhost:${config.port}`);
  console.log(
    `检索阈值=${config.retrieval.threshold} topK=${config.retrieval.topK} strict=${config.retrieval.strict}`
  );
  console.log('提示：首次运行请先 `npm install` 再 `npm run ingest` 生成向量索引。');
  console.log(
    allowedOrigins.length
      ? `CORS 白名单：${allowedOrigins.join(', ')}`
      : '⚠ CORS 全放行（未配置 ALLOWED_ORIGINS），生产部署前请在 .env 配置网页版域名'
  );
});
