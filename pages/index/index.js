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

  // 拍照 / 相册上传化验单 → 云存储 → 云函数 OCR 解读
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
          loading: true,
        };
        this.setData({
          messages: [...this.data.messages, userMsg, botMsg],
          sending: true,
          scrollTarget: `msg-${botMsg.id}`,
        });

        try {
          const up = await this.uploadToCloud(file.tempFilePath);
          const result = await chat.analyzeReport(up.fileID);

          const finalBot = {
            ...botMsg,
            content: result.interpretation,
            rawText: result.rawText,
            sources: result.sources || [],
            loading: false,
          };
          const messages = this.data.messages.map((m) => (m.id === botMsg.id ? finalBot : m));
          this.setData({ messages, sending: false, scrollTarget: `msg-${botMsg.id}` });
          this.saveHistory(userMsg, finalBot);
        } catch (err) {
          const messages = this.data.messages.map((m) =>
            m.id === botMsg.id
              ? { ...m, content: '化验单处理失败，请重试或咨询医护。', rawText: '', sources: [], loading: false }
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
