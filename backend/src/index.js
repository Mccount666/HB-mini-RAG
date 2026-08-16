// backend/src/index.js - 服务入口
const express = require('express');
const cors = require('cors');
const config = require('./config');
const chatRouter = require('./routes/chat');
const authRouter = require('./routes/auth');
const feedbackRouter = require('./routes/feedback');

const app = express();
app.use(cors());
app.use(express.json());

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
});
