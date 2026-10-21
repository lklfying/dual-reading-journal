/* ============================================================
   共读札记 · 核心逻辑 (app.js)
   数据层 / 登录 / 写作面板 / 读书墙 / 统计 / 设置
   ============================================================ */

(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const STORAGE_KEY = 'gongdu_journal_v1';
  const USERS = ['我', '同伴'];
  const DAILY_TARGET = 3;   // 每日至少 3 条
  const WEEKLY_TARGET = 3;  // 每周至少 3 天

  /* ---------------- 数据层 ---------------- */
  function defaultData() {
    return {
      currentUser: '我',
      entries: [],      // {id, user, bookTitle, coverUrl, coverKind, date, content, createdAt}
      comments: [],     // {id, entryId, user, content, createdAt}
      shelves: { '我': [], '同伴': [] },  // 书架: [{title, author, coverUrl, isbn, source}]
      wereadCookie: { '我': '', '同伴': '' }
    };
  }

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      // 合并默认结构，防止旧数据缺字段
      const base = defaultData();
      return Object.assign(base, parsed, {
        shelves: Object.assign({ '我': [], '同伴': [] }, parsed.shelves),
        wereadCookie: Object.assign({ '我': '', '同伴': '' }, parsed.wereadCookie)
      });
    } catch (e) {
      console.warn('数据读取失败，使用默认数据', e);
      return defaultData();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  /* ---------------- 工具函数 ---------------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayStr() {
    const d = new Date();
    return fmtDate(d);
  }

  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function fmtDateTime(ts) {
    const d = new Date(ts);
    return `${fmtDate(d)} ${fmtTime(d)}`;
  }

  function weekStartOf(dateStr) {
    // 周一为一周开始
    const d = new Date(dateStr + 'T00:00:00');
    const day = (d.getDay() + 6) % 7; // 周一=0
    d.setDate(d.getDate() - day);
    return fmtDate(d);
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return fmtDate(d);
  }

  function entriesOfUserOn(user, dateStr) {
    return data.entries.filter(e => e.user === user && e.date === dateStr);
  }

  function entriesOn(dateStr) {
    return data.entries.filter(e => e.date === dateStr);
  }

  function userCountOn(user, dateStr) {
    return entriesOfUserOn(user, dateStr).length;
  }

  // 本周（周一到周日）内用户写作的天数
  function weekWritingDays(user) {
    const start = weekStartOf(todayStr());
    const days = new Set();
    data.entries.forEach(e => {
      if (e.user === user && e.date >= start && e.date <= addDays(start, 6)) {
        days.add(e.date);
      }
    });
    return days;
  }

  function weekEntries(user) {
    const start = weekStartOf(todayStr());
    return data.entries.filter(e => e.user === user && e.date >= start && e.date <= addDays(start, 6));
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden', 'toast-error');
    if (isError) el.classList.add('toast-error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  /* ---------------- 登录 ---------------- */
  function initLogin() {
    document.querySelectorAll('.login-buttons .btn').forEach(btn => {
      btn.addEventListener('click', () => {
        data.currentUser = btn.dataset.user;
        save();
        enterApp();
      });
    });
  }

  function enterApp() {
    $('loginOverlay').classList.add('hidden');
    $('app').classList.remove('hidden');
    renderCurrentUser();
    renderWrite();
    renderWall();
    renderStats();
    renderWeread();
  }

  function renderCurrentUser() {
    $('currentUserChip').textContent = data.currentUser;
  }

  /* ---------------- Tab 切换 ---------------- */
  function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const panel = $('tab-' + tab.dataset.tab);
        if (panel) panel.classList.add('active');
        // 切到对应面板时刷新数据
        if (tab.dataset.tab === 'wall') renderWall();
        if (tab.dataset.tab === 'stats') renderStats();
        if (tab.dataset.tab === 'weread') renderWeread();
      });
    });
  }

  /* ============================================================
     写作面板：书名 → 封面加载
     ============================================================ */
  // 封面接口：先试 Google Books，再试 Open Library，失败用本地兜底
  async function fetchCover(title) {
    if (!title.trim()) return { url: '', kind: '' };
    // 1. Google Books
    try {
      const r = await fetchWithTimeout(
        'https://www.googleapis.com/books/v1/volumes?q=intitle:' + encodeURIComponent(title.trim()) + '&maxResults=3',
        6000
      );
      const j = await r.json();
      const img = j.items && j.items[0] && j.items[0].volumeInfo && j.items[0].volumeInfo.imageLinks;
      if (img && img.thumbnail) {
        // Google 返回的 thumbnail 可能是 http，转 https
        return { url: img.thumbnail.replace(/^http:/, 'https:'), kind: 'google', raw: j.items[0].volumeInfo };
      }
    } catch (e) { /* 继续尝试下一接口 */ }

    // 2. Open Library
    try {
      const r = await fetchWithTimeout(
        'https://openlibrary.org/search.json?q=' + encodeURIComponent(title.trim()) + '&limit=3',
        6000
      );
      const j = await r.json();
      if (j.docs && j.docs.length && j.docs[0].cover_i != null) {
        return {
          url: 'https://covers.openlibrary.org/b/id/' + j.docs[0].cover_i + '-M.jpg',
          kind: 'openlibrary',
          raw: j.docs[0]
        };
      }
    } catch (e) { /* 继续 */ }

    // 3. Open Library ISBN 精确匹配（尝试）
    try {
      const r = await fetchWithTimeout(
        'https://openlibrary.org/search.json?q=title:' + encodeURIComponent(title.trim()) + '&fields=isbn,cover_i&limit=5',
        6000
      );
      const j = await r.json();
      if (j.docs && j.docs.length) {
        const doc = j.docs.find(d => d.isbn && d.isbn.length) || j.docs[0];
        const isbn = doc.isbn && doc.isbn[0];
        if (isbn) {
          return {
            url: 'https://covers.openlibrary.org/b/isbn/' + isbn + '-M.jpg',
            kind: 'openlibrary-isbn',
            isbn
          };
        }
      }
    } catch (e) { /* 继续 */ }

    return { url: '', kind: 'fallback' };
  }

  function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
  }

  // 本地兜底封面（SVG data URI）
  function fallbackCoverData(title) {
    const t = (title || '无题').trim();
    const ch = t.charAt(0) || '书';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280">
  <rect width="200" height="280" fill="#3a332b"/>
  <rect x="12" y="12" width="176" height="256" fill="none" stroke="#c9b889" stroke-width="2"/>
  <circle cx="100" cy="100" r="46" fill="none" stroke="#e8ddc2" stroke-width="2"/>
  <text x="100" y="118" font-size="56" text-anchor="middle" fill="#f5efe0" font-family="KaiTi, SimSun, serif">${esc(ch)}</text>
  <text x="100" y="190" font-size="22" text-anchor="middle" fill="#f5efe0" font-family="KaiTi, SimSun, serif">${esc(t.length > 10 ? t.slice(0, 10) + '…' : t)}</text>
</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function setCoverPreview(url, title, kind) {
    const box = $('coverPreview');
    const meta = $('coverMeta');
    if (url) {
      box.innerHTML = `<img src="${esc(url)}" alt="封面" onerror="this.parentNode.innerHTML=window.__gongduFallback('${esc(title.replace(/'/g, ''))}')">`;
    } else {
      box.innerHTML = `<div class="cover-fallback">${fallbackHTML(title)}</div>`;
    }
    const kindText = { google: 'Google Books', openlibrary: 'Open Library', 'openlibrary-isbn': 'Open Library ISBN', fallback: '本地兜底封面' };
    meta.innerHTML = kind === 'fallback'
      ? `<span class="meta-loading">未能获取网络封面，已使用本地兜底封面</span>`
      : `<span>封面来源：${kindText[kind] || kind}</span>`;
  }

  // 兜底封面 HTML（用于列表/卡片）
  function fallbackHTML(title) {
    const t = (title || '无题').trim();
    const ch = t.charAt(0) || '书';
    return `<div class="cover-fallback"><span class="cf-char">${esc(ch)}</span><span class="cf-title">${esc(t)}</span></div>`;
  }

  // 暴露给 img onerror 使用
  window.__gongduFallback = function (title) {
    const box = $('coverPreview');
    if (box) box.innerHTML = `<div class="cover-fallback">${fallbackHTML(title)}</div>`;
  };

  // 渲染任意封面的 HTML 片段（条目/书架用）
  function coverHTML(entry) {
    if (entry.coverUrl) {
      const safeTitle = esc(entry.bookTitle).replace(/'/g, '');
      return `<div class="entry-cover"><img src="${esc(entry.coverUrl)}" alt="封面" loading="lazy" onerror="this.outerHTML=window.__gongduEntryCover('${safeTitle}')"></div>`;
    }
    return `<div class="entry-cover">${fallbackHTML(entry.bookTitle)}</div>`;
  }

  // 读书墙封面加载失败时的兜底（暴露为全局，供 onerror 使用）
  window.__gongduEntryCover = function (title) {
    return `<div class="cover-fallback">${fallbackHTML(title)}</div>`;
  };

  /* ---------------- 写作面板 ---------------- */
  let coverTimer = null;

  function initWrite() {
    $('readDate').value = todayStr();

    // 书名输入 → 防抖加载封面
    $('bookTitle').addEventListener('input', () => {
      clearTimeout(coverTimer);
      const title = $('bookTitle').value.trim();
      if (!title) {
        $('coverPreview').innerHTML = '<span class="cover-placeholder">封面预览</span>';
        $('coverMeta').innerHTML = '';
        return;
      }
      $('coverPreview').innerHTML = '<span class="cover-placeholder">加载封面中…</span>';
      $('coverMeta').innerHTML = '<span class="meta-loading">正在查询公开封面接口…</span>';
      coverTimer = setTimeout(async () => {
        const cover = await fetchCover(title);
        setCoverPreview(cover.url, title, cover.kind);
      }, 700);
    });

    $('writeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const bookTitle = $('bookTitle').value.trim();
      const date = $('readDate').value;
      const content = $('content').value.trim();
      if (!bookTitle) { toast('请输入书名', true); return; }
      if (!date) { toast('请选择读书日期', true); return; }
      if (!content) { toast('请输入读书输出内容', true); return; }

      // 用当前预览的封面（若还在加载中，尝试同步获取一次）
      const entry = {
        id: uid(),
        user: data.currentUser,
        bookTitle,
        coverUrl: '',   // 提交时再异步补封面
        coverKind: 'fallback',
        date,
        content,
        createdAt: Date.now()
      };
      data.entries.push(entry);
      save();

      // 异步补封面（不阻塞提交）
      fetchCover(bookTitle).then(cover => {
        const found = data.entries.find(en => en.id === entry.id);
        if (found && cover.url) {
          found.coverUrl = cover.url;
          found.coverKind = cover.kind;
          save();
          renderWall();
          renderStats();
        }
      });

      // 清空表单，日期保持今天
      $('bookTitle').value = '';
      $('content').value = '';
      $('coverPreview').innerHTML = '<span class="cover-placeholder">封面预览</span>';
      $('coverMeta').innerHTML = '';
      $('readDate').value = todayStr();

      const count = userCountOn(data.currentUser, date);
      toast(`已提交「${bookTitle}」。${date} 当日你已写 ${count} 条`);
      renderWrite();
      renderWall();
      renderStats();
    });
  }

  function renderWrite() {
    const user = data.currentUser;
    const days = weekWritingDays(user);
    const entries = weekEntries(user);

    // 本周 7 天卡片
    const start = weekStartOf(todayStr());
    const html = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const isToday = d === todayStr();
      const isFuture = d > todayStr();
      const count = userCountOn(user, d);
      const cls = ['goal-day'];
      if (count >= DAILY_TARGET) cls.push('ok');
      if (isToday) cls.push('today');
      if (isFuture) cls.push('future');
      const weekNames = ['一', '二', '三', '四', '五', '六', '日'];
      html.push(`<div class="${cls.join(' ')}" title="${d} 已写 ${count} 条">
        <div class="gd-w">周${weekNames[i]}</div>
        <div class="gd-n">${count}/${DAILY_TARGET}</div>
      </div>`);
    }
    $('goalDays').innerHTML = html.join('');

    // 周目标进度
    const daysCount = days.size;
    $('goalDaysText').textContent = `${daysCount} / ${WEEKLY_TARGET} 天`;
    $('goalDaysBar').style.width = Math.min(100, (daysCount / WEEKLY_TARGET) * 100) + '%';
    $('goalEntriesText').textContent = entries.length + ' 条';
    $('goalEntriesBar').style.width = Math.min(100, (entries.length / (DAILY_TARGET * WEEKLY_TARGET)) * 100) + '%';

    // 提示
    let tip = '';
    const todayCount = userCountOn(user, todayStr());
    if (todayCount < DAILY_TARGET) {
      tip = `今日（${todayStr()}）已写 ${todayCount} 条，还需 ${DAILY_TARGET - todayCount} 条达标。`;
    } else {
      tip = `今日（${todayStr()}）已达标（${todayCount} 条），保持！`;
    }
    if (daysCount >= WEEKLY_TARGET) {
      tip += ` 本周已达成 ${daysCount} 天写作目标，共 ${entries.length} 条。`;
    } else {
      tip += ` 本周已写 ${daysCount} 天，还差 ${WEEKLY_TARGET - daysCount} 天达成周目标。`;
    }
    $('goalTip').textContent = tip;
  }

  /* ============================================================
     读书墙
     ============================================================ */
  function renderWall() {
    const showMine = $('filterMine').checked;
    const showPeer = $('filterPeer').checked;

    // 按日期倒序聚合
    const byDate = {};
    data.entries.forEach(e => {
      const show = (e.user === '我' && showMine) || (e.user === '同伴' && showPeer);
      if (!show) return;
      (byDate[e.date] = byDate[e.date] || []).push(e);
    });

    const dates = Object.keys(byDate).sort().reverse();
    if (!dates.length) {
      $('wallList').innerHTML = `<div class="empty-tip">读书墙还空着，去「写作面板」写下第一条读书输出吧。</div>`;
      return;
    }

    const html = dates.map(date => {
      const items = byDate[date].sort((a, b) => b.createdAt - a.createdAt);
      const entriesHTML = items.map(e => {
        const comments = data.comments
          .filter(c => c.entryId === e.id)
          .sort((a, b) => a.createdAt - b.createdAt);
        const commentsHTML = comments.length
          ? `<div class="entry-comments">${comments.map(c =>
              `<div class="cmt"><b>${esc(c.user)}</b>：${esc(c.content)} <span style="font-size:11px;color:#aaa">(${fmtDateTime(c.createdAt)})</span></div>`
            ).join('')}</div>`
          : '';
        return `<div class="wall-entry" data-id="${e.id}">
          ${coverHTML(e)}
          <div class="entry-body">
            <div class="entry-top">
              <span class="entry-user">${esc(e.user)}</span>
              <span class="entry-book">《${esc(e.bookTitle)}》</span>
              <span class="entry-time">${e.date} ${fmtTime(e.createdAt)}</span>
            </div>
            <div class="entry-content">${esc(e.content)}</div>
            <div class="entry-actions">
              <button class="entry-action act-comment">💬 评论（${comments.length}）</button>
              ${e.user === data.currentUser ? `<button class="entry-action act-delete">删除</button>` : ''}
            </div>
            ${commentsHTML}
          </div>
        </div>`;
      }).join('');
      const myN = userCountOn('我', date);
      const peerN = userCountOn('同伴', date);
      return `<div class="wall-day-group">
        <div class="wall-day-head">${date} · 我 ${myN} 条 / 同伴 ${peerN} 条</div>
        ${entriesHTML}
      </div>`;
    }).join('');

    $('wallList').innerHTML = html;

    // 事件绑定
    $('wallList').querySelectorAll('.act-comment').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = data.entries.find(e => e.id === btn.closest('.wall-entry').dataset.id);
        if (entry) openCommentModal(entry);
      });
    });
    $('wallList').querySelectorAll('.act-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const entryId = btn.closest('.wall-entry').dataset.id;
        if (confirm('确定删除这条读书输出吗？（评论会一并删除）')) {
          data.entries = data.entries.filter(e => e.id !== entryId);
          data.comments = data.comments.filter(c => c.entryId !== entryId);
          save();
          renderWall();
          renderWrite();
          renderStats();
          toast('已删除');
        }
      });
    });
  }

  /* ---------------- 评论弹层 ---------------- */
  let commentEntryId = null;

  function openCommentModal(entry) {
    commentEntryId = entry.id;
    $('commentModalTitle').textContent = `评论《${entry.bookTitle}》 · ${entry.user}`;
    renderComments(entry.id);
    $('commentModal').classList.remove('hidden');
    $('commentInput').value = '';
  }

  function renderComments(entryId) {
    const comments = data.comments
      .filter(c => c.entryId === entryId)
      .sort((a, b) => a.createdAt - b.createdAt);
    $('commentList').innerHTML = comments.length
      ? comments.map(c => `<div class="cmt-item">
          <div class="cmt-head"><b>${esc(c.user)}</b><span>${fmtDateTime(c.createdAt)}</span></div>
          <div class="cmt-content">${esc(c.content)}</div>
        </div>`).join('')
      : '<div class="empty-tip">还没有评论，来回复对方吧。</div>';
  }

  function initComments() {
    $('commentModalClose').addEventListener('click', () => $('commentModal').classList.add('hidden'));
    $('commentSubmit').addEventListener('click', () => {
      const content = $('commentInput').value.trim();
      if (!commentEntryId || !content) { toast('请输入回复内容', true); return; }
      data.comments.push({
        id: uid(),
        entryId: commentEntryId,
        user: data.currentUser,
        content,
        createdAt: Date.now()
      });
      save();
      renderComments(commentEntryId);
      renderWall();
      toast('回复成功');
    });
  }

  /* ============================================================
     统计：日历
     ============================================================ */
  let statsYear, statsMonth;

  function initStats() {
    const now = new Date();
    statsYear = now.getFullYear();
    statsMonth = now.getMonth() + 1;
    $('prevMonth').addEventListener('click', () => { shiftMonth(-1); });
    $('nextMonth').addEventListener('click', () => { shiftMonth(1); });
  }

  function shiftMonth(delta) {
    statsMonth += delta;
    if (statsMonth < 1) { statsMonth = 12; statsYear--; }
    if (statsMonth > 12) { statsMonth = 1; statsYear++; }
    renderStats();
  }

  function renderStats() {
    $('statsMonthLabel').textContent = `${statsYear}年${statsMonth}月`;
    const first = new Date(statsYear, statsMonth - 1, 1);
    const daysInMonth = new Date(statsYear, statsMonth, 0).getDate();
    const startWeekday = (first.getDay() + 6) % 7; // 周一=0

    const today = todayStr();
    let cells = '';
    // 前置空格
    for (let i = 0; i < startWeekday; i++) {
      cells += '<td class="cal-day empty"></td>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${statsYear}-${String(statsMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const mineN = userCountOn('我', dateStr);
      const peerN = userCountOn('同伴', dateStr);
      const bothOk = mineN >= DAILY_TARGET && peerN >= DAILY_TARGET;
      const eitherOk = mineN >= DAILY_TARGET || peerN >= DAILY_TARGET;
      const any = mineN + peerN > 0;
      let cls = 'cal-day';
      if (any) {
        if (bothOk) cls += ' done-full';
        else if (eitherOk) cls += ' done-full';
        else cls += ' done-part';
      }
      if (dateStr === today) cls += ' today-mark';
      const stateHTML = any
        ? `<span class="cal-day-state mine">我 ${mineN}条${mineN >= DAILY_TARGET ? ' ✓' : ''}</span><span class="cal-day-state peer">同伴 ${peerN}条${peerN >= DAILY_TARGET ? ' ✓' : ''}</span>`
        : '';
      cells += `<td class="${cls}"><span class="cal-day-num">${d}</span>${stateHTML}</td>`;
    }
    // 尾部补足
    const total = startWeekday + daysInMonth;
    const pad = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 0; i < pad; i++) {
      cells += '<td class="cal-day empty"></td>';
    }
    $('calendarBody').innerHTML = cells;

    // 月度总结
    let mineDays = 0, mineTotal = 0, peerDays = 0, peerTotal = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${statsYear}-${String(statsMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (userCountOn('我', dateStr) > 0) mineDays++;
      if (userCountOn('同伴', dateStr) > 0) peerDays++;
      mineTotal += userCountOn('我', dateStr);
      peerTotal += userCountOn('同伴', dateStr);
    }
    const monthFirst = `${statsYear}-${String(statsMonth).padStart(2, '0')}-01`;
    const monthLast = `${statsYear}-${String(statsMonth).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const mineWeeks = countWeeksWithTarget('我', monthFirst, monthLast);
    const peerWeeks = countWeeksWithTarget('同伴', monthFirst, monthLast);

    $('monthlySummary').innerHTML = `
      <div class="ms-card"><h4>📖 我 · 本月</h4>共 ${mineTotal} 条 · 写作 ${mineDays} 天 · 达标周 ${mineWeeks} 个</div>
      <div class="ms-card"><h4>📖 同伴 · 本月</h4>共 ${peerTotal} 条 · 写作 ${peerDays} 天 · 达标周 ${peerWeeks} 个</div>
      <div class="ms-card"><h4>🏅 双人合计</h4>共 ${mineTotal + peerTotal} 条 · 覆盖 ${new Set(data.entries.filter(e => e.date >= monthFirst && e.date <= monthLast).map(e => e.date)).size} 天</div>
    `;
  }

  // 统计某月内用户满足"每周>=3天写作"的完整周数
  function countWeeksWithTarget(user, monthFirst, monthLast) {
    // 收集该月内用户写作的所有日期
    const writeDates = new Set(
      data.entries.filter(e => e.user === user && e.date >= monthFirst && e.date <= monthLast).map(e => e.date)
    );
    // 从月首所在周开始，遍历该月涉及的所有周
    const startWeek = weekStartOf(monthFirst);
    let weeks = 0;
    for (let w = startWeek, i = 0; i < 6; i++, w = addDays(w, 7)) {
      // 该周与本月有交集才统计
      const weekDates = [];
      let intersects = false;
      for (let j = 0; j < 7; j++) {
        const d = addDays(w, j);
        if (d >= monthFirst && d <= monthLast) { intersects = true; weekDates.push(d); }
      }
      if (!intersects) continue;
      const hit = weekDates.filter(d => writeDates.has(d)).length;
      if (hit >= WEEKLY_TARGET) weeks++;
    }
    return weeks;
  }

  /* ============================================================
     设置：导入导出
     ============================================================ */
  function initSettings() {
    // 导出 JSON
    $('exportDataBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `共读札记备份_${todayStr()}.json`);
      toast('已导出 JSON 备份');
    });

    // 导入 JSON
    $('importDataBtn').addEventListener('click', () => $('importDataInput').click());
    $('importDataInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (!imported.entries || !imported.comments || !imported.shelves) {
            throw new Error('格式不正确');
          }
          // 合并去重（按 id）
          const mergeById = (list) => {
            const map = new Map();
            data.entries.concat(list).forEach(x => map.set(x.id, x));
            return Array.from(map.values());
          };
          // 先合并 entries 和 comments，再合并书架
          data.entries = mergeById(imported.entries);
          data.comments = mergeById(imported.comments);
          USERS.forEach(u => {
            const mine = (data.shelves[u] || []);
            const theirs = (imported.shelves[u] || []).filter(b => !mine.some(m => m.title === b.title && m.author === b.author));
            data.shelves[u] = mine.concat(theirs);
          });
          // 合并 Cookie（本地 Cookie 优先保留）
          USERS.forEach(u => {
            if (!data.wereadCookie[u] && imported.wereadCookie && imported.wereadCookie[u]) {
              data.wereadCookie[u] = imported.wereadCookie[u];
            }
          });
          save();
          renderWrite(); renderWall(); renderStats(); renderWeread();
          toast(`导入成功：${imported.entries.length} 条输出已并入`);
        } catch (err) {
          toast('导入失败：JSON 格式不正确', true);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // 清空数据
    $('clearDataBtn').addEventListener('click', () => {
      if (confirm('确定清空本浏览器中的全部数据？此操作不可恢复！建议先导出备份。')) {
        if (confirm('再次确认：全部读书输出、评论、书架将被删除。确定继续？')) {
          data = defaultData();
          save();
          renderWrite(); renderWall(); renderStats(); renderWeread();
          toast('已清空全部数据');
        }
      }
    });
  }

  // 切换身份
  $('switchUserBtn') && $('switchUserBtn').addEventListener('click', () => {
    data.currentUser = (data.currentUser === '我') ? '同伴' : '我';
    save();
    renderCurrentUser();
    renderWrite(); renderWall(); renderStats(); renderWeread();
    toast(`已切换为「${data.currentUser}」`);
  });

  /* ---------------- 导出 DOCX（由 export.js 提供 window.exportDocx） ---------------- */
  function initExportModal() {
    $('exportModalClose').addEventListener('click', () => $('exportModal').classList.add('hidden'));
    $('exportDocxBtn').addEventListener('click', async () => {
      const user = $('exportUser').value;
      const start = $('exportStart').value;
      const end = $('exportEnd').value;
      if (!start || !end) { toast('请选择起止日期', true); return; }
      if (start > end) { toast('开始日期不能晚于结束日期', true); return; }
      try {
        await window.exportDocx({ user, start, end, entries: data.entries, comments: data.comments });
        toast('DOCX 已生成下载');
      } catch (err) {
        console.error(err);
        toast('导出失败，请检查网络后重试', true);
      }
    });
  }

  // 读书墙上提供导出入口（在空态旁），由设置面板导出按钮统一入口
  // 在统计面板顶部加一个快速导出按钮
  function addExportButton() {
    const statsPanel = $('tab-stats');
    const nav = statsPanel.querySelector('.stats-nav');
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = '导出 DOCX';
    btn.style.marginLeft = 'auto';
    btn.addEventListener('click', () => {
      const now = new Date();
      $('exportStart').value = `${now.getFullYear()}-01-01`;
      $('exportEnd').value = todayStr();
      $('exportUser').value = data.currentUser;
      $('exportModal').classList.remove('hidden');
    });
    nav.appendChild(btn);
  }

  /* ---------------- 通用下载 ---------------- */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    initLogin();
    initTabs();
    initWrite();
    initComments();
    initStats();
    initSettings();
    initExportModal();
    addExportButton();

    // 过滤条件变化时刷新读书墙
    $('filterMine').addEventListener('change', renderWall);
    $('filterPeer').addEventListener('change', renderWall);

    // 自动进入（若已选择过身份）
    if (data.currentUser && USERS.includes(data.currentUser)) {
      enterApp();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  // 供 weread.js / export.js 使用
  window.GD = {
    data, save, $, esc, uid, toast, todayStr, fmtDate, fmtDateTime,
    coverHTML, fallbackHTML, downloadBlob, renderWrite, renderWall, renderStats, renderWeread,
    DAILY_TARGET, WEEKLY_TARGET, USERS
  };
})();
