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
    wx.showModal({
      title: item.question,
      content: item.answer + (item.sources && item.sources.length ? `\n\n参考来源：${item.sources.map((s) => s.title).join('、')}` : ''),
      showCancel: false,
      confirmText: '知道了',
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
