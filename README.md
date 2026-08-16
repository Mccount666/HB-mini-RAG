# 肝母细胞瘤智能问答小程序（RAG）

面向**肝母细胞瘤患儿家长**的微信小程序问答助手。后端采用 **RAG（检索增强生成）** 架构，
回答严格限定在权威知识库内，最大限度减少大模型"幻觉"。**大模型默认 DeepSeek**，向量化默认本地免 key 方案。

## 目录结构

```
hepatoblastoma-qa-miniprogram/
├── app.json / app.js / app.wxss         # 小程序全局配置（app.js 初始化云开发）
├── project.config.json / sitemap.json   # project.config.json 含 cloudfunctionRoot
├── pages/                               # index 问答 / history 历史 / about 须知
├── components/chat-message/             # 带"参考来源"引用的消息气泡
├── utils/                               # request 统一请求（自托管备用）、auth 登录
├── services/chat.js                     # 问答业务：调用云函数 qa（云开发后端）
├── backend/                             # Node.js RAG 后端（自托管 / 复用核心）
│   ├── .env.example                     # 配置大模型 / embedding / 检索阈值 / 护栏
│   ├── src/
│   │   ├── config.js
│   │   ├── rag/
│   │   │   ├── answer.js                # 问答全流程（门控→提示词→大模型→护栏）
│   │   │   ├── retriever.js             # 混合检索：向量余弦 + BM25 融合
│   │   │   ├── bm25.js                  # BM25 词法检索 + 查询覆盖率
│   │   │   ├── synonyms.js              # 医学同义词表 + 停用词
│   │   │   ├── query.js                 # 追问场景的检索查询构建
│   │   │   ├── guard.js                 # 生成后护栏：引用校验 + 数字溯源
│   │   │   ├── {embedder,llm,prompt}.js # 向量化 / 大模型(超时重试) / 严格提示词
│   │   ├── ocr/{ocr,interpret}.js         # 化验单 OCR 识别 + 严格解读
│   │   ├── kb/{index,ingest}.js
│   │   └── routes/{chat,auth}.js
│   ├── test/rag.test.js                 # 单元测试（node:test，npm test）
│   └── data/
│       ├── knowledge_base/
│       │   ├── sample.json               # 早期演示样本（待并入 ganya_articles 后停用）
│       │   ├── ganya_articles.json        # 《肝芽守护》科普文章结构化医学知识（待导师审核）
│       │   └── lab_reference.json         # 化验单参考区间（仅供 OCR 解读检索，待导师核对）
│       └── index.json                    # 由 ingest 生成的向量索引
├── cloudfunctions/qa/                   # 微信云开发云函数（复用 backend/src/rag + src/ocr）
│   ├── index.js
│   ├── src/rag/* + src/ocr/* + src/config.js  # 由 tools/sync-cloudfunction.js 同步
│   └── data/index.json                   # 由同步脚本拷贝
├── tools/
│   ├── sync-cloudfunction.js             # 把 RAG 核心 + 索引同步进云函数
│   ├── eval.js                           # 检索质量评测 + 阈值校准
│   ├── smoke.js                          # 端到端冒烟测试（mock 大模型）
│   └── kb-status.js                      # 知识库审核状态清单
└── docs/architecture.md                 # 系统架构与控幻觉设计
```

## 快速开始

### 1. 小程序前端（微信开发者工具）
1. 用微信开发者工具导入本项目根目录（已含 `cloudfunctionRoot`，工具会识别云函数）
2. 把 `project.config.json` 的 `appid` 换成你自己的小程序 AppID
3. 把 `app.js` 里 `wx.cloud.init` 的 `env` 换成你的**云开发环境 ID**
> 前端已改为调用云函数 `qa`，不再需要 `utils/request.js` 的 `BASE_URL`。若改自托管后端，把 `services/chat.js` 换回 `utils/request` 的 `POST /api/chat` 即可。

### 2. 接入大模型（默认 DeepSeek）
```bash
cd backend
npm install
cp .env.example .env
```
编辑 `.env`，只改一行把 Key 填进去（其余已是 DeepSeek 默认值）：
```
LLM_API_KEY=sk-你的DeepSeekKey在这里填      # ← 你自填
LLM_BASE_URL=https://api.deepseek.com/v1    # DeepSeek 需 /v1 前缀（已默认）
LLM_MODEL=deepseek-chat                     # 已默认
```
> **向量化默认本地免 key**：DeepSeek 不提供 embedding 接口，本项目默认用本地哈希向量化，
> 所以整套系统**只用一个 DeepSeek Key 即可跑通**。如需更高质量检索，在 `.env` 把
> `EMBEDDING_PROVIDER=api` 并提供 embedding Key（OpenAI / 中文 embedding 服务）即可。

### 3. 生成知识库向量索引
```bash
npm run ingest        # 读取知识库 → 本地向量化 → data/index.json
node tools/kb-status.js   # 查看待导师审核清单
```

