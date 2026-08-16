# 向量索引存放处

部署云函数前，请在本目录放入向量索引文件 `index.json`：

```bash
# 1. 在 backend 目录完成知识库向量化
cd ../../backend
npm install
cp .env.example .env        # 填入 EMBEDDING_API_KEY 等
npm run ingest              # 生成 ../backend/data/index.json

# 2. 复制到本目录
cp ../backend/data/index.json ./data/index.json
```

云函数运行时通过 `fs.readFileSync(path.join(__dirname, 'data', 'index.json'))`（或环境变量 INDEX_FILE 指定路径）读取该索引，无需访问外部数据库。
