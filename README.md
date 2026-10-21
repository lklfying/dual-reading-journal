---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: ee08f8ed85974cf172a08fc54fd0f487_e4af8872cd3e11f1b76f525400638852
    ReservedCode1: CdrpH10qPl/0pIwOl4+3N0QSKfnL8rOVeb2WUecx4E3illKg/+eRQG+fNyFFfMAsnrhqfY+jYSJDBEHeDAWPkYcarAGWppSZwDh8gHylUh2ssPABFjTgpbeKGgMUTQHQurAtPGMy0vE0uuvp7fYl6zCJtHSIIsLR9B8eXujDZOqLuc5QbD3qmwMVEBg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: ee08f8ed85974cf172a08fc54fd0f487_e4af8872cd3e11f1b76f525400638852
    ReservedCode2: CdrpH10qPl/0pIwOl4+3N0QSKfnL8rOVeb2WUecx4E3illKg/+eRQG+fNyFFfMAsnrhqfY+jYSJDBEHeDAWPkYcarAGWppSZwDh8gHylUh2ssPABFjTgpbeKGgMUTQHQurAtPGMy0vE0uuvp7fYl6zCJtHSIIsLR9B8eXujDZOqLuc5QbD3qmwMVEBg=
---

# 共读札记 · 双人读书输出记录网页

一个纯前端、可在 GitHub Pages 免费部署的双人读书笔记共享平台。供两个固定用户（「我」与「同伴」）记录读书输出、互相留言回复、打卡统计、导出 DOCX，并联动微信读书书架对比重合书籍。

## ✨ 功能总览

| 模块 | 说明 |
|---|---|
| 双人共享 | 本地身份选择（我 / 同伴），两人在读书墙互相可见、互相评论回复 |
| 写作面板 | 输入书名自动加载封面（Google Books / Open Library 公开接口，失败自动使用本地兜底封面）；选择读书年月日；输入多行读书输出 |
| 目标打卡 | 每日至少 3 条、每周至少 3 天：本周 7 天卡片 + 双进度条 + 日历月视图（达标/有写/未写标记） |
| 读书笔记导出 DOCX | 选择用户 + 时间范围，浏览器端用 docx.js 生成并下载 .docx |
| 微信读书联动 | 粘贴微信读书 Cookie 拉取书架；支持手动添加与批量导入；两人书架自动计算重合书名、重合数量、重合率，并以韦恩图 + 列表展示 |
| 数据存储 | localStorage 本地存储；JSON 导出 / 导入，实现两人数据同步 |
| 设计风格 | 古典风格：米色纸张底纹、墨色文字、朱砂红点缀、印章与边框装饰、楷体/宋体/衬线字体 |

## 📁 项目结构

```
dual-reading-journal/
├── index.html      # 页面结构与所有视图
├── styles.css      # 古典风格样式
├── js/
│   ├── app.js      # 核心逻辑：数据层 / 登录 / 写作面板 / 读书墙 / 统计 / 设置
│   ├── weread.js   # 微信读书书架联动与重合对比
│   └── export.js   # DOCX 导出（docx.js）
└── README.md       # 本文档
```

## 🚀 部署到 GitHub Pages

### 方式一：新建仓库部署（推荐）

