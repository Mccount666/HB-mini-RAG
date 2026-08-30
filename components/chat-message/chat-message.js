// components/chat-message/chat-message.js
Component({
  properties: {
    role: { type: String, value: 'assistant' },       // user | assistant
    type: { type: String, value: 'text' },            // text | ocr
    content: { type: String, value: '' },             // 文本答案 / OCR 解读
    imagePath: { type: String, value: '' },           // 用户上传的化验单缩略图（本地临时路径）
    rawText: { type: String, value: '' },             // 化验单 OCR 识别原文
    sources: { type: Array, value: [] },              // [{id, title, excerpt, source}]
    loading: { type: Boolean, value: false },
    rating: { type: String, value: '' },              // 用户评价：'' | 'good' | 'bad'
  },
  data: {
    showRaw: false,
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
      const source = e.currentTarget.dataset.source;
      wx.showModal({
        title: `参考来源 [${source.id}]`,
        content: (source.excerpt || source.title || '暂无摘要') + (source.source ? `\n\n出处：${source.source}` : ''),
        showCancel: false,
        confirmText: '知道了',
      });
    },
    previewImage(e) {
      const url = e.currentTarget.dataset.url;
      if (!url) return;
      wx.previewImage({ urls: [url], current: url });
    },
  },
});
