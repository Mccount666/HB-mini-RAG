// utils/request.js - 统一请求层
// 注意：BASE_URL 必须替换为你的后端域名，且该域名要在
// 微信公众平台「开发管理 → 服务器域名 → request合法域名」中备案（仅支持 HTTPS）
const BASE_URL = 'https://your-api-domain.com';

const request = (options) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: options.timeout || 30000,
      header: {
        'Content-Type': 'application/json',
        ...options.header,
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject({ code: res.statusCode, message: (res.data && res.data.message) || '请求失败' });
        }
      },
      fail: (err) => reject({ code: -1, message: '网络错误', detail: err }),
    });
  });
};

module.exports = { request, BASE_URL };
