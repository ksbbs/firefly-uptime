# Firefly Uptime ✨

基于 [Uptime Robot API](https://uptimerobot.com/api/v3/) 的个人服务状态页，部署在 [Vercel](https://vercel.com) 上。

## 功能

- 📊 实时服务状态总览
- ⏱️ 响应时间监控
- 📈 7/30/90 天 uptime 百分比
- 🔍 搜索和筛选监控项
- ⏰ 事件时间线（宕机记录）
- 🌙 深色模式
- 🔄 每 30 秒自动刷新

## 部署

### 1. Fork 或克隆本仓库

### 2. 获取 Uptime Robot API Key

1. 登录 [Uptime Robot](https://uptimerobot.com)
2. 进入 **My Settings** → **API Settings**
3. 创建或复制你的 **Read-only API Key**

### 3. 在 Vercel 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

- 连接你的 Git 仓库
- 添加环境变量：
  - `UPTIME_ROBOT_API_KEY`：你的 Uptime Robot API Key

### 4. 本地开发

```bash
# 安装依赖
npm install

# 复制环境变量
cp .env.example .env.local
# 编辑 .env.local 填入你的 UPTIME_ROBOT_API_KEY

# 启动开发服务器
npm run dev
```

## 技术栈

- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS v4
- **API**: Uptime Robot API v3
- **部署**: Vercel

## 许可证

MIT
