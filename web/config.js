// web/config.js - 网站配置
// API_BASE：后端地址（AI 模式）。留空 = 演示模式（纯浏览器检索，展示知识库原文，零生成零幻觉）。
// 当前指向微信云开发 HTTP 网关（云函数 qa），与网站同域名。
// 访客也可以用 ?api=地址 参数或页面右上角 ⚙ 临时覆盖（仅存本人浏览器）。
window.WEB_CONFIG = {
  API_BASE: 'https://cloud1-d9gcm6bdkca62b5ac-1469689182.ap-shanghai.app.tcloudbase.com',
  // 与云函数环境变量 HTTP_SHARED_SECRET 一致（云开发控制台配置后填到这里）。
  // 说明：网页是静态公开的，密钥可被看到，属"防匿名批量刷量"的软防护；
  // 真正的拦截靠服务端每 IP 限速（HTTP_RATE_LIMIT）。留空 = 服务端未启用密钥校验。
  HTTP_SHARED_SECRET: '',
  SITE_NAME: '肝母细胞瘤智能问答',
  SITE_BADGE: '网页测试版',
};
