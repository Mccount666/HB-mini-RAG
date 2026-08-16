# 云函数 qa 部署说明

本云函数复用 `backend/src/rag` 的 RAG 管线，无需自建服务器。

## 前置
- 微信开发者工具已开通「云开发」
- 已创建云环境，记下环境 ID

## 步骤
1. 在 `backend` 目录生成向量索引并复制到本函数目录：
   ```bash
   cd ../../backend
   npm install && cp .env.example .env   # 填 EMBEDDING_API_KEY / LLM_API_KEY
   npm run ingest
   cp data/index.json ../cloudfunctions/qa/data/index.json
   ```
2. 在微信开发者工具的「云开发 → 云函数」中右键 `cloudfunctions/qa` 上传并部署（云端安装依赖）。
3. 在云开发控制台 → 云函数 `qa` → 配置 → 环境变量，填入：
   - `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`
   - `EMBEDDING_API_KEY`、`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_DIM`
   - `RETRIEVAL_TOP_K`、`RETRIEVAL_THRESHOLD`、`STRICT_RETRIEVAL`
   - （可选）`INDEX_FILE`：若索引不放默认 `data/index.json` 路径，用此覆盖
4. 小程序端调用（前端 `utils/request.js` 改为云函数模式，或直接在页面用 `wx.cloud.callFunction`）：
   ```js
   const res = await wx.cloud.callFunction({ name: 'qa', data: { message: '术后饮食注意什么？', history: [] } });
   // res.result = { answer, sources, confidence, retrieved }
   ```

## 注意
- 向量索引随云函数包上传，知识库更新后需重新 ingest 并重新部署云函数。
- 大模型/向量库均可插拔，改环境变量即可换模型，无需改代码。
