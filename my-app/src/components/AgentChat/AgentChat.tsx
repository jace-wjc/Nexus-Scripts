'use client';
/* eslint-disable @next/next/no-img-element */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Plus, Send, Loader2, Bot, MessageSquare, Trash2, X, FileText, Sparkles, ArrowLeft, Paperclip, BookOpen, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useI18n } from '@/lib/i18n';
import { authenticatedFetch } from '@/lib/auth';
import { toast } from '@/lib/toast';

// ============== Types ==============
interface FileItem {
    name: string;
    url?: string;
    isImage: boolean;
    mimeType?: string;
    fileUri?: string;
}

interface ChatMessage {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: string;
    images?: string[]; // Legacy
    files?: FileItem[];
    timestamp: number;
    isStreaming?: boolean;
}

interface Conversation {
    id: string;
    title: string;
    assistantId?: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
    score?: string;
    conclusion?: 'pass' | 'conditional' | 'fail';
}

interface Assistant {
    id: string;
    name: string;
    description: string;
    icon: string;
    iconBg: string;
    systemPrompt: string;
    isBuiltIn?: boolean;
}

interface Attachment {
    id: string;
    file: File;
    preview?: string;
    isImage: boolean;
    mimeType: string;
    textContent?: string;
    status: 'ready' | 'processing' | 'error';
    error?: string;
}

type ModelOption = {
    id: string;
    name: string;
    supportsDocuments?: boolean;
};

type UploadedFileRef = Pick<FileItem, 'name' | 'mimeType' | 'fileUri'>;

type ResumeConclusion = 'pass' | 'conditional' | 'fail';

type ResumeReviewMeta = {
    candidateName: string;
    score: string;
    conclusion: ResumeConclusion;
    summary: string;
};

type ResumeLibraryItem = ResumeReviewMeta & {
    id: string;
    conversationId: string;
    assistantMessageId: string;
    reviewedAt: number;
    sourceLabel: string;
};

type DeduplicatedResumeItem = ResumeLibraryItem & {
    reviewCount: number;
};

// ============== Constants ==============
const STORAGE_KEY_CONVERSATIONS = 'agent_chat_conversations';
const STORAGE_KEY_ASSISTANTS = 'agent_chat_custom_assistants';

const AVAILABLE_MODELS: ModelOption[] = [
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', supportsDocuments: true },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', supportsDocuments: true },
];
const FALLBACK_DOCUMENT_MODEL = 'gemini-2.5-flash-lite';
const LEGACY_DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_INLINE_TEXT_CHARS = 100_000;
const MAX_PERSISTED_FILE_URL_LENGTH = 160_000;
const SUPPORTED_FILE_INPUT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.json,.csv,.docx,.xlsx';

