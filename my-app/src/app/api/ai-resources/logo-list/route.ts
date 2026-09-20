import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import { requireFreshScriptHubPermission } from '@/lib/server/scriptHubSession';
import { getResourceLogoDirectory, getResourceLogoReadDirectories, RESOURCE_LOGO_EXTENSIONS } from '@/lib/server/resourceLogoPaths';

export const dynamic = 'force-dynamic';

const LOGOS_DIR = getResourceLogoDirectory('ai-logos');

// GET: 批量获取所有本地logo文件列表
export async function GET(request: NextRequest) {
    const auth = await requireFreshScriptHubPermission(request, 'ai-resources');
    if ('response' in auth) {
        return auth.response;
    }

    try {
        const logos = new Map<string, string>();
        // Runtime files take precedence; bundled files remain a read-only fallback.
        for (const directory of getResourceLogoReadDirectories('ai-logos')) {
            if (!fs.existsSync(directory)) continue;
            const files = fs.readdirSync(directory).sort((left, right) =>
                RESOURCE_LOGO_EXTENSIONS.indexOf(path.extname(left).toLowerCase()) - RESOURCE_LOGO_EXTENSIONS.indexOf(path.extname(right).toLowerCase()));
            for (const file of files) {
                if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|ico|svg|webp|gif|avif)$/i.test(file)) continue;
                if (fs.existsSync(path.join(LOGOS_DIR, `${file}.deleted`))) continue;
                if (!fs.statSync(path.join(directory, file)).isFile()) continue;
                const id = path.basename(file, path.extname(file));
                if (!logos.has(id)) logos.set(id, `/ai-logos/${file}`);
            }
        }

        return NextResponse.json({ logos: Object.fromEntries(logos) });
    } catch (error) {
        console.error('Error listing logos:', error);
        return NextResponse.json({ logos: {} });
    }
}
