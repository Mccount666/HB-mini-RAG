// pages/history/detail.js - 历史问答详情（完整回答可滚动查看，替代原弹窗截断展示）
Page({
  data: { item: null },

  onLoad() {
    const item = wx.getStorageSync('history_detail');
    if (!item) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ item });
  },
});
