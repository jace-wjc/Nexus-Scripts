import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getLegacyLogoDirectory, getResourceLogoDirectory } from '@/lib/server/resourceLogoPaths';

export const dynamic = 'force-dynamic';
const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.avif': 'image/avif',
};

// Logos retain their existing public URL/visibility. Credentials never use this route.
export async function GET(_request: Request, context: { params: Promise<{ kind: string; filename: string }> }) {
  const { kind, filename } = await context.params;
  if ((kind !== 'team-logos' && kind !== 'ai-logos') || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return new Response(null, { status: 404 });
  }
  const contentType = imageTypes[path.extname(filename).toLowerCase()];
  if (!contentType) return new Response(null, { status: 404 });
  try {
    await stat(path.join(getResourceLogoDirectory(kind), `${filename}.deleted`));
    return new Response(null, { status: 404 });
  } catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      return new Response(null, { status: 500 });
    }
  }
  for (const directory of new Set([getResourceLogoDirectory(kind), getLegacyLogoDirectory(kind)])) {
    try {
      const data = await readFile(path.join(directory, filename));
      return new Response(new Uint8Array(data), { headers: {
        'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'no-cache',
      } });
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        console.error('Resource logo read failed');
        return new Response(null, { status: 500 });
      }
    }
  }
  return new Response(null, { status: 404 });
}
