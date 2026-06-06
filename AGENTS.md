# AGENTS.md — firefly-uptime

个人服务状态页（基于 Uptime Robot v3 API，部署在 Vercel）。单一 Next.js App Router 项目，无数据库，无后端服务。

## 包管理（重要：与全局默认冲突）

仓库使用 **npm**，锁文件是 `package-lock.json`（无 `pnpm-lock.yaml`、无 `.npmrc`）。**不要使用 `pnpm`**，即使全局偏好是 pnpm——混用锁文件会破坏 lockfile 一致性。所有命令用 `npm` / `npx`。

## 常用命令

| 用途 | 命令 |
|---|---|
| 本地开发 | `npm run dev` → `http://localhost:3000` |
| 生产构建 | `npm run build` |
| 启动生产 | `npm run start` |
| Lint | `npm run lint`（`next lint`，见下方"已知陷阱"） |
| Typecheck | **无脚本**。用 `npx tsc --noEmit`（`tsconfig.json` 已设 `noEmit: true`） |
| 测试 | **无测试框架**——`package.json` 无 test 脚本，无 `vitest/jest/playwright` 依赖。**不要尝试运行测试**，也无需新增。 |

### 环境变量

- 仅一个：`UPTIME_ROBOT_JWT`（Uptime Robot v3 JWT Bearer Token）。**必需**，缺失时 `/api/monitors` 返回 500。
- 本地：复制 `.env.example` → `.env.local`（`.env.local` 在 `.gitignore` 中）。
- Vercel：在项目设置中配置同名环境变量。

## 关键路径

- `src/app/page.tsx` — 客户端组件，每 30 秒轮询 `/api/monitors`（`setInterval`）。
- `src/app/api/monitors/route.ts` — 唯一 API 路由；`export const dynamic = "force-dynamic"`；返回前**剥离** `url` 字段以防泄露。
- `src/lib/uptime-robot.ts` — v3 REST API 客户端，所有 UptimeRobot 数据获取逻辑在此。修改前必读。
- `src/lib/deepseek-status.ts` — DeepSeek 状态页 atom feed 解析 + 30 分钟内存缓存 + 状态推断；返回一个**合成** `FormattedMonitor`（`id = -1`，`source = "deepseek-feed"`）。
- `src/lib/types.ts` — v3 字符串状态（`UP/DOWN/LOOKS_DOWN/PAUSED/STARTED`）到内部数字状态（`MONITOR_STATUS`）的映射，以及 UI 层 `FormattedMonitor` 类型（新增 `source?` 字段）。
- `src/components/*.tsx` — 全部带 `"use client"`。
- `src/app/layout.tsx` — 服务端组件，包含 `<html lang="zh-CN" className="dark">`（强制深色模式）。

## 架构要点

### 三级缓存 + 请求去重（`src/lib/uptime-robot.ts`）

- **FRESH**（<30 分钟）：直接返回缓存，零 API 调用。
- **STALE**（30–90 分钟）：返回旧数据 + 后台静默刷新。
- **COLD**：阻塞刷新，但通过 `globalThis.__uptimeInflight` Promise 去重并发请求。
- 响应时间独立缓存 TTL 2 小时。
- 429 重试：指数退避 10s/20s/40s（最多 3 次）；请求间强制 `delay(1000–3000ms)` 限速。

**修改此文件需谨慎**——近期 commit 多次修复 429 / 缓存 / 图表数据 bug（见 `git log`）。任何变更需本地反复验证并检查服务端日志（`[uptime-robot]`、`[DIAG]` 前缀）。

### DeepSeek 状态页合成 monitor（`src/lib/deepseek-status.ts`）

