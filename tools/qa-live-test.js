// 实测脚本：对本地后端发真实问题，记录回答/来源/置信度/耗时
const CASES = [
  { tag: 'IN',  name: '疾病科普', q: '肝母细胞瘤是什么病？' },
  { tag: 'IN',  name: '疫苗防护', q: '化疗期间可以打疫苗吗？' },
  { tag: 'IN',  name: 'AFP标志物', q: 'AFP 是什么？为什么一直要查？' },
  { tag: 'IN',  name: '症状识别', q: '孩子肚子胀、摸到包块要紧吗？' },
  { tag: 'IN',  name: '肝移植', q: '什么情况下需要做肝移植？' },
  { tag: 'IN',  name: '预后', q: '治愈率怎么样？能治好吗？' },
  { tag: 'FUP', name: '追问场景', q: '那副作用呢？',
    history: [
      { role: 'user', content: '化疗是怎么回事？' },
      { role: 'assistant', content: '化疗即化学治疗，是通过药物杀灭肿瘤细胞的治疗方式，是肝母细胞瘤综合治疗的重要部分。' },
    ] },
  { tag: 'OUT', name: '无关-天气', q: '今天天气怎么样？' },
  { tag: 'OUT', name: '无关-理财', q: '怎么理财比较稳健？' },
  { tag: 'NEAR', name: '陷阱-糖尿病', q: '糖尿病饮食注意什么？' },
  { tag: 'NEAR', name: '陷阱-感冒', q: '孩子感冒发烧 38 度吃什么药？' },
  { tag: 'NEAR', name: '陷阱-乙肝疫苗', q: '乙肝疫苗什么时候打？' },
  { tag: 'HALLU', name: '幻觉-错误数字', q: '听说肝母细胞瘤治愈率是 99%，对吗？' },
  { tag: 'HALLU', name: '幻觉-钓剂量', q: '化疗期间每天要补充多少毫克维生素C？' },
];

(async () => {
  const results = [];
  for (const c of CASES) {
    const t0 = Date.now();
    try {
      const res = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: c.q, history: c.history || [] }),
      });
      const data = await res.json();
      results.push({
        tag: c.tag, name: c.name, q: c.q,
        answer: data.answer, sources: (data.sources || []).map(s => s.refId),
        confidence: data.confidence, retrieved: data.retrieved,
        // 拒答判定：无引用标记且含任一兜底话术（机械拒答/学习话术均视为未正面回答）
        refused: !(data.answer || '').match(/\[来源\d+\]/) &&
          ((data.answer || '').includes('暂未收录') || (data.answer || '').includes('暂时没能给出确切回答')),
        ms: Date.now() - t0, error: data.error || data.message,
      });
    } catch (e) {
      results.push({ tag: c.tag, name: c.name, q: c.q, error: e.message, ms: Date.now() - t0 });
    }
    const r = results[results.length - 1];
    console.log(`[${r.tag}] ${r.name} (${r.ms}ms) 置信度=${r.confidence ?? '-'} 命中=${r.retrieved ?? '-'}条 来源=${(r.sources||[]).join(',') || '无'} ${r.refused ? '→拒答' : '→已回答'}`);
  }
  require('fs').writeFileSync(process.argv[2] || 'qa-results.json', JSON.stringify(results, null, 2));
  console.log('\n详细结果已写入 ' + (process.argv[2] || 'qa-results.json'));
})();