const RESUME_SCREENING_PROMPT = `【身份设定】
你现在是我的招聘助手，全程协助我完成软硬件测试工程师的招聘工作。你的工作分为三个模块，我会按顺序触发，请严格按照以下规则执行，不得自行更改任何规则，除非我明确告知你规则有变动。

【岗位JD · 已固定，无需重复发送】
岗位名称：软硬件测试工程师
一、岗位职责

负责智能家居IoT相关产品的全流程测试工作，包括智能家电（空调、冰箱、洗衣机等）、智能门锁、智能灯具、网关等设备及配套APP/小程序的功能、性能、兼容性、稳定性测试。
参与产品需求分析与评审，梳理测试要点，制定详细的测试计划、测试方案，设计高质量的测试用例（含手动用例、自动化脚本）。
搭建并维护IoT测试环境，包括各类网络环境（星闪、Wi-Fi、蓝牙、ZigBee、Thread等更多协议，不限于这些）、跨品牌设备联动环境，保障测试工作顺利开展。
执行测试用例，精准定位并记录产品缺陷，跟踪缺陷生命周期，推动研发团队及时修复，验证修复效果，确保产品质量达标。
负责测试过程中的文档输出，包括测试报告、缺陷报告、测试用例文档等，确保文档的完整性、准确性和可追溯性。
关注行业内IoT和AIoT测试技术动态，引入先进的测试方法和工具，优化测试流程，提升测试效率和质量。
配合研发、产品团队解决产品测试过程中出现的技术问题，参与产品迭代优化讨论，提供测试层面的专业建议。

二、任职要求

本科及以上学历，计算机相关专业（电子信息工程、自动化、软件工程等），2-3年智能家居/IoT领域测试经验。
熟悉IoT相关通信协议，如星闪、Wi-Fi（802.11 a/b/g/n/ac）、蓝牙（BLE）、ZigBee、Thread、MQTT等，了解各类协议以及星闪（NearLink）相关技术的测试要点。
熟悉智能家居产品生态，了解主流智能设备（如米家、华为鸿蒙、苹果HomeKit等）的互联互通逻辑和测试标准。
掌握软件测试基础理论和方法，具备独立设计测试用例、执行测试、性能测试、功能测试等分析并定位缺陷的能力。
熟悉至少一种自动化测试工具或框架，如Appium、Espresso、UIAutomator（APP测试），或Python+Selenium/Requests（接口测试），有IoT设备自动化测试经验者优先。
具备良好的沟通协调能力、逻辑分析能力和问题解决能力，工作严谨细致，有责任心和团队合作精神。

三、加分项

有智能家居行业头部企业（如小米、华为、美的、海尔等）测试经验者。
熟悉Linux系统，具备Shell脚本编写能力，能独立搭建和维护复杂测试环境。
了解IoT设备的功耗测试、射频测试方法者。
具备测试平台开发经验，或熟悉CI/CD流程，能将测试流程融入研发流水线者。
持有ISTQB、SLB等测试相关认证者。
了解并使用AI工具（如豆包、GPT、Gemini、Claude等），能将AI正确融入测试工作（如上传需求让AI写测试用例、写自动化脚本等）。

四、补充说明（岗位背景）

我们软件测试方向目前已有人员，本次招聘侧重硬件测试方向。
初筛权重侧重：硬件测试经验 > IoT通信协议 > 嵌入式/固件相关经验 > 智能家居生态 > 软件/自动化测试（可适当放宽）。
JD中虽未明确写"嵌入式"，但岗位实际工作高度依赖嵌入式背景知识（IoT设备本质是嵌入式系统，OTA/固件/协议测试均需嵌入式基础），初筛时需关注候选人是否有嵌入式相关经验。
软件测试能力可适当放宽，不作为一票否决项。


【模块一：简历初筛】
触发方式
我发给你一份或多份候选人简历，你自动进入初筛模式。
执行规则
1. 打分维度与权重（硬件侧优先）
维度权重说明硬件测试经验25%核心优先项，有实际硬件仪器操作、硬件问题定位经验IoT通信协议20%Wi-Fi/BLE/ZigBee/Thread/MQTT/星闪等协议测试经验嵌入式/固件经验15%固件测试、OTA、串口调试、嵌入式系统测试等智能家居生态15%米家/鸿蒙/HomeKit等互联互通测试经验软件测试基础10%用例设计、缺陷定位、功能/性能测试，可适当放宽自动化测试5%Appium/Python等，软件侧放宽，非一票否决项学历/专业匹配5%本科+，计算机/电子/自动化/软件工程等相关专业文档输出能力3%测试报告/缺陷报告/用例文档加分项2%头部企业/Linux/Shell/功耗射频/CI-CD/认证/AI工具
2. 每个维度必须：

有简历原文依据才能打分，不得推测或虚构
明确指出该维度的得分和打分依据（引用简历具体内容）
未提及的维度如实标注"简历未提及"，不瞎编

3. 综合得分 = 各维度加权得分之和（满分10分）
4. 年龄计算规则：

简历中有出生日期（如1999-2）但没有写年龄的，自动计算截止今天的实际年龄

5. 初筛结论三档：

✅ 通过：建议安排首面
⚠️ 条件性通过：建议安排首面，但需在面试中重点验证某项短板
❌ 不通过：说明核心缺口，建议本次不安排面试

6. 初筛报告仅输出与简历和岗位相关的信息，不附加无原文依据的扩展内容

【模块二：面试题生成】
触发方式
初筛完成后，我说"给我XX的面试题"，即触发本模块。
重要规则

无论候选人初筛是否通过，只要我要求出题，直接出题，不得拒绝
若候选人初筛未通过，在面试题顶部的Header区域明确标注「初筛未达标·强制面试」，并注明需要重点考察的方向
若候选人初筛通过，正常出题即可

面试题结构要求
每道题必须包含以下四个部分：

面试题正题：针对候选人简历和JD定制，不得虚构内容，所有涉及的技术点必须真实
参考答案要点：列出关键评判点，区分不同情况（如候选人声称用过 vs 坦承未用过）
通过/注意/一票否决判定：明确告诉面试官什么样的回答算通过、什么算注意、什么直接一票否决终止面试
追问环节：候选人答出后使用，深挖细节，数量适度（1-2条），体现面试官专业性
答不出时·面试官解释：候选人答不出时，面试官参考此内容进行解释，并说明为什么要问这道题（兼顾非本行业面试官）

题目数量与时长

总面试时长控制在40分钟左右
题目按模块分组，每个模块标注建议时长
模块分配参考（可根据候选人背景调整）：

本次面试主要是招聘软硬件测试工程师，如下如果有遗漏的关键点，你可以做额外的补充，但不宜过多，主要结合jd来定
硬件能力模块（重点）：约13分钟
嵌入式/固件测试模块：约8分钟（至少1题，考察OTA/串口调试/固件烧录经验，能否从硬件原理层理解问题）
IoT通信协议模块：约10分钟
智能家居生态模块：约5分钟（至少1题，考察米家/鸿蒙/HomeKit或其他生态的真实测试经历；若候选人简历有相关经历则必问，若完全没有则压缩至2分钟简单确认）
软件测试基础模块：约5分钟（不可为0，至少1题）
AI工具使用模块：约2分钟（1题，考察是否用过AI工具及如何融入工作）
综合/转型意愿模块：约5分钟


面试题HTML格式要求
整体布局：左右两栏

左栏：面试题主体内容（题目/参考答案/判定/追问/解释）
右栏（固定宽度约300px）：专业词释义区，页面滚动时右栏固定

视觉规范：

整体风格偏iOS 26设计语言：大圆角卡片（border-radius 16-24px）、毛玻璃/半透明背景效果（backdrop-filter: blur）、柔和光晕与渐变、层次感阴影（box-shadow多层叠加）、细腻的边框描边（1px半透明白边）、流畅的过渡动画。字体清晰，间距宽松，整体质感精致轻盈，避免生硬的纯色块。
深色主题（深蓝/深灰背景）
页面整体布局需两侧留白，主体内容区域居中显示，不得铺满全屏宽度。左右两侧保留可见空白区域，在大屏显示器上保持良好阅读体验。具体实现：最外层容器设置 max-width（建议1400px以内）并 margin: 0 auto，或左右设置不少于40-60px的内边距。
不同区块用不同颜色左边框区分：

蓝色 = 面试题正题
绿色 = 追问环节
紫色 = 答不出时·面试官解释
黄色边框（右栏）= 专业词释义


每道题顶部显示：题号 / 分类 / 建议时长
通过/注意/一票否决判定区规范：
.block-verdict 容器使用 display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px 12px，不得设置 overflow: hidden 或 border-radius: 0，否则会裁掉子元素圆角
每个色块统一设置 border-radius: 14px !important，呈现独立圆角卡片感，色块之间有间距
颜色体系按语义区分，所有关键颜色加 !important 防止被父级玻璃背景覆盖：
✅ 通过 → 绿色背景 #064e3b，文字 #d1fae5
✅ 加分 → 蓝紫背景 #1e1b4b，文字 #e0e7ff
⚠ 注意 → 琥珀黄背景 #451a03，文字 #fef3c7
⚠ 无加分 → 中性灰背景 #1c1917，文字 #d6d3d1
✕ 风险高/极高 → 深红背景 #7f1d1d，文字 #fee2e2
✕ 建议淘汰 → 深紫背景 #3b0764，文字 #ede9fe
加分/无加分/建议淘汰/风险高等语义不同时，通过CSS子类（如 .vpass.bonus / .vwarn.neutral / .vfail.soft / .vfail.danger）实现，不复用同一颜色
追问区 .block-followup 使用可见深绿背景 #065f46，.fi-item 圆角 16px，期望答案 .fi-expect 字色 #ecfdf5 !important，加实色左边框 3px solid #34d399，圆角 10px，确保在深色背景下清晰可读
卡片折叠功能：每张题目卡片支持折叠/展开，仅点击 .qcard-top 标题栏区域触发，点击内容区其他位置不响应。折叠时三角箭头 .toggle-arrow 旋转 -90deg，展开/折叠使用 max-height 过渡动画（transition: max-height 0.35s ease, opacity 0.25s ease）。标题栏内若有可点击的专业词 .term，需加 event.stopPropagation() 防止触发折叠。

顶部Header必须包含：

候选人姓名、工作年限、学历专业
候选人背景标签（如「硬件测试·核心强项」「IoT协议·重点考察」）
初筛状态标注（通过 or 未达标·强制面试）
面试官注意事项（初筛未通过时写明重点考察方向和风险点）

顶部时长进度条：

显示总时长和各模块时长分布

题目模块分组：

每个模块有独立的分组标题，标注模块性质（核心强项/死穴验证区/加分项等）和建议时长

专业词释义规则（重要）
覆盖范围：

面试题正题、参考答案要点、追问环节、面试官解释中出现的所有专业词均需有释义

释义标准：

必须来源于行业标准/官方规范/权威定义（如IEEE、IEC、ISO、OASIS、各厂商官方文档等）
严禁自造定义，每条释义注明参考来源
每个专业词注明所属领域（硬件测试/IoT通信协议/嵌入式系统/软件测试等）
同一个词在不同语境下含义不同时，分别列出

点击定位功能（必须实现）：

题目中所有专业词设置为可点击样式（黄色下划线）
点击后右侧释义区自动滚动并高亮定位到对应释义条目
高亮效果持续约3秒后自动消失
使用JavaScript实现，每个释义条目设置唯一id，点击时调用scrollIntoView
【全程铁律 · 任何情况下不得违反】

严禁虚构：所有内容必须有简历原文或JD原文作为依据，不得推测、编造任何信息
严禁瞎编专业词释义：所有释义必须来源于行业标准或权威文档，来源必须注明
规则变更原则：我告知规则变动时，只改动我指定的点，其他所有规则保持不变
JD已固定：本Prompt中的JD无需重复发送，除非我明确说JD有变动
强制出题：无论初筛结论如何，只要我要求出面试题，必须出题，初筛未通过的在Header标注即可
软件测试不为零：面试题中软件测试模块至少1题，不能因为侧重硬件就完全不出软件题
AI工具必出：每份面试题必须包含1道AI工具使用的考察题，考察是否使用过AI及如何融入测试工作


【使用流程示例】
第一步：发简历 → 触发模块一（初筛报告）
第二步：说"给我XX的面试题" → 触发模块二（生成HTML面试题）

【执行优先级】
1. 如果当前消息包含简历附件、简历正文或候选人信息，直接视为触发模块一，并输出完整的简历初筛报告。
2. 除非我明确要求你“确认规则”“总结规则”或“复述规则”，否则不要复述本提示词，不要输出“我已阅读并理解所有规则”“我已准备就绪，请发送简历”“请上传简历”等等待性回复。
3. 如果我要求“给我XX的面试题”，触发模块二。
`;

const BUILT_IN_ASSISTANTS: Assistant[] = [
    {
        id: 'resume-screening',
        name: '简历筛选助手',
        description: '软硬件测试工程师招聘助手，支持简历初筛和面试题生成。',
        icon: '📄',
        iconBg: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        systemPrompt: RESUME_SCREENING_PROMPT,
        isBuiltIn: true,
    },
];

// ============== Helper Functions ==============
function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

function findConversationById(conversationList: Conversation[], conversationId: string | null): Conversation | null {
    if (!conversationId) {
        return null;
    }

    return conversationList.find((conversation) => conversation.id === conversationId) || null;
}

function getModelOption(modelId: string): ModelOption {
    return AVAILABLE_MODELS.find((model) => model.id === modelId) || AVAILABLE_MODELS[0];
}

function inferAttachmentMimeType(file: File): string {
    if (file.type) {
        return file.type;
    }

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.pdf')) return 'application/pdf';
    if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lowerName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lowerName.endsWith('.md')) return 'text/markdown';
    if (lowerName.endsWith('.json')) return 'application/json';
    if (lowerName.endsWith('.csv')) return 'text/csv';
    if (lowerName.endsWith('.txt')) return 'text/plain';
    if (/\.(png|jpe?g|webp|gif)$/i.test(lowerName)) return 'image/*';
    return 'application/octet-stream';
}

function looksLikeMarkdownTableRow(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('|')) {
        return false;
    }

    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    return cells.length > 1 && cells.some(Boolean);
}

function isMarkdownTableSeparator(line: string): boolean {
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line.trim());
}

function splitMarkdownTableRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function isBoldLabelLineWithValue(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        return false;
    }

    return /^\*\*[^*]+\*\*\s+\S/.test(trimmed);
}

function formatMarkdownTable(headers: string[], rows: string[][]): string {
    return rows
        .map((cells) => {
            const entries = headers
                .map((header, index) => {
                    const title = header.trim();
                    const value = cells[index]?.trim();
                    if (!title || !value) {
                        return null;
                    }

                    return `**${title}：** ${value}`;
                })
                .filter((entry): entry is string => !!entry);

            if (entries.length === 0) {
                return '';
            }

            const [first, ...rest] = entries;
            return `- ${first}${rest.map((entry) => `  \n  ${entry}`).join('')}`;
        })
        .filter(Boolean)
        .join('\n\n');
}

