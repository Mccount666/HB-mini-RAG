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
    wx.cloud.init({
      env: 'cloud1-d9gcm6bdkca62b5ac', // test-1（cloud1），与国内版网页/云函数同一环境
      traceUser: true,
    });
    this.globalData.cloudReady = true;
  },
});
