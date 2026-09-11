// pages/index/index.js - 问答主页（纯 Chat：文本问答 + 化验单 OCR 解读）
const chat = require('../../services/chat');

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const TOPIC_RULES = [
  { key: 'diagnosis', label: '确诊检查', words: ['确诊', '检查', '影像', 'CT', '核磁', 'MRI', '病理', '活检', '分期', 'PRETEXT'] },
  { key: 'lab', label: '化验指标', words: ['AFP', '甲胎蛋白', '白细胞', '血小板', '血红蛋白', '胆红素', 'ALT', 'AST', '指标', '化验'] },
  { key: 'chemo', label: '化疗护理', words: ['化疗', '顺铂', '副作用', '骨髓抑制', '恶心', '呕吐', '掉头发', '伤耳'] },
  { key: 'surgery', label: '手术移植', words: ['手术', '切除', '切干净', '肝移植', '移植'] },
  { key: 'followup', label: '随访复查', words: ['复查', '随访', '出院', '复诊', '多久查'] },
  { key: 'care', label: '居家护理', words: ['饮食', '营养', '护理', '感染', '发烧', '疫苗', '生活'] },
  { key: 'prognosis', label: '预后风险', words: ['治愈', '预后', '复发', '风险', '遗传', '二胎', '基因'] },
  { key: 'emergency', label: '危险信号', words: ['马上去医院', '急诊', '肿瘤破裂', '腹痛', '出血', '严重'] },
];

function inferQuestionTopic(text, type = 'text') {
  if (type === 'ocr') return { key: 'lab_report', label: '化验单解读' };
  const q = String(text || '').toLowerCase();
  const hit = TOPIC_RULES.find((rule) => rule.words.some((w) => q.includes(String(w).toLowerCase())));
  return hit ? { key: hit.key, label: hit.label } : { key: 'general', label: '疾病科普' };
}

Page({
  data: {
    messages: [],
    inputValue: '',
    sending: false,
    showDisclaimer: true,
    scrollTarget: '',
    showPrivacy: false,     // 隐私授权弹窗（化验单识别需相册/相机）
    privacyPending: false,  // 同意后是否继续之前被打断的选图动作
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

  onNeedPrivacyAuth() {
    this.setData({ showPrivacy: true, privacyPending: true });
  },

  openPrivacyContract() {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({
        fail: () => wx.showToast({ title: '暂时无法打开隐私协议', icon: 'none' }),
      });
    }
  },

  onAgreePrivacyAuthorization() {
    const app = getApp();
    const shouldResume = this.data.privacyPending && !app.globalData.privacyResolve;
    if (app.globalData.privacyResolve) {
      app.globalData.privacyResolve({ event: 'agree', buttonId: 'agree-btn' });
      app.globalData.privacyResolve = null;
    }
    this.setData({ showPrivacy: false, privacyPending: false });
    if (shouldResume) this.onUpload();
  },

  onRejectPrivacyAuthorization() {
    const app = getApp();
    if (app.globalData.privacyResolve) {
      app.globalData.privacyResolve({ event: 'disagree' });
      app.globalData.privacyResolve = null;
    }
    this.setData({ showPrivacy: false, privacyPending: false });
    wx.showToast({ title: '同意隐私授权后才能上传化验单', icon: 'none' });
  },

  ensurePrivacyAuthorized() {
    return new Promise((resolve) => {
      if (!wx.getPrivacySetting) {
        resolve(true);
        return;
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (res.needAuthorization) {
            this.setData({ showPrivacy: true, privacyPending: true });
            resolve(false);
          } else {
            resolve(true);
          }
        },
        fail: () => resolve(true),
      });
    });
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  async onSend() {
    const text = (this.data.inputValue || '').trim();
    if (!text || this.data.sending) return;

    const userMsg = { id: uid(), role: 'user', type: 'text', content: text, sources: [], topic: inferQuestionTopic(text) };
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
  async onUpload() {
    if (this.data.sending) return;
    const authorized = await this.ensurePrivacyAuthorized();
    if (!authorized) return;
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
          topic: inferQuestionTopic('', 'ocr'),
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
        var topic = m.topic || inferQuestionTopic(q, m.type);
        break;
      }
    }

    const topicInfo = topic || inferQuestionTopic(q);
    this.setData({ [`messages[${idx}].rating`]: rating });
    chat
      .sendFeedback({ q, rating, topicKey: topicInfo.key, topicLabel: topicInfo.label })
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
      topic: userMsg.topic || inferQuestionTopic(userMsg.content, userMsg.type),
      time: Date.now(),
    });
    wx.setStorageSync('chat_history', history.slice(0, 200));
  },
});
