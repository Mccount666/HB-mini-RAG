// pages/visit-prep/visit-prep.js - 复诊准备单：一键生成"给医生看的一页纸"
// 内容：最近两次化验指标对比 + 收藏的疑问 + 最近问过的话题。纯本地组装，复制即可带走。
const labCompare = require('../../services/lab-compare');

const fmtShort = (ts) => {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

Page({
  data: {
    hasLab: false,
    labA: null,
    labB: null,
    labRows: [],
    stars: [],
    recents: [],
    empty: false,
  },

  onShow() {
    const history = wx.getStorageSync('chat_history') || [];
    if (!history.length) {
      this.setData({ empty: true });
      return;
    }

    // 1) 最近两份有原文的化验单 → 指标对比
    const labs = history
      .filter((it) => it.rawText && String(it.rawText).trim())
      .sort((a, b) => a.time - b.time);
    let labData = { hasLab: false, labA: null, labB: null, labRows: [] };
    if (labs.length >= 2) {
      const a = labCompare.extractIndicators(labs[labs.length - 2].rawText);
      const b = labCompare.extractIndicators(labs[labs.length - 1].rawText);
      const rows = labCompare
        .compareIndicators(a, b)
        .map((r) => ({ ...r, trendText: labCompare.TREND_TEXT[r.trend] }));
      labData = {
        hasLab: rows.length > 0,
        labA: fmtShort(labs[labs.length - 2].time),
        labB: fmtShort(labs[labs.length - 1].time),
        labRows: rows,
      };
    }

    // 2) 收藏的疑问
    const stars = history
      .filter((it) => it.star)
      .sort((a, b) => b.time - a.time)
      .slice(0, 20)
      .map((it) => it.question);

    // 3) 最近问过的话题（去重取前 6 条）
    const recents = [];
    const seen = new Set();
    for (const it of history.slice(0, 20)) {
      const q = it.question || '';
      if (seen.has(q)) continue;
      seen.add(q);
      recents.push(q);
      if (recents.length >= 6) break;
    }

    this.setData({ ...labData, stars, recents, empty: false });
  },

  // 复制整页内容（微信里粘贴给家人 / 打印带去复诊）
  onCopy() {
    const d = this.data;
    const parts = ['【复诊准备单】（由肝芽守护小程序整理）'];
    if (d.hasLab) {
      parts.push(`一、最近两次化验对比（${d.labA} → ${d.labB}）`);
      for (const r of d.labRows) {
        parts.push(`  ${r.label}：${r.aText} → ${r.bText}（${r.trendText}${r.unit ? '，单位 ' + r.unit : ''}）`);
      }
    }
    if (d.stars.length) {
      parts.push('二、我们想请教医生的问题');
      d.stars.forEach((q, i) => parts.push(`  ${i + 1}. ${q}`));
    }
    if (d.recents.length) {
      parts.push('三、最近关注过的话题');
      d.recents.forEach((q) => parts.push(`  · ${q}`));
    }
    parts.push('以上内容为家长自行整理的问答记录，仅供复诊沟通参考，具体诊疗以主治医生意见为准。');
    wx.setClipboardData({
      data: parts.join('\n'),
      success: () => wx.showToast({ title: '已复制，可粘贴保存或打印', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    });
  },
});
