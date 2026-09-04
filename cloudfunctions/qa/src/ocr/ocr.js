// backend/src/ocr/ocr.js - 化验单 OCR 识别（可插拔）
// provider='tencent' : 调用腾讯云 OCR（通用印刷体 GeneralBasicOCR），需 TENCENT_SECRET_ID/KEY
// provider='mock'    : 默认，免 key，返回一份代表性演示化验单文本，便于无 OCR key 时跑通整条管线
// DeepSeek 无视觉能力，化验单识别必须走独立 OCR 服务；解读再交给大模型。
// 输入统一为图片 Buffer：自托管从磁盘读文件，云函数直接用云存储下载的 fileContent，
// 全程不落盘（无临时文件清理与路径拼接问题）。
const fs = require('fs');
const config = require('../config');

async function ocrFromBuffer(buffer) {
  const provider = config.ocr.provider;
  if (provider === 'tencent' && config.ocr.secretId && config.ocr.secretKey) {
    return tencentOcr(buffer);
  }
  // 默认 / 缺少腾讯云密钥时走 mock，保证管线可演示
  return mockOcr(buffer);
}

// 兼容旧接口：自托管场景按本地文件路径读取
async function ocrFromFile(filePath) {
  return ocrFromBuffer(fs.readFileSync(filePath));
}

async function tencentOcr(input) {
  // 懒加载，避免本地无 key 时装包失败；依赖缺失时明确报错而不是抛出模块找不到的堆栈
  let tencentcloud;
  try {
    tencentcloud = require('tencentcloud-sdk-nodejs-ocr');
  } catch (e) {
    throw new Error('未安装 tencentcloud-sdk-nodejs-ocr，请先 npm install（或改用 OCR_PROVIDER=mock）');
  }
  const Client = tencentcloud.ocr.v20181119.Client;
  const client = new Client({
    credential: { secretId: config.ocr.secretId, secretKey: config.ocr.secretKey },
    region: config.ocr.region,
    profile: { httpProfile: { endpoint: 'ocr.tencentcloudapi.com' } },
  });
  const base64 = Buffer.isBuffer(input)
    ? input.toString('base64')
    : fs.readFileSync(input).toString('base64');
  const resp = await client.GeneralBasicOCR({ ImageBase64: base64 });
  const lines = (resp.TextDetections || []).map((t) => t.DetectedText).filter(Boolean);
  if (!lines.length) throw new Error('OCR 未识别到任何文字');
  return lines.join('\n');
}

// 演示样本：一份代表性儿科住院化验单（含肝母细胞瘤随访常用指标），
// 仅用于无 OCR key 时验证「识别→检索→解读」整条管线。真实部署请切 provider='tencent'。
function mockOcr() {
  return [
    'XX医院 检验报告单',
    '姓名：患儿  性别：男  年龄：3岁',
    '甲胎蛋白(AFP): 1250.0 ng/mL   参考区间: 0-7.0',
    '丙氨酸氨基转移酶(ALT): 68 U/L   参考区间: 9-50',
    '天冬氨酸氨基转移酶(AST): 75 U/L   参考区间: 15-40',
    '总胆红素(TBIL): 18.5 umol/L   参考区间: 3.4-20.5',
    '白蛋白(ALB): 38 g/L   参考区间: 40-55',
    '白细胞计数(WBC): 2.1 x10^9/L   参考区间: 4.0-10.0',
    '血红蛋白(HGB): 98 g/L   参考区间: 110-160',
    '血小板(PLT): 85 x10^9/L   参考区间: 100-300',
  ].join('\n');
}

module.exports = { ocrFromBuffer, ocrFromFile, mockOcr, tencentOcr };
