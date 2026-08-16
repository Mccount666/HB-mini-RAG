// backend/src/rag/synonyms.js - 医学同义词表 + 停用词（供 BM25 词法检索使用）
// 目的：家长口语与知识库术语经常对不上（如「AFP」vs「甲胎蛋白」、「肚子胀」vs「腹部膨隆」），
// 纯向量检索难以稳定捕捉这类精确的术语等价关系。expandText 在分词前把命中的同义说法
// 统一追加规范术语，让 BM25 的精确匹配能力覆盖口语化提问。

// 每组：任意一个 variant 出现在文本中，即把整组 canonical 术语追加进文本。
// 只收医学上无歧义的等价/强关联说法，宁缺毋滥，避免错误扩展引入噪音。
const GROUPS = [
  // —— 疾病本体 ——
  { canonical: ['肝母细胞瘤', 'hepatoblastoma'], variants: ['肝母', '肝母细胞', 'hb', '肝脏恶性肿瘤', '儿童肝癌', '小儿肝癌'] },
  // —— 肿瘤标志物 / 化验指标 ——
  { canonical: ['甲胎蛋白', 'afp'], variants: ['甲胎球蛋白', '胎甲球'] },
  { canonical: ['丙氨酸氨基转移酶', 'alt'], variants: ['谷丙转氨酶', '谷丙'] },
  { canonical: ['天冬氨酸氨基转移酶', 'ast'], variants: ['谷草转氨酶', '谷草'] },
  { canonical: ['转氨酶'], variants: ['alt', 'ast', '谷丙转氨酶', '谷草转氨酶'] },
  { canonical: ['碱性磷酸酶', 'alp'], variants: ['骨源性碱性磷酸酶'] },
  { canonical: ['γ-谷氨酰转移酶', 'ggt'], variants: ['r-谷氨酰转移酶', '谷氨酰转肽酶'] },
  { canonical: ['总胆红素', 'tbil'], variants: ['胆红素'] },
  { canonical: ['白蛋白', 'alb'], variants: ['血清白蛋白'] },
  { canonical: ['总蛋白', 'tp'], variants: ['血清总蛋白'] },
  { canonical: ['白细胞计数', 'wbc'], variants: ['白细胞', '白血球'] },
  { canonical: ['中性粒细胞绝对值', 'anc'], variants: ['中性粒细胞', '粒细胞减少'] },
  { canonical: ['血红蛋白', 'hgb'], variants: ['血色素'] },
  { canonical: ['血小板', 'plt'], variants: ['血小板计数'] },
  { canonical: ['凝血酶原时间国际标准化比值', 'inr'], variants: ['凝血功能', '凝血'] },
  { canonical: ['肌酐', 'crea'], variants: ['血肌酐', 'cr'] },
  { canonical: ['参考区间'], variants: ['参考范围', '正常值', '正常范围', '参考值'] },
  // —— 症状与体征 ——
  { canonical: ['腹部膨隆', '腹胀'], variants: ['肚子胀', '肚子大', '肚胀', '腹围增大'] },
  { canonical: ['腹部包块'], variants: ['肚子有包块', '摸到包块', '腹部肿块', '肚子有硬块', '腹部肿物'] },
  { canonical: ['黄疸'], variants: ['皮肤发黄', '眼白发黄', '眼睛发黄', '皮肤黄'] },
  { canonical: ['食欲下降'], variants: ['不爱吃饭', '不想吃饭', '吃饭差', '胃口差', '食欲不振'] },
  { canonical: ['体重增长缓慢'], variants: ['不长体重', '体重不增', '越来越瘦'] },
  { canonical: ['易疲乏'], variants: ['没精神', '乏力', '没力气', '精神差'] },
  { canonical: ['发热'], variants: ['发烧', '发高烧', '低烧', '体温高'] },
  { canonical: ['呕吐'], variants: ['吐', '恶心呕吐'] },
  // —— 诊疗 ——
  { canonical: ['化学治疗', '化疗'], variants: ['化疗药', '打化疗', '输化疗'] },
  { canonical: ['新辅助化疗'], variants: ['术前化疗', '手术前化疗'] },
  { canonical: ['肝移植'], variants: ['移植', '换肝'] },
  { canonical: ['肿瘤切除术', '手术切除'], variants: ['肝切除', '切肿瘤', '做手术', '动手术'] },
  { canonical: ['穿刺活检', '病理'], variants: ['活检', '取病理'] },
  { canonical: ['影像学检查'], variants: ['超声', 'b超', 'ct', 'mri', '核磁'] },
  { canonical: ['复查随访', '随访'], variants: ['复查', '复诊', '定期检查'] },
  { canonical: ['副作用', '不良反应'], variants: ['副反应', '药物反应'] },
  { canonical: ['骨髓抑制'], variants: ['白细胞低', '血象低', '血象抑制'] },
  { canonical: ['复发'], variants: ['又长了', '重新长', '再发'] },
  { canonical: ['转移'], variants: ['扩散', '转移到'] },
  { canonical: ['预后'], variants: ['治愈率', '生存率', '能治好吗', '治得好吗', '效果怎么样'] },
  { canonical: ['分期'], variants: ['pretext', '几期', '早期晚期'] },
  { canonical: ['营养支持'], variants: ['营养', '吃什么', '饮食'] },
  { canonical: ['居家照护'], variants: ['在家护理', '家里照顾', '居家护理'] },
  { canonical: ['心理压力'], variants: ['焦虑', '压力大', '失眠', '心情不好', '崩溃'] },
  { canonical: ['疫苗接种'], variants: ['疫苗', '打疫苗', '预防针'] },
  { canonical: ['感染防护'], variants: ['感染', '预防感染', '隔离'] },
  // —— 常用化疗药（家长常直接问药名）——
  { canonical: ['顺铂'], variants: ['cddp'] },
  { canonical: ['卡铂'], variants: ['carbo'] },
  { canonical: ['长春新碱'], variants: ['vcr'] },
  { canonical: ['氟尿嘧啶'], variants: ['5-fu', '5fu'] },
  { canonical: ['阿霉素'], variants: ['多柔比星'] },
];

