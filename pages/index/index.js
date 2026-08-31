// pages/index/index.js - 问答主页（纯 Chat：文本问答 + 化验单 OCR 解读）
const chat = require('../../services/chat');

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

Page({
  data: {
    messages: [],
    inputValue: '',
    sending: false,
    showDisclaimer: true,
    scrollTarget: '',
    quickQuestions: [
      '肝母细胞瘤是什么？',
      '常见症状有哪些？',
      '主要治疗方法是什么？',
      '治疗后如何复查随访？',
    ],
  },

  onQuickTap(e) {
    this.setData({ inputValue: e.currentTarget.dataset.q });
    this.onSend();
  },

  dismissDisclaimer() {
    this.setData({ showDisclaimer: false });
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  async onSend() {
    const text = (this.data.inputValue || '').trim();
    if (!text || this.data.sending) return;

    const userMsg = { id: uid(), role: 'user', type: 'text', content: text, sources: [] };
    const botMsg = { id: uid(), role: 'assistant', type: 'text', content: '', sources: [], loading: true };

    this.setData({
      messages: [...this.data.messages, userMsg, botMsg],
      inputValue: '',
      sending: true,
      scrollTarget: `msg-${botMsg.id}`,
    });

    try {
      const history = this.data.messages
        .filter((m) => !m.loading)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await chat.ask(text, history);

      const finalBot = { ...botMsg, content: res.answer, sources: res.sources || [], loading: false };
      const messages = this.data.messages.map((m) => (m.id === botMsg.id ? finalBot : m));
      this.setData({ messages, sending: false, scrollTarget: `msg-${botMsg.id}` });
      this.saveHistory(userMsg, finalBot);
    } catch (err) {
      const messages = this.data.messages.map((m) =>
        m.id === botMsg.id
          ? { ...m, content: '抱歉，服务暂时不可用，请稍后再试。', sources: [], loading: false }
          : m
      );
      this.setData({ messages, sending: false });
    }
  },

  // 拍照 / 相册上传化验单 → 云存储 → 云函数 OCR 两段式：
  // 第一段：只识别提取文字（extract）→ 展示给用户核对/修正；
  // 第二段：用户确认文字后（interpret）再严格解读，最大限度避免 OCR 误判。
  onUpload() {
    if (this.data.sending) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles[0];
        const userMsg = {
          id: uid(),
          role: 'user',
          type: 'ocr',
          imagePath: file.tempFilePath,
          content: '上传化验单',
          sources: [],
        };
        const botMsg = {
          id: uid(),
          role: 'assistant',
          type: 'ocr',
          content: '',
          rawText: '',
          sources: [],
          ocrStage: 'confirm', // 识别文字待用户确认
          loading: true,
        };
        this.setData({
          messages: [...this.data.messages, userMsg, botMsg],
          sending: true,
          scrollTarget: `msg-${botMsg.id}`,
        });

        try {
          const up = await this.uploadToCloud(file.tempFilePath);
          const { rawText } = await chat.extractReport(up.fileID);

          const finalBot = { ...botMsg, rawText: rawText || '', loading: false };
          const messages = this.data.messages.map((m) => (m.id === botMsg.id ? finalBot : m));
          this.setData({ messages, sending: false, scrollTarget: `msg-${botMsg.id}` });
        } catch (err) {
          const messages = this.data.messages.map((m) =>
            m.id === botMsg.id
              ? { ...m, content: '化验单识别失败，请重试或咨询医护。', rawText: '', sources: [], ocrStage: 'done', loading: false }
              : m
          );
          this.setData({ messages, sending: false });
        }
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      },
    });
  },

  // 用户确认识别文字 → 第二段：严格解读
  async onConfirmOcr(e) {
    if (this.data.sending) return;
    const id = e.currentTarget.dataset.id;
    const text = ((e.detail && e.detail.text) || '').trim();
    const idx = this.data.messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const botMsg = this.data.messages[idx];
    if (!text) {
      wx.showToast({ title: '识别文字为空，请重新上传', icon: 'none' });
      return;
    }

    // 向前找最近一条用户消息作为被解读的对象（历史记录用）
    let userMsg = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (this.data.messages[i].role === 'user') { userMsg = this.data.messages[i]; break; }
    }

    this.setData({ sending: true, [`messages[${idx}].loading`]: true });
    try {
      const result = await chat.interpretReport(text);
      const finalBot = {
        ...botMsg,
        content: result.interpretation,
        rawText: text,
        sources: result.sources || [],
        ocrStage: 'done',
        loading: false,
      };
      const messages = this.data.messages.map((m) => (m.id === botMsg.id ? finalBot : m));
      this.setData({ messages, sending: false, scrollTarget: `msg-${botMsg.id}` });
      this.saveHistory(userMsg, finalBot);
    } catch (err) {
      const messages = this.data.messages.map((m) =>
        m.id === botMsg.id
          ? { ...m, content: '化验单解读失败，请重试或咨询医护。', sources: [], ocrStage: 'done', loading: false }
          : m
      );
      this.setData({ messages, sending: false });
    }
  },

  // 用户要求重新上传 → 移除待确认消息，重新走拍照/相册
  onRetakeOcr(e) {
    if (this.data.sending) return;
    const id = e.currentTarget.dataset.id;
    let messages = this.data.messages;
    const idx = messages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      // 移除这条待确认消息（连同它前面的用户上传图），保持会话干净
      const userIdx = idx - 1;
      const drop = new Set([id]);
      if (messages[userIdx] && messages[userIdx].role === 'user' && messages[userIdx].type === 'ocr') {
        drop.add(messages[userIdx].id);
      }
      messages = messages.filter((m) => !drop.has(m.id));
    }
    this.setData({ messages });
    this.onUpload();
  },

  uploadToCloud(tempFilePath) {
    const cloudPath = `lab-reports/${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
        success: resolve,
        fail: reject,
      });
    });
  },

  // 评价回答 👍/👎：找到对应问题后提交云数据库 feedback 集合
  onRate(e) {
    const id = e.currentTarget.dataset.id;
    const rating = e.detail && e.detail.rating;
    if (!id || !rating) return;
    const idx = this.data.messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const msg = this.data.messages[idx];
    if (msg.rating) return; // 已评价

    // 向前找最近一条用户消息作为被评价的问题
    let q = '';
    for (let i = idx - 1; i >= 0; i--) {
      const m = this.data.messages[i];
      if (m.role === 'user') {
        q = m.type === 'ocr' ? '[化验单解读]' : m.content || '';
        break;
      }
    }

    this.setData({ [`messages[${idx}].rating`]: rating });
    chat
      .sendFeedback({ q, rating })
      .catch(() => {
        // 提交失败时回滚，允许用户重试
        this.setData({ [`messages[${idx}].rating`]: '' });
        wx.showToast({ title: '反馈失败，请重试', icon: 'none' });
      });
  },

  saveHistory(userMsg, botMsg) {
    const history = wx.getStorageSync('chat_history') || [];
    history.unshift({
      id: uid(),
      question: userMsg.type === 'ocr' ? '[化验单解读]' : userMsg.content,
      answer: botMsg.content,
      sources: botMsg.sources,
      time: Date.now(),
    });
    wx.setStorageSync('chat_history', history.slice(0, 200));
  },
});