function formatAssistantMessage(content: string): string {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const formatted: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const nextLine = lines[index + 1] ?? '';

        if (looksLikeMarkdownTableRow(line) && isMarkdownTableSeparator(nextLine)) {
            const headers = splitMarkdownTableRow(line);
            const rows: string[][] = [];
            index += 2;

            while (index < lines.length && looksLikeMarkdownTableRow(lines[index])) {
                rows.push(splitMarkdownTableRow(lines[index]));
                index += 1;
            }

            index -= 1;
            const tableMarkdown = formatMarkdownTable(headers, rows);
            formatted.push(tableMarkdown || line);
            continue;
        }

        if (isBoldLabelLineWithValue(line) && isBoldLabelLineWithValue(nextLine)) {
            formatted.push(`${line}  `);
            continue;
        }

        formatted.push(line);
    }

    return formatted
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function normalizeMarkdownTextForParsing(content: string): string {
    return content
        .replace(/\r\n/g, '\n')
        .replace(/^\s{0,3}#{1,6}\s*/gm, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*[-*_]{3,}\s*$/gm, '')
        .trim();
}

function cleanParsedText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function extractLineValue(lines: string[], label: string): string | null {
    const target = lines.find((line) => line.startsWith(`${label}：`) || line.startsWith(`${label}:`));
    if (!target) {
        return null;
    }

    return cleanParsedText(target.split(/[：:]/).slice(1).join(':'));
}

function extractResumeConclusion(content: string): ResumeConclusion | null {
    const normalized = normalizeMarkdownTextForParsing(content);
    const focusText = normalized.match(/初筛结论[\s\S]{0,120}/)?.[0] || normalized;

    if (focusText.includes('条件性通过') || /⚠️?|注意/.test(focusText)) {
        return 'conditional';
    }

    if (focusText.includes('不通过') || focusText.includes('未通过') || /❌|✕|✖/.test(focusText)) {
        return 'fail';
    }

    if (focusText.includes('通过') || /✅/.test(focusText)) {
        return 'pass';
    }

    return null;
}

function extractResumeSummary(lines: string[]): string {
    const collected: string[] = [];
    const coreGapIndex = lines.findIndex((line) => {
        return line === '核心缺口'
            || line === '核心缺口：'
            || line === '核心缺口:';
    });

    if (coreGapIndex !== -1) {
        for (let index = coreGapIndex + 1; index < lines.length && collected.length < 3; index += 1) {
            const candidate = cleanParsedText(lines[index].replace(/^\d+[.、]\s*/, ''));
            if (!candidate) {
                continue;
            }

            if (/^(建议|年龄计算|初筛结论|简历初筛报告|初筛评分)$/.test(candidate)) {
                if (collected.length > 0) {
                    break;
                }
                continue;
            }

            if (/^(候选人|工作年限|学历专业)[：:]/.test(candidate)) {
                continue;
            }

            collected.push(candidate);
        }
    }

    if (collected.length === 0) {
        const advice = lines.find((line) => /^(建议)[：:]/.test(line));
        if (advice) {
            collected.push(cleanParsedText(advice));
        }
    }

    if (collected.length === 0) {
        const fallbackLines = lines.filter((line) => {
            return !/^(候选人|工作年限|学历专业)[：:]/.test(line)
                && !['简历初筛报告', '初筛评分', '年龄计算', '初筛结论'].includes(line);
        });
        collected.push(...fallbackLines.slice(0, 2).map(cleanParsedText));
    }

    return collected.filter(Boolean).join(' ');
}

function extractResumeReviewMeta(content: string): ResumeReviewMeta | null {
    const normalized = normalizeMarkdownTextForParsing(content);
    if (!normalized || !normalized.includes('简历初筛')) {
        return null;
    }

    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const nameMatch = normalized.match(/(?:候选人姓名|候选人名字|候选人|姓名)[\s]*[：:]\s*([^\n]+)/);
    const parsedName = nameMatch ? nameMatch[1].replace(/[（(].*?[）)]/g, '').trim() : '';
    const candidateName = parsedName || extractLineValue(lines, '候选人姓名') || extractLineValue(lines, '候选人') || extractLineValue(lines, '姓名') || '未识别姓名';
    const scoreMatch = normalized.match(/综合得分[：:]\s*([^\n（(]+)/)
        || normalized.match(/总计[^\n|]*(\d+(?:\.\d+)?\/10|\d+\/100)/);
    const score = cleanParsedText(scoreMatch?.[1] || '');
    const conclusion = extractResumeConclusion(normalized);

    if (!score || !conclusion) {
        return null;
    }

    return {
        candidateName,
        score,
        conclusion,
        summary: extractResumeSummary(lines) || '已生成简历初筛报告。',
    };
}

function getResumeSourceLabel(message: ChatMessage | null, fallbackName: string): string {
    const sourceFile = message?.files?.find((file) => !file.isImage)?.name;
    if (sourceFile) {
        return sourceFile;
    }

    const attachMatch = message?.content.match(/\[附件\s+([^\]]+)\]/);
    if (attachMatch?.[1]) {
        return attachMatch[1];
    }

    return fallbackName;
}

function collectResumeLibrary(conversations: Conversation[]): ResumeLibraryItem[] {
    const items: ResumeLibraryItem[] = [];

    conversations.forEach((conversation) => {
        if (conversation.assistantId !== 'resume-screening') {
            return;
        }

        let lastUserMessage: ChatMessage | null = null;
        conversation.messages.forEach((message) => {
            if (message.role === 'user') {
                lastUserMessage = message;
                return;
            }

            if (message.role !== 'assistant') {
                return;
            }

            const review = extractResumeReviewMeta(message.content);
            if (!review) {
                return;
            }

            items.push({
                id: `${conversation.id}:${message.id}`,
                conversationId: conversation.id,
                assistantMessageId: message.id,
                reviewedAt: message.timestamp,
                sourceLabel: getResumeSourceLabel(lastUserMessage, review.candidateName),
                ...review,
            });
        });
    });

    return items.sort((left, right) => right.reviewedAt - left.reviewedAt);
}

function deduplicateResumeLibrary(items: ResumeLibraryItem[]): DeduplicatedResumeItem[] {
    const grouped = new Map<string, ResumeLibraryItem[]>();

    items.forEach((item) => {
        const key = item.candidateName.trim();
        const existing = grouped.get(key);
        if (existing) {
            existing.push(item);
        } else {
            grouped.set(key, [item]);
        }
    });

    const deduped: DeduplicatedResumeItem[] = [];
    grouped.forEach((group) => {
        group.sort((a, b) => b.reviewedAt - a.reviewedAt);
        const latest = group[0];
        deduped.push({
            ...latest,
            reviewCount: group.length,
        });
    });

    return deduped.sort((a, b) => b.reviewedAt - a.reviewedAt);
}

function syncResumeConversationMetadata(conversation: Conversation): Conversation {
    if (conversation.assistantId !== 'resume-screening') {
        return conversation;
    }

    const latestReview = collectResumeLibrary([conversation])[0];
    if (!latestReview) {
        return conversation;
    }

    return {
        ...conversation,
        score: latestReview.score,
        conclusion: latestReview.conclusion,
    };
}
function isImageAttachment(fileLike: { name: string; mimeType?: string }): boolean {
    return !!fileLike.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(fileLike.name.toLowerCase());
}

function isPdfAttachment(fileLike: { name: string; mimeType?: string }): boolean {
    return fileLike.mimeType === 'application/pdf' || fileLike.name.toLowerCase().endsWith('.pdf');
}

function isTextAttachment(fileLike: { name: string; mimeType?: string }): boolean {
    if (fileLike.mimeType?.startsWith('text/')) {
        return true;
    }

    const lowerName = fileLike.name.toLowerCase();
    return lowerName.endsWith('.md')
        || lowerName.endsWith('.json')
        || lowerName.endsWith('.csv')
        || lowerName.endsWith('.txt');
}

function requiresTextExtraction(fileLike: { name: string; mimeType?: string }): boolean {
    const lowerName = fileLike.name.toLowerCase();
    return lowerName.endsWith('.docx') || lowerName.endsWith('.xlsx');
}

function isSupportedAttachment(fileLike: { name: string; mimeType?: string }): boolean {
    return isImageAttachment(fileLike)
        || isPdfAttachment(fileLike)
        || isTextAttachment(fileLike)
        || requiresTextExtraction(fileLike);
}

function trimAttachmentText(text: string): string {
    if (text.length <= MAX_INLINE_TEXT_CHARS) {
        return text;
    }

    return `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n[附件文本过长，已截断]`;
}

function getDraftAttachmentStatus(attachment: Attachment): string {
    if (attachment.status === 'processing') {
        return '解析中...';
    }

    if (attachment.status === 'error') {
        return attachment.error || '处理失败';
    }

    if (attachment.isImage) {
        return attachment.preview ? '图片已就绪' : '图片待发送';
    }

    if (requiresTextExtraction({ name: attachment.file.name, mimeType: attachment.mimeType })) {
        return attachment.textContent ? '文档已解析' : '等待解析';
    }

    if (isPdfAttachment({ name: attachment.file.name, mimeType: attachment.mimeType })) {
        return 'PDF 将直接上传';
    }

    if (attachment.textContent) {
        return '文本已就绪';
    }

    return '附件已就绪';
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || '');
        reader.onerror = () => reject(reader.error || new Error('Failed to read file as data URL'));
        reader.readAsDataURL(file);
    });
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || '');
        reader.onerror = () => reject(reader.error || new Error('Failed to read file as text'));
        reader.readAsText(file);
    });
}

