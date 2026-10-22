/* ============================================================
   共读札记 · 微信读书联动 (weread.js)
   静态书架同步（data/shelves.json）/ 手动添加 / 批量导入 / 重合对比
   ============================================================ */

(function () {
  'use strict';
  const GD = window.GD;
  const $ = GD.$;

  // 当前书架操作对象（'H' / 'Q'）
  let shelfUser = 'H';

  /* ---------------- 阅读统计展示 ---------------- */
  // 阅读统计展示文案（尽力读取常见字段，缺失显示 —）
  function statText(s) {
    if (!s || typeof s !== 'object') return '—';
    const pick = (k1, k2) => (s[k1] != null ? s[k1] : (s[k2] != null ? s[k2] : null));
    const parts = [];
    const finish = pick('finishCount', 'finishedCount');
    if (finish != null) parts.push(finish + ' 本读完');
    const reading = pick('readingCount', 'readingingCount');
    if (reading != null) parts.push(reading + ' 本在读');
    const total = pick('totalMinutes', 'readingMinutes');
    if (total != null) parts.push(total + ' 分钟');
    return parts.length ? parts.join(' / ') : '—';
  }

  /* ---------------- 渲染书架区 ---------------- */
  function renderWeread() {
    // 书架用户切换按钮
    const resultEl = $('wereadResult');
    if (!resultEl) return;

    // 展示两个书架概要 + 当前操作书架的书本网格
    const mine = GD.data.shelves['H'] || [];
    const peer = GD.data.shelves['Q'] || [];
    const active = shelfUser;

    // 阅读统计摘要（来自 /readdata/detail，缓存于 GD.data.readStats）
    const statsH = (GD.data.readStats && GD.data.readStats['H']) || null;
    const statsQ = (GD.data.readStats && GD.data.readStats['Q']) || null;
    const statsHTML = (statsH || statsQ) ? `
      <div class="weread-stats">
        <span class="ws-item"><b>H</b> ${statText(statsH)}</span>
        <span class="ws-item"><b>Q</b> ${statText(statsQ)}</span>
      </div>` : '';

    // 顶部操作栏：切换谁的书架
    const switcher = `
      <div class="form-actions" style="margin-bottom:14px">
        <button class="btn ${active === 'H' ? 'btn-primary' : 'btn-ghost'}" data-shelf-user="H">H 的书架（${mine.length}）</button>
        <button class="btn ${active === 'Q' ? 'btn-primary' : 'btn-ghost'}" data-shelf-user="Q">Q 的书架（${peer.length}）</button>
      </div>`;

    const list = active === 'H' ? mine : peer;
    const booksHTML = list.length
      ? `<div class="shelf-grid">${list.map((b, i) => {
          const safeTitle = GD.esc(b.title).replace(/'/g, '');
          const cleanCover = normalizeCover(b.coverUrl);
          const coverHTML = cleanCover
            ? `<img src="${GD.esc(cleanCover)}" loading="lazy" onerror="this.outerHTML=window.__gongduShelfCover('${safeTitle}')">`
            : shelfFallback(b.title);
          return `
          <div class="shelf-book" title="${GD.esc(b.title)}">
            <button class="sb-remove" data-shelf-user="${active}" data-idx="${i}">×</button>
            <div class="sb-cover">${coverHTML}</div>
            <div class="sb-title">${GD.esc(b.title)}</div>
          </div>`;
        }).join('')}</div>`
      : `<div class="empty-tip">「${active}」的书架还是空的，书架数据自动同步后即会显示，也可手动添加书籍。</div>`;

    resultEl.innerHTML = `
      <div class="weread-summary">H ${mine.length} 本 · Q ${peer.length} 本</div>
      ${statsHTML}
      ${switcher}
      ${booksHTML}`;

    // 绑定切换
    resultEl.querySelectorAll('[data-shelf-user]').forEach(btn => {
      if (btn.dataset.idx !== undefined) {
        btn.addEventListener('click', () => {
          const u = btn.dataset.shelfUser;
          const idx = Number(btn.dataset.idx);
          if (!confirm(`从「${u}」书架中移除《${GD.data.shelves[u][idx].title}》？`)) return;
          GD.data.shelves[u].splice(idx, 1);
          GD.save();
          if (window.CLOUD) window.CLOUD.updateShelf(u).catch(function () { });
          renderWeread();
          renderOverlap();
          GD.toast('已移除');
        });
      } else {
        btn.addEventListener('click', () => {
          shelfUser = btn.dataset.shelfUser;
          renderWeread();
        });
      }
    });
  }

  // 归一化封面 URL：修复历史脏数据（https://weread.qq.com/https://cdn.weread.qq.com/... 重复域名）
  function normalizeCover(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    const m = s.match(/^https?:\/\/[^/]+\/(https?:\/\/.+)$/i);
    return m ? m[1] : s;
  }

  function shelfFallback(title) {
    const t = (title || '书').trim();
    const ch = t.charAt(0) || '书';
    return `<div class="cover-fallback"><span class="cf-char">${GD.esc(ch)}</span><span class="cf-title">${GD.esc(t)}</span></div>`;
  }

  // 书架封面加载失败时的兜底（暴露为全局，供 onerror 使用）
  window.__gongduShelfCover = function (title) {
    return shelfFallback(title);
  };

  // 暴露给 app.js（enterApp 时会调用 renderWeread / renderOverlap）
  window.renderWeread = renderWeread;
  window.renderOverlap = renderOverlap;

  /* ---------------- 重合计算 ---------------- */
  function normalizeTitle(t) {
    return String(t || '').replace(/[《》\s：:，,。.!！?？·、]/g, '').toLowerCase();
  }

  function calcOverlap() {
    const mine = GD.data.shelves['H'] || [];
    const peer = GD.data.shelves['Q'] || [];
    const peerSet = new Map();
    peer.forEach(b => peerSet.set(normalizeTitle(b.title), b));
    const overlap = [];
    mine.forEach(b => {
      const key = normalizeTitle(b.title);
      if (key && peerSet.has(key)) {
        overlap.push({ mine: b, peer: peerSet.get(key) });
      }
    });
    const total = mine.length + peer.length;
    const rate = total === 0 ? 0 : (overlap.length * 2) / total;
    return { mine: mine.length, peer: peer.length, overlap, rate };
  }

  function renderOverlap() {
    const { mine, peer, overlap, rate } = calcOverlap();
    // 重合对比标签随当前身份动态变化：左侧为当前身份，右侧为对方
    const me = GD.data.currentUser || 'H';
    const them = me === 'H' ? 'Q' : 'H';
    const mineNameEl = document.querySelector('#vennMineLabel .venn-name');
    const peerNameEl = document.querySelector('#vennPeerLabel .venn-name');
    if (mineNameEl) mineNameEl.textContent = me;
    if (peerNameEl) peerNameEl.textContent = them;
    $('vennMineCount').textContent = mine;
    $('vennPeerCount').textContent = peer;
    $('vennOverlapCount').textContent = overlap.length;

    const rateText = (rate * 100).toFixed(1) + '%';
    $('overlapInfo').innerHTML = overlap.length
      ? `两人书架重合 <b style="color:var(--cinnabar)">${overlap.length}</b> 本，重合率（Jaccard 近似）约 <b>${rateText}</b>。`
      : `暂未发现重合书籍。重合率 ${rateText}。`;

    $('overlapList').innerHTML = overlap.length
      ? overlap.map((o, i) => `<div class="overlap-book">
          <span>${i + 1}. 《${GD.esc(o.mine.title)}》${o.mine.author ? '（' + GD.esc(o.mine.author) + '）' : ''}</span>
          <span style="color:var(--gold);font-size:12px;white-space:nowrap">共同在读</span>
        </div>`).join('')
      : '';
  }

  /* ---------------- 事件绑定 ---------------- */
  function initWeread() {
    // 手动添加
    $('wereadManualBtn').addEventListener('click', () => {
      openModal(`
        <h3>手动添加书籍到「${shelfUser}」书架</h3>
        <div class="field"><label>书名 *</label><input type="text" id="manualTitle" placeholder="如：红楼梦"></div>
        <div class="field"><label>作者</label><input type="text" id="manualAuthor" placeholder="如：曹雪芹"></div>
        <div class="field"><label>封面图片 URL（可选）</label><input type="text" id="manualCover" placeholder="https://… 留空则自动尝试加载"></div>
        <div class="field"><label>ISBN（可选）</label><input type="text" id="manualIsbn" placeholder="978…"></div>
        <div class="form-actions"><button class="btn btn-primary" id="manualSaveBtn">添加</button></div>
      `);
      $('manualSaveBtn').addEventListener('click', () => {
        const title = $('manualTitle').value.trim();
        if (!title) { GD.toast('请输入书名', true); return; }
        const book = {
          title,
          author: $('manualAuthor').value.trim(),
          coverUrl: $('manualCover').value.trim(),
          isbn: $('manualIsbn').value.trim(),
          source: 'manual'
        };
        if (!book.coverUrl) {
          // 尝试按书名取封面（不阻塞添加）
          fetchCoverForManual(book, shelfUser);
        }
        GD.data.shelves[shelfUser].push(book);
        GD.save();
        if (window.CLOUD) window.CLOUD.updateShelf(shelfUser).catch(function () { });
        closeModal();
        renderWeread();
        renderOverlap();
        GD.toast(`已添加《${title}》`);
      });
    });

    // 批量导入
    $('wereadBatchBtn').addEventListener('click', () => {
      openModal(`
        <h3>批量导入书籍到「${shelfUser}」书架</h3>
        <p class="panel-desc">支持两种格式：<br>
        ① JSON 数组：[{"title":"红楼梦","author":"曹雪芹","coverUrl":"…","isbn":"…"}]<br>
        ② 纯文本每行一本：书名|作者（竖线分隔）</p>
        <div class="field"><textarea id="batchText" rows="8" placeholder='红楼梦|曹雪芹&#10;三体|刘慈欣'></textarea></div>
        <div class="form-actions"><button class="btn btn-primary" id="batchSaveBtn">导入</button></div>
      `);
      $('batchSaveBtn').addEventListener('click', () => {
        const text = $('batchText').value.trim();
        if (!text) { GD.toast('请输入内容', true); return; }
        const books = parseBatch(text);
        if (!books.length) { GD.toast('未能解析出任何书籍', true); return; }
        books.forEach(b => GD.data.shelves[shelfUser].push(b));
        GD.save();
        if (window.CLOUD) window.CLOUD.updateShelf(shelfUser).catch(function () { });
        closeModal();
        renderWeread();
        renderOverlap();
        GD.toast(`成功导入 ${books.length} 本`);
      });
    });
  }

  function parseBatch(text) {
    // 尝试 JSON
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j)) {
        return j.map(b => ({ title: b.title || '', author: b.author || '', coverUrl: b.coverUrl || b.cover || '', isbn: b.isbn || '', source: 'batch' }))
          .filter(b => b.title);
      }
    } catch (e) { /* 走纯文本 */ }
    // 纯文本：每行 书名|作者
    return text.split(/\r?\n/).map(line => {
      line = line.trim();
      if (!line) return null;
      const [title, author] = line.split('|').map(s => (s || '').trim());
      return { title, author: author || '', coverUrl: '', isbn: '', source: 'batch' };
    }).filter(Boolean);
  }

  function mergeBooks(user, books) {
    const existing = GD.data.shelves[user] || [];
    const seen = new Set(existing.map(b => normalizeTitle(b.title)));
    books.forEach(b => {
      const key = normalizeTitle(b.title);
      if (key && !seen.has(key)) { existing.push(b); seen.add(key); }
    });
  }

  /* ---------------- 静态同步文件合并（GitHub Actions 生成 data/shelves.json） ---------------- */
  // 成功时将微信读书来源数据优先覆盖对应 user 的书架并刷新渲染/重合度；失败静默降级
  async function loadStaticShelves() {
    try {
      const res = await fetch('./data/shelves.json', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || typeof json !== 'object') return;
      ['H', 'Q'].forEach(user => {
        const remote = json[user];
        if (!remote || !Array.isArray(remote.books)) return;
        GD.data.shelves[user] = GD.data.shelves[user] || [];
        // 优先覆盖：移除旧的 weread 来源书籍，再合并远端数据（保留手动/批量导入的书）
        GD.data.shelves[user] = GD.data.shelves[user].filter(b => b.source !== 'weread');
        const existing = GD.data.shelves[user];
        const seen = new Set(existing.map(b => normalizeTitle(b.title)));
        remote.books.forEach(b => {
          const key = normalizeTitle(b.title);
          if (key && !seen.has(key)) { existing.push(b); seen.add(key); }
        });
        // 阅读时长 stats 同步进 GD.data.readStats 并展示
        if (remote.stats && typeof remote.stats === 'object') {
          GD.data.readStats = GD.data.readStats || {};
          GD.data.readStats[user] = remote.stats;
        }
      });
      GD.save();
      if (window.CLOUD) {
        window.CLOUD.updateShelf('H').catch(function () { });
        window.CLOUD.updateShelf('Q').catch(function () { });
      }
      renderWeread();
      renderOverlap();
    } catch (e) {
      // 静态同步文件不存在/不可用时静默降级，不影响现有功能
      console.warn('[weread] data/shelves.json 不可用，使用现有数据', e);
    }
  }

  async function fetchCoverForManual(book, user) {
    try {
      // 复用 app.js 的封面接口逻辑（简化版：Google Books）
      const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=intitle:' + encodeURIComponent(book.title) + '&maxResults=1');
      const j = await r.json();
      const img = j.items && j.items[0] && j.items[0].volumeInfo && j.items[0].volumeInfo.imageLinks;
      if (img && img.thumbnail) {
        book.coverUrl = normalizeCover(img.thumbnail.replace(/^http:/, 'https:'));
        GD.save();
        if (window.CLOUD) window.CLOUD.updateShelf(user || 'H').catch(function () { });
        renderWeread();
        renderOverlap();
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 弹层 ---------------- */
  let modalBodyEl = null;
  function openModal(html) {
    $('bookModalBody').innerHTML = html;
    $('bookModal').classList.remove('hidden');
    modalBodyEl = $('bookModalBody');
  }
  function closeModal() {
    $('bookModal').classList.add('hidden');
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    initWeread();
    // DOM 就绪后再绑定关闭按钮
    $('bookModalClose') && $('bookModalClose').addEventListener('click', closeModal);
    renderOverlap();
    // 尝试加载 GitHub Actions 自动生成的静态同步文件（失败静默降级）
    loadStaticShelves();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
