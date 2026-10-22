/* ============================================================
   共读札记 · 微信读书同步云函数 (weread-sync)
   - 通过 HTTP 触发（CloudBase 云函数 HTTP 访问服务）
   - 持有环境变量 WEREAD_API_KEY，调用微信读书 Agent Gateway
   - 支持动作：/shelf/sync（拉书架）、/readdata/detail（拉阅读统计）
   - 请求 body 必须携带 skill_version = '1.0.5'，其余参数平铺
   ============================================================ */
'use strict';

const https = require('https');

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.5';
const SUPPORTED_ACTIONS = ['/shelf/sync', '/readdata/detail'];

/* ---------------- HTTP 请求封装 ---------------- */
function requestGateway(apiKey, action, params) {
  const body = Object.assign({ skill_version: SKILL_VERSION, path: action }, params);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'i.weread.qq.com',
      port: 443,
      path: '/api/agent/gateway',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer ' + apiKey,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (e) { j = { raw: buf }; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(j);
        } else {
          reject(new Error('Gateway HTTP ' + res.statusCode + ': ' + buf.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ---------------- 从网关响应中尽力提取书架书籍数组 ---------------- */
function extractBooks(obj, depth) {
  if (!obj || typeof obj !== 'object' || (depth || 0) > 6) return null;
  if (Array.isArray(obj)) return null;
  if (Array.isArray(obj.books)) return obj.books;
  if (Array.isArray(obj.bookList)) return obj.bookList;
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const r = extractBooks(obj[keys[i]], (depth || 0) + 1);
    if (r) return r;
  }
  return null;
}

/* ---------------- 入口 ---------------- */
exports.main = async (event, context) => {
  try {
    // 兼容两种调用：callFunction（body 带 action） / HTTP 触发（path 含接口路径）
    const body = typeof event.body === 'string'
      ? (event.body ? JSON.parse(event.body) : {})
      : (event.body || {});

    const action = (body.action || body.path || '').trim()
      || (String(event.path || event.url || '').match(/\/(shelf\/sync|readdata\/detail)/) || [])[1];

    if (!action) {
      return { ok: false, msg: '缺少 action，应为 /shelf/sync 或 /readdata/detail' };
    }
    if (!SUPPORTED_ACTIONS.includes(action)) {
      return { ok: false, msg: '不支持的 action: ' + action };
    }
    if (body.skill_version !== SKILL_VERSION) {
      return { ok: false, msg: 'skill_version 必须为 ' + SKILL_VERSION };
    }

    const apiKey = process.env.WEREAD_API_KEY;
    if (!apiKey) {
      return { ok: false, msg: '服务端未配置环境变量 WEREAD_API_KEY' };
    }

    // 透传业务参数（去掉 action / skill_version / path），保持平铺
    const params = Object.assign({}, body);
    delete params.action;
    delete params.skill_version;
    delete params.path;

    const gw = await requestGateway(apiKey, action, params);

    // 网关显式报错时透传
    if (gw && gw.code !== undefined && Number(gw.code) !== 0) {
      return { ok: false, msg: (gw.msg || gw.errMsg || ('网关返回 code ' + gw.code)), raw: gw };
    }

    if (action === '/shelf/sync') {
      const books = extractBooks(gw, 0);
      return { ok: true, data: Array.isArray(books) ? books : [], raw: gw };
    }
    // /readdata/detail 及未来扩展：透传网关原始返回
    return { ok: true, data: gw, raw: gw };
  } catch (e) {
    console.error('[weread-sync] error', e);
    return { ok: false, msg: '云函数内部错误: ' + (e && e.message ? e.message : String(e)) };
  }
};
