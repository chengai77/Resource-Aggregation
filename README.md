# MC 资源聚合

抓取国内外 Minecraft 地图与数据包资源，统一入库，通过前端可视化查看、编辑并跳转原站。

每条资源都包含：来源链接、封面、内容概述、玩法简介、图集、版本与分类。

## 特性

- 多源适配：新增站点只需实现 `search` 与 `details`，业务层不感知站点差异
- 字段补全：列表页缺概述与封面的站点会逐条进详情页补全
- 跨源去重：精确键（规范化 URL）+ 近似匹配（标题 bigram Dice ≥ 0.86，并查集分组）
- 可视化前端：卡片流、多维筛选、详情抽屉、外链跳转、可编辑可还原
- 导出：CSV / Markdown / JSON
- 采集纪律：同源限速、指数退避重试、遵从 `Retry-After`、遵守 robots.txt

## 环境要求

- Node.js 18 或更高版本
- 可选：Playwright Chromium（仅在使用浏览器抓取模式时需要）

## 快速开始

```bash
npm install
npm start
```

打开 `http://127.0.0.1:5178`，在「采集」面板选择数据源与类型后开始抓取。

安装浏览器抓取所需的 Chromium（国内网络建议走镜像）：

```bash
set PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
npx playwright install chromium
```

## 命令行

```bash
node cli.js collect --source=klpbbs --type=map --pages=1 --limit=20
node cli.js stats
node cli.js export --format=csv --out=out.csv
node cli.js selftest
```

`collect` 支持的参数：`--source`（逗号分隔多个源）、`--type`、`--query`、`--sort`、`--category`、`--version`、`--pages`、`--limit`、`--enrich=false`、`--dedupe=false`。

`selftest` 使用独立数据目录，覆盖抓取、字段、去重、查询、编辑与导出。

## 数据源

| 源 | 类型 | 接入方式 | 凭据 |
| --- | --- | --- | --- |
| Modrinth | 数据包 | 官方 API v2 | 不需要 |
| MinecraftMaps | 地图 | 可见浏览器模式 | 站点有 Cloudflare 防护，必须低频 |
| 苦力怕论坛（klpbbs） | 地图、附加包 | 直连 Discuz，详情页补全 | 不需要，可选 Cookie |
| Planet Minecraft | 地图、数据包 | 可见浏览器模式复用 Cookie | 人工过一次人机验证 |
| CurseForge | 地图、数据包、整合包、资源包 | 官方 API v1 | 需要 API Key |

Planet Minecraft 受 Cloudflare 托管校验保护。注意：HTTP 200 也可能是挑战页，不能仅凭状态码判断成功；程序会识别 `__cf_chl_`、`cf-turnstile`、`/cdn-cgi/challenge-platform/` 等标记。首次使用需在「设置」中开启浏览器抓取模式，然后点击「打开验证窗口」。程序会打开可见浏览器并等待用户手动完成验证；验证完成后再从「采集」面板选择 Planet Minecraft 抓取地图或数据包文章。程序只保存该浏览器上下文的本地状态，不复制、伪造或注入 `cf_clearance`。

MinecraftMaps 同样受 Cloudflare 保护，且防护更严格：请求间隔过密会直接返回 `Error 1006`（IP 级拒绝访问），此时内置 Chromium 与普通浏览器都会一并被拦。程序识别到拦截页后会暂停该源十分钟，仅靠延长间隔通常无法立即恢复，建议把它作为低频补充源使用。

