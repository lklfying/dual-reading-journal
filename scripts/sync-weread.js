#!/usr/bin/env node
/* ============================================================
   sync-weread.js — 微信读书书架/阅读统计自动同步（GitHub Actions）
   - 读取环境变量 WEREAD_API_KEY_H / WEREAD_API_KEY_Q（各自识别身份）
   - 调用微信读书 skill 官方网关 https://i.weread.qq.com/api/agent/gateway
   - 生成 data/shelves.json 并 git add/commit/push
   运行环境：Node 18+，仅用内置 fetch / fs / child_process，无第三方依赖
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.5';
const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

/* ---------------- 网关调用 ---------------- */
async function callGateway(apiKey, body) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* 保留原文用于报错 */ }
  if (!res.ok && !json) {
    throw new Error('网关返回 HTTP ' + res.status + ': ' + String(text).slice(0, 200));
  }
  return json || {};
}

/* ---------------- 响应兼容解析 ---------------- */
// 返回结构可能为 res.books / res.data / bookList 数组，元素可能是 {bookInfo:{...}} 嵌套
function extractBooks(payload) {
  const candidates = [];
  const scan = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 4) return;
    if (Array.isArray(obj.books) && obj.books.length) candidates.push(obj.books);
    if (Array.isArray(obj.data) && obj.data.length && obj.data[0] && typeof obj.data[0] === 'object') candidates.push(obj.data);
    if (Array.isArray(obj.bookList) && obj.bookList.length) candidates.push(obj.bookList);
    for (const k of Object.keys(obj)) {
      if (k === 'books' || k === 'data' || k === 'bookList') continue;
      scan(obj[k], depth + 1);
    }
  };
  if (Array.isArray(payload)) candidates.push(payload);
  scan(payload, 0);

  for (const list of candidates) {
    const mapped = list
      .map((b) => {
        const bi = b && b.bookInfo && typeof b.bookInfo === 'object' ? b.bookInfo : b;
        return {
          title: (bi && bi.title) || '',
          author: String((bi && bi.author) || '').split('/')[0] || '',
          coverUrl: bi && bi.cover
            ? /^https?:\/\//i.test(String(bi.cover))
              ? String(bi.cover)
              : 'https://weread.qq.com/' + String(bi.cover).replace(/^\/+/, '')
            : '',
          isbn: bi && bi.isbn != null ? String(bi.isbn).trim() : '',
          source: 'weread',
        };
      })
      .filter((b) => b.title);
    if (mapped.length) return mapped;
  }
  return [];
}

// 尽力提取常见统计字段：finishCount / readingCount / totalMinutes
function extractStats(payload) {
  const out = {};
  const pick = (obj, keys) => {
    for (const k of keys) {
      if (obj && obj[k] != null) return obj[k];
    }
    return null;
  };
  const seenKeys = new Set();
  const scan = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 5 || seenKeys.size >= 12) return;
    const finish = pick(obj, ['finishCount', 'finishedCount', 'finishedBookCount']);
    const reading = pick(obj, ['readingCount', 'readingingCount', 'readingBookCount']);
    const minutes = pick(obj, ['totalMinutes', 'readingMinutes', 'readMinutes']);
    if (finish != null && !seenKeys.has('finishCount')) { out.finishCount = finish; seenKeys.add('finishCount'); }
    if (reading != null && !seenKeys.has('readingCount')) { out.readingCount = reading; seenKeys.add('readingCount'); }
    if (minutes != null && !seenKeys.has('totalMinutes')) { out.totalMinutes = minutes; seenKeys.add('totalMinutes'); }
    for (const k of Object.keys(obj)) {
      if (['finishCount', 'finishedCount', 'finishedBookCount', 'readingCount', 'readingingCount', 'readingBookCount', 'totalMinutes', 'readingMinutes', 'readMinutes'].includes(k)) continue;
      scan(obj[k], depth + 1);
    }
  };
  scan(payload, 0);
  return out;
}

/* ---------------- 单用户拉取 ---------------- */
async function fetchUser(apiKey) {
  const shelfRes = await callGateway(apiKey, { api_name: '/shelf/sync', skill_version: SKILL_VERSION });
  const books = extractBooks(shelfRes);

  let stats = {};
  try {
    const statsRes = await callGateway(apiKey, { api_name: '/readdata/detail', mode: 'overall', skill_version: SKILL_VERSION });
    stats = extractStats(statsRes);
  } catch (e) {
    console.warn('[weread-sync] 阅读统计获取失败（跳过）: ' + e.message);
  }
  return { books, stats };
}

/* ---------------- git 提交推送 ---------------- */
function runGit(args, repoRoot) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function commitAndPush(repoRoot, message) {
  runGit(['add', 'data/shelves.json'], repoRoot);
  const changed = runGit(['status', '--porcelain', '--', 'data/shelves.json'], repoRoot).trim();
  if (!changed) {
    console.log('[weread-sync] 无变更，跳过提交');
    return;
  }
  runGit(['-c', 'user.name=' + BOT_NAME, '-c', 'user.email=' + BOT_EMAIL, 'commit', '-m', message], repoRoot);
  runGit(['push'], repoRoot);
  console.log('[weread-sync] 已提交并推送');
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const keyH = process.env.WEREAD_API_KEY_H;
  const keyQ = process.env.WEREAD_API_KEY_Q;
  if (!keyH || !keyQ) {
    console.error('[weread-sync] 缺少环境变量 WEREAD_API_KEY_H / WEREAD_API_KEY_Q，请在 GitHub Secrets 中配置');
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const [h, q] = await Promise.all([fetchUser(keyH), fetchUser(keyQ)]);

  const payload = {
    updatedAt: new Date().toISOString(),
    H: { books: h.books, stats: h.stats },
    Q: { books: q.books, stats: q.stats },
  };

  const outFile = path.join(repoRoot, 'data', 'shelves.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('[weread-sync] 已生成 data/shelves.json（H: ' + h.books.length + ' 本 / Q: ' + q.books.length + ' 本）');

  commitAndPush(repoRoot, 'chore(data): 自动同步微信读书书架 ' + new Date().toISOString());
  console.log('[weread-sync] 完成');
}

main().catch((e) => {
  console.error('[weread-sync] 失败: ' + ((e && e.message) || e));
  process.exit(1);
});
