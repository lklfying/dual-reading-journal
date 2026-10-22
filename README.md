---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: ee08f8ed85974cf172a08fc54fd0f487_a06ea964ce1711f18de0525400de85a5
    ReservedCode1: T1BBvIOrrXb5m45lCrHTbgMq3Ky1CYCu28C6LO4qRhowZO9oofoTlVtE9DooToWIBLeZ6kKvZwvTGYzgUExs8sh1+ct9G4iN9xq4doaEYI/tIOO0ernf3elRDyN1wtShcDyoqJFfMxGwrWhDiEZVcvLHzJMesnN9tgn8pVP0ObxUqL1pQUumGtW4iJw=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: ee08f8ed85974cf172a08fc54fd0f487_a06ea964ce1711f18de0525400de85a5
    ReservedCode2: T1BBvIOrrXb5m45lCrHTbgMq3Ky1CYCu28C6LO4qRhowZO9oofoTlVtE9DooToWIBLeZ6kKvZwvTGYzgUExs8sh1+ct9G4iN9xq4doaEYI/tIOO0ernf3elRDyN1wtShcDyoqJFfMxGwrWhDiEZVcvLHzJMesnN9tgn8pVP0ObxUqL1pQUumGtW4iJw=
---



# 共读札记 · 双人读书输出记录

古典风双人读书网页：写作面板 / 读书墙 / 进度统计 / 微信读书书架 / 设置。双人（H / Q）在同一页面各选身份使用，数据保存在本浏览器 localStorage（可导出 JSON 备份）。

## 架构

- **前端**：纯静态页面（index.html + styles.css + js/*.js），浏览器打开即可用，无需服务器。
- **数据层**：`localStorage`（`STORAGE_KEY = gongdu_journal_v1`）本地存储，支持 JSON 导出 / 导入备份。
- **微信读书书架**：通过 GitHub Actions 定时调用微信读书网关，将书架与阅读统计写入 `data/shelves.json`（静态文件），页面本地加载该文件进行重合对比，前端不接触任何 Cookie / 密钥。

## 目录结构

```
dual-reading-journal/
├── index.html                  # 页面结构
├── styles.css                  # 样式
├── js/
│   ├── app.js                  # 核心逻辑：数据存储、写作面板、读书墙、统计、设置
│   ├── weread.js               # 微信读书：静态书架加载、重合对比、手动添加、批量导入
│   └── export.js               # 导出 DOCX / JSON
├── data/
│   └── shelves.json            # 自动同步的书架数据（GitHub Actions 生成）
├── scripts/
│   └── sync-weread.js          # 微信读书书架同步脚本（CI 运行）
└── .github/workflows/
    └── sync-weread.yml         # 定时同步书架的工作流（每 6 小时）
```

## 书架数据同步（GitHub Actions）

`scripts/sync-weread.js` 读取环境变量 `WEREAD_API_KEY_H` / `WEREAD_API_KEY_Q`（各自识别身份），调用微信读书网关拉取书架与阅读统计，生成 `data/shelves.json` 并自动提交。由 `.github/workflows/sync-weread.yml` 每 6 小时触发一次（也可在 Actions 页面手动触发）。

密钥仅配置在仓库 Secrets 中，**严禁写入前端代码或提交到公开仓库**。

## 本地运行

直接用浏览器打开 `index.html` 即可（静态页面，无构建步骤）。书架数据从 `./data/shelves.json` 加载，页面未打开时本地功能（写作 / 读书墙 / 统计 / 设置）不受影响。

## 数据备份

- 设置页可导出全部数据（读书输出、评论、书架）为 JSON 文件；
- 可导入 JSON 合并双方数据；
- 清空数据为不可逆操作，建议先导出备份。
*（内容由AI生成，仅供参考）*
*（内容由AI生成，仅供参考）*