- **数据源**：写死 `https://status.deepseek.com/feed.atom`，**不读取环境变量**。每 30 分钟 `globalThis.__uptimeCache.deepseekFeed` 缓存一次。
- **状态推断（启发式）**：feed 没有"当前状态"字段，靠最新 entry 推断——7 天内无 entry → UP；最新 entry `Status: resolved` → UP；`investigating|identified|monitoring` → DOWN；feed 拉取失败 → `NOT_CHECKED_YET`（**不**显示 DOWN，避免探测自身失败时误报）。
- **Uptime 比率**：把每条 entry 视为 1 小时故障窗，与 `calcUptimeFromIncidents` 算法保持一致。
- **sentinel id = -1**：UptimeRobot id 都是正数，DeepSeek 合成 monitor 用 `-1` 避免冲突。
- **手写 atom 解析**：无 `fast-xml-parser` 依赖。entry 用 `<entry>…</entry>` 切块，`<title>/<id>/<updated>/<content>` 用 regex 提取。**Statuspage 模板稳定 10+ 年**；若 atom 格式改动则需要回归。
- **失败隔离**：`fetchDeepSeekSnapshot()` 顶部包 `.catch(() => null)`，feed 异常不会影响 UptimeRobot 数据流。
- **注意**：DeepSeek 状态页是 Atlassian Statuspage + FlashDuty 包装层（页面 footer 标识 `flashcat.cloud/product/flashduty/`），标准 `/api/v2/*.json` 端点**全部 404**，只能用 atom/rss feed；entry ID 是 `urn:flashduty:change:<long-digits>` URN。

### 路径别名

`@/*` → `./src/*`（同时在 `tsconfig.json` paths 和 Next.js 约定中）。

### 样式（Tailwind v4，非 v3）

- **没有 `tailwind.config.js`**。Tailwind v4 用 CSS-first 配置：自定义色在 `src/app/globals.css` 的 `@theme {}` 块。
- 所有动画是 CSS keyframes（`fade-in` / `slide-up` / `glow-pulse` / `status-pulse` + `stagger-1..8`）。**未使用 framer-motion**——新增动画请用 CSS class。
- 深色主题通过 `<html className="dark">` 强制；颜色变量如 `--color-bg-primary` / `--color-accent` / `--color-up` / `--color-down` / `--color-paused`。

## 已知陷阱

1. **`next lint` 在 Next.js 15.4+ 已移除。** `package.json` 锁的是 `^15.3.1`，但 `^` 范围允许升级到 15.4+，届时 `npm run lint` 会失败。若 `lint` 失败且 lockfile 已升 15.4，临时替代方案：`npx eslint src --ext .ts,.tsx` 或直接 `npx tsc --noEmit` 兜底。
2. **Typecheck 脚本缺失**：CI / pre-commit 若要 typecheck，必须显式用 `npx tsc --noEmit`，不能依赖 `npm run` 触发。
3. **`/api/monitors` 强制 dynamic**：路由设置 `force-dynamic` 禁止 ISR/数据缓存。CDN 缓存由响应头 `Cache-Control: public, s-maxage=30, stale-while-revalidate=60` 控制（不要在路由层加 `revalidate` 配置，会冲突）。
4. **敏感字段过滤**：`api/monitors/route.ts` 返回前会删除 `monitor.url` 与 `incident.monitorUrl`——这是有意为之，不要"修复"它。
5. **响应时间数据可能含 `null` `datetime`**（Uptime Robot v3 偶发）：`src/lib/uptime-robot.ts:399` 用合成时间戳兜底，**不要删除**这段回退逻辑。

## 部署

- 目标平台：Vercel。**无 `vercel.json`**，依赖 Next.js 默认检测。
- 推送 `main` 分支即触发 Vercel 构建。
- 唯一需要的环境变量：`UPTIME_ROBOT_JWT`。

## 代码风格

- 全部源码注释、日志、用户文案为**中文**。新增 UI 文案保持中文，与现有萤火虫暗色主题风格一致。
- 提交风格：使用 emoji 前缀（`🐛 Fix` / `⚡ Optimize` / `🔍 Debug` / `✨ Feature`），参见 `git log`。
- 已有指令文件：`README.md`、`CLAUDE.md`（项目根不含），无需重复其内容。
</content>
</invoke>