# 肝芽守护小程序上线清单

更新时间：2026-09-10

## 当前代码状态

- 小程序 AppID：`wx92ba1d52a0eb2e43`
- 云开发环境：`cloud1-d9gcm6bdkca62b5ac`
- 本地知识库索引：`backend/data/index.json`、`cloudfunctions/qa/data/index.json`、`web/data/index.json` 均为 167 条导师终审门控版。
- 已启用微信隐私接口检查：`app.json` 中 `__usePrivacyCheck__ = true`。
- 化验单上传前已增加隐私授权弹窗，覆盖相册/相机与云端 OCR 临时上传说明。
- “使用须知”页已改为 167 条导师终审版说明，不再写“示例数据仅供演示”。

## 已通过的本地质量检查

```bash
node --check app.js
node --check pages/index/index.js
node --check tools/smoke.js
node tools/check-sync.js
node tools/smoke.js
cd backend && npm test
```

检查结果：

- JS/JSON 语法检查通过。
- `backend/src` 与 `cloudfunctions/qa/src` 同步检查通过。
- 后端单元测试 36/36 通过。
- RAG/OCR 冒烟测试全部通过。
- `git diff --check` 无空白错误。

## 提审前必须在微信公众平台完成

1. 登录微信公众平台：`mp.weixin.qq.com`。
2. 进入当前小程序后台。
3. 打开「设置」→「服务内容声明」/「隐私保护指引」。
4. 确认隐私保护指引覆盖以下用途：
   - 选择图片或拍摄图片：用于上传化验单图片。
   - 图片会临时上传到云开发存储，用于 OCR 文字识别和解读。
   - 识别出的化验单文字仅用于本次 AI 解读和安全溯源。
5. 发布/生效隐私保护指引后，再在开发者工具里真机预览一次“上传化验单”流程。

## 提审前必须在微信开发者工具验证

1. 导入目录：`C:\Users\Mccou\Desktop\hepatoblastoma-qa-miniprogram`。
2. 顶部选择当前 AppID：`wx92ba1d52a0eb2e43`。
3. 点击「编译」，确认首页、历史记录、使用须知三页正常打开。
4. 在首页测试文本问答：
   - 问：`肝母细胞瘤是什么？`
   - 预期：返回带来源的回答。
5. 测试出范围拒答：
   - 问：`今天天气怎么样？`
   - 预期：拒答或学习话术，不给具体天气建议。
6. 测试化验单上传：
   - 点击左下角 `＋`。
   - 首次应出现隐私授权弹窗。
   - 点击「查看《用户隐私保护指引》」应能打开微信官方隐私指引页。
   - 点击「同意并继续」后，应能选择相册/相机图片。
   - 上传测试样张后，应进入“识别文字待确认 → 用户确认 → 解读”两段式流程。
7. 测试反馈按钮：对回答点 👍/👎，确认无报错。

## 云开发控制台核对项

环境：`cloud1-d9gcm6bdkca62b5ac`

1. 云函数 `qa`
   - 代码已包含 `data/index.json` 167 条终审门控版。
   - 环境变量需存在：
     - `LLM_API_KEY`
     - `LLM_BASE_URL`（可选；未配置时默认 DeepSeek OpenAI 兼容地址）
     - `LLM_MODEL`（可选；未配置时默认 `deepseek-chat`）
     - `OCR_PROVIDER`（当前应为 `tencent`）
     - `TENCENT_SECRET_ID`
     - `TENCENT_SECRET_KEY`
     - `HTTP_SHARED_SECRET`
     - `HTTP_RATE_LIMIT`
     - `HTTP_CORS_ORIGINS`
   - 当前 CLI 核对结果：环境状态 NORMAL；`qa` 云函数 Active/Available；运行时 Nodejs16.13；超时时间 20s；环境变量已包含 LLM、腾讯 OCR、HTTP 共享密钥、限流、CORS 白名单。`LLM_BASE_URL`、`LLM_MODEL`、`KB_ONLY_REVIEWED` 未显式配置，但前两者有代码默认值，当前部署包内索引已是 167 条全量终审版。
2. 数据库集合
   - `feedback`：用于 👍/👎 反馈。
   - `learn_queue`：用于相关但知识库不足的问题积累。
3. 云存储
   - 化验单上传路径只应使用 `lab-reports/` 前缀。
4. HTTP 访问服务
   - `/api/chat` 指向云函数 `qa`。
   - `/api/feedback` 指向云函数 `qa`。
   - POST 需校验 `x-hb-secret`（如已配置 `HTTP_SHARED_SECRET`）。

## 小程序提审建议文案

版本说明可写：

> 肝母细胞瘤家长科普问答助手。基于 167 条经导师审核的知识库内容提供疾病科普、治疗护理、随访和化验指标解释；回答带参考来源，不能替代医生诊断和医嘱。本版本补充化验单 OCR 两段式解读、反馈收集和隐私授权说明。

## 上线风险提示

- 这是医疗健康科普工具，不应承诺诊断、治疗方案或用药剂量。
- 页面和提审材料应持续强调“不能替代医生诊断和医嘱”。
- 正式公开前建议补数据库或网关层限流；当前内存限流在多实例下可能不稳定。
- CloudBase MCP 当前在本机报 Windows ACL 初始化失败；已改用 `npx -p @cloudbase/cli tcb ...` 完成只读核对：环境状态 NORMAL，`qa` 云函数 Active/Available，HTTP 网关防护测试 8/8 通过。