CurseForge 的 Key 需向 Overwolf 提交[申请表单](https://forms.monday.com/forms/dce5ccb7afda9a1c21dab1a1aa1d84eb?r=use1)获取，通过后填入「设置」即自动启用。

## 设置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `browserMode` | `false` | 启用可见浏览器抓取需校验的站点 |
| `browserIntervalMs` | `5000` | 浏览器模式最小请求间隔，过低易触发站点防护 |
| `requestIntervalMs` | `1200` | 同一站点最小请求间隔 |
| `maxItems` | `50000` | 条目上限，超出后淘汰最旧，已编辑与收藏受保护 |
| `curseforgeApiKey` | 空 | CurseForge API Key |
| `klpbbsCookie` | 空 | 苦力怕论坛登录 Cookie，带上后以本人登录态抓取，配额更宽松 |

## REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态与库存量 |
| GET | `/api/sources` | 各源就绪状态 |
| GET | `/api/items` | 列表，支持 `q` `type` `source` `category` `version` `tag` `sort` `page` `limit` `dup` `favorite` `edited` |
| GET | `/api/items/:uid` | 详情，含概述、玩法、图集全文 |
| PATCH | `/api/items/:uid` | 编辑条目 |
| POST | `/api/items/:uid/reset` | 还原为原始抓取数据 |
| POST | `/api/items/:uid/refresh` | 从源站重新拉取 |
| DELETE | `/api/items/:uid` | 删除条目 |
| POST | `/api/collect` | 发起采集（后台执行） |
| GET | `/api/collect/status` | 采集进度 |
| GET | `/api/facets` | 筛选统计 |
| POST | `/api/dedupe` | 手动重跑去重 |
| GET | `/api/export` | 导出，`format=csv\|md\|json` |
| GET/POST | `/api/settings` | 读取或保存设置 |
| POST | `/api/browser/verify/planetminecraft` | 打开可见浏览器，等待用户手动完成 Planet Minecraft 验证 |
| GET | `/api/browser/status` | 查看人工验证窗口状态 |
| GET | `/api/logs` | 运行日志 |

## 目录结构

```
server.js              服务入口
cli.js                 命令行：collect / stats / export / selftest
src/
  config.js            路径、端口与可持久化设置
  collector.js         采集编排：逐源 search → enrich → 入库 → 去重
  sources/             源适配器（base、modrinth、klpbbs、planetminecraft、minecraftmaps、curseforge）
  store/               store 存储与 dedupe 去重
  server/              app 静态与错误出口、routes 路由、query 查询、export 导出
  util/                http 限速重试缓存、robots、browser 浏览器抓取、richtext、log
public/                前端：index.html、css、js（api、ui、state、filters、cards、detail、collect、app）
data/                  运行时数据（items.json、settings.json、browser-state.json）
```

## 设计要点

- **适配器模式**：抽象基类只要求 `search` 与 `details`，`enrich` 与 `taxonomy` 按需实现，接口隔离
- **存储**：内存索引 + 写临时文件后 `rename` 的原子落盘，1500ms 节流；上限淘汰保护用户编辑与收藏
- **去重**：先按规范化 URL 精确匹配，再用倒排索引 + bigram Dice 近似匹配，候选规模受限以控制开销
- **前端**：零构建原生 ES module；列表接口只返回轻量字段，正文与图集走详情接口

## 合规说明

本项目不破解验证码、不做浏览器指纹伪装、不使用代理池规避 WAF。

采集策略为：官方 API 优先 → 直连（限速、遵守 robots.txt、遵从 `Retry-After`）→ 必要时由使用者在可见浏览器中手动完成一次校验并复用 Cookie。

请遵守各站点的服务条款与内容授权，仅将抓取结果用于个人查阅，不要重新分发资源文件本身。

## 已知限制

- Planet Minecraft 首次采集需要人工过一次人机验证，Cookie 失效后需重新验证
- MinecraftMaps 需开启浏览器模式，且站点可能对本机 IP 返回 `Error 1006` 硬拦截，此时该源本轮会被跳过；详情正文的容器选择器尚未在真实页面校准，概述暂取自站点元信息
- 苦力怕论坛的 `/search.php` 被其 robots.txt 明确禁止抓取，因此不提供站内关键词搜索：按板块翻页采集入库后，用本工具前端的本地搜索即可
- CurseForge 未配置 API Key 时该源会被跳过
- 苦力怕论坛部分帖子未上传图片，这类条目的封面为空属正常情况