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
  },
  data: {
    showRaw: false,
    editText: '', // OCR 确认阶段的可编辑文字（textarea 绑定内部字段，避免游标跳动）
  },
  observers: {
    // 外部传入识别文字时同步到内部可编辑字段
    rawText(v) {
      this.setData({ editText: v || '' });
    },
  },
  methods: {
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
  },
});
