// pages/history/history.js - 历史问答：搜索 / 主题筛选 / 收藏星标
const fmtTime = (ts) => {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 筛选条：全部 / 收藏 / 按主题（与问答页 inferQuestionTopic 的 key 对应）
const TOPIC_CHIPS = [
  { key: '', label: '全部' },
  { key: '__star__', label: '★ 收藏' },
  { key: 'general', label: '疾病科普' },
  { key: 'diagnosis', label: '确诊检查' },
  { key: 'lab', label: '化验指标' },
  { key: 'lab_report', label: '化验单解读' },
  { key: 'chemo', label: '化疗护理' },
  { key: 'surgery', label: '手术移植' },
  { key: 'followup', label: '随访复查' },
  { key: 'care', label: '居家护理' },
  { key: 'prognosis', label: '预后风险' },
  { key: 'emergency', label: '危险信号' },
];

Page({
  data: {
    chips: TOPIC_CHIPS,
    activeTopic: '',   // '' = 全部；'__star__' = 收藏；其余为 topic.key
    keyword: '',
    total: 0,
    list: [],
    hasAny: false,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const raw = (wx.getStorageSync('chat_history') || []).map((it) => ({
      ...it,
      timeText: fmtTime(it.time),
    }));
    this.setData({ total: raw.length, hasAny: raw.length > 0 });
    this.applyFilter(raw);
  },

  applyFilter(raw) {
    const kw = this.data.keyword.trim().toLowerCase();
    const topic = this.data.activeTopic;
    const list = raw.filter((it) => {
      if (topic === '__star__' && !it.star) return false;
      if (topic && topic !== '__star__' && (!it.topic || it.topic.key !== topic)) return false;
      if (kw) {
        const hay = ((it.question || '') + '\n' + (it.answer || '')).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
    this.setData({ list });
  },

  onChipTap(e) {
    this.setData({ activeTopic: e.currentTarget.dataset.key });
    this.refresh();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.refresh();
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.refresh();
  },

  onTap(e) {
    const item = e.currentTarget.dataset.item;
    // 完整回答在详情页展示（可滚动），避免弹窗内容被截断
    wx.setStorageSync('history_detail', item);
    wx.navigateTo({ url: '/pages/history/detail' });
  },

  // 收藏 / 取消收藏：写回本地历史并刷新当前筛选视图
  onToggleStar(e) {
    const id = e.currentTarget.dataset.id;
    const history = wx.getStorageSync('chat_history') || [];
    const rec = history.find((it) => it.id === id);
    if (!rec) return;
    rec.star = !rec.star;
    wx.setStorageSync('chat_history', history);
    wx.vibrateShort && wx.vibrateShort({ type: 'light', fail: () => {} });
    this.refresh();
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条记录？',
      content: '仅删除本条问答历史，不可恢复。',
      confirmText: '删除',
      confirmColor: '#D36C6C',
      success: (r) => {
        if (!r.confirm) return;
        const rest = (wx.getStorageSync('chat_history') || []).filter((it) => it.id !== id);
        wx.setStorageSync('chat_history', rest);
        this.refresh();
      },
    });
  },

  onClear() {
    wx.showModal({
      title: '确认清空',
      content: '将删除全部本地问答历史（含收藏），不可恢复。',
      success: (r) => {
        if (r.confirm) {
          wx.removeStorageSync('chat_history');
          this.refresh();
        }
      },
    });
  },
});
