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
│   ├── api/monitors/route.ts    # API 代理路由（v3 JWT）
│   ├── globals.css              # 全局样式 + Tailwind + 动画
│   ├── layout.tsx               # 根布局
│   └── page.tsx                 # 主页面
├── components/
│   ├── IncidentTimeline.tsx     # 事件时间线
│   ├── MiniHistoryBar.tsx       # 迷你历史趋势条
│   ├── MonitorCard.tsx          # 监控卡片（点击查看详情）
│   ├── MonitorDetail.tsx        # 监控详情弹窗
│   ├── ResponseTimeChart.tsx    # 响应时间 SVG 图表
│   ├── SearchFilter.tsx         # 搜索和筛选
│   └── StatusHeader.tsx         # 状态头部汇总
└── lib/
    ├── types.ts                 # 类型定义 + v3 状态映射
    └── uptime-robot.ts          # v3 REST API 客户端
```

## API 版本说明

使用 **Uptime Robot v3 REST API**：

- **Base URL**: `https://api.uptimerobot.com/v3`
- **认证**: `Authorization: Bearer <JWT>`
- **端点**:
  - `GET /monitors` — monitor 列表
  - `GET /monitors/{id}/stats/uptime` — uptime 统计（7d/30d/90d）
  - `GET /monitors/{id}/stats/response-time` — 响应时间数据
  - `GET /incidents` — 宕机事件
- **缓存**: 服务端 ISR 30 秒，CDN 缓存

## 许可证

MIT
