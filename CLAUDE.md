# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # 启动 Next.js 开发服务器（默认 http://localhost:3000）
npm run build    # 生产构建（顺带类型检查）
npm run start    # 跑生产构建产物
npm run lint     # ESLint（next/core-web-vitals 配置）
```

无测试框架。`npm run build` 是当前唯一的"全量验证"手段。

## 必需环境变量

- `UPTIME_ROBOT_JWT`：Uptime Robot v3 JWT Bearer Token，从 Dashboard → Integrations → API → Create JWT 获取。本地放进 `.env.local`。

## 架构概览

技术栈：Next.js 15 App Router + React 19 + TypeScript（strict）+ Tailwind v4（`@theme` 而非 config 文件）。路径别名 `@/*` → `src/*`。

数据通路有两条入口共享同一 fetch 函数：
- **SSR 首屏**：`page.tsx`（async server component, `revalidate = 30`） → `lib/status-page.ts` → `lib/uptime-robot.ts` → Uptime Robot v3
- **客户端轮询（30s）**：`StatusPageClient.tsx` → `/api/monitors` → 同上

理解这条通路上的缓存层是改动这个仓库的关键。冷启动 ≤1s 的硬约束由 SSR + 多层缓存共同保障，单独改动任何一层都可能破坏这个目标。

### 数据层（`src/lib/uptime-robot.ts`）— 核心复杂度集中地

- **只调用 2 个基础端点**：`GET /monitors` 和 `GET /incidents`（90 天窗口）。**uptime 比率本地从 incidents 计算**（`calcUptimeFromIncidents`），不调用 `/stats/uptime`。修改 7d/30d/90d 比率逻辑时改这里。
- **基础数据并行拉取**：`monitors` 和 `incidents` 用 `Promise.all` 同发，冷启动只等最慢的一个。不要再加串行 delay。
- **三级 globalThis 缓存（warm instance 内）**：
  - FRESH（< 30 min）→ 直接返，零 API 调用
  - STALE（30-90 min）→ 返旧数据，后台异步刷新
  - COLD（> 90 min 或冷启动）→ 阻塞拉取，同时通过 `inflightPromise` 去重并发请求
- **Next Data Cache**：v3 fetch 都带 `next: { revalidate }`，跨 serverless 冷启动复用 Vercel 边缘缓存（基础数据 60s，RT 30min）。这是 globalThis 清零后的二级保护。
- **响应时间完全异步**：冷启动**绝不阻塞**等 RT。`hydrateResponseTimesFromCache` 同步从缓存填充已知 monitor，未命中的由 `fillResponseTimesAsync` 后台 fire-and-forget。下一次轮询自然拿到新数据。
- **RT 串行 + 8s 间隔**：FREE plan 限制 10 req/min（滚动窗口）。冷启动峰值 = 2（基础并行）+ 7（60s 内可塞下的 RT 串行）= 9 req/min，留 1 次余量。**间隔不要调小**——会被 429 拉黑且违反 plan 限制。
- **429 重试**走指数退避（10s/20s/40s），别改成更短，会被持续拉黑。
- **状态映射**：v3 返回字符串（`UP`/`DOWN`/`LOOKS_DOWN`/`PAUSED`/`STARTED`），通过 `v3StatusToInternal` 转成内部数值 `MonitorStatus`（0/1/2/8/9）。UI 层只认数值。

### SSR 数据封装（`src/lib/status-page.ts`）

`getStatusPageData()` 是 SSR 和 API 路由共用的入口，负责调用 `fetchMonitors` + 构建 `OverallStatus`/`Incident` + sanitize（`url` 置空字符串以保留 `FormattedMonitor` 类型形状）。新增需要 sanitize 的字段时改这里。

### API 路由（`src/app/api/monitors/route.ts`）

- `force-dynamic`，每次请求都进 `getStatusPageData`（缓存命中时仍是几毫秒）。
- 仅服务客户端 30s 轮询；首屏不走这里，走 SSR。
- 响应头 `Cache-Control: public, s-maxage=30, stale-while-revalidate=60` 走 Vercel CDN。

### UI 层（`src/app/page.tsx` + `StatusPageClient.tsx` + `src/components/`）

- `page.tsx` 是 async server component，SSR 时直接拿到数据并把 `initialData` 传给 client island
- `StatusPageClient.tsx` 接管 30s 轮询、搜索、筛选、详情弹窗等所有交互
- `MonitorDetail` 展示 `ResponseTimeChart`（纯 SVG，无图表库）和 `MiniHistoryBar`

设计 token 全在 `src/app/globals.css` 的 `@theme` 块里（萤火虫暗色主题：琥珀强调色 `--color-accent` + 深紫底 `--color-bg-primary`）。**新增动画务必沿用现有的 `animate-fade-in`/`animate-slide-up` + `stagger-N` 体系**（见全局规则中的切换动画约定）。

## 改动须知

- **不要让冷启动主路径等 RT**：`fillResponseTimes` 之类的同步阻塞早期版本写过，现在已经全部改成 fire-and-forget。冷启动 SSR 主路径只能等基础 2 个并行请求。
- **新增 v3 端点调用**：先确认能否从 `/incidents` 或 `/monitors` 现有数据派生（参考 uptime 比率的本地计算思路）。每多一个端点就多一份限流和缓存负担，并且要重新核算 10 req/min 是否会被打破。
- **改缓存 TTL**：上下文是 Vercel serverless 的 warm instance，冷启动后 globalThis 清零但 Next Data Cache 仍在边缘节点。TTL 是用户体验、API 配额、数据时效性的三方妥协，别凭直觉调。
- **API 响应字段变更**：先改 `src/lib/types.ts` 的 `V3*` 接口，再改 `FormattedMonitor`，最后才是组件。类型驱动重构在这个项目里很有效。