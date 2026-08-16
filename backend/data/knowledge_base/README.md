# 知识库目录说明（后端）

本目录存放 RAG 检索用的全部知识条目。`npm run ingest` 会读取本目录下**所有 `.json`** 并向量化生成 `../index.json`。

> ⚠️ 当前所有条目 `reviewed:false`，均为**待导师审核的草稿**。上线前必须由儿科肿瘤专业医生（导师）逐条核对，通过后在 JSON 把 `reviewed` 改为 `true` 并填 `reviewedBy`/`reviewedAt`，最后在 `.env` 设 `KB_ONLY_REVIEWED=true` 重跑 `ingest`。

## 文件与分工

| 文件 | 内容 | 类别 | 用途 |
|------|------|------|------|
| `sample.json` | 早期演示样本（12 条） | 疾病科普/症状/… | 早期占位，建议逐步并入 `ganya_articles.json` 后停用 |
| `ganya_articles.json` | 《肝芽守护》科普文章结构化医学知识（18 条） | 疾病科普/病理/分期/治疗/随访/… | 文本问答主知识库 |
| `lab_reference.json` | 化验单常用项目参考区间与意义 | `lab_reference` | **仅供 OCR 化验单解读检索**，不进入文本问答 |

## 如何把《肝芽守护》真实文章导进来（替换占位）

1. 从公众号后台 / 素材库把科普文章导出为纯文本或 Markdown。
2. 按下面格式，每条写成一个对象，追加到 `ganya_articles.json`（或新建 `ganya_articles_part2.json`，ingest 会自动合并）：

```json
{
  "id": "HB-201",
  "category": "科普文章标题或主题",
  "question": "该段科普要回答的核心问题（如：肝母细胞瘤为什么要做术前化疗？）",
  "answer": "该段科普的正文要点，用家长能看懂的话写，避免诊断/剂量。",
  "source": "《肝芽守护》文章《xxxx》2026-xx-xx",
  "reviewed": false,
  "reviewedBy": "",
  "reviewedAt": ""
}
```

3. 保存后运行：
```bash
cd backend
npm run ingest
node tools/sync-cloudfunction.js   # 同步索引进云函数
```
4. 导师在微信开发者工具里右键 `cloudfunctions/qa` → 重新部署。

## 化验单参考区间（`lab_reference.json`）

- 这些条目 `category:"lab_reference"`，**只会被 OCR 解读分支检索**（`interpret.js` 用 `category` 过滤），不会污染文本问答。
- 参考区间以"主流诊断标准"编写，但**不同实验室/年龄/性别有差异**，且婴幼儿 AFP 呈生理性升高。上线前务必由导师核对为本院/本实验室的实际区间与儿科标准。
- 解读提示词已强制：以**化验单上标注的参考区间**为准，与参考标准不一致时提示家长"以就诊医院报告为准"。

## 审核进度

随时运行 `node tools/kb-status.js` 查看待审 / 已审清单。
