// app.js - 小程序入口：初始化云开发 + 全局数据
App({
  globalData: {
    userInfo: null,
    cloudReady: false,
    // 隐私授权挂起回调：wx.onNeedPrivacyAuthorization 触发时由基础库传入，
    // 用户点击「同意」按钮（open-type=agreePrivacyAuthorization）后基础库自动放行
    privacyResolve: null,
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

    // 隐私合规：调用隐私接口（如 wx.chooseMedia 选相册/拍照）且用户未同意时，
    // 基础库回调这里；存下 resolve 并通知当前页面弹出内置隐私弹窗。
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        this.globalData.privacyResolve = resolve;
        const pages = getCurrentPages();
        const page = pages[pages.length - 1];
        if (page && typeof page.onNeedPrivacyAuth === 'function') {
          page.onNeedPrivacyAuth();
        }
      });
    }
  },
});