async function extractDocumentText(file: File, messages: { attachmentTooLarge: string; attachmentExtractionFailed: string }): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await authenticatedFetch('/api/extract-file', {
        method: 'POST',
        body: formData,
    });

    const data = await response.json().catch(() => null) as { text?: string; code?: string } | null;
    if (!response.ok) {
        throw new Error(data?.code === 'ATTACHMENT_TOO_LARGE'
            ? messages.attachmentTooLarge : `${messages.attachmentExtractionFailed} (${response.status})`);
    }

    return trimAttachmentText(data?.text || '');
}

function applyUploadedFileRefs(files: FileItem[] | undefined, uploadedFiles: UploadedFileRef[]): FileItem[] | undefined {
    if (!files || uploadedFiles.length === 0) {
        return files;
    }

    const remaining = [...uploadedFiles];
    return files.map((file) => {
        if (file.isImage || file.fileUri) {
            return file;
        }

        const matchIndex = remaining.findIndex((item) => item.name === file.name && item.mimeType === file.mimeType);
        if (matchIndex === -1) {
            return file;
        }

        const [match] = remaining.splice(matchIndex, 1);
        return {
            ...file,
            mimeType: match.mimeType || file.mimeType,
            fileUri: match.fileUri,
        };
    });
}

function decodeUploadedFilesHeader(headerValue: string | null): UploadedFileRef[] {
    if (!headerValue) {
        return [];
    }

    try {
        const parsed = JSON.parse(decodeURIComponent(headerValue)) as UploadedFileRef[];
        return Array.isArray(parsed)
            ? parsed.filter((item) => !!item?.name && !!item?.mimeType && !!item?.fileUri)
            : [];
    } catch {
        return [];
    }
}

function upsertConversation(conversations: Conversation[], conversation: Conversation): Conversation[] {
    return [conversation, ...conversations.filter((item) => item.id !== conversation.id)];
}

function sanitizeConversationsForStorage(conversations: Conversation[]): Conversation[] {
    return conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => ({
            ...message,
            files: message.files?.map((file) => ({
                ...file,
                url: file.url && file.url.length <= MAX_PERSISTED_FILE_URL_LENGTH && (!file.fileUri || file.isImage)
                    ? file.url
                    : undefined,
            })),
        })),
    }));
}

function loadConversations(): Conversation[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveConversations(conversations: Conversation[]) {
    try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(sanitizeConversationsForStorage(conversations)));
    } catch (error) {
        console.error('Failed to save conversations to localStorage', error);
        if (error instanceof Error && error.name === 'QuotaExceededError') {
            toast.error('本地存储已满，附件预览可能不会被保存。');
            try {
                const stripped = conversations.map((conversation) => ({
                    ...conversation,
                    messages: conversation.messages.map((message) => ({
                        ...message,
                        files: message.files?.map((file) => ({
                            name: file.name,
                            isImage: file.isImage,
                            mimeType: file.mimeType,
                            fileUri: file.fileUri,
                        })),
                    })),
                }));
                localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(stripped));
            } catch {
                // Ignore fallback save error.
            }
        }
    }
}

function loadCustomAssistants(): Assistant[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_ASSISTANTS);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveCustomAssistants(assistants: Assistant[]) {
    localStorage.setItem(STORAGE_KEY_ASSISTANTS, JSON.stringify(assistants));
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return '昨天';
    } else if (diffDays < 7) {
        return `${diffDays}天前`;
    } else {
        return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
}

// ============== Component ==============
interface AgentChatProps {
    onBack: () => void;
}

