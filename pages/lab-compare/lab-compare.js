// pages/lab-compare/lab-compare.js - 化验单对比：两次 OCR 解读记录的指标趋势对照
// 数据取自本地历史里的化验单原文（rawText），提取为启发式，页面全程注明仅供参考。
const labCompare = require('../../services/lab-compare');

const fmtFull = (ts) => {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

Page({
  data: {
    ready: false,      // 是否有 ≥2 条化验单记录
    records: [],       // 候选记录（有 rawText 的化验单解读，时间正序）
    idxA: 0,           // 上一次
    idxB: 1,           // 这一次
    labels: [],
    rows: [],
    hasRows: false,
  },

  onLoad() {
    const history = wx.getStorageSync('chat_history') || [];
    const records = history
      .filter((it) => it.rawText && String(it.rawText).trim())
      .sort((x, y) => x.time - y.time)
      .map((it) => ({ ...it, timeText: fmtFull(it.time) }));
    if (records.length < 2) {
      this.setData({ ready: false });
      return;
    }
    const labels = records.map((it) => `${it.timeText} 化验单`);
    const idxA = records.length - 2;
    const idxB = records.length - 1;
    this.setData({ ready: true, records, labels, idxA, idxB });
    this.compute();
  },

  onPickA(e) {
    this.setData({ idxA: Number(e.detail.value) });
    this.compute();
  },

  onPickB(e) {
    this.setData({ idxB: Number(e.detail.value) });
    this.compute();
  },

  compute() {
    const { records, idxA, idxB } = this.data;
    if (!records.length) return;
    const a = labCompare.extractIndicators(records[idxA].rawText);
    const b = labCompare.extractIndicators(records[idxB].rawText);
    const rows = labCompare.compareIndicators(a, b).map((r) => ({
      ...r,
      trendText: labCompare.TREND_TEXT[r.trend],
    }));
    this.setData({ rows, hasRows: rows.length > 0 });
    if (!rows.length) {
      wx.showToast({ title: '两份报告没能识别出常见指标', icon: 'none' });
    }
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/history' });
  },
});
