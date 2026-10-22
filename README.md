---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: ee08f8ed85974cf172a08fc54fd0f487_06f4bcb5cd7111f1b659525400cd780f
    ReservedCode1: MJxfP+lXSUY4IJMlIZGsbXb+yTEsWnFi5hxtlI6kmAMjz2+1UDarOJFP3Rmu+TI727G12Eneedx2P4onTMKrn6e7scIFZBUtPr9sOskq04osa1iZ2et1YtKiwEuT9GEyYR7eeklaGEz5O+Qmoie7vj6NrzF3QofHChIvYxQjpvmXDRwbk9w9UEuW4s0=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: ee08f8ed85974cf172a08fc54fd0f487_06f4bcb5cd7111f1b659525400cd780f
    ReservedCode2: MJxfP+lXSUY4IJMlIZGsbXb+yTEsWnFi5hxtlI6kmAMjz2+1UDarOJFP3Rmu+TI727G12Eneedx2P4onTMKrn6e7scIFZBUtPr9sOskq04osa1iZ2et1YtKiwEuT9GEyYR7eeklaGEz5O+Qmoie7vj6NrzF3QofHChIvYxQjpvmXDRwbk9w9UEuW4s0=
---

# 共读札记 · 双人读书输出记录

古典风双人读书网页：写作面板 / 读书墙 / 进度统计 / 微信读书书架 / 设置。双人（H / Q）在同一页面各选身份使用，数据经腾讯云 CloudBase 云端互见（SQL 型数据库）。

## 架构

