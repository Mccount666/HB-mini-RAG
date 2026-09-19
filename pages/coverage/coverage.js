// pages/coverage/coverage.js - "带我问"知识覆盖图：帮家长发现还没问过的话题盲区
// 点未了解的话题 → 自动带入一个该话题的入门问题回到问答页开问。
const { BANK } = require('../../services/follow-ups');

const TOPICS = [
  { key: 'general', label: '疾病科普', desc: '这个病是什么、严不严重' },
  { key: 'diagnosis', label: '确诊检查', desc: '要做哪些检查、分期是什么意思' },
  { key: 'lab', label: '化验指标', desc: 'AFP、白细胞这些指标怎么看' },
  { key: 'chemo', label: '化疗护理', desc: '副作用怎么缓解、顺铂护耳' },
  { key: 'surgery', label: '手术移植', desc: '手术怎么做、什么情况要肝移植' },
  { key: 'followup', label: '随访复查', desc: '出院后多久复查一次' },
  { key: 'care', label: '居家护理', desc: '吃什么、怎么防感染' },
  { key: 'prognosis', label: '预后风险', desc: '治愈率、会不会遗传、靶向药' },
  { key: 'emergency', label: '危险信号', desc: '哪些情况必须马上去医院' },
];

Page({
  data: { topics: [], done: 0 },

  onShow() {
    const history = wx.getStorageSync('chat_history') || [];
    const askedSet = new Set(history.map((it) => String(it.question || '').trim()));
    // 话题被问过 = 有任何历史记录的 topic.key 命中（含化验单解读归入 lab）
    const askedKeys = new Set(history.map((it) => (it.topic && it.topic.key) || 'general'));
    const topics = TOPICS.map((t) => {
      const starter = BANK.find((b) => b.topics.includes(t.key) && !askedSet.has(b.q));
      return {
        ...t,
        asked: askedKeys.has(t.key),
        count: history.filter((it) => (it.topic && it.topic.key) === t.key).length,
        starter: starter ? starter.q : '',
      };
    });
    this.setData({ topics, done: topics.filter((t) => t.asked).length });
  },

  onTopicTap(e) {
    const key = e.currentTarget.dataset.key;
    const topic = this.data.topics.find((t) => t.key === key);
    if (!topic) return;
    if (!topic.starter) {
      wx.showToast({ title: '这个话题下的问题都问过啦', icon: 'none' });
      return;
    }
    // 把入门问题带回问答页直接开问
    wx.setStorageSync('pending_ask', topic.starter);
    wx.switchTab({ url: '/pages/index/index' });
  },
});
