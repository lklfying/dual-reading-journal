/* ============================================================
   共读札记 · 微信读书联动 (weread.js)
   Cookie 拉取书架 / 手动添加 / 批量导入 / 重合对比
   ============================================================ */

(function () {
  'use strict';
  const GD = window.GD;
  const $ = GD.$;

  // 当前书架操作对象（'我' / '同伴'）
  let shelfUser = '我';

  /* ---------------- 微信读书书架接口 ---------------- */
  async function fetchWereadShelf(cookie) {
    // 微信读书网页版书架接口（需携带登录 Cookie）
    const res = await fetch('https://weread.qq.com/web/shelf/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      },
      body: JSON.stringify({ synckeys: [], list: [] })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const books = (j.books || []).map(b => {
      const bi = b.bookInfo || b;
      return {
        title: bi.title || '',
        author: (bi.author || '').split('/')[0] || '',
        coverUrl: bi.cover ? ('https://weread.qq.com/' + bi.cover.replace(/^\/+/, '')) : '',
        isbn: (bi.isbn && String(bi.isbn).trim()) || '',
        source: 'weread'
      };
    }).filter(b => b.title);
    return books;
  }

  /* ---------------- 渲染书架区 ---------------- */
  function renderWeread() {
    // 书架用户切换按钮
    const resultEl = $('wereadResult');
    if (!resultEl) return;

    // 展示两个书架概要 + 当前操作书架的书本网格
    const mine = GD.data.shelves['我'] || [];
    const peer = GD.data.shelves['同伴'] || [];
    const active = shelfUser;

    // 顶部操作栏：切换谁的书架
    const switcher = `
      <div class="form-actions" style="margin-bottom:14px">
        <button class="btn ${active === '我' ? 'btn-primary' : 'btn-ghost'}" data-shelf-user="我">我的书架（${mine.length}）</button>
        <button class="btn ${active === '同伴' ? 'btn-primary' : 'btn-ghost'}" data-shelf-user="同伴">同伴书架（${peer.length}）</button>
      </div>`;

    const list = active === '我' ? mine : peer;
    const booksHTML = list.length
      ? `<div class="shelf-grid">${list.map((b, i) => {
          const safeTitle = GD.esc(b.title).replace(/'/g, '');
          const coverHTML = b.coverUrl
            ? `<img src="${GD.esc(b.coverUrl)}" loading="lazy" onerror="this.outerHTML=window.__gongduShelfCover('${safeTitle}')">`
            : shelfFallback(b.title);
          return `
          <div class="shelf-book" title="${GD.esc(b.title)}">
            <button class="sb-remove" data-shelf-user="${active}" data-idx="${i}">×</button>
            <div class="sb-cover">${coverHTML}</div>
            <div class="sb-title">${GD.esc(b.title)}</div>
          </div>`;
        }).join('')}</div>`
      : `<div class="empty-tip">「${active}」的书架还是空的，用 Cookie 拉取或手动添加书籍。</div>`;

    resultEl.innerHTML = `
      <div class="weread-summary">我 ${mine.length} 本 · 同伴 ${peer.length} 本</div>
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
    const mine = GD.data.shelves['我'] || [];
    const peer = GD.data.shelves['同伴'] || [];
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
    // 拉取书架
    $('wereadFetchBtn').addEventListener('click', async () => {
      const cookie = $('wereadCookie').value.trim();
      if (!cookie) { GD.toast('请先粘贴微信读书 Cookie', true); return; }
      // 保存到当前用户的 Cookie 槽位
      GD.data.wereadCookie[shelfUser] = cookie;
      GD.save();
      GD.toast('正在拉取书架…');
      $('wereadFetchBtn').disabled = true;
      try {
        const books = await fetchWereadShelf(cookie);
        if (!books.length) { GD.toast('接口未返回书籍，可能 Cookie 失效或接口变更，请手动添加', true); return; }
        mergeBooks(shelfUser, books);
        GD.toast(`拉取成功：${books.length} 本书已加入「${shelfUser}」书架`);
        renderWeread();
        renderOverlap();
      } catch (e) {
        console.error(e);
        GD.toast('拉取失败：接口不可用或 Cookie 无效。已优雅降级，请使用手动添加/批量导入。', true);
      } finally {
        $('wereadFetchBtn').disabled = false;
      }
    });

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
          fetchCoverForManual(book);
        }
        GD.data.shelves[shelfUser].push(book);
        GD.save();
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

  async function fetchCoverForManual(book) {
    try {
      // 复用 app.js 的封面接口逻辑（简化版：Google Books）
      const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=intitle:' + encodeURIComponent(book.title) + '&maxResults=1');
      const j = await r.json();
      const img = j.items && j.items[0] && j.items[0].volumeInfo && j.items[0].volumeInfo.imageLinks;
      if (img && img.thumbnail) {
        book.coverUrl = img.thumbnail.replace(/^http:/, 'https:');
        GD.save();
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
  $('bookModalClose') && $('bookModalClose').addEventListener('click', closeModal);

  /* ---------------- 启动 ---------------- */
  function boot() {
    initWeread();
    renderOverlap();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