- **前端**：纯静态页面（index.html + styles.css + js/*.js），浏览器打开即可用。
- **数据层**：双写策略
  - `localStorage`（`STORAGE_KEY = gongdu_journal_v1`）：本地缓存 + 离线降级；
  - CloudBase SQL 型数据库（PostgreSQL 模式）表 `entries` / `comments` / `shelves`：云端互见。
- **云端同步**：`js/cloud.js` 使用 CloudBase Web SDK 匿名登录获取 JWT，通过 PostgREST 风格 HTTP API（`/v1/rdb/rest/<table>`）读写三张表，权限由数据库层 GRANT + RLS 行级安全策略控制。
- **实时互见**：SQL 型数据库**不支持** NoSQL 的 `watch` 实时监听，改用**轮询**方案：页面可见时每 15 秒全量拉取一次并刷新渲染；页面切回 / 聚焦时立即拉取。
- **微信读书同步**：前端不再持有 Cookie / 密钥，改为调用云函数 `weread-sync`（通过 `app.callFunction({ name: 'weread-sync' })`），云函数内部持有环境变量 `WEREAD_API_KEY`，调用微信读书 Agent Gateway：`https://i.weread.qq.com/api/agent/gateway`，支持动作 `/shelf/sync`（拉书架）与 `/readdata/detail`（拉阅读统计）。每次请求 body 必须携带 `skill_version = '1.0.5'`，业务参数平铺。

## 目录结构

```
dual-reading-journal/
├── index.html                  # 页面结构（引入 CloudBase SDK + js/cloud.js）
├── styles.css                  # 样式（含云同步横幅、阅读统计样式）
├── js/
│   ├── cloud.js                # CloudBase 云同步层：匿名登录 / SQL 表读写 / 轮询 / 降级
│   ├── app.js                  # 核心逻辑：数据双写、写作面板、读书墙、统计、设置
│   ├── weread.js               # 微信读书：云函数同步书架、重合对比、阅读统计
│   └── export.js               # 导出 DOCX / JSON
└── cloudfunctions/
    └── weread-sync/            # 微信读书同步云函数
        ├── index.js            # 网关调用逻辑（持有 WEREAD_API_KEY）
        └── package.json
```

## 云函数部署步骤（weread-sync）

1. 登录 [CloudBase 控制台](https://console.cloud.tencent.com/tcb)，选择环境：`zhhhhh-d7g3gofzia26c76c3`。
2. 进入「云函数」→「新建云函数」：
   - 名称：`weread-sync`
   - 运行环境：Nodejs（>= 16 即可，本函数无第三方依赖）
   - 上传 `cloudfunctions/weread-sync/` 目录下的 `index.js` 与 `package.json`
3. 配置环境变量：
   - `WEREAD_API_KEY = wrk-25apaPBDTrCY8QAdthf5ygAA`
   - 该密钥仅存于云函数环境变量中，**严禁写入前端代码 / 提交到公开仓库**。
4.（可选）如需 HTTP 触发，在云函数「HTTP 访问服务」中开启；前端默认通过 `callFunction` 调用，无需公网 HTTP。
5. 云函数权限：默认即可（函数通过网关调第三方接口，不访问云数据库）。

## 前端绑定 CloudBase（SQL 型数据库）

- `index.html` 静态加载官方 SDK：`https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js`（失败时 `js/cloud.js` 自动回退 jsdelivr / unpkg）。
- 环境 ID 固定写在 `js/cloud.js`：`CLOUD_ENV = 'zhhhhh-d7g3gofzia26c76c3'`。
- 匿名登录：`auth.anonymousAuthProvider().signIn()`，无需注册；登录后取 JWT 作为 REST 请求的 `Authorization: Bearer <token>`。
- 前端查询写法（PostgREST 风格，`js/cloud.js` 内部封装 `request()`，页面代码无需直接拼接）：

```
GET  https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/entries?select=*&limit=1000&offset=0
GET  https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/entries?doc_key=eq.<id>&limit=1
POST https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/entries        # body 为整行 JSON，Prefer: return=representation
PATCH https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/entries?doc_key=eq.<id>  # body 为待更新字段
DELETE https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/entries?doc_key=eq.<id>
```

- 所有请求必须携带 `Authorization: Bearer <匿名登录 access_token>`；网关解析 JWT 后以 `anon` / `authenticated` 角色执行 SQL，受表级 GRANT 与行级 RLS 双重约束。
- 写操作返回 `Prefer: return=representation` 的变更后行；`delete` / 无结果时可能返回 `204`。

## SQL 表结构

三张表均以 `doc_key` 为业务唯一键（原 NoSQL 集合 docKey 字段映射为 `doc_key` 列），`owner_uid` 由数据库默认值 `auth.uid()` 自动填充（当前 JWT 的 sub），用于 RLS 判定创建者。

```sql
CREATE TABLE IF NOT EXISTS entries (
  id          BIGSERIAL PRIMARY KEY,
  doc_key     TEXT NOT NULL UNIQUE,          -- 输出条目 id（原 docKey）
  user        TEXT NOT NULL,                 -- H / Q
  book_title  TEXT NOT NULL,
  cover_url   TEXT NOT NULL DEFAULT '',
  cover_kind  TEXT NOT NULL DEFAULT 'fallback',
  date        TEXT NOT NULL,                 -- 读书日期
  content     TEXT NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL DEFAULT 0,     -- 毫秒时间戳
  owner_uid   TEXT NOT NULL DEFAULT auth.uid()  -- 创建者，RLS 依据
);

CREATE TABLE IF NOT EXISTS comments (
  id          BIGSERIAL PRIMARY KEY,
  doc_key     TEXT NOT NULL UNIQUE,          -- 评论 id
  entry_id    TEXT NOT NULL,                 -- 所属输出条目 id
  user        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL DEFAULT 0,
  owner_uid   TEXT NOT NULL DEFAULT auth.uid()
);

CREATE TABLE IF NOT EXISTS shelves (
  id          BIGSERIAL PRIMARY KEY,
  doc_key     TEXT NOT NULL UNIQUE,          -- shelf_H / shelf_Q
  user        TEXT NOT NULL,
  books       JSONB NOT NULL DEFAULT '[]',   -- 书架书籍数组
  cookie      TEXT NOT NULL DEFAULT '',
  stats       JSONB,                          -- 阅读统计缓存
  owner_uid   TEXT NOT NULL DEFAULT auth.uid()
);
```

> 说明：JSONB 列（`books` / `stats`）直接以 JSON 存取，PostgREST 返回时自动解析为对象 / 数组，`cloud.js` 无需手动序列化。

## RLS 行级安全策略配置

在 SQL 型数据库控制台或 CLI 中对上述三张表执行以下授权（以 `entries` 为例，`comments` / `shelves` 同理）：

```sql
-- 1. 表级授权：允许前端角色读写表与序列
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entries TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.entries_id_seq TO anon, authenticated;

-- 2. 开启行级安全
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- 3. 行级策略：所有人可读，仅创建者可写（RLS 双人互见的关键）
CREATE POLICY entries_select_all ON public.entries
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY entries_insert_own ON public.entries
  FOR INSERT TO anon, authenticated WITH CHECK (owner_uid = auth.uid());
CREATE POLICY entries_update_own ON public.entries
  FOR UPDATE TO anon, authenticated USING (owner_uid = auth.uid()) WITH CHECK (owner_uid = auth.uid());
CREATE POLICY entries_delete_own ON public.entries
  FOR DELETE TO anon, authenticated USING (owner_uid = auth.uid());
```

配置要点：

- **双层校验**：GRANT 决定角色能否操作表，RLS 决定能访问哪些行，两者缺一不可；只配 GRANT 无 RLS 会读到超预期数据，只配 RLS 无 GRANT 会直接 `permission denied`。
- **身份函数**：策略中必须使用 `auth.uid()`（返回当前 JWT 的 sub，text 类型），**禁止**使用 `current_user` / `current_setting(...)`（返回的是数据库角色名而非用户 id）。
- **前端角色**：匿名登录产生 access_token 后以 `authenticated` 角色访问；未登录 / 仅 Publishable Key 时为 `anon`。策略同时授权两个角色以兼容两种来源。
- **清空云端**：`clearAllCloud` 受 RLS 限制，仅能删除本人创建的行（与 NoSQL 版「仅创建者可读写」语义一致）。

## 实时监听能力结论（重要）

SQL 型数据库（PostgreSQL 模式）**不支持** NoSQL 集合的 `watch` 实时监听 API。`js/cloud.js` 已改用**轮询方案**：

- 页面可见时每 **15 秒**（`POLL_INTERVAL`）全量拉取三张表并刷新渲染；
- 页面 Tab 切换 / 窗口聚焦时立即拉取（`visibilitychange` / `focus` 事件，`onTabSwitch`）；
- 页面隐藏（`visibilityState === 'hidden'`）时暂停轮询，避免后台无效请求；
- 轮询期间防重入（`pulling` 标志），失败自动跳过等待下一轮，不影响本地编辑。

## 本地运行

直接用浏览器打开 `index.html` 即可（静态页面，无构建步骤）。CloudBase SDK 由 CDN 加载，需要网络；断网时页面自动降级为本地模式（底部横幅提示），编辑不丢数据，恢复后自动补传。

## 离线降级

- SDK 加载 / 登录失败：`cloud.js` 优雅降级，显示横幅「云端未连接」，页面仍可本地编辑。
- 写入失败：本地保存后标记 `pendingSync`，恢复连接后增量上传本地孤儿数据（以 docKey 判断），避免覆盖云端他人内容。
- 页面 Tab 切换 / 聚焦：自动重试连接并全量拉取最新数据。
*（内容由AI生成，仅供参考）*
