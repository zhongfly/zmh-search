# ZMH 漫画搜索（零后端 / 纯静态）

从 SQLite 离线生成索引文件，部署为纯静态站点：浏览器端支持 **标题 / 别名 / 作者** 关键词搜索 + **标签**、隐藏漫画、章节被隐藏筛选，并将索引缓存在本机（IndexedDB）。

## 功能

- 关键词（最短 2 字符）：包含匹配 + 错字/漏字容错（n-gram 覆盖率）
- 筛选：标签（可多选交集）、隐藏漫画、章节被隐藏（默认：所有）
- 排序：相关性、上架时间从新到旧、上架时间从旧到新
- 结果展示：封面、名称、别名、作者、标签
- 交互：
  - 封面右上角显示漫画 ID，点击复制到剪贴板
  - 点击作者 / 标签可快速搜索对应作者 / 标签的全部漫画
  - 点击封面 / 标题（新标签页打开）：`https://m.zaimanhua.com/pages/comic/detail?id={id}`

## 开发与构建

前置要求：Node.js、Python（项目内使用 `sqlite3` 标准库读取 SQLite）

> 注意：本仓库不包含原始数据文件 `data/zaimanhua.sqlite3`。如需重新生成索引，请自行放置该文件。

1) 安装依赖
```bash
npm install
```

2) 生成索引（会写入 `public/assets/`）
```bash
npm run build:index
```

该命令默认会清理 `public/assets/` 里旧的索引产物（仅 `meta-lite.*` / `ngram.*` / `authors.dict.*` / `tags.*`）。
默认会：
- 将 `meta-lite` 按固定条目数分片（写入 `manifest.json` 的 `assets.metaShards`），用于“高频小增量更新”时避免全量下载。
- 将 `ngram.index` 按 tokenKey 哈希固定分片（写入 `manifest.json` 的 `assets.indexShards`），前端会按需下载并在网络条件允许时后台预热。
- `meta-lite` 使用 v4 格式：将 `cover` 拆为「base + path」，作者改为 `authorId` 列表（作者名放在独立 `authors.dict`），`id` 使用 delta-varint 进一步压缩。

如需关闭/调整分片，可传参：
```bash
npm run build:index -- --meta-shard-docs 0
npm run build:index -- --meta-shard-docs 8192
npm run build:index -- --index-shard-count 0
npm run build:index -- --index-shard-count 16
```
如需保留旧文件，可直接运行：
```bash
python scripts/build_index.py D:/path/to/zaimanhua.sqlite3
```

可手动指定原始数据文件路径（推荐用 `npm run ... --` 传参）：
```bash
npm run build:index -- D:/path/to/zaimanhua.sqlite3
```

3) 本地开发
```bash
npm run dev
```

4) 生产构建（包含索引生成）
```bash
npm run build:all
```

构建产物位于 `dist/`，可直接部署到任意静态托管（Pages/Vercel/Netlify/GitHub Pages 等）。

> 性能：构建完成后会对 `dist/assets/*.bin` 写入 brotli 压缩内容；在 Cloudflare Pages 通过 `_headers` 设置 `Content-Encoding: br`，浏览器会自动解压后交给前端使用。

## 更新数据

替换 SQLite 文件后重新执行：
```bash
npm run build:index -- D:/path/to/zaimanhua.sqlite3
```

如需指定页面右上角显示的数据版本时间（写入 `public/assets/manifest.json` 的 `generatedAt`），可使用：
```bash
python scripts/build_index.py D:/path/to/zaimanhua.sqlite3 --clean --generated-at "2026-01-31T00:00:00Z"
```

## GitHub Actions 自动部署（Cloudflare Pages）

已提供工作流：`.github/workflows/pages-deploy.yml`，它会：
- 从 `zhongfly/zmh-manga-data` 仓库 **tag 为 `data` 的 Release** 下载 `zaimanhua.sqlite3`
- 用下载到的 SQLite 生成索引（写入 `public/assets/`）
- 当数据版本变化时构建 `dist/` 并通过 `cloudflare/wrangler-action` 部署到 Pages

触发方式：
- 定时任务：每天 UTC 04:00 和 16:00 检查数据版本，若未变化则跳过
- 手动触发：`workflow_dispatch`

需要在 GitHub 仓库中配置 Secrets（Settings → Secrets and variables → Actions）：
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT_NAME`
