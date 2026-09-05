// backend/src/routes/auth.js - 微信登录占位
// ⚠️ 生产环境启用自托管后端前必须完成：用 code 调微信 auth.code2Session 换 openid + session_key，
// 并签发自定义 token（当前返回的随机 token 未与会话绑定，仅占位）。
// 文档：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/login/auth.code2Session.html
// 当前小程序主流程走云函数（wx.cloud.callFunction），身份由云开发托管，本路由仅在自托管时使用。
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.post('/login', (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== 'string' || code.length > 512) {
    return res.status(400).json({ message: 'code 不能为空且长度须 ≤ 512' });
  }

  // TODO: 调用微信服务端
  // const r = await fetch(`https://api.weixin.qq.com/sns/jscode2session?appid=APPID&secret=SECRET&js_code=${code}&grant_type=authorization_code`)
  // 用返回的 openid 关联你的用户表，签发自定义 token
  const token = crypto.randomBytes(16).toString('hex');
  res.json({ token, openid: 'stub_openid' });
});

module.exports = router;
