# 网页测试版（v0.0.2）部署与运维说明

## 架构

```
访客浏览器（手机/电脑）
  └─ https://mccount666.github.io/HB-mini-RAG/     ← GitHub Pages 静态托管（免费、HTTPS）
       ├─ 演示模式（默认）：检索/门控/拒答在浏览器本地完成，展示知识库原文，零生成零幻觉
       └─ AI 模式：POST {API_BASE}/api/chat        ← 免费后端（Render），调 DeepSeek 生成回答
                                                    ↘ Key 只存在后端环境变量，前端永不接触
```

- 网页代码在 `web/`，其中 `rag-client.js` 是 `backend/src/rag` 防幻觉逻辑的浏览器移植版
  （修改后端检索逻辑时需同步更新）。
- 知识库向量索引 `web/data/index.json` 随仓库分发；**修改知识库后**：
  `cd backend && npm run ingest`，然后 `cp backend/data/index.json web/data/index.json`，
  再重新发布网页。

## 发布网页（日常更新）

```bash
node tools/deploy-pages.js
# 如需同时让所有访客切换 AI 模式：
node tools/deploy-pages.js --api=https://你的后端地址.onrender.com
```

## 部署后端（AI 模式，一次性）

1. 注册/登录 [render.com](https://render.com)（可直接用 GitHub 账号授权）
2. Dashboard → **New → Blueprint** → 选择本仓库 → Apply（会读取根目录 `render.yaml`）
3. 在服务的 **Environment** 里添加环境变量：`LLM_API_KEY=sk-你的DeepSeekKey`
4. 等待部署完成，拿到形如 `https://hb-qa-backend.onrender.com` 的地址
5. 把地址告诉开发者或自己运行：
   `node tools/deploy-pages.js --api=https://hb-qa-backend.onrender.com`

> 免费层限制：15 分钟无访问会休眠，下一次首次请求约需 30-60 秒唤醒，请提前告知测试的朋友。
> 反馈数据存访客浏览器本地 + 后端内存/临时文件（重启会丢），正式运营前应接数据库。

## 反馈查看

- 后端在线时：`GET https://你的后端地址/api/feedback`
- 访客本地：页面右上角 ⚙ → 「导出本机反馈」

## 安全要点

- DeepSeek Key 只存在 Render 环境变量（`backend/.env` 仅本地，均不进 git）
- 网页端不出现任何密钥；`web/config.js` 只有后端地址
