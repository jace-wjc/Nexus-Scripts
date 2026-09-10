# pdf-parse / pdfjs-dist 要求 Node.js 20.16+ 或 22.3+，统一使用 Node.js 22
FROM docker.1panel.live/library/node:22-alpine AS base

# 依赖安装阶段
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app/my-app

# 复制依赖文件
COPY my-app/package.json my-app/package-lock.json ./

# 生产服务器无法稳定访问 registry.npmjs.org，使用可达镜像并缩短失败等待时间。
# replace-registry-host=always 确保 package-lock 中的官方源地址也会替换为镜像源。
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set replace-registry-host always \
    && npm config set fetch-retries 2 \
    && npm config set fetch-retry-mintimeout 5000 \
    && npm config set fetch-retry-maxtimeout 30000 \
    && npm config set fetch-timeout 120000

# 缓存下载包但不缓存 node_modules 本身；构建中断后可复用已下载的完整包。
# 安装结束立即校验 Next.js 可执行文件，避免不完整依赖层进入构建阶段。
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund \
    && test -x node_modules/.bin/next

# 构建阶段
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/my-app/node_modules ./my-app/node_modules
COPY scripts ./scripts
COPY my-app ./my-app

# 禁用 Next.js 遥测
ENV NEXT_TELEMETRY_DISABLED 1
ARG BUILD_VERSION=
ARG APP_VERSION=
ARG BUILD_NUMBER=
ARG GIT_COMMIT=
ENV BUILD_VERSION=${BUILD_VERSION}
ENV APP_VERSION=${APP_VERSION}
ENV BUILD_NUMBER=${BUILD_NUMBER}
ENV GIT_COMMIT=${GIT_COMMIT}

# 执行构建
WORKDIR /app/my-app
RUN npm run build

# 运行阶段
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p /app/runtime-logos/team-logos /app/runtime-logos/ai-logos \
    && chown -R nextjs:nodejs /app/runtime-logos

# 关键：复制 public 目录 (包含 logo)
COPY --from=builder --chown=nextjs:nodejs /app/my-app/public ./public

# 关键：复制 data 目录 (包含 json 数据文件)
COPY --from=builder --chown=nextjs:nodejs /app/my-app/data ./data

# 设置 .next 目录权限
RUN mkdir .next
RUN chown nextjs:nodejs .next

# 复制 Next.js 构建产物 (Standalone 模式)
COPY --from=builder --chown=nextjs:nodejs /app/my-app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/my-app/.next/static ./.next/static

USER nextjs

# 容器内部端口 3000
EXPOSE 3000

ENV PORT 3000

# 启动 Node.js 服务器 (不是 Nginx!)
CMD ["node", "server.js"]