### 4. 部署到微信云开发（推荐，免服务器、天然 HTTPS）
```bash
node tools/sync-cloudfunction.js   # 把 RAG 核心 + index.json 同步进 cloudfunctions/qa
```
然后在微信开发者工具中**右键 `cloudfunctions/qa` → 上传并部署（云端安装依赖）**。
在云函数环境变量里填入：`LLM_API_KEY`（其余可留默认）。前端即可通过 `wx.cloud.callFunction` 调用。

### 5. 自托管后端（可选）
```bash
npm start            # http://localhost:3000
curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' \
  -d '{"message":"肝母细胞瘤是什么？"}'
```
> 云开发与自托管后端共用同一套 `backend/src/rag` 防幻觉逻辑，只是部署形态不同。

### 6. 化验单 OCR 解读（拍照→识别→基于诊断标准解读）

家长在问答页点「＋化验单」拍照/选图 → 上传云存储 → 云函数 `qa`（type:'ocr'）识别并解读。
解读严格基于 `lab_reference.json` 的参考区间，并强制"以化验单标注区间为准"。

```bash
# 默认 OCR_PROVIDER=mock：免 key，返回演示化验单，便于无 OCR key 时跑通整条管线
# 生产接真实识别：在腾讯云控制台开通「文字识别」，填密钥后切 tencent
#   OCR_PROVIDER=tencent
#   TENCENT_SECRET_ID=你的SecretId
#   TENCENT_SECRET_KEY=你的SecretKey
```

> OCR 解读同样走"检索增强 + 严格提示词 + 来源可溯"，且只在 `lab_reference` 分类内检索，
> 保证 AFP、ALT、WBC 等每条异常都被引用、严格基于诊断标准。详见 `docs/architecture.md` 第三节。

## 控幻觉六道防线（详见 docs/architecture.md）
1. **混合检索**：向量余弦 + BM25 词法（含医学同义词扩展）加权融合，术语类问题精确命中
2. **检索优先**：先检索知识库，再决定是否生成
3. **置信度门控**：融合分低于阈值直接拒答，**根本不调大模型**（本地向量化实测阈值 0.35，用 `node tools/eval.js` 校准）
4. **严格提示词**：仅允许依据 `<知识库>` 作答，强制 `[来源N]` 引用，数字必须与原文逐字一致，无内容必拒答
5. **生成后护栏**：机检回答——无效引用剔除；关键数字（剂量/百分比等）必须能在知识库找到原文，否则整条拒答；无引用时强化重试一次，仍无引用则拒答
6. **来源可溯**：每条回答回传 `sources`，前端可点开看出处

> "近邻问题"（如"糖尿病饮食注意什么"）与知识库共享表面词，检索层无法完全分隔——
> 这类问题会进入大模型，由严格提示词拒答 + 护栏兜底（tools/eval.js 中标记为 ⚠ 预期行为）。

## 质量工具
```bash
cd backend && npm test          # 11 项单元测试：同义词/BM25/门控分隔/护栏/追问
node tools/eval.js              # 检索评测：范围内命中率、出范围拦截、阈值建议
node tools/smoke.js             # 端到端冒烟（需先 npm run ingest）：mock 大模型跑全链路
```

## 知识库审核工作流（上线前必做）

知识库位于 `backend/data/knowledge_base/`，共三份：
- `ganya_articles.json` —— 《肝芽守护》科普文章结构化医学知识（**当前为按文章主题编写的占位草稿**，待替换为真实文章导出）
- `lab_reference.json` —— 化验单常用项目参考区间（**仅供 OCR 解读检索**，待导师核对为本实验室标准）
- `sample.json` —— 早期演示样本（建议逐步并入 `ganya_articles.json` 后停用）

> ⚠️ **关于《肝芽守护》真实文章**：本仓库的 `ganya_articles.json` 是我按那些科普文章会覆盖的医学主题**编写的结构化草稿**（标注 `source: 《肝芽守护》科普文章（待替换为原文导出）`）。
> 我无法访问公众号后台原文，所以上线前请按 `knowledge_base/README.md` 把真实文章导出、按相同格式覆盖进去，再由导师审核。

全部条目均为 `reviewed:false` 的**演示数据**，上线前必须由科室高年资医生（导师）终审：
1. 逐条核对 `backend/data/knowledge_base/REVIEW.md` 的审核清单
2. 通过后在 JSON 把 `reviewed` 改为 `true`，并填 `reviewedBy` / `reviewedAt`
3. 全部通过后，在 `.env` 设 `KB_ONLY_REVIEWED=true`（**安全门控**：仅已审核内容进检索库）
4. 重新 `npm run ingest` → `node tools/sync-cloudfunction.js` → 重新部署云函数
随时跑 `node tools/kb-status.js` 看审核进度（当前共 44 条待审）。

> ⚠️ 未设 `KB_ONLY_REVIEWED=true` 前，演示数据会进入检索库，仅供内部测试，**不得对家长开放**。

## 上线合规提醒
- 云开发天然 HTTPS、无需备案域名；若自托管需配置 request 合法域名（HTTPS）
- 完善《隐私保护指引》，问答属于个人信息处理，需明确告知并取得同意
- 医疗健康类目可能要求机构资质，提前准备（建议用科室机构主体注册）
- 显著位置展示免责声明（"不能替代医生诊断"）
- 前端文案**不出现具体医院名称**，符合合规要求
