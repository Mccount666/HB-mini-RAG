// tools/smoke.js - 端到端冒烟测试：本地 mock 大模型 + 真实检索管线
// 用法：先 cd backend && npm run ingest 生成 index.json，再 node tools/smoke.js
// 不需要任何真实 API key：mock 服务器模拟 OpenAI 兼容接口，验证
//   门控拒答 / 正常引用回答 / 无引用重试 / 数字无出处拦截 / OCR 解读 全链路。
const http = require('http');

process.env.EMBEDDING_PROVIDER = 'local';
process.env.KB_ONLY_REVIEWED = 'false';
process.env.LLM_API_KEY = 'smoke-test-key';

// —— mock 大模型：按队列依次返回预设回答 ——
const replies = [];
let llmCalls = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    llmCalls++;
    const content = replies.length ? replies.shift() : '（mock 默认回复）';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

function assert(name, cond, detail) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

function isRefusal(answer) {
  return String(answer || '').includes('暂未收录') || String(answer || '').includes('暂时没能给出确切回答');
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;

  const { answerQuestion } = require('../backend/src/rag/answer');
  const { interpretLabReport } = require('../backend/src/ocr/interpret');

  // 1) 出范围问题：应拒答；语义 judge 可能调用一次 LLM 做相关性判定
  llmCalls = 0;
  const r1 = await answerQuestion('今天天气怎么样？', []);
  assert('出范围问题被拒答', isRefusal(r1.answer), r1.answer.slice(0, 30) + '…');
  assert('拒答最多只调判定模型', llmCalls <= 1, `LLM 调用 ${llmCalls} 次`);

  // 2) 范围内问题：正常回答，带引用与来源
  replies.push('家长先看：化疗期间免疫功能较低，一般不建议接种活疫苗，具体请遵医嘱 [来源1]。\n\n进一步了解：接种安排需要结合治疗阶段和免疫状态判断 [来源1]。\n\n就医提醒：请在复诊时让主治医生或预防接种门诊共同评估。');
  const r2 = await answerQuestion('化疗期间可以打疫苗吗？', []);
  assert('范围内问题正常回答', r2.answer.includes('[来源1]'), r2.answer.slice(0, 40) + '…');
  assert('分层科普结构可用', /家长先看|进一步了解|就医提醒/.test(r2.answer), r2.answer.slice(0, 60) + '…');
  assert('返回来源列表', Array.isArray(r2.sources) && r2.sources.length > 0, `${r2.sources.length} 条来源`);

  // 3) 无引用 → 强化重试一次 → 仍无引用则拒答
  llmCalls = 0;
  replies.push('化疗期间一般不建议打活疫苗。', '家长先看：化疗期间仍然不建议 [来源1]。');
  const r3 = await answerQuestion('化疗期间可以打疫苗吗？', []);
  assert('无引用触发重试', llmCalls === 2, `LLM 调用 ${llmCalls} 次`);
  assert('重试后回答放行', r3.answer.includes('[来源1]'), r3.answer.slice(0, 40) + '…');

  // 4) 数字无出处：直接拦截拒答（医学安全）
  replies.push('化疗治愈率高达 95%，放心 [来源1]。');
  const r4 = await answerQuestion('治愈率怎么样？', []);
  assert('无出处数字被拦截', isRefusal(r4.answer), r4.answer.slice(0, 30) + '…');

  // 5) 追问场景：检索查询拼接上轮问题（不直接可见，验证不报错且能回答）
  replies.push('化疗常见副作用包括骨髓抑制等 [来源1]。');
  const r5 = await answerQuestion('那副作用呢？', [
    { role: 'user', content: '化疗是怎么回事？' },
    { role: 'assistant', content: '化疗是…' },
  ]);
  assert('追问场景正常回答', r5.answer.includes('[来源1]'), r5.answer.slice(0, 40) + '…');

  // 6) OCR 化验单解读（mock OCR + mock LLM；化验参考全量 14 条为上下文，越界引用为 >14）
  replies.push('AFP 1250.0 ng/mL 明显升高，需结合年龄判读并遵医嘱 [来源1]；白细胞偏低 [来源99]。');
  const r6 = await interpretLabReport(
    ['甲胎蛋白(AFP): 1250.0 ng/mL 参考区间: 0-7.0', '白细胞计数(WBC): 2.1 x10^9/L 参考区间: 4.0-10.0'].join('\n'),
    []
  );
  assert('OCR 解读保留合法引用', r6.interpretation.includes('[来源1]'), r6.interpretation.slice(0, 40) + '…');
  assert('OCR 解读剔除越界引用', !r6.interpretation.includes('[来源99]'));
  assert('OCR 返回化验参考来源', r6.sources.some((s) => s.refId === 'LAB-AFP'), r6.sources.map((s) => s.refId).join(','));

  server.close();
  console.log(process.exitCode ? '\n冒烟测试存在失败项' : '\n冒烟测试全部通过');
})().catch((e) => {
  console.error('冒烟测试异常：', e);
  server.close();
  process.exit(1);
});
