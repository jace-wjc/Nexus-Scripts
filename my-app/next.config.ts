import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type BuildInfo = {
  version: string;
  buildId: string;
  buildNumber: string;
  commitSha: string;
  builtAt: string;
};

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function loadBuildInfo(): BuildInfo {
  const packageJson = readJson(join(process.cwd(), "package.json"));
  const packageVersion = readString(packageJson.version, "0.1.0");

  if (process.env.NODE_ENV !== "production") {
    return {
      version: packageVersion,
      buildId: "dev",
      buildNumber: "dev",
      commitSha: "",
      builtAt: "",
    };
  }

  try {
    const payload = readJson(join(process.cwd(), "public", "build-info.json"));
    return {
      version: readString(payload.version, packageVersion),
      buildId: readString(payload.buildId, "build-unknown"),
      buildNumber: readString(payload.buildNumber, "unknown"),
      commitSha: readString(payload.commitSha),
      builtAt: readString(payload.builtAt),
    };
  } catch {
    return {
      version: packageVersion,
      buildId: "build-unknown",
      buildNumber: "unknown",
      commitSha: "",
      builtAt: "",
    };
  }
}

const buildInfo = loadBuildInfo();

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  output: "standalone",
  compress: true, // 明确启用 Gzip 压缩
  env: {
    NEXT_PUBLIC_APP_VERSION: buildInfo.version,
    NEXT_PUBLIC_BUILD_ID: buildInfo.buildId,
    NEXT_PUBLIC_BUILD_NUMBER: buildInfo.buildNumber,
    NEXT_PUBLIC_BUILD_COMMIT: buildInfo.commitSha,
    NEXT_PUBLIC_BUILD_TIME: buildInfo.builtAt,
  },
  generateBuildId: async () => buildInfo.buildId,
  // Runtime uploads are served dynamically, including files created after startup.
  rewrites: async () => ({
    beforeFiles: [
      { source: '/team-logos/:filename', destination: '/api/resource-logos/team-logos/:filename' },
      { source: '/ai-logos/:filename', destination: '/api/resource-logos/ai-logos/:filename' },
    ],
    afterFiles: [],
    fallback: [],
  }),

  // 性能优化：优化包导入
  serverExternalPackages: ['pdf-parse'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', 'framer-motion'],
  },

  // Webpack 优化
  webpack: (config, { dev }) => {
    // 解决 pdf-parse / canvas 在服务端打包时的 DOMMatrix 缺失报错
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    
    if (!dev) {
      // 使用确定性模块 ID（更好的缓存）
      config.optimization.moduleIds = 'deterministic';
    }
    return config;
  },
};

// Bundle analyzer - 仅在 ANALYZE=true 时启用
// 使用方式: set ANALYZE=true && npm run build (Windows)
// 或: ANALYZE=true npm run build (Mac/Linux)
let exportedConfig = nextConfig;

if (process.env.ANALYZE === 'true') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const withBundleAnalyzer = require('@next/bundle-analyzer')({ enabled: true });
  exportedConfig = withBundleAnalyzer(nextConfig);
}

export default exportedConfig;
