// ⚠️ 当前未接入：主流程走云函数（services/chat.js），本文件为未来自托管后端预留的脚手架，
// 全项目无任何 require 引用（仅注释提及），接入前请勿删除。修改自托管方案时再启用。
// utils/auth.js - 微信登录换取自定义登录态
// 后端 /api/auth/login 用 wx.login 的 code 调微信 auth.code2Session 换 openid
const { request } = require('./request');

const ensureLogin = async () => {
  const token = wx.getStorageSync('access_token');
  if (token) return token;

  const { code } = await wx.login();
  const res = await request({ url: '/api/auth/login', method: 'POST', data: { code } });
  wx.setStorageSync('access_token', res.token);
  return res.token;
};

module.exports = { ensureLogin };