// BM25 停用词：高频功能词对语义无贡献，剔除后让 IDF 聚焦在实义词上。
// 注：BM25 的 IDF 本身会压低高频词权重，这里只是进一步去噪。
const STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '吗', '呢', '啊', '吧', '呀', '哦', '嘛',
  '有', '和', '与', '及', '或', '对', '从', '被', '把', '让', '给', '向', '往', '都', '也', '还',
  '就', '才', '只', '要', '会', '能', '可以', '什么', '怎么', '怎样', '如何', '为什么', '哪些',
  '哪个', '谁', '哪里', '请问', '一下', '这个', '那个', '这些', '那些', '很', '非常', '比较',
  '么样', '什么样', '咋', '咋样',
  '孩子', '宝宝', '小孩', '家长', '医生', '医院', '老师', '大家', '现在', '应该', '需要',
]);

// 在文本中扫描同组词（canonical 或 variants 任一命中即触发），
// 把组内其余说法追加到文本末尾（保留原文，只做增强）。
// 大小写不敏感；英文 variant 用词边界匹配，避免 "cr" 误命中 "cry" 之类。
function expandText(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const extra = [];
  for (const g of GROUPS) {
    const members = [...g.canonical, ...g.variants];
    let hit = false;
    for (const v of members) {
      const needle = v.toLowerCase();
      if (/^[a-z0-9-]+$/.test(needle)) {
        // 英文/数字：词边界匹配
        const re = new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}([^a-z0-9]|$)`);
        if (re.test(lower)) { hit = true; break; }
      } else if (lower.includes(needle)) {
        hit = true;
        break;
      }
    }
    if (hit) extra.push(...members.filter((c) => !lower.includes(c.toLowerCase())));
  }
  return extra.length ? `${raw} ${extra.join(' ')}` : raw;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { GROUPS, STOPWORDS, expandText };
