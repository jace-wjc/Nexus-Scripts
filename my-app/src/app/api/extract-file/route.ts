import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';

import { requireFreshScriptHubPermission } from '@/lib/server/scriptHubSession';

// 强制动态路由，阻止 Next.js 在构建时尝试执行此文件收集静态数据
export const dynamic = 'force-dynamic';

const MAX_EXTRACTED_TEXT_LENGTH = 100_000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function trimExtractedText(text: string): string {
    if (text.length <= MAX_EXTRACTED_TEXT_LENGTH) {
        return text;
    }

    return `${text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)}\n\n[附件文本过长，已自动截断]`;
}

export async function POST(request: NextRequest) {
    const auth = await requireFreshScriptHubPermission(request, 'agent-chat');
    if ('response' in auth) {
        return auth.response;
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
            return NextResponse.json({ error: 'Attachment exceeds 20 MB', code: 'ATTACHMENT_TOO_LARGE' }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const fileName = file.name.toLowerCase();
        let text = '';

        if (fileName.endsWith('.pdf')) {
            // 2.x 提供实例 API；成功和解析失败都必须释放 worker/文档资源。
            const { PDFParse } = await import('pdf-parse');
            const parser = new PDFParse({ data: buffer });
            try {
                text = (await parser.getText()).text;
            } finally {
                await parser.destroy();
            }
        } else if (fileName.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
        } else if (fileName.endsWith('.xlsx')) {
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            workbook.SheetNames.forEach((sheetName: string) => {
                const sheet = workbook.Sheets[sheetName];
                text += `${xlsx.utils.sheet_to_csv(sheet)}\n`;
            });
        } else {
            text = buffer.toString('utf-8');
        }

        return NextResponse.json({ text: trimExtractedText(text) });
    } catch (error: unknown) {
        console.error('File extraction failed:', error instanceof Error ? error.name : 'UnknownError');
        return NextResponse.json({ error: 'Extraction failed', code: 'ATTACHMENT_EXTRACTION_FAILED' }, { status: 500 });
    }
}