1. 注册并登录 [GitHub](https://github.com)，点击右上角 **+ → New repository**。
2. 仓库名随意（如 `dual-reading-journal`），选择 **Public**（免费托管必须公开），不要勾选 "Add a README"。
3. 点击 **Create repository** 后，页面会显示上传指引。将本项目的 4 个文件/文件夹（`index.html`、`styles.css`、`js/`、`README.md`）上传：
   - 方式 A（网页上传）：点击页面的 **Add file → Upload files**，把上述文件拖拽进去，Commit。
   - 方式 B（命令行）：在项目文件夹内执行
     ```bash
     git init
     git add .
     git commit -m "init"
     git branch -M main
     git remote add origin https://github.com/<你的用户名>/dual-reading-journal.git
     git push -u origin main
     ```
4. 打开仓库 **Settings → Pages**：
   - Source 选择 **Deploy from a branch**；
   - Branch 选择 **main**、目录 `/ (root)`；
   - 点击 **Save**。
5. 等待 1~2 分钟，页面顶部会显示站点地址，形如：
   `https://<你的用户名>.github.io/dual-reading-journal/`
   两人用这个地址即可访问。

### 方式二：Fork / 已有仓库

- 已有仓库时，把本项目文件提交到 `main` 分支根目录，再按上述第 4 步开启 Pages 即可。
- 注意：仓库必须为 **Public**（免费版 GitHub Pages 不支持私有仓库）。

### 更新页面

修改文件后 `git add . && git commit -m "update" && git push`，Pages 会自动重新构建，约 1 分钟生效。

## 🔄 两人数据同步说明

本页面数据默认只保存在**各自浏览器**的 localStorage 中，两人之间通过 JSON 文件同步：

1. 「我」写作、回复、导入书架后，进入 **设置 → 导出数据备份**，得到一个 JSON 文件。
2. 把 JSON 文件发送给「同伴」（微信 / QQ / 邮件均可）。
3. 「同伴」在自己的浏览器打开页面 → **设置 → 导入数据备份**，选择该 JSON 文件。
4. 导入采用**按 ID 去重合并**策略：双方各自的输出、评论、书架会自动合并，不会重复；自己已有的数据不会被覆盖。
5. 反向同理：同伴导出后发回给我导入，即可互相看到对方的输出、回复与书架。
6. 建议：**每次写作或回复后**导出一次；或者约定每天结束时互相同步一次。

> 提示：如果两人共用同一台电脑/浏览器，直接切换身份即可，无需同步文件。

## 📱 微信读书 Cookie 获取说明与安全提示

微信读书官方没有公开 API，本项目调用的是 `weread.qq.com` 网页版接口，需要你自己在浏览器中获取登录 Cookie。

### 获取步骤

1. 在电脑浏览器打开并登录 [weread.qq.com](https://weread.qq.com)。
2. 按 **F12** 打开开发者工具。
3. 切换到 **Console（控制台）** 标签页。
4. 输入以下命令并回车：
   ```js
   document.cookie
   ```
5. 复制输出的整串文本（形如 `wr_vid=xxxx; wr_skey=xxxx; ...`），粘贴到页面「微信读书」面板的 Cookie 输入框中。
6. 点击 **拉取我的书架**。

### 安全提示

- ⚠️ **Cookie 相当于你的登录凭证**，切勿发给任何人。
- 本项目为**纯前端**实现：Cookie 只写入你浏览器本地 localStorage，**不会发送到任何服务器**（代码中没有后端请求，GitHub Pages 也仅托管静态文件）。
- 微信读书网页接口可能随时变更。若拉取失败，页面会提示并**优雅降级**——请改用「手动添加书籍」或「批量导入」（支持 JSON 数组或每行 `书名|作者` 的纯文本）。
- 书架数据保存在本地；两人各自维护自己的书架，通过 JSON 导入导出合并。
- 建议定期在微信读书网页端重新登录以刷新 Cookie；Cookie 失效时重新获取即可。

## 📚 封面加载说明

- 写作面板输入书名后，页面会依次尝试 **Google Books**、**Open Library** 公开接口获取封面。
- 接口不可用或查无封面时，自动使用**本地 SVG 兜底封面**（深底描金、书名首字印章样式），不影响正常写作。
- 书架手动添加时同样支持封面 URL；微信读书拉取的书籍自带封面。

## 🔒 数据与隐私

- 全部数据存于浏览器 localStorage，关闭浏览器不丢失，清除浏览器数据会丢失，请定期导出备份。
- 清空数据需两次确认；删除单条读书输出在读书墙点击「删除」并确认。
- 本项目无后端、无数据库、无第三方统计脚本，数据不出本地。

## 🛠 技术栈

- 原生 HTML + CSS + JavaScript（无框架、无构建步骤）
- 封面接口：Google Books API、Open Library API
- 微信读书：`weread.qq.com/web/shelf/sync`（需 Cookie）
- DOCX 导出：docx.js（CDN：unpkg / jsdelivr，失败自动切换）
- 字体：Noto Serif SC、Ma Shan Zheng（Google Fonts，国内不可用时回退楷体/宋体）

## 📝 常见问题

**Q：Google Fonts 加载慢 / 打不开？**
A：不影响功能。CSS 已配置回退：楷体（KaiTi）、宋体（SimSun）、衬线字体。

**Q：导出的 DOCX 打不开？**
A：请确认浏览器可访问 unpkg / jsdelivr 的 CDN（国内网络偶发失败会尝试第二个 CDN）。若均失败，可把 `js/export.js` 中 `DOCX_CDNS` 改为本地 `/vendor/docx.js` 并自行下载该库文件放于项目目录。

**Q：微信读书拉取不到书架？**
A：优先检查 Cookie 是否完整（需以 `wr_` 开头的关键字段）且已登录 weread.qq.com。接口变更时请手动添加书籍。

**Q：两人数据合并不对吗？**
A：导入合并按条目标识 ID 去重。请确认双方都使用同一份代码部署，且导出的是最新数据。

---

祝你们共读愉快，以书会友。
*（内容由AI生成，仅供参考）*