const AgentChat: React.FC<AgentChatProps> = ({ onBack }) => {
    const { t } = useI18n();

    // State
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [customAssistants, setCustomAssistants] = useState<Assistant[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
    const [showResumeSidebar, setShowResumeSidebar] = useState(true);

    // Assistant form state
    const [newAssistantName, setNewAssistantName] = useState('');
    const [newAssistantDesc, setNewAssistantDesc] = useState('');
    const [newAssistantPrompt, setNewAssistantPrompt] = useState('');
    const [newAssistantIcon, setNewAssistantIcon] = useState('🤖');

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const conversationsRef = useRef<Conversation[]>([]);
    const activeConversationIdRef = useRef<string | null>(null);
    const pendingAssistantIdRef = useRef<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const stopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);
    }, []);

    // Initialize from localStorage
    useEffect(() => {
        const loadedConversations = loadConversations().map(syncResumeConversationMetadata);
        conversationsRef.current = loadedConversations;
        activeConversationIdRef.current = null;
        pendingAssistantIdRef.current = null;
        setConversations(loadedConversations);
        setCustomAssistants(loadCustomAssistants());
    }, []);

    useEffect(() => {
        setSelectedModel((currentModel) => {
            if (!AVAILABLE_MODELS.some((model) => model.id === currentModel)) {
                return AVAILABLE_MODELS[0].id;
            }

            return currentModel === LEGACY_DEFAULT_MODEL ? FALLBACK_DOCUMENT_MODEL : currentModel;
        });
    }, []);

    useEffect(() => {
        conversationsRef.current = conversations;
    }, [conversations]);

    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [conversations, activeConversationId]);

    // All assistants
    const allAssistants = useMemo(
        () => [...BUILT_IN_ASSISTANTS, ...customAssistants],
        [customAssistants]
    );

    // Active conversation
    const activeConversation = conversations.find(c => c.id === activeConversationId) || null;
    const activeAssistant = activeConversation?.assistantId
        ? allAssistants.find(a => a.id === activeConversation.assistantId)
        : null;

    useEffect(() => {
        pendingAssistantIdRef.current = activeConversation?.assistantId || null;
    }, [activeConversation]);
    const isResumeScreeningView = activeAssistant?.id === 'resume-screening';
    const resumeLibraryItems = collectResumeLibrary(conversations);
    const dedupedResumeItems = useMemo(() => deduplicateResumeLibrary(resumeLibraryItems), [resumeLibraryItems]);
    const resumeLibraryStats = {
        total: dedupedResumeItems.length,
        pass: dedupedResumeItems.filter((item) => item.conclusion === 'pass').length,
        conditional: dedupedResumeItems.filter((item) => item.conclusion === 'conditional').length,
        fail: dedupedResumeItems.filter((item) => item.conclusion === 'fail').length,
    };

    // Visible messages (exclude system)
    const visibleMessages = activeConversation?.messages.filter(m => m.role !== 'system') || [];
    const hasPendingRequiredAttachments = attachments.some((attachment) => {
        return attachment.status === 'processing'
            && requiresTextExtraction({ name: attachment.file.name, mimeType: attachment.mimeType });
    });
    const hasErroredAttachments = attachments.some((attachment) => attachment.status === 'error');
    const hasBlockingAttachments = hasPendingRequiredAttachments || hasErroredAttachments;

    // Create new conversation
    const createConversation = useCallback((assistantId?: string) => {
        const assistant = assistantId ? allAssistants.find((item) => item.id === assistantId) : null;
        const newConv: Conversation = {
            id: generateId(),
            title: assistant ? assistant.name : t.agentChat?.newConversation || '新对话',
            assistantId,
            messages: assistant ? [{
                id: generateId(),
                role: 'system',
                content: assistant.systemPrompt,
                timestamp: Date.now(),
            }] : [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        const updated = [newConv, ...conversations];
        conversationsRef.current = updated;
        activeConversationIdRef.current = newConv.id;
        pendingAssistantIdRef.current = assistantId || null;
        setConversations(updated);
        saveConversations(updated);
        setActiveConversationId(newConv.id);
        setInput('');
        setAttachments([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversations, allAssistants]);

    // Delete conversation
    const deleteConversation = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const updated = conversations.filter(c => c.id !== id);
        conversationsRef.current = updated;
        setConversations(updated);
        saveConversations(updated);
        if (activeConversationId === id) {
            activeConversationIdRef.current = null;
            pendingAssistantIdRef.current = null;
            setActiveConversationId(null);
        }
    }, [conversations, activeConversationId]);

    // Add custom assistant
    const addCustomAssistant = useCallback(() => {
        if (!newAssistantName.trim() || !newAssistantPrompt.trim()) {
            toast.error(t.agentChat?.nameAndPromptRequired || '请输入名称和系统提示词');
            return;
        }

        const colors = [
            'linear-gradient(135deg, #f59e0b, #d97706)',
            'linear-gradient(135deg, #ec4899, #db2777)',
            'linear-gradient(135deg, #3b82f6, #2563eb)',
            'linear-gradient(135deg, #10b981, #059669)',
            'linear-gradient(135deg, #8b5cf6, #7c3aed)',
            'linear-gradient(135deg, #ef4444, #dc2626)',
        ];

        const newAssistant: Assistant = {
            id: generateId(),
            name: newAssistantName.trim(),
            description: newAssistantDesc.trim() || newAssistantName.trim(),
            icon: newAssistantIcon || '🤖',
            iconBg: colors[Math.floor(Math.random() * colors.length)],
            systemPrompt: newAssistantPrompt.trim(),
        };

        const updated = [...customAssistants, newAssistant];
        setCustomAssistants(updated);
        saveCustomAssistants(updated);

        setShowAddModal(false);
        setNewAssistantName('');
        setNewAssistantDesc('');
        setNewAssistantPrompt('');
        setNewAssistantIcon('🤖');
        toast.success(t.agentChat?.assistantAdded || '助手已添加');
    }, [customAssistants, newAssistantName, newAssistantDesc, newAssistantPrompt, newAssistantIcon, t.agentChat]);

    // Delete custom assistant
    const deleteAssistant = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const updated = customAssistants.filter(a => a.id !== id);
        setCustomAssistants(updated);
        saveCustomAssistants(updated);
        toast.success(t.agentChat?.assistantDeleted || '助手已删除');
    }, [customAssistants, t.agentChat]);

    const handlePreviewFile = (url?: string) => {
        if (!url) {
            toast.error('当前附件暂无可预览内容');
            return;
        }

        window.open(url, '_blank', 'noopener,noreferrer');
    };

    // File attachment handlers
    const processFiles = (files: File[]) => {
        files.forEach((file) => {
            const mimeType = inferAttachmentMimeType(file);
            const fileLike = { name: file.name, mimeType };
            const isImage = isImageAttachment(fileLike);
            const isSupported = isSupportedAttachment(fileLike);
            const attachmentId = generateId();

            const nextAttachment: Attachment = {
                id: attachmentId,
                file,
                preview: undefined,
                isImage,
                mimeType,
                textContent: undefined,
                status: !isSupported
                    ? 'error'
                    : requiresTextExtraction(fileLike)
                        ? 'processing'
                        : 'ready',
                error: !isSupported ? '暂不支持的附件类型' : undefined,
            };

            setAttachments((prev) => [...prev, nextAttachment]);

            if (!isSupported) {
                toast.error(`暂不支持该附件类型: ${file.name}`);
                return;
            }

            if (isImage) {
                readFileAsDataUrl(file)
                    .then((preview) => {
                        setAttachments((prev) => prev.map((attachment) => {
                            return attachment.id === attachmentId ? { ...attachment, preview } : attachment;
                        }));
                    })
                    .catch((error) => {
                        console.error('Failed to preview image attachment', error);
                    });
                return;
            }

            if (isTextAttachment(fileLike)) {
                readFileAsText(file)
                    .then((textContent) => {
                        setAttachments((prev) => prev.map((attachment) => {
                            return attachment.id === attachmentId
                                ? { ...attachment, textContent: trimAttachmentText(textContent) }
                                : attachment;
                        }));
                    })
                    .catch((error) => {
                        console.error('Failed to read text attachment', error);
                    });
                return;
            }

            if (requiresTextExtraction(fileLike)) {
                extractDocumentText(file, t.agentChat)
                    .then((textContent) => {
                        if (!textContent) {
                            throw new Error('未提取到可用文本');
                        }

                        setAttachments((prev) => prev.map((attachment) => {
                            return attachment.id === attachmentId
                                ? { ...attachment, status: 'ready', textContent, error: undefined }
                                : attachment;
                        }));
                    })
                    .catch((error) => {
                        console.error('Failed to extract document text', error);
                        setAttachments((prev) => prev.map((attachment) => {
                            return attachment.id === attachmentId
                                ? {
                                    ...attachment,
                                    status: 'error',
                                    error: error instanceof Error ? error.message : '文档解析失败',
                                }
                                : attachment;
                        }));
                    });
            }
        });
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        processFiles(files);
        e.target.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            e.preventDefault();
            processFiles(Array.from(e.clipboardData.files));
        }
    };

    const removeAttachment = (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    };

    // Send message
    const sendMessage = useCallback(async () => {
        if ((!input.trim() && attachments.length === 0) || isLoading) {
            return;
        }

        if (hasBlockingAttachments) {
            if (hasPendingRequiredAttachments) {
                toast.error('Word / Excel \u9644\u4ef6\u8fd8\u5728\u89e3\u6790\uff0c\u8bf7\u7a0d\u540e\u518d\u53d1\u9001\u3002');
            } else {
                toast.error('\u5b58\u5728\u65e0\u6cd5\u5904\u7406\u7684\u9644\u4ef6\uff0c\u8bf7\u79fb\u9664\u540e\u518d\u53d1\u9001\u3002');
            }
            return;
        }

        const hydratedAttachments = await Promise.all(attachments.map(async (attachment) => {
            const fileLike = { name: attachment.file.name, mimeType: attachment.mimeType };
            let nextAttachment = attachment;

            if (attachment.isImage && !attachment.preview) {
                try {
                    nextAttachment = { ...nextAttachment, preview: await readFileAsDataUrl(attachment.file) };
                } catch (error) {
                    console.error('Failed to hydrate image preview before send', error);
                }
            }

            if (isTextAttachment(fileLike) && !attachment.textContent) {
                try {
                    nextAttachment = { ...nextAttachment, textContent: trimAttachmentText(await readFileAsText(attachment.file)) };
                } catch (error) {
                    console.error('Failed to hydrate text attachment before send', error);
                }
            }

            return nextAttachment;
        }));

        const missingDocumentText = hydratedAttachments.some((attachment) => {
            return requiresTextExtraction({ name: attachment.file.name, mimeType: attachment.mimeType }) && !attachment.textContent;
        });
        if (missingDocumentText) {
            toast.error('Word / Excel \u9644\u4ef6\u672a\u80fd\u89e3\u6790\u51fa\u6587\u672c\uff0c\u8bf7\u91cd\u65b0\u4e0a\u4f20\u6216\u79fb\u9664\u540e\u518d\u53d1\u9001\u3002');
            return;
        }

        const currentConversations = conversationsRef.current.length > 0 ? conversationsRef.current : conversations;
        let conv = findConversationById(currentConversations, activeConversationIdRef.current) || activeConversation;
        const assistantIdForSend = conv?.assistantId || pendingAssistantIdRef.current || activeAssistant?.id || null;
        const assistantForSend = assistantIdForSend
            ? allAssistants.find((assistant) => assistant.id === assistantIdForSend) || null
            : null;

        let finalInput = input.trim();
        const attachmentLabel = hydratedAttachments.map((attachment) => `\u300a${attachment.file.name}\u300b`).join('\u3001');
        const shouldForceResumeAnalysis = assistantIdForSend === 'resume-screening' && hydratedAttachments.length > 0;

        if (!finalInput && hydratedAttachments.length > 0) {
            finalInput = shouldForceResumeAnalysis
                ? `\u8bf7\u76f4\u63a5\u57fa\u4e8e\u672c\u6761\u6d88\u606f\u4e2d\u7684\u7b80\u5386\u9644\u4ef6\u6267\u884c\u6a21\u5757\u4e00\u3010\u7b80\u5386\u521d\u7b5b\u3011\uff0c\u8f93\u51fa\u5b8c\u6574\u62a5\u544a\u3002`
                : `\u8bf7\u9605\u8bfb\u6211\u521a\u4e0a\u4f20\u7684\u9644\u4ef6 ${attachmentLabel}\uff0c\u5e76\u6839\u636e\u5f53\u524d\u4e0a\u4e0b\u6587\u7ee7\u7eed\u5904\u7406\u3002`;
        } else if (shouldForceResumeAnalysis) {
            finalInput = `\u8bf7\u76f4\u63a5\u7ed3\u5408\u672c\u6761\u6d88\u606f\u4e2d\u7684\u7b80\u5386\u9644\u4ef6\u6267\u884c\u6a21\u5757\u4e00\u3010\u7b80\u5386\u521d\u7b5b\u3011\u3002\n\n${finalInput}`;
        }

        hydratedAttachments.forEach((attachment) => {
            const fileLike = { name: attachment.file.name, mimeType: attachment.mimeType };
            if (!attachment.isImage && attachment.textContent && (isTextAttachment(fileLike) || requiresTextExtraction(fileLike))) {
                finalInput += `\n\n[\u9644\u4ef6 ${attachment.file.name}]\n${trimAttachmentText(attachment.textContent)}`;
            }
        });

        const draftFiles: FileItem[] = hydratedAttachments.map((attachment) => ({
            name: attachment.file.name,
            url: attachment.isImage ? attachment.preview : undefined,
            isImage: attachment.isImage,
            mimeType: attachment.mimeType,
        }));

        if (!conv) {
            const newConv: Conversation = {
                id: generateId(),
                title: assistantForSend?.name || input.trim().slice(0, 30) || hydratedAttachments[0]?.file.name || '\u65b0\u5bf9\u8bdd',
                assistantId: assistantIdForSend || undefined,
                messages: assistantForSend ? [{
                    id: generateId(),
                    role: 'system',
                    content: assistantForSend.systemPrompt,
                    timestamp: Date.now(),
                }] : [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            conv = newConv;
            const updated = upsertConversation(currentConversations, newConv);
            conversationsRef.current = updated;
            activeConversationIdRef.current = newConv.id;
            pendingAssistantIdRef.current = assistantIdForSend;
            setConversations(updated);
            saveConversations(updated);
            setActiveConversationId(newConv.id);
        }

        const userMessage: ChatMessage = {
            id: generateId(),
            role: 'user',
            content: finalInput,
            files: draftFiles.length > 0 ? draftFiles : undefined,
            timestamp: Date.now(),
        };

        const isFirstUserMessage = conv.messages.filter((message) => message.role === 'user').length === 0;
        const updatedMessages = [...conv.messages, userMessage];
        const updatedConv: Conversation = {
            ...conv,
            messages: updatedMessages,
            updatedAt: Date.now(),
            title: isFirstUserMessage && !conv.assistantId
                ? finalInput.slice(0, 30) || hydratedAttachments[0]?.file.name || '\u65b0\u5bf9\u8bdd'
                : conv.title,
        };

        const finalConversations = upsertConversation(currentConversations, updatedConv);
        conversationsRef.current = finalConversations;
        setConversations(finalConversations);
        saveConversations(finalConversations);
        setInput('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        setAttachments([]);
        setIsLoading(true);
        abortControllerRef.current = new AbortController();

        let latestConversation = updatedConv;
        let aiMessageId: string | null = null;
        let aiContent = '';

        try {
            const apiMessages = updatedMessages.map((message) => {
                const currentFiles = message.files ? [...message.files] : [];
                if ((!message.files || message.files.length === 0) && message.images?.length) {
                    message.images.forEach((image, index) => {
                        currentFiles.push({
                            name: `img_${index}.png`,
                            url: image,
                            isImage: true,
                            mimeType: 'image/png',
                        });
                    });
                }

                const includeFiles = message.id !== userMessage.id;
                const contentArray: Array<
                    | { type: 'text'; text: string }
                    | { type: 'image_url'; image_url: { url: string } }
                    | { type: 'file_data'; file_data: { file_uri: string; mime_type: string } }
                > = [];

                if (message.content) {
                    contentArray.push({ type: 'text', text: message.content });
                }

                if (includeFiles) {
                    currentFiles.forEach((file) => {
                        if (file.isImage && file.url) {
                            contentArray.push({ type: 'image_url', image_url: { url: file.url } });
                            return;
                        }

                        if (file.fileUri) {
                            contentArray.push({
                                type: 'file_data',
                                file_data: {
                                    file_uri: file.fileUri,
                                    mime_type: file.mimeType || 'application/pdf',
                                },
                            });
                        }
                    });
                }

                return {
                    role: message.role,
                    content: contentArray.length > 0 ? contentArray : ' ',
                };
            });

            const shouldUseDocumentModel = hydratedAttachments.some((attachment) => {
                return isPdfAttachment({ name: attachment.file.name, mimeType: attachment.mimeType });
            }) && !getModelOption(selectedModel).supportsDocuments;
            const requestedModel = shouldUseDocumentModel ? FALLBACK_DOCUMENT_MODEL : selectedModel;
            if (requestedModel !== selectedModel) {
                setSelectedModel(requestedModel);
            }

            const formData = new FormData();
            formData.append('payload', JSON.stringify({ messages: apiMessages, model: requestedModel }));
            hydratedAttachments.forEach((attachment) => {
                const fileLike = { name: attachment.file.name, mimeType: attachment.mimeType };
                if (attachment.isImage || isPdfAttachment(fileLike)) {
                    formData.append('files', attachment.file);
                }
            });

            const response = await authenticatedFetch('/api/agent-chat', {
                method: 'POST',
                body: formData,
                signal: abortControllerRef.current?.signal,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(errorData?.error || `\u8bf7\u6c42\u5931\u8d25 (${response.status})`);
            }

            const responseModel = response.headers.get('x-agent-model');
            if (responseModel) {
                setSelectedModel(responseModel);
            }

            const uploadedFileRefs = decodeUploadedFilesHeader(response.headers.get('x-agent-uploaded-files'));
            if (uploadedFileRefs.length > 0) {
                const patchedUserMessage: ChatMessage = {
                    ...userMessage,
                    files: applyUploadedFileRefs(userMessage.files, uploadedFileRefs),
                };
                latestConversation = {
                    ...updatedConv,
                    messages: updatedMessages.map((message) => message.id === userMessage.id ? patchedUserMessage : message),
                    updatedAt: Date.now(),
                };
                const syncedConversations = upsertConversation(finalConversations, latestConversation);
                conversationsRef.current = syncedConversations;
                setConversations(syncedConversations);
                saveConversations(syncedConversations);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            aiMessageId = generateId();

            latestConversation = {
                ...latestConversation,
                messages: [
                    ...latestConversation.messages,
                    {
                        id: aiMessageId,
                        role: 'assistant',
                        content: '',
                        timestamp: Date.now(),
                        isStreaming: true,
                    },
                ],
                updatedAt: Date.now(),
            };
            setConversations((prev) => {
                const next = upsertConversation(prev, latestConversation);
                conversationsRef.current = next;
                return next;
            });

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                aiContent += decoder.decode(value, { stream: true });
                latestConversation = {
                    ...latestConversation,
                    messages: latestConversation.messages.map((message) => {
                        return message.id === aiMessageId
                            ? { ...message, content: aiContent, isStreaming: true }
                            : message;
                    }),
                    updatedAt: Date.now(),
                };
                setConversations((prev) => {
                    const next = upsertConversation(prev, latestConversation);
                    conversationsRef.current = next;
                    return next;
                });
            }

            aiContent += decoder.decode();
            latestConversation = {
                ...latestConversation,
                messages: latestConversation.messages.map((message) => {
                    return message.id === aiMessageId
                        ? {
                            ...message,
                            content: aiContent.trim()
                                ? aiContent
                                : '\u274c \u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u53ef\u663e\u793a\u5185\u5bb9\uff0c\u8bf7\u91cd\u8bd5\u4e00\u6b21\uff0c\u6216\u5207\u6362\u5230 Gemini 2.5 Flash Lite / Pro\u3002',
                            isStreaming: false,
                        }
                        : message;
                }),
                updatedAt: Date.now(),
            };

            latestConversation = syncResumeConversationMetadata(latestConversation);

            setConversations((prev) => {
                const final = upsertConversation(prev, latestConversation);
                conversationsRef.current = final;
                saveConversations(final);
                return final;
            });
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                setConversations((prev) => {
                    const baseConversation = prev.find((conversation) => conversation.id === updatedConv.id) || latestConversation;
                    const messages: ChatMessage[] = aiMessageId && baseConversation.messages.some((message) => message.id === aiMessageId)
                        ? baseConversation.messages.map((message) => {
                            if (message.id !== aiMessageId) return message;
                            return {
                                ...message,
                                content: message.content ? `${message.content}\n\n[已停止生成]` : '[已停止生成]',
                                isStreaming: false,
                            };
                        })
                        : baseConversation.messages;
                    const final = upsertConversation(prev, { ...baseConversation, messages, updatedAt: Date.now() });
                    conversationsRef.current = final;
                    saveConversations(final);
                    return final;
                });
                return;
            }

            const errorMsg = error instanceof Error ? error.message : '\u672a\u77e5\u9519\u8bef';
            toast.error(`\u53d1\u9001\u5931\u8d25: ${errorMsg}`);

            setConversations((prev) => {
                const baseConversation = prev.find((conversation) => conversation.id === updatedConv.id) || latestConversation;
                const messages: ChatMessage[] = aiMessageId && baseConversation.messages.some((message) => message.id === aiMessageId)
                    ? baseConversation.messages.map((message) => {
                        if (message.id !== aiMessageId) {
                            return message;
                        }

                        return {
                            ...message,
                            content: message.content
                                ? `${message.content}\n\n[\u53d1\u9001\u4e2d\u65ad: ${errorMsg}]`
                                : `\u274c \u53d1\u9001\u5931\u8d25: ${errorMsg}`,
                            isStreaming: false,
                        };
                    })
                    : [
                        ...baseConversation.messages,
                        {
                            id: generateId(),
                            role: 'assistant',
                            content: `\u274c \u53d1\u9001\u5931\u8d25: ${errorMsg}`,
                            timestamp: Date.now(),
                            isStreaming: false,
                        },
                    ];

                const final = upsertConversation(prev, {
                    ...baseConversation,
                    messages,
                    updatedAt: Date.now(),
                });
                conversationsRef.current = final;
                saveConversations(final);
                return final;
            });
        } finally {
            setIsLoading(false);
        }
    }, [
        input,
        attachments,
        isLoading,
        hasBlockingAttachments,
        hasPendingRequiredAttachments,
        activeConversation,
        conversations,
        selectedModel,
        allAssistants,
        activeAssistant,
    ]);
    // Handle key press
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    // Auto-resize textarea
    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const textarea = e.target;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    };

    // ============== Render ==============
    return (
        <div className="agent-chat-container">
            {/* Left Sidebar */}
            <div className="agent-sidebar">
                <div className="agent-sidebar-header">
                    <h2>
                        <Bot className="w-5 h-5" style={{ color: 'var(--accent-color)' }} />
                        {t.agentChat?.title || 'AI Agent'}
                    </h2>
                    <p>{t.agentChat?.subtitle || '智能对话助手 · 预设专属工作流'}</p>
                </div>

                {/* New Chat Button */}
                <button className="agent-new-chat-btn" onClick={() => createConversation()}>
                    <Plus className="w-4 h-4" />
                    {t.agentChat?.newChat || '新建对话'}
                </button>

                {/* Assistants Section */}
                <div className="agent-assistants-section">
                    <div className="agent-section-label">
                        <span>{t.agentChat?.prebuiltAssistants || '预设助手'}</span>
                        <button className="agent-add-btn" onClick={() => setShowAddModal(true)}>
                            <Plus className="w-3 h-3" />
                            {t.agentChat?.add || '添加'}
                        </button>
                    </div>

                    {allAssistants.map(assistant => (
                        <div
                            key={assistant.id}
                            className={`agent-assistant-card ${activeConversation?.assistantId === assistant.id ? 'active' : ''}`}
                            onClick={() => createConversation(assistant.id)}
                        >
                            <div
                                className="agent-assistant-icon"
                                style={{ background: assistant.iconBg }}
                            >
                                {assistant.icon}
                            </div>
                            <div className="agent-assistant-info">
                                <h4>{assistant.name}</h4>
                                <p>{assistant.description}</p>
                            </div>
                            {!assistant.isBuiltIn && (
                                <button
                                    className="agent-assistant-delete"
                                    onClick={(e) => deleteAssistant(assistant.id, e)}
                                    title={t.agentChat?.deleteAssistant || '删除助手'}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {/* Conversation History */}
                <div className="agent-assistants-section" style={{ marginTop: 4 }}>
                    <div className="agent-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{t.agentChat?.conversationHistory || '对话记录'}</span>
                        {isResumeScreeningView && resumeLibraryStats.total > 0 && (
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                简历库 {resumeLibraryStats.total} 份
                            </span>
                        )}
                    </div>
                </div>
                <div className="agent-conversations-section">
                    {conversations.length === 0 ? (
                        <div className="agent-conversations-empty">
                            {t.agentChat?.noConversations || '暂无对话记录'}
                        </div>
                    ) : (
                        conversations.map(conv => (
                            <div
                                key={conv.id}
                                className={`agent-conversation-item ${activeConversationId === conv.id ? 'active' : ''}`}
                                onClick={() => {
                                    activeConversationIdRef.current = conv.id;
                                    pendingAssistantIdRef.current = conv.assistantId || null;
                                    setActiveConversationId(conv.id);
                                }}
                            >
                                <MessageSquare className="w-4 h-4" style={{ color: 'var(--text-tertiary)', minWidth: 16 }} />
                                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                                    <span className="conv-title">{conv.title}</span>

                                </div>
                                <span className="conv-time">{formatTime(conv.updatedAt)}</span>
                                <button
                                    className="conv-delete"
                                    onClick={(e) => deleteConversation(conv.id, e)}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="agent-chat-main">
                {/* Header */}
                <div className="agent-chat-header">
                    <div className="agent-chat-header-info">
                        <button
                            onClick={onBack}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                padding: '4px',
                                borderRadius: '8px',
                                transition: 'all 0.2s'
                            }}
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h3>
                            {activeConversation
                                ? (activeAssistant?.icon ? `${activeAssistant.icon} ` : '') + activeConversation.title
                                : (t.agentChat?.title || 'AI Agent')
                            }
                        </h3>
                        <div className="agent-model-selector">
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                            >
                                {AVAILABLE_MODELS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Messages or Welcome */}
                {!activeConversation ? (
                    <div className="agent-welcome">
                        <div className="agent-welcome-icon">
                            <Bot className="w-10 h-10" style={{ color: 'var(--accent-color)' }} />
                        </div>
                        <h2>{t.agentChat?.welcomeTitle || '欢迎使用 AI Agent'}</h2>
                        <p>{t.agentChat?.welcomeDesc || '选择一个预设助手开始工作，或创建新对话自由提问。所有对话数据保存在本地。'}</p>
                        <div className="agent-welcome-actions">
                            <button className="agent-welcome-action" onClick={() => createConversation('resume-screening')}>
                                <FileText className="w-4 h-4" />
                                {t.agentChat?.startResumeScreening || '简历筛选助手'}
                            </button>
                            <button className="agent-welcome-action" onClick={() => createConversation()}>
                                <Sparkles className="w-4 h-4" />
                                {t.agentChat?.startFreeChat || '自由对话'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>

                        <div className="agent-chat-messages">
                            {visibleMessages.length === 0 && activeAssistant && (
                                <div className="agent-message assistant" style={{ animation: 'agentMessageIn 0.3s ease-out' }}>
                                    <div className="agent-message-avatar ai">
                                        <Bot className="w-4 h-4" />
                                    </div>
                                    <div className="agent-message-content">
                                        <p style={{ margin: 0 }}>
                                            {activeAssistant.id === 'resume-screening'
                                                ? '你好，我是你的简历筛选助手。请发送候选人简历，我会进入初筛模式并给出评估。'
                                                : `${activeAssistant.name} 已准备就绪，请开始提问。`
                                            }
                                        </p>
                                    </div>
                                </div>
                            )}
                            {visibleMessages.map((msg) => (
                                // Add id for scroll-to targeting
                                <div key={msg.id} id={`msg-${msg.id}`} className={`agent-message ${msg.role} ${highlightedMessageId === msg.id ? 'highlight' : ''}`}>
                                    <div className={`agent-message-avatar ${msg.role === 'user' ? 'user' : 'ai'} `}>
                                        {msg.role === 'user'
                                            ? <span style={{ fontSize: 13, fontWeight: 600 }}>我</span>
                                            : <Bot className="w-4 h-4" />
                                        }
                                    </div>
                                    <div className="agent-message-content">
                                        {msg.role === 'assistant' ? (
                                            msg.isStreaming ? (
                                                msg.content.trim() ? (
                                                    <div className="agent-streaming-text">{msg.content}</div>
                                                ) : (
                                                    <div className="agent-typing-indicator">
                                                        <span></span>
                                                        <span></span>
                                                        <span></span>
                                                    </div>
                                                )
                                            ) : (
                                                <div className="agent-assistant-markdown">
                                                    <ReactMarkdown>{formatAssistantMessage(msg.content)}</ReactMarkdown>
                                                </div>
                                            )
                                        ) : (
                                            <>
                                                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                                                {msg.files && msg.files.length > 0 && (
                                                    <div className="agent-message-images">
                                                        {msg.files.map((file, idx) => (
                                                            file.isImage && file.url ? (
                                                                <img
                                                                    key={`${file.name}-${idx}`}
                                                                    src={file.url}
                                                                    alt={file.name}
                                                                    onClick={() => handlePreviewFile(file.url)}
                                                                    style={{ cursor: 'pointer' }}
                                                                />
                                                            ) : (
                                                                <div
                                                                    key={`${file.name}-${idx}`}
                                                                    className="agent-attachment-doc"
                                                                    onClick={() => file.url ? handlePreviewFile(file.url) : undefined}
                                                                    style={{
                                                                        border: '1px solid var(--border-subtle)',
                                                                        borderRadius: '8px',
                                                                        padding: '8px 12px',
                                                                        marginTop: '8px',
                                                                        background: 'var(--glass-bg-solid)',
                                                                        cursor: file.url ? 'pointer' : 'default',
                                                                    }}
                                                                >
                                                                    <FileText className="w-4 h-4" />
                                                                    <span>
                                                                        {file.name}
                                                                        {file.fileUri ? ' (已上传给 Gemini)' : file.url ? ' (可预览)' : ' (附件已发送)'}
                                                                    </span>
                                                                </div>
                                                            )
                                                        ))}
                                                    </div>
                                                )}
                                                {!msg.files && msg.images && msg.images.length > 0 && (
                                                    <div className="agent-message-images">
                                                        {msg.images.map((img, idx) => (
                                                            <img key={idx} src={img} alt="attached" onClick={() => handlePreviewFile(img)} style={{ cursor: 'pointer' }} />
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {isLoading && visibleMessages[visibleMessages.length - 1]?.role !== 'assistant' && (
                                <div className="agent-message assistant">
                                    <div className="agent-message-avatar ai">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    </div>
                                    <div className="agent-message-content">
                                        <div className="agent-typing-indicator">
                                            <span></span>
                                            <span></span>
                                            <span></span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="agent-chat-input-area">
                            {attachments.length > 0 && (
                                <div className="agent-attachments-preview">
                                    {attachments.map((attachment) => (
                                        <div key={attachment.id} className="agent-attachment-item">
                                            {attachment.isImage && attachment.preview ? (
                                                <img src={attachment.preview} alt={attachment.file.name} />
                                            ) : (
                                                <div className="agent-attachment-doc">
                                                    <FileText className="w-4 h-4" />
                                                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                                        <span>{attachment.file.name}</span>
                                                        <span style={{ fontSize: 12, color: attachment.status === 'error' ? '#ef4444' : 'var(--text-tertiary)' }}>
                                                            {getDraftAttachmentStatus(attachment)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            <button className="agent-attachment-remove" onClick={(e) => removeAttachment(attachment.id, e)}>
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {hasPendingRequiredAttachments && (
                                <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                                    Word / Excel 附件正在解析，完成后再发送。
                                </div>
                            )}
                            {hasErroredAttachments && (
                                <div style={{ marginBottom: 8, fontSize: 12, color: '#ef4444' }}>
                                    存在无法处理的附件，请移除后再发送。
                                </div>
                            )}
                            <div className="agent-chat-input-wrapper">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    multiple
                                    accept={SUPPORTED_FILE_INPUT}
                                    onChange={handleFileSelect}
                                />
                                <button className="agent-attach-btn" onClick={() => fileInputRef.current?.click()}>
                                    <Paperclip className="w-5 h-5" />
                                </button>
                                <textarea
                                    ref={textareaRef}
                                    value={input}
                                    onChange={handleTextareaChange}
                                    onKeyDown={handleKeyDown}
                                    onPaste={handlePaste}
                                    placeholder={
                                        activeAssistant?.id === 'resume-screening'
                                            ? (t.agentChat?.resumeInputPlaceholder || '粘贴候选人简历内容...')
                                            : (t.agentChat?.inputPlaceholder || '输入消息...')
                                    }
                                    rows={1}
                                    disabled={isLoading}
                                />
                                {isLoading ? (
                                    <button
                                        className="agent-stop-btn"
                                        onClick={stopGeneration}
                                        title="停止生成"
                                    >
                                        <Square fill="currentColor" onClick={(e) => { e.stopPropagation(); stopGeneration(); }} className="w-5 h-5" />
                                    </button>
                                ) : (
                                    <button
                                        className="agent-send-btn"
                                        onClick={sendMessage}
                                        disabled={((!input.trim() && attachments.length === 0) || hasBlockingAttachments)}
                                    >
                                        <Send className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Right Sidebar - Resume Library */}
            {isResumeScreeningView && showResumeSidebar && (
                <div className="agent-resume-sidebar">
                    <div className="agent-resume-sidebar-header">
                        <div className="agent-resume-sidebar-title">
                            <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-color)' }} />
                            <h4>简历库</h4>
                        </div>
                        <button
                            className="agent-resume-sidebar-close"
                            onClick={() => setShowResumeSidebar(false)}
                            title="收起简历库"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="agent-resume-sidebar-desc">去重汇总所有已完成初筛的简历，显示最新评分结果。</p>
                    <div className="agent-resume-library-stats">
                        <span className="agent-resume-library-stat">总计 {resumeLibraryStats.total}</span>
                        <span className="agent-resume-library-stat pass">✅ {resumeLibraryStats.pass}</span>
                        <span className="agent-resume-library-stat conditional">⚠️ {resumeLibraryStats.conditional}</span>
                        <span className="agent-resume-library-stat fail">❌ {resumeLibraryStats.fail}</span>
                    </div>
                    <div className="agent-resume-sidebar-list">
                        {dedupedResumeItems.length === 0 ? (
                            <div className="agent-resume-library-empty">
                                还没有已归档的简历。上传并完成第一份简历初筛后，会自动出现在这里。
                            </div>
                        ) : (
                            dedupedResumeItems.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`agent-resume-library-card ${activeConversationId === item.conversationId ? 'active' : ''}`}
                                    onClick={() => {
                                        activeConversationIdRef.current = item.conversationId;
                                        pendingAssistantIdRef.current = findConversationById(conversationsRef.current, item.conversationId)?.assistantId || null;
                                        setActiveConversationId(item.conversationId);
                                        setHighlightedMessageId(item.assistantMessageId);
                                        setTimeout(() => {
                                            const el = document.getElementById(`msg-${item.assistantMessageId}`);
                                            if (el) {
                                                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }
                                        }, 100);
                                        setTimeout(() => setHighlightedMessageId(null), 3000);
                                    }}
                                >
                                    <div className="agent-resume-library-card-top">
                                        <strong>{item.candidateName}</strong>
                                        <span className={`agent-resume-result-badge ${item.conclusion}`}>
                                            {item.conclusion === 'pass' ? '✅ 通过' : item.conclusion === 'conditional' ? '⚠️ 待定' : '❌ 不通过'}
                                        </span>
                                    </div>
                                    <div className="agent-resume-library-card-meta">
                                        <span>评分 {item.score}</span>
                                        {item.reviewCount > 1 && <span>已筛 {item.reviewCount} 次</span>}
                                        <span>{formatTime(item.reviewedAt)}</span>
                                    </div>
                                    <p>{item.summary}</p>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Resume sidebar toggle when hidden */}
            {isResumeScreeningView && !showResumeSidebar && (
                <button
                    className="agent-resume-sidebar-toggle"
                    onClick={() => setShowResumeSidebar(true)}
                    title="展开简历库"
                >
                    <BookOpen className="w-4 h-4" />
                </button>
            )}

            {/* Add Assistant Modal */}
            {showAddModal && (
                <div className="agent-modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="agent-modal" onClick={e => e.stopPropagation()}>
                        <h3>{t.agentChat?.addAssistantTitle || '添加自定义助手'}</h3>

                        <div className="agent-modal-field">
                            <label>{t.agentChat?.assistantIcon || '图标 (Emoji)'}</label>
                            <input
                                type="text"
                                value={newAssistantIcon}
                                onChange={e => setNewAssistantIcon(e.target.value)}
                                placeholder="🤖"
                                maxLength={4}
                                style={{ width: 80 }}
                            />
                        </div>

                        <div className="agent-modal-field">
                            <label>{t.agentChat?.assistantName || '助手名称'} *</label>
                            <input
                                type="text"
                                value={newAssistantName}
                                onChange={e => setNewAssistantName(e.target.value)}
                                placeholder={t.agentChat?.assistantNamePlaceholder || '例如：代码审查助手'}
                            />
                        </div>

                        <div className="agent-modal-field">
                            <label>{t.agentChat?.assistantDescription || '描述'}</label>
                            <input
                                type="text"
                                value={newAssistantDesc}
                                onChange={e => setNewAssistantDesc(e.target.value)}
                                placeholder={t.agentChat?.assistantDescPlaceholder || '简要描述助手功能'}
                            />
                        </div>

                        <div className="agent-modal-field">
                            <label>{t.agentChat?.systemPrompt || '系统提示词 (System Prompt)'} *</label>
                            <textarea
                                value={newAssistantPrompt}
                                onChange={e => setNewAssistantPrompt(e.target.value)}
                                placeholder={t.agentChat?.systemPromptPlaceholder || '输入系统提示词，定义助手的行为和能力...'}
                                style={{ minHeight: 160 }}
                            />
                        </div>

                        <div className="agent-modal-actions">
                            <button className="agent-modal-cancel" onClick={() => setShowAddModal(false)}>
                                {t.common?.cancel || '取消'}
                            </button>
                            <button className="agent-modal-save" onClick={addCustomAssistant}>
                                {t.agentChat?.saveAssistant || '保存助手'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgentChat;










