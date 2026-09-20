import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import { requireFreshScriptHubPermission } from '@/lib/server/scriptHubSession';
import { getResourceLogoDirectory } from '@/lib/server/resourceLogoPaths';

const LOGOS_DIR = getResourceLogoDirectory('ai-logos');

function isValidResourceId(id: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(id);
}

// 确保目录存在
function ensureLogosDir() {
    if (!fs.existsSync(LOGOS_DIR)) {
        fs.mkdirSync(LOGOS_DIR, { recursive: true });
    }
}

// POST: 上传icon到本地目录
export async function POST(request: NextRequest) {
    const auth = await requireFreshScriptHubPermission(request, 'ai-resources-manage');
    if ('response' in auth) {
        return auth.response;
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const id = formData.get('id') as string;

        if (!file || !id) {
            return NextResponse.json({ error: 'Missing file or id' }, { status: 400 });
        }

        if (!isValidResourceId(id)) {
            return NextResponse.json({ error: 'Invalid id format' }, { status: 400 });
        }

        ensureLogosDir();

        // 获取文件扩展名
        const originalName = file.name;
        const ext = path.extname(originalName) || '.png';

        // 保存文件
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = path.join(LOGOS_DIR, `${id}${ext}`);

        fs.writeFileSync(filePath, buffer);
        const tombstone = `${filePath}.deleted`;
        if (fs.existsSync(tombstone)) fs.unlinkSync(tombstone);

        return NextResponse.json({
            success: true,
            path: `/ai-logos/${id}${ext}`
        });
    } catch (error) {
        console.error('Error uploading icon:', error);
        return NextResponse.json({
            success: false,
            error: String(error)
        }, { status: 500 });
    }
}
