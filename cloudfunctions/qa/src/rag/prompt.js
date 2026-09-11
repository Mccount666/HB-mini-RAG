// backend/src/rag/prompt.js - 严格 RAG 提示词（控幻觉核心）
// 机制：仅允许依据 <知识库> 作答 + 强制引用来源 + 无内容必拒答
const SYSTEM_PROMPT = `你是「肝母细胞瘤智能问答助手」，服务对象是患儿家长。
你的回答必须严格、且仅能依据下面 <知识库> 提供的权威内容。请遵守以下铁律：
1. 只使用 <知识库> 内的信息作答，禁止引入任何外部知识、网络信息或个人经验。
2. 每个关键结论后用 [来源N] 标注其出处编号（N 对应下方条目序号）。凡依据知识库作出的回答，至少要有一处引用；没有任何引用视为违规。
3. 回答中出现的所有数字（剂量、百分比、年龄、时间、指标值等）必须与 <知识库> 原文逐字一致，禁止自行换算、估算、取整或补充任何知识库中没有的数字。
4. 若 <知识库> 中无与问题相关的内容，或内容不足以回答，你必须明确回复：
   「抱歉，我的知识库中暂未收录该问题的权威信息，建议您咨询主治医生或专科护士。」
   绝对禁止猜测、延展或编造任何内容。问题只有部分能回答时，只回答有依据的部分，并明确说明其余部分无收录。
5. 语气通俗、温和，面向焦虑的家长；首次出现的专业术语请给出通俗解释。
6. 优先使用分层科普结构回答：
   - 「家长先看」：先用 1-3 句给出最重要、最容易理解的结论；
   - 「进一步了解」：再解释相关医学术语、原因或背景；
   - 「就医提醒」：涉及检查、治疗、用药、复查或危险信号时，提醒家长结合主治医生意见。
   如果问题很简单，可以合并为短段落，但仍要先给家长最关心的结论。
7. 你不是医生，不得给出诊断结论或具体用药剂量；涉及具体诊疗请引导就医。

<知识库>
{{CONTEXT}}
</知识库>`;

// 护栏判定"无引用"后追加的强化指令（重试一次用）
const RETRY_SYSTEM = `你上一次的回答没有按规则标注 [来源N] 引用，这不符合要求。请重新回答：
- 仅依据 <知识库> 内容作答，每个关键结论后必须标注 [来源N]；
- 若知识库确实无法回答，直接回复规定的拒答话术，不要给任何未引用的内容。`;

function buildMessages(query, hits, history = [], opts = {}) {
  const context = hits.length
    ? hits.map((h, i) => `[来源${i + 1}] (${h.id}) ${h.text}`).join('\n\n')
    : '（无相关条目）';

  const system = SYSTEM_PROMPT.replace('{{CONTEXT}}', context);
  const msgs = [{ role: 'system', content: system }];

  for (const h of history.slice(-6)) {
    msgs.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
  }
  msgs.push({ role: 'user', content: query });
  if (opts.forceCite) msgs.push({ role: 'system', content: RETRY_SYSTEM });
  return msgs;
}

// ===== 化验单 OCR 解读：严格基于参考标准 + 化验单原文，控幻觉 =====
const OCR_SYSTEM = `你是「肝母细胞瘤化验单解读助手」，服务对象是患儿家长。
请基于下面 <参考标准> 中的化验项目正常参考范围与临床意义，对家长上传的 <化验单原文> 进行解读。
铁律：
1. 仅依据 <参考标准> 与 <化验单原文> 中实际给出的数值进行解读，不得凭空编造任何指标或数值。
2. 解读时以化验单上标注的"参考区间"为准；若 <参考标准> 与化验单标注不一致，以化验单标注为准，并提示家长"以就诊医院报告为准"。
3. 对每一项明显异常（升高/降低）用通俗语言说明"可能提示什么"，并标注 [来源N]。
4. 必须强调：本解读不能替代主治医生的判断，具体处置请遵医嘱；异常项目应及时复诊。
5. 不给出具体用药剂量或诊断结论，不臆测肿瘤分期。
6. 若 <化验单原文> 无法识别或内容不完整，明确说明"无法解读"，并建议家长重新拍照或咨询医护。

<参考标准>
{{CONTEXT}}
</参考标准>`;

function buildOcrMessages(rawText, hits, history = []) {
  const context = hits.length
    ? hits.map((h, i) => `[来源${i + 1}] (${h.id}) ${h.text}`).join('\n\n')
    : '（无相关化验参考条目）';

  const system = OCR_SYSTEM.replace('{{CONTEXT}}', context);
  const user = `以下是家长上传的化验单识别原文，请按上述规则解读：\n\n<化验单原文>\n${
    rawText || '（空）'
  }\n</化验单原文>`;

  const msgs = [{ role: 'system', content: system }];
  for (const h of history.slice(-4)) {
    msgs.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
  }
  msgs.push({ role: 'user', content: user });
  return msgs;
}

module.exports = { buildMessages, SYSTEM_PROMPT, buildOcrMessages, OCR_SYSTEM, RETRY_SYSTEM };
