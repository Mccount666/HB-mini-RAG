// pages/timeline/timeline.js - 治疗时间线：把问答历史按月份排成纵向照护档案
const fmtTime = (ts) => {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 话题 → 时间线图标
const TOPIC_ICONS = {
  diagnosis: '🔬', lab: '🧪', lab_report: '🧾', chemo: '💊', surgery: '🏥',
  followup: '📅', care: '🏠', prognosis: '🌱', emergency: '⚠️', general: '📖',
};

Page({
  data: { groups: [], total: 0 },

  onShow() {
    const history = wx.getStorageSync('chat_history') || [];
    const items = history
      .slice()
      .sort((a, b) => a.time - b.time)
      .map((it) => {
        const d = new Date(it.time);
        const topicKey = (it.topic && it.topic.key) || 'general';
        return {
          ...it,
          timeText: fmtTime(it.time),
          month: `${d.getFullYear()}年${d.getMonth() + 1}月`,
          icon: TOPIC_ICONS[topicKey] || '📖',
          title: it.question || '(无标题)',
        };
      });
    // 按月分组，保持时间正序
    const groups = [];
    const byMonth = new Map();
    for (const it of items) {
      if (!byMonth.has(it.month)) {
        const g = { month: it.month, items: [] };
        byMonth.set(it.month, g);
        groups.push(g);
      }
      byMonth.get(it.month).items.push(it);
    }
    this.setData({ groups, total: items.length });
  },

  onTap(e) {
    const item = e.currentTarget.dataset.item;
    wx.setStorageSync('history_detail', item);
    wx.navigateTo({ url: '/pages/history/detail' });
  },
});
