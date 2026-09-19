// components/chat-message/chat-message.js
Component({
  properties: {
    role: { type: String, value: 'assistant' },       // user | assistant
    type: { type: String, value: 'text' },            // text | ocr
    content: { type: String, value: '' },             // 文本答案 / OCR 解读
    imagePath: { type: String, value: '' },           // 用户上传的化验单缩略图（本地临时路径）
    rawText: { type: String, value: '' },             // 化验单 OCR 识别原文（确认阶段可编辑）
    sources: { type: Array, value: [] },              // [{id, title, excerpt, source}]
    topic: { type: Object, value: null },             // {key, label} 科普需求主题
    loading: { type: Boolean, value: false },
    rating: { type: String, value: '' },              // 用户评价：'' | 'good' | 'bad'
    ocrStage: { type: String, value: '' },            // '' | 'confirm'(识别文字待确认) | 'done'
    suggestions: { type: Array, value: [] },          // 追问推荐：回答下方可点的"接着问"
    canRemind: { type: Boolean, value: false },       // 随访类回答显示"设复查提醒"入口
    highlight: { type: Boolean, value: false },       // 搜索定位后短暂高亮
    refusal: { type: String, value: '' },             // 拒答原因码：learning|out_of_scope|guard_numbers|guard_citations|judge_fail
    check: { type: Object, value: null },             // 回答体检数据 {cites, numberCheck, judged, retried}
    confidence: { type: Number, value: null },        // 检索相关度 0~1
  },
  data: {
    showRaw: false,
    showCheck: false,
    refusalText: '',
    checkLines: [],
    editText: '', // OCR 确认阶段的可编辑文字（textarea 绑定内部字段，避免游标跳动）
  },
  observers: {
    // 外部传入识别文字时同步到内部可编辑字段
    rawText(v) {
      this.setData({ editText: v || '' });
    },
    // 拒答原因码 → 说人话的解释文案
    refusal(code) {
      const map = {
        learning: '这个问题和主题相关，但知识库还没有收录可靠的权威依据。你的提问已经记入「共建清单」，导师补录后我就会回答它了。',
        out_of_scope: '这个问题超出了「儿童肝母细胞瘤」知识库的范围。我不能凭没有依据的话作答，建议咨询主治医生。',
        guard_numbers: '刚才生成的回答里，有数字在权威依据中找不到出处。安全护栏把它拦下了——宁可拒答，也不给没依据的答案。',
        guard_citations: '刚才生成的回答缺少来源标注，强化重试后仍未达标，已被安全护栏拦下。',
        judge_fail: '语义判定服务暂时不可用，为稳妥起见，这次没有作答，请稍后再试。',
      };
      this.setData({ refusalText: map[code] || '' });
    },
    // 体检数据 → 家长能看懂的展示行（百分比取整等在逻辑层算好）
    'check, confidence': function (check, confidence) {
      if (!check) {
        this.setData({ checkLines: [] });
        return;
      }
      const lines = [`知识库依据：${check.cites} 条`];
      if (typeof confidence === 'number' && confidence >= 0) {
        lines.push(`检索相关度：约 ${Math.round(confidence * 100)}%`);
      }
      lines.push(
        check.numberCheck === 'pass'
          ? '关键数字：全部能在依据原文中找到出处'
          : '关键数字：本条回答未涉及关键数字'
      );
      lines.push(
        check.judged === 'semantic'
          ? '判定路径：AI 确认问题与知识库相关后作答'
          : '判定路径：问题与知识库条目直接匹配'
      );
      if (check.retried) lines.push('补充说明：首次回答引用缺失，强化重试 1 次后达标');
      this.setData({ checkLines: lines });
    },
  },
  methods: {
    toggleCheck() {
      this.setData({ showCheck: !this.data.showCheck });
    },
    onRate(e) {
      if (this.data.rating) return; // 已评价过，不再触发
      const rating = e.currentTarget.dataset.rating === 'good' ? 'good' : 'bad';
      this.triggerEvent('rate', { rating });
    },
    toggleRaw() {
      this.setData({ showRaw: !this.data.showRaw });
    },
    onSourceTap(e) {
      const source = e.currentTarget.dataset.source || {};
      const title = source.title || source.refId || '知识库条目';
      const excerpt = source.excerpt || '暂无摘要';
      const origin = source.source ? `\n\n出处：${source.source}` : '';
      wx.showModal({
        title: `来源卡片 [${source.id || '?'}]`,
        content: `引用主题：${title}\n\n为什么引用：这条内容是当前回答中关键结论的知识库依据，您可以用它核对回答来源。\n\n原文摘要：${excerpt}${origin}`,
        showCancel: false,
        confirmText: '知道了',
      });
    },
    previewImage(e) {
      const url = e.currentTarget.dataset.url;
      if (!url) return;
      wx.previewImage({ urls: [url], current: url });
    },
    // ===== OCR 确认阶段：用户核对/修正识别文字 =====
    onConfirmInput(e) {
      this.setData({ editText: e.detail.value || '' });
    },
    onConfirmOcr() {
      this.triggerEvent('confirmocr', { text: this.data.editText });
    },
    onRetakeOcr() {
      this.triggerEvent('retakeocr');
    },
    // 追问推荐：点击直接发起该问题
    onSuggestTap(e) {
      const q = (e.currentTarget.dataset.q || '').trim();
      if (!q) return;
      this.triggerEvent('suggest', { q });
    },
    // 复查提醒：交给页面弹选择（1/3/6 个月后）
    onRemindTap() {
      this.triggerEvent('remind');
    },
  },
});
