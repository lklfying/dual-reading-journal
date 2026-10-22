/* ============================================================
   共读札记 · CloudBase 云同步层 (cloud.js)
   - 手动调用 auth API 匿名登录（无需依赖 SDK 内部 token 状态）
   - SQL 型数据库（PostgreSQL 模式）表 entries / comments / shelves
   - 通过 PostgREST 风格 HTTP API（/v1/rdb/rest/<table>）执行行级读写，受 RLS 约束
   - SQL 型数据库不支持 watch 实时监听，改用轮询（15s）+ 页面聚焦即时拉取
   - localStorage 由 app.js 保留为本地缓存与离线降级
   ============================================================ */
(function () {
  'use strict';

  var CLOUD_ENV = 'zhhhhh-d7g3gofzia26c76c3';
  var USERS = ['H', 'Q'];
  var API_BASE = 'https://' + CLOUD_ENV + '.api.tcloudbasegateway.com/v1/rdb/rest/';
  var AUTH_BASE = 'https://' + CLOUD_ENV + '.api.tcloudbasegateway.com';
  var DEVICE_ID_KEY = 'cloudbase_device_id'; // 设备 ID 决定匿名用户身份，必须持久化
  var POLL_INTERVAL = 300000;  // 节省 SQL 算力：轮询间隔 5 分钟（页面不可见时暂停）
  var BATCH = 1000;            // 单次分页拉取行数上限

  // SDK CDN 备选（按优先级）。static.cloudbase.net 为官方 CDN（国内可访问）；
  // jsdelivr / unpkg 为国际 CDN（国内部分网络可访问），仅作失败回退。
  var SDK_CDNS = [
    'https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js',
    'https://cdn.jsdelivr.net/npm/@cloudbase/js-sdk@1.9.5/dist/index.umd.js',
    'https://unpkg.com/@cloudbase/js-sdk@1.9.5/dist/index.umd.js'
  ];

  var state = {
    ready: false,        // 云是否可用（仅当实际数据请求成功后置 true）
    authed: false,       // 匿名登录是否成功（不等于云可用，banner 以此区分失败原因）
    connecting: false,   // 是否正在重连
    paused: false,       // 页面不可见/离线时暂停轮询与重试
    pendingSync: false,  // 降级期间有本地写入，恢复后需同步
    token: null,         // 匿名登录 access_token（JWT），用于 REST 请求
    tokenExpiresAt: 0,   // token 过期时间戳
    deviceId: null,      // 匿名登录设备 ID（保持同一匿名用户身份，RLS 按 sub 归属）
    cloudKeys: { entries: new Set(), comments: new Set(), shelves: new Set() } // docKey 集合（已上传标记）
  };

  var pollTimer = null;
  var pulling = false;

  function GD() { return window.GD; }

  /* ---------------- SDK 加载（保留：后续如需 SDK 高级能力可复用） ---------------- */
  function loadSDK() {
    if (window.cloudbase && typeof window.cloudbase.init === 'function') {
      return Promise.resolve(window.cloudbase);
    }
    var urls = SDK_CDNS.slice();
    // 官方 CDN 已在 index.html 静态加载失败（onerror 已置标记），跳过第一个直接试备选
    if (window.__SDK_LOAD_FAILED) urls.shift();
    return new Promise(function (resolve, reject) {
      var i = 0;
      function tryNext() {
        if (i >= urls.length) {
          reject(new Error('CloudBase SDK 加载失败，已降级为本地模式'));
          return;
        }
        var url = urls[i++];
        var s = document.createElement('script');
        s.src = url;
        s.onload = function () {
          if (window.cloudbase && typeof window.cloudbase.init === 'function') {
            resolve(window.cloudbase);
          } else {
            tryNext();
          }
        };
        s.onerror = function () { tryNext(); };
        document.head.appendChild(s);
      }
      tryNext();
    });
  }

  /* ---------------- 匿名登录（手动调用 auth API，拿 JWT） ---------------- */
  function genUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // 设备 ID 决定匿名用户身份（RLS 按 sub 归属），必须持久化保持同一用户
  function getDeviceId() {
    if (state.deviceId) return state.deviceId;
    var v = null;
    try {
      v = localStorage.getItem(DEVICE_ID_KEY);
      if (!v) { v = genUUID(); localStorage.setItem(DEVICE_ID_KEY, v); }
    } catch (e) {
      v = v || genUUID();
    }
    state.deviceId = v;
    return v;
  }

  // 匿名登录：POST /auth/v1/signin/anonymously（必须携带 x-device-id 头，否则 400）
  function anonymSignIn() {
    return fetch(AUTH_BASE + '/auth/v1/signin/anonymously', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-device-id': getDeviceId(),
        'x-request-id': genUUID()
      },
      body: '{}'
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (txt) {
          throw new Error('匿名登录失败: ' + resp.status + ' ' + txt);
        });
      }
      return resp.json();
    }).then(function (j) {
      var t = j.access_token || (j.data && j.data.access_token);
      if (!t) throw new Error('匿名登录响应缺少 access_token');
      state.token = t;
      state.tokenExpiresAt = Date.now() + ((j.expires_in && j.expires_in > 0) ? j.expires_in : 7200) * 1000;
      state.authed = true;
      return t;
    });
  }

  /* ---------------- 初始化 / 匿名登录（拿 JWT） ---------------- */
  function init() {
    return anonymSignIn().then(function () {
      updateBanner();
      return true;
    }).catch(function (e) {
      console.warn('[cloud] init failed', e);
      state.authed = false;
      state.token = null;
      updateBanner();
      return false;
    });
  }

  /* ---------------- 状态横幅 ---------------- */
  function updateBanner() {
    var el = document.getElementById('cloudBanner');
    if (!el) return;
    if (state.ready) {
      el.textContent = '云端已连接：每 5 分钟自动同步，页面不可见时暂停';
      el.className = 'cloud-banner ok';
    } else if (state.authed) {
      el.textContent = '云端未连接：认证成功但数据请求失败（401/网络异常），请检查环境配置';
      el.className = 'cloud-banner error';
    } else {
      el.textContent = '云端未连接：匿名登录失败，仍可本地编辑，恢复后自动同步';
      el.className = 'cloud-banner error';
    }
  }

  /* ---------------- Token 获取 / REST 请求 ---------------- */
  // token 缺失或临近过期（提前 60s）时重新匿名登录；同一设备 ID 保持同一匿名用户
  function getToken() {
    if (state.token && state.tokenExpiresAt && state.tokenExpiresAt > Date.now() + 60000) {
      return Promise.resolve(state.token);
    }
    return anonymSignIn();
  }

  function doRequest(method, table, queryStr, body, token) {
    var url = API_BASE + table + (queryStr || '');
    var opts = { method: method, headers: { Authorization: 'Bearer ' + token } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (method !== 'GET') opts.headers['Prefer'] = 'return=representation';
    return fetch(url, opts).then(function (resp) {
      if (resp.status === 204) return [];
      if (!resp.ok) {
        return resp.text().then(function (txt) {
          throw new Error(method + ' ' + table + ' 失败: ' + resp.status + ' ' + txt);
        });
      }
      return resp.json();
    });
  }

  // 统一请求入口：401 时刷新 token 重试一次
  function request(method, table, queryStr, body) {
    return getToken().then(function (token) {
      return doRequest(method, table, queryStr, body, token).catch(function (e) {
        if (String(e.message || '').indexOf('401') === -1 && String(e.message || '').indexOf('Unauthorized') === -1) {
          throw e;
        }
        state.token = null; // token 失效，重取后重试一次
        return getToken().then(function (t2) {
          return doRequest(method, table, queryStr, body, t2);
        });
      });
    });
  }

  /* ---------------- 表读取（分页拉取，绕过单次请求行数限制） ---------------- */
  function fetchAll(table) {
    var out = [];
    function page(offset) {
      return request('GET', table, '?select=*&limit=' + BATCH + '&offset=' + offset).then(function (rows) {
        var arr = rows || [];
        out = out.concat(arr);
        if (arr.length < BATCH) return out;
        return page(offset + BATCH);
      });
    }
    return page(0);
  }

  /* 行 -> 前端对象（snake_case -> camelCase） */
  function stripEntry(x) {
    return {
      id: x.doc_key,
      user: x.user,
      bookTitle: x.book_title,
      coverUrl: x.cover_url || '',
      coverKind: x.cover_kind || 'fallback',
      date: x.date,
      content: x.content || '',
      createdAt: x.created_at || 0
    };
  }

  function stripComment(x) {
    return {
      id: x.doc_key,
      entryId: x.entry_id,
      user: x.user,
      content: x.content || '',
      createdAt: x.created_at || 0
    };
  }

  /* 前端 payload -> 表字段（camelCase -> snake_case） */
  function rowForEntry(e) {
    return {
      user: e.user,
      book_title: e.bookTitle,
      cover_url: e.coverUrl || '',
      cover_kind: e.coverKind || 'fallback',
      date: e.date,
      content: e.content || '',
      created_at: e.createdAt || 0
    };
  }

  function rowForComment(c) {
    return {
      entry_id: c.entryId,
      user: c.user,
      content: c.content || '',
      created_at: c.createdAt || 0
    };
  }

  function rowForShelf(user, extra) {
    var d = GD();
    var row = {
      user: user,
      books: d.data.shelves[user] || [],
      cookie: (d.data.wereadCookie && d.data.wereadCookie[user]) || ''
    };
    if (extra) Object.assign(row, extra);
    return row;
  }

  /* ---------------- 按表拉取（云端优先，保留本地孤儿待上传） ---------------- */
  // tables 传入要拉取的表（entries/comments/shelves）；常规同步只用 entries/comments
  function pullTables(tables) {
    var d = GD();
    return Promise.all(tables.map(function (t) { return fetchAll(t); })).then(function (results) {
      var cloudKeys = { entries: new Set(), comments: new Set(), shelves: new Set() };
      var cloudEntries = [], cloudComments = [], cloudShelves = {};

      results.forEach(function (rows, i) {
        var table = tables[i];
        rows.forEach(function (x) {
          if (!x || !x.doc_key) return;
          if (table === 'entries') {
            cloudKeys.entries.add(x.doc_key); cloudEntries.push(stripEntry(x));
          } else if (table === 'comments') {
            cloudKeys.comments.add(x.doc_key); cloudComments.push(stripComment(x));
          } else if (table === 'shelves' && x.user) {
            cloudKeys.shelves.add(x.doc_key); cloudShelves[x.user] = x;
          }
        });
      });

      // 云端 + 本地孤儿（云端还没有的业务 id）合并，避免覆盖本地刚写入但未同步的数据
      var cloudIds = new Set(cloudEntries.map(function (e) { return e.id; }));
      var orphanEntries = (d.data.entries || []).filter(function (e) { return !cloudIds.has(e.id); });
      d.data.entries = cloudEntries.concat(orphanEntries);

      var cloudCIds = new Set(cloudComments.map(function (c) { return c.id; }));
      var orphanComments = (d.data.comments || []).filter(function (c) { return !cloudCIds.has(c.id); });
      d.data.comments = cloudComments.concat(orphanComments);

      // 书架：云端优先，缺用户用本地缓存
      USERS.forEach(function (u) {
        if (cloudShelves[u]) {
          var s = cloudShelves[u];
          d.data.shelves[u] = Array.isArray(s.books) ? s.books : (d.data.shelves[u] || []);
          if (typeof s.cookie === 'string') d.data.wereadCookie[u] = s.cookie;
          if (s.stats) {
            d.data.readStats = d.data.readStats || {};
            d.data.readStats[u] = s.stats;
          }
        }
      });

      state.cloudKeys = cloudKeys;
      d.save();
    });
  }

  // 常规自动同步：仅双方笔记（entries/comments），书架不参与轮询
  function pullNotes() {
    return pullTables(['entries', 'comments']);
  }

  // 全量拉取（含书架），供手动刷新等场景使用
  function pullAll() {
    return pullTables(['entries', 'comments', 'shelves']);
  }

  /* ---------------- upsert：doc_key 存在则更新，否则新增 ---------------- */
  function upsert(coll, docKey, payload) {
    var q = '?select=*&doc_key=eq.' + encodeURIComponent(docKey) + '&limit=1';
    return request('GET', coll, q).then(function (rows) {
      if (rows && rows.length) {
        return request('PATCH', coll, '?doc_key=eq.' + encodeURIComponent(docKey), payload).catch(function (e) {
          console.warn('[cloud] upsert patch failed', coll, e);
          throw e;
        });
      }
      return request('POST', coll, '', Object.assign({ doc_key: docKey }, payload)).catch(function (e) {
        console.warn('[cloud] upsert insert failed', coll, e);
        throw e;
      });
    }).then(function () {
      state.cloudKeys[coll].add(docKey);
    });
  }

  function markPending() {
    state.pendingSync = true;
  }

  /* ---------------- 写入操作（云端不可达时标记待同步） ---------------- */
  function pushEntry(e) {
    if (!state.ready) { markPending(); return Promise.resolve(); }
    return upsert('entries', e.id, rowForEntry(e));
  }

  function updateEntry(id, patch) {
    if (!state.ready) { markPending(); return Promise.resolve(); }
    if (state.cloudKeys.entries.has(id)) {
      // patch 为前端字段（coverUrl/coverKind），转为表字段
      var row = {};
      if (patch.coverUrl !== undefined) row.cover_url = patch.coverUrl;
      if (patch.coverKind !== undefined) row.cover_kind = patch.coverKind;
      if (patch.bookTitle !== undefined) row.book_title = patch.bookTitle;
      if (patch.content !== undefined) row.content = patch.content;
      return request('PATCH', 'entries', '?doc_key=eq.' + encodeURIComponent(id), row).catch(function (e) {
        console.warn('[cloud] updateEntry failed', e);
      });
    }
    var d = GD();
    var e = (d.data.entries || []).find(function (x) { return x.id === id; });
    if (e) return pushEntry(e);
    return Promise.resolve();
  }

  function deleteEntry(id) {
    if (!state.ready) { markPending(); return Promise.resolve(); }
    var chain = request('DELETE', 'entries', '?doc_key=eq.' + encodeURIComponent(id)).catch(function () {});
    state.cloudKeys.entries.delete(id);
    // 级联删除该条目的评论（RLS 权限不足时静默跳过，不影响主流程）
    var d = GD();
    var cmts = (d.data.comments || []).filter(function (c) { return c.entryId === id; });
    cmts.forEach(function (c) {
      chain = chain.then(function () {
        return request('DELETE', 'comments', '?doc_key=eq.' + encodeURIComponent(c.id)).catch(function () {});
      });
      state.cloudKeys.comments.delete(c.id);
    });
    return chain;
  }

  function pushComment(c) {
    if (!state.ready) { markPending(); return Promise.resolve(); }
    return upsert('comments', c.id, rowForComment(c));
  }

  function updateShelf(user, extra) {
    if (!state.ready) { markPending(); return Promise.resolve(); }
    return upsert('shelves', 'shelf_' + user, rowForShelf(user, extra));
  }

  /* ---------------- 本地 → 云端增量上传（首次迁移 / 恢复同步） ---------------- */
  function syncLocalToCloud() {
    if (!state.ready) return Promise.resolve();
    var d = GD();
    var jobs = [];
    (d.data.entries || []).forEach(function (e) {
      if (!state.cloudKeys.entries.has(e.id)) jobs.push(pushEntry(e));
    });
    (d.data.comments || []).forEach(function (c) {
      if (!state.cloudKeys.comments.has(c.id)) jobs.push(pushComment(c));
    });
    // 书架不参与自动同步（靠 data/shelves.json 静态文件 + 手动刷新），仅笔记自动上传
    return Promise.all(jobs).then(function () { state.pendingSync = false; });
  }

  /* ---------------- 轮询（SQL 型数据库无 watch，替代实时监听） ---------------- */
  var failCount = 0; // 连续拉取失败计数（>=3 时降级为未连接）
  // 常规轮询只同步双方笔记（entries/comments），书架不参与轮询
  function pollOnce() {
    if (!state.ready || pulling || state.paused) return;
    pulling = true;
    pullNotes().then(function () {
      failCount = 0;
      refreshAll();
    }).catch(function (e) {
      failCount += 1;
      if (failCount >= 3) {
        state.ready = false;
        updateBanner();
      }
      console.warn('[cloud] poll pull failed', e);
    }).finally(function () {
      pulling = false;
    });
  }

  function startPolling() {
    if (state.paused) return; // 暂停态不启动定时器
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      // 页面隐藏时不轮询（另有 visibility/offline 监听彻底暂停），聚焦/恢复时立即同步
      if (document.visibilityState !== 'hidden') pollOnce();
    }, POLL_INTERVAL);
  }

  /* ---------------- 暂停 / 恢复（节省 SQL 算力） ---------------- */
  function pausePolling() {
    if (state.paused) return;
    state.paused = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // 恢复可见/上线：先立即同步一次，再恢复 5 分钟轮询；从未连上则触发重连
  function resumePolling() {
    if (!state.paused) return;
    state.paused = false;
    if (!state.ready) { retryConnect(); return; }
    pollOnce();
    startPolling();
  }

  function initLifecycleListeners() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pausePolling();
      else resumePolling();
    });
    window.addEventListener('pagehide', pausePolling);
    window.addEventListener('offline', pausePolling);
    window.addEventListener('online', resumePolling);
  }

  /* ---------------- 刷新渲染 ---------------- */
  function refreshAll() {
    var d = GD();
    if (!d) return;
    try {
      d.renderWrite();
      d.renderWall();
      d.renderStats();
      d.renderWeread();
      if (window.renderOverlap) window.renderOverlap();
    } catch (e) {
      console.warn('[cloud] refresh failed', e);
    }
  }

  /* ---------------- 启动 / 重连 / Tab 切换 ---------------- */
  function bootstrap() {
    return init().then(function (ok) {
      if (!ok) return;
      // 首次真实数据请求成功后才标记云可用（banner 才显示已连接）
      return pullNotes().then(function () {
        state.ready = true;
        updateBanner();
        return syncLocalToCloud();
      }).then(function () {
        // 上传后再拉一次，刷新已上传标记
        return pullNotes();
      }).then(function () {
        startPolling();
        refreshAll();
      }).catch(function (e) {
        state.ready = false;
        updateBanner();
        console.warn('[cloud] bootstrap sync failed', e);
      });
    });
  }

  function retryConnect() {
    if (state.connecting || state.ready) return Promise.resolve(false);
    state.connecting = true;
    return init().then(function (ok) {
      if (!ok) return false;
      return pullNotes().then(function () {
        state.ready = true;
        updateBanner();
        return syncLocalToCloud();
      }).then(function () { return pullNotes(); })
        .then(function () { startPolling(); refreshAll(); return true; });
    }).catch(function (e) {
      state.ready = false;
      updateBanner();
      console.warn('[cloud] retry failed', e);
      return false;
    }).finally(function () {
      state.connecting = false;
    });
  }

  function onTabSwitch() {
    if (state.connecting || state.paused) return;
    if (state.ready) {
      pollOnce(); // 聚焦 / 切回页面立即拉取，不等待轮询间隔
    } else {
      retryConnect();
    }
  }

  /* ---------------- 清空云端（尽力而为，RLS 仅允许删除本人创建的行） ---------------- */
  function clearAllCloud() {
    if (!state.ready) return Promise.resolve();
    var tables = ['entries', 'comments', 'shelves'];
    var chain = Promise.resolve();
    tables.forEach(function (table) {
      chain = chain.then(function () {
        return fetchAll(table);
      }).then(function (all) {
        all.forEach(function (row) {
          if (!row || !row.doc_key) return;
          chain = chain.then(function () {
            return request('DELETE', table, '?doc_key=eq.' + encodeURIComponent(row.doc_key)).catch(function () {});
          });
          state.cloudKeys[table].delete(row.doc_key);
        });
      });
    });
    return chain.catch(function () {});
  }

  /* ---------------- 生命周期监听（页面不可见/离线暂停，恢复可见/在线继续） ---------------- */
  initLifecycleListeners();

  /* ---------------- 导出 ---------------- */
  window.CLOUD = {
    CLOUD_ENV: CLOUD_ENV,
    bootstrap: bootstrap,
    retryConnect: retryConnect,
    onTabSwitch: onTabSwitch,
    pullAll: pullAll,
    syncAllLocalToCloud: syncLocalToCloud,
    pushEntry: pushEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    pushComment: pushComment,
    updateShelf: updateShelf,
    clearAllCloud: clearAllCloud,
    isReady: function () { return state.ready; }
  };
})();
