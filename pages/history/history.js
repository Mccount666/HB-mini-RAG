// pages/history/history.js
const fmtTime = (ts) => {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

Page({
  data: { list: [] },

  onShow() {
    const raw = wx.getStorageSync('chat_history') || [];
    this.setData({
      list: raw.map((it) => ({ ...it, timeText: fmtTime(it.time) })),
    });
  },

  onTap(e) {
    const item = e.currentTarget.dataset.item;
    // 完整回答在详情页展示（可滚动），避免弹窗内容被截断
    wx.setStorageSync('history_detail', item);
    wx.navigateTo({ url: '/pages/history/detail' });
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
        this.setData({ list: rest.map((it) => ({ ...it, timeText: fmtTime(it.time) })) });
      },
    });
  },

  onClear() {
    wx.showModal({
      title: '确认清空',
      content: '将删除全部本地问答历史，不可恢复。',
      success: (r) => {
        if (r.confirm) {
          wx.removeStorageSync('chat_history');
          this.setData({ list: [] });
        }
      },
    });
  },
});
