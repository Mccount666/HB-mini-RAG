// app.js - 小程序入口：初始化云开发 + 全局数据
App({
  globalData: {
    userInfo: null,
    cloudReady: false,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请升级微信开发者工具 / 客户端');
      return;
    }
    // TODO: 把 YOUR-CLOUD-ENV-ID 换成你的云开发环境 ID（云开发控制台 → 环境设置 可查）
    // 在微信开发者工具「详情 → 本地设置」勾选「使用云开发」并创建环境后即可获得。
    wx.cloud.init({
      env: 'YOUR-CLOUD-ENV-ID',
      traceUser: true,
    });
    this.globalData.cloudReady = true;
  },
});
