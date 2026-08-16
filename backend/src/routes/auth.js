// backend/src/routes/auth.js - 微信登录占位
// 生产环境应：用 code 调微信 auth.code2Session 换 openid + session_key
// 文档：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/login/auth.code2Session.html
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.post('/login', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ message: 'code 不能为空' });

  // TODO: 调用微信服务端
  // const r = await fetch(`https://api.weixin.qq.com/sns/jscode2session?appid=APPID&secret=SECRET&js_code=${code}&grant_type=authorization_code`)
  // 用返回的 openid 关联你的用户表，签发自定义 token
  const token = crypto.randomBytes(16).toString('hex');
  res.json({ token, openid: 'stub_openid' });
});

module.exports = router;
