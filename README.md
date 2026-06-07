# Firefly Uptime ✨

基于 Uptime Robot API v3 的个人服务状态页，部署在 Vercel 上。

## 功能

- 📊 **实时服务状态总览** — 整体运行状态一目了然
- ⏱️ **响应时间监控** — 含当前/平均/最大/最小响应时间
- 📈 **多时段 Uptime** — 7 天 / 30 天 / 90 天 uptime 百分比
- 🗺️ **迷你历史趋势图** — 每服务最近 7 天宕机趋势预览
- 📉 **响应时间图表** — 点击卡片查看详细响应时间柱状图
- 🔍 **搜索和筛选** — 按名称搜索，按状态（全部/正常/异常/暂停）筛选
- ⏰ **事件时间线** — 过去 90 天宕机事件记录
- 🔄 **自动刷新** — 每 30 秒轮询最新状态
- 🌙 **深色模式** — 萤火虫主题暗色设计
- 📱 **响应式布局** — 桌面和移动端均可正常使用

## 技术栈

| 层 | 技术 |
|---|------|
| **框架** | Next.js 15 (App Router) |
| **语言** | TypeScript |
| **样式** | Tailwind CSS v4 |
| **API** | Uptime Robot API v3 |
| **部署** | Vercel |

## 部署

### 快速部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

### 1. Fork 或克隆本仓库

```bash
git clone <your-fork-url>
cd firefly-uptime
```

### 2. 获取 Uptime Robot v3 认证信息

1. 登录 [Uptime Robot Dashboard](https://dashboard.uptimerobot.com/)
2. 进入 **Integrations** → **API** → **Create JWT**
3. 复制 JWT Token

### 3. 配置环境变量

在 Vercel 项目设置中添加环境变量：

| 变量 | 必填 | 说明 |
|------|------|------|
| `UPTIME_ROBOT_JWT` | 是 | v3 JWT Bearer Token |

### 4. 本地开发

```bash
npm install
cp .env.example .env.local
# 编辑 .env.local 填入 UPTIME_ROBOT_JWT

npm run dev
```

## 项目结构

```
src/
├── app/
│   ├── api/monitors/route.ts    # API 代理路由（v3 JWT，30s polling 复用）
│   ├── globals.css              # 全局样式 + Tailwind + 动画
│   ├── layout.tsx               # 根布局
│   ├── page.tsx                 # 主页面（async server component, ISR 30s）
│   └── StatusPageClient.tsx     # 客户端交互层（轮询 / 搜索 / 筛选 / 弹窗）
├── components/
│   ├── IncidentTimeline.tsx     # 事件时间线
│   ├── MiniHistoryBar.tsx       # 迷你历史趋势条
│   ├── MonitorCard.tsx          # 监控卡片（点击查看详情）
│   ├── MonitorDetail.tsx        # 监控详情弹窗
│   ├── ResponseTimeChart.tsx    # 响应时间 SVG 图表
│   ├── SearchFilter.tsx         # 搜索和筛选
│   └── StatusHeader.tsx         # 状态头部汇总
└── lib/
    ├── status-page.ts           # SSR/路由共用的数据封装 + sanitize
    ├── types.ts                 # 类型定义 + v3 状态映射
    └── uptime-robot.ts          # v3 REST API 客户端 + 三级缓存
```

## API 版本说明

使用 **Uptime Robot v3 REST API**：

- **Base URL**: `https://api.uptimerobot.com/v3`
- **认证**: `Authorization: Bearer <JWT>`
- **端点**（只用 2 个）:
  - `GET /monitors` — monitor 列表
  - `GET /incidents` — 宕机事件（uptime 比率从 incidents 本地计算，不再调 stats/uptime）
  - `GET /monitors/{id}/stats/response-time` — 响应时间数据（独立缓存，后台异步拉取）
- **限流**: FREE plan 10 req/min。冷启动峰值 ≤ 9 req/min，留出余量。

## 性能优化

冷启动首屏 ≤ 1s 的关键设计：

- **SSR + ISR**：`page.tsx` 是 server component，HTML 直接带初始数据下发，省一个客户端往返。`revalidate = 30` 配合 Vercel 边缘缓存。
- **基础数据并行**：`/monitors` 和 `/incidents` 用 `Promise.all` 同时拉，省掉之前的 1s 串行间隔。
- **响应时间永不阻塞**：冷启动只用 RT 的 globalThis 缓存即时填充，未命中部分以 8s 间隔在后台串行补拉，不挡首屏。
- **Next Data Cache**：`fetch` 加 `next: { revalidate }`，跨 serverless 冷启动复用边缘缓存，二次冷启动几乎零外部 API 调用。
- **三级缓存**（globalThis warm instance 内）：FRESH < 30 min 直接返；STALE 30–90 min 返旧 + 后台刷新；COLD 阻塞拉取并通过 `inflightPromise` 去重并发。

## 许可证

MIT
