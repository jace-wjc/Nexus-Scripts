import path from 'node:path';

export type ResourceLogoKind = 'team-logos' | 'ai-logos';

export function getResourceLogoDirectory(kind: ResourceLogoKind): string {
  const runtimeRoot = process.env.RESOURCE_LOGO_ROOT;
  return runtimeRoot ? path.resolve(runtimeRoot, kind) : path.join(process.cwd(), 'public', kind);
}

export function getLegacyLogoDirectory(kind: ResourceLogoKind): string {
  return path.join(process.cwd(), 'public', kind);
}
