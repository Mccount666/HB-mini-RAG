// pages/history/detail.js - 历史问答详情（完整回答可滚动查看，替代原弹窗截断展示）
// 支持收藏星标 / 一键复制全文（方便贴到家庭群）/ 化验单原文回看
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

  // 收藏 / 取消收藏：同步写回本地历史，返回列表后状态一致
  onToggleStar() {
    const item = this.data.item;
    if (!item) return;
    const history = wx.getStorageSync('chat_history') || [];
    const rec = history.find((it) => it.id === item.id);
    const star = rec ? !rec.star : !item.star; // 记录已被清空时仅更新当前视图
    if (rec) {
      rec.star = star;
      wx.setStorageSync('chat_history', history);
    }
    this.setData({ 'item.star': star });
    wx.vibrateShort && wx.vibrateShort({ type: 'light', fail: () => {} });
    wx.showToast({ title: star ? '已收藏' : '已取消收藏', icon: 'none' });
  },

  // 复制全文：问题 + 回答 +（化验单原文）+ 来源标题，方便粘贴到家庭群
  onCopy() {
    const item = this.data.item;
    if (!item) return;
    const parts = [`问：${item.question}`, `答：${item.answer}`];
    if (item.rawText) {
      parts.push(`—— 化验单原文 ——\n${item.rawText}`);
    }
    if (item.sources && item.sources.length) {
      parts.push(`参考来源：${item.sources.map((s) => s.title).join('；')}`);
    }
    const text = parts.join('\n\n');
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制，可粘贴给家人', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    });
  },
});
