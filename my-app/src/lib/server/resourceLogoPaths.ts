import path from 'node:path';

export type ResourceLogoKind = 'team-logos' | 'ai-logos';
export const RESOURCE_LOGO_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.gif', '.avif'];

export function getResourceLogoDirectory(kind: ResourceLogoKind): string {
  const runtimeRoot = process.env.RESOURCE_LOGO_ROOT;
  return runtimeRoot ? path.resolve(runtimeRoot, kind) : path.join(process.cwd(), 'public', kind);
}

export function getLegacyLogoDirectory(kind: ResourceLogoKind): string {
  return path.join(process.cwd(), 'public', kind);
}

export function getResourceLogoReadDirectories(kind: ResourceLogoKind): string[] {
  return [...new Set([getResourceLogoDirectory(kind), getLegacyLogoDirectory(kind)])];
}
