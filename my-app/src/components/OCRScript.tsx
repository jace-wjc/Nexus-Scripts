import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ArrowLeft, Play, FileText, Folder, Loader2, Download, AlertTriangle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { getApiBaseUrl } from '../lib/api';
import { authenticatedFetch, getScriptHubAuthHeaderRecord } from '../lib/auth';
import { useI18n } from '@/lib/i18n';
import { consumeOcrStream } from './ocrStream';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";

// Extend File interface to include webkitRelativePath (used by directory upload)
interface FileWithPath extends File {
    readonly webkitRelativePath: string;
}

interface OCRScriptProps {
    onBack: () => void;
}

export default function OCRScript({ onBack }: OCRScriptProps) {
    const [excelFile, setExcelFile] = useState<File | null>(null);
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const { t } = useI18n();
    const ocr = t.scripts.ocr;

    const [mode, setMode] = useState('1');
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [downloadUrl, setDownloadUrl] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [partialResult, setPartialResult] = useState(false);

    // 进度跟踪
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
    const [requestId, setRequestId] = useState<string>('');
    const [isAborting, setIsAborting] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // 确认弹窗状态
    const [showBackConfirm, setShowBackConfirm] = useState(false);
    const [showAbortConfirm, setShowAbortConfirm] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const folderInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    useEffect(() => {
        if (folderInputRef.current) {
            folderInputRef.current.setAttribute('webkitdirectory', '');
            folderInputRef.current.setAttribute('directory', '');
        }
    }, []);

    const handleScroll = () => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
        }
    };

    const handleExcelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) setExcelFile(file);
    };

    const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const arr: File[] = [];
            for (let i = 0; i < files.length; i++) arr.push(files[i]);
            setImageFiles(arr);
        }
    };

    // 计算总文件大小
    const getTotalSize = () => {
        let total = excelFile?.size || 0;
        imageFiles.forEach(f => total += f.size);
        return (total / 1024 / 1024).toFixed(2);
    };

    const handleRun = async () => {
        if (!excelFile) {
            toast.error(ocr.messages.selectExcel);
            return;
        }
        if (imageFiles.length === 0) {
            toast.error(ocr.messages.selectFolder);
            return;
        }

        setIsRunning(true);
        setLogs([]);
        setDownloadUrl('');
        setPartialResult(false);
        setProgress(null);
        setRequestId('');
        setIsAborting(false);

        // 创建 AbortController 用于中止请求
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const base = getApiBaseUrl();
            if (!base) {
                setIsRunning(false);
                return;
            }

            const formData = new FormData();
            formData.append('mode', mode);
            formData.append('excel_file', excelFile);

            for (const file of imageFiles) {
                const relativePath = (file as FileWithPath).webkitRelativePath || file.name;
                formData.append('image_files', file, relativePath);
            }

            const totalSize = getTotalSize();
            setLogs(prev => [...prev, ocr.logs.startUpload.replace('{count}', String(imageFiles.length)).replace('{size}', totalSize)]);
            setLogs(prev => [...prev, ocr.logs.uploading]);

            const response = await fetch(`${base}/ocr/process-upload`, {
                method: 'POST',
                headers: getScriptHubAuthHeaderRecord(),
                body: formData,
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || response.statusText);
            }

            setLogs(prev => [...prev, ocr.logs.uploadComplete]);

            await consumeOcrStream(response.body, data => {
                if (data.type === 'init') {
                    setRequestId(data.request_id);
                } else if (data.type === 'progress') {
                    setProgress({ current: data.current, total: data.total });
                } else if (data.type === 'log') {
                    setLogs(prev => [...prev, data.content]);
                } else if (data.success) {
                    if (data.aborted) toast.warning(data.message || ocr.status.partial);
                    else toast.success(ocr.messages.success);
                    setLogs(prev => [...prev, `${data.aborted ? '⚠️' : '✅'} ${data.message}`]);
                    if (data.download_url) {
                        setPartialResult(Boolean(data.aborted));
                        setDownloadUrl(`${base}/${data.download_url}`);
                    }
                } else {
                    const message = data.message === 'ocr_result_missing' || !data.message ? ocr.messages.resultMissing : data.message;
                    toast.error(message);
                    setLogs(prev => [...prev, `❌ ${message}`]);
                }
            });

        } catch (error: unknown) {
            // 检查是否为用户中止
            if (error instanceof Error && error.name === 'AbortError') {
                setLogs(prev => [...prev, ocr.logs.aborted]);
            } else {
                const rawMessage = error instanceof Error ? error.message : String(error);
                const errMsg = ['ocr_result_missing', 'ocr_stream_invalid'].includes(rawMessage) ? ocr.messages.resultMissing : rawMessage;
                setDownloadUrl('');
                toast.error(ocr.logs.failed + errMsg);
                setLogs(prev => [...prev, `❌ ${ocr.logs.failed} ${errMsg}`]);
            }
        } finally {
            setIsRunning(false);
            setIsAborting(false);
            setProgress(null);
            abortControllerRef.current = null;
        }
    };

    const handleDownload = async () => {
        if (!downloadUrl || downloading) return;
        setDownloading(true);
        try {
            const expected = new URL(`${getApiBaseUrl()}/outputs/`, window.location.href);
            const target = new URL(downloadUrl, window.location.href);
            if (target.origin !== expected.origin || !target.pathname.startsWith(expected.pathname)) {
                throw new Error('invalid_download_target');
            }
            const response = await authenticatedFetch(target.href, { cache: 'no-store' });
            if (!response.ok) {
                toast.error(response.status === 401 || response.status === 403 ? ocr.messages.downloadForbidden : ocr.messages.downloadFailed);
                return;
            }
            const objectUrl = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = decodeURIComponent(target.pathname.split('/').pop() || 'ocr-result.xlsx');
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch {
            toast.error(ocr.messages.downloadFailed);
        } finally {
            setDownloading(false);
        }
    };

    // 中止处理函数
    const handleAbort = async () => {
        if (!requestId || isAborting) return;

        setIsAborting(true);
        setLogs(prev => [...prev, ocr.logs.aborting]);

        try {
            const base = getApiBaseUrl();
            if (base && requestId) {
                await fetch(`${base}/ocr/abort/${requestId}`, {
                    method: 'POST',
                    headers: getScriptHubAuthHeaderRecord(),
                });
            }
            // 同时中止 fetch 流
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        } catch (err) {
            console.error('中止请求失败:', err);
        }
    };

    // 处理返回点击
    const handleBackClick = () => {
        if (isRunning) {
            setShowBackConfirm(true);
        } else {
            onBack();
        }
    };

    // 处理中止点击
    const handleAbortClick = () => {
        setShowAbortConfirm(true);
    };

    // 确认中止
    const confirmAbort = async () => {
        setShowAbortConfirm(false);
        await handleAbort();
    };

    // 确认返回
    const confirmBack = async () => {
        setShowBackConfirm(false);
        if (isRunning) {
            await handleAbort();
        }
        onBack();
    };

    return (
        <div className="min-h-screen bg-[var(--background)] p-6 md:p-12 font-sans text-[var(--text-primary)]">
            {/* 顶栏：标题与返回 */}
            <div className="max-w-7xl mx-auto mb-8 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleBackClick}
                        className="h-10 w-10 rounded-full border-[var(--border-subtle)] bg-[var(--card-bg)] shadow-sm hover:bg-[var(--background-secondary)] hover:text-[var(--text-primary)] transition-all"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
                            {ocr.title}
                        </h1>
                        <p className="text-sm font-medium text-[var(--text-secondary)] mt-1">
                            {ocr.subtitle}
                        </p>
                    </div>
                </div>
                {/* 状态指示器 & 中止按钮 */}
                {isRunning && (
                    <div className="flex items-center gap-3">
                        {/* 进度显示 */}
                        <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {progress ? (
                                <span>{ocr.status.processing.replace('{current}', String(progress.current)).replace('{total}', String(progress.total))}</span>
                            ) : (
                                <span>{ocr.status.initializing}</span>
                            )}
                        </div>
                        {/* 中止按钮 */}
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleAbortClick}
                            disabled={isAborting || !requestId}
                            className="rounded-full"
                        >
                            {isAborting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                    {ocr.actions.aborting}
                                </>
                            ) : (
                                ocr.actions.abort
                            )}
                        </Button>
                    </div>
                )}
            </div>

            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* 左侧：配置与操作区域 */}
                <div className="lg:col-span-5 space-y-6">
                    {/* 文件上传卡片 */}
                    <Card className="border-0 shadow-xl bg-[var(--glass-bg)] backdrop-blur-sm ring-1 ring-[var(--border-subtle)]/5 overflow-hidden">
                        <CardHeader className="pb-4 border-b border-[var(--border-subtle)] bg-[var(--card-bg)]/50">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <FileText className="w-5 h-5 text-blue-600" />
                                {ocr.form.dataSource}
                            </CardTitle>
                            <CardDescription>
                                {ocr.form.dataSourceDesc}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            {/* Excel 上传 */}
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold text-[var(--text-primary)]">{ocr.form.excelLabel}</Label>
                                <div className="group relative">
                                    <div className={`
                                        relative flex flex-col items-center justify-center w-full h-32 rounded-xl border-2 border-dashed transition-all duration-200
                                        ${excelFile
                                            ? 'border-green-500/50 bg-green-500/10'
                                            : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5'
                                        }
                                    `}>
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                                            {excelFile ? (
                                                <>
                                                    <FileText className="w-8 h-8 text-green-600 mb-2" />
                                                    <p className="text-sm font-medium text-green-600 dark:text-green-400 truncate max-w-full px-4">
                                                        {excelFile.name}
                                                    </p>
                                                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                                        {(excelFile.size / 1024).toFixed(1)} KB
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <FileText className="w-8 h-8 text-muted-foreground/50 mb-2 group-hover:text-primary transition-colors" />
                                                    <p className="text-sm text-[var(--text-secondary)] font-medium">
                                                        {ocr.form.excelPlaceholder}
                                                    </p>
                                                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                                                        {ocr.form.excelHint}
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                        <Input
                                            id="excel-file"
                                            type="file"
                                            accept=".xlsx,.xls"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            onChange={handleExcelChange}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 文件夹上传 */}
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold text-[var(--text-primary)]">
                                    {ocr.form.imagesLabel}
                                    <span className="ml-1 text-xs font-normal text-[var(--text-secondary)]">{ocr.form.imagesHint}</span>
                                </Label>
                                <div className="group relative">
                                    <div className={`
                                        relative flex flex-col items-center justify-center w-full h-32 rounded-xl border-2 border-dashed transition-all duration-200
                                        ${imageFiles.length > 0
                                            ? 'border-green-500/50 bg-green-500/10'
                                            : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5'
                                        }
                                    `}>
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                                            {imageFiles.length > 0 ? (
                                                <>
                                                    <Folder className="w-8 h-8 text-green-600 mb-2" />
                                                    <p className="text-sm font-medium text-green-600 dark:text-green-400">
                                                        {ocr.form.selectedFiles.replace('{count}', String(imageFiles.length))}
                                                    </p>
                                                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                                        {ocr.form.totalSize.replace('{size}', getTotalSize())}
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <Folder className="w-8 h-8 text-muted-foreground/50 mb-2 group-hover:text-primary transition-colors" />
                                                    <p className="text-sm text-[var(--text-secondary)] font-medium">
                                                        {ocr.form.folderPlaceholder}
                                                    </p>
                                                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                                                        {ocr.form.folderHint}
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                        <input
                                            id="folder-input"
                                            ref={folderInputRef}
                                            type="file"
                                            multiple
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            onChange={handleFolderChange}
                                        />
                                    </div>
                                </div>
                                {imageFiles.length > 500 && (
                                    <div className="flex items-start gap-2 p-3 mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-600 dark:text-amber-400 text-xs">
                                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>
                                            {ocr.form.largeFileWarning.replace('{count}', String(imageFiles.length))}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* 运行模式 & 按钮 */}
                    <Card className="border-0 shadow-lg bg-[var(--card-bg)] overflow-hidden">
                        {/* 运行模式 & 启动按钮 */}
                        {/* 运行模式 & 启动按钮 */}
                        <CardContent className="p-6 space-y-6">
                            <div className="space-y-6">
                                <div className="space-y-4">
                                    <Label className="text-sm font-semibold text-[var(--text-primary)]">{ocr.mode.label}</Label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div
                                            className={`
                                            cursor-pointer relative flex items-start gap-3 p-4 rounded-xl border-2 transition-all duration-200
                                            ${mode === '1'
                                                    ? 'border-primary bg-primary/5 shadow-sm'
                                                    : 'border-border bg-card hover:border-primary/30 hover:bg-muted/50'
                                                }
                                        `}
                                            onClick={() => !isRunning && setMode('1')}
                                        >
                                            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${mode === '1' ? 'border-primary' : 'border-border'}`}>
                                                {mode === '1' && <div className="w-2 h-2 rounded-full bg-primary" />}
                                            </div>
                                            <div>
                                                <p className={`font-semibold text-sm ${mode === '1' ? 'text-primary' : 'text-[var(--text-primary)]'}`}>
                                                    {ocr.mode.excelFirst}
                                                </p>
                                                <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                                                    {ocr.mode.excelFirstDesc}
                                                </p>
                                            </div>
                                        </div>

                                        <div
                                            className={`
                                            cursor-pointer relative flex items-start gap-3 p-4 rounded-xl border-2 transition-all duration-200
                                            ${mode === '2'
                                                    ? 'border-primary bg-primary/5 shadow-sm'
                                                    : 'border-border bg-card hover:border-primary/30 hover:bg-muted/50'
                                                }
                                        `}
                                            onClick={() => !isRunning && setMode('2')}
                                        >
                                            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${mode === '2' ? 'border-primary' : 'border-border'}`}>
                                                {mode === '2' && <div className="w-2 h-2 rounded-full bg-primary" />}
                                            </div>
                                            <div>
                                                <p className={`font-semibold text-sm ${mode === '2' ? 'text-primary' : 'text-[var(--text-primary)]'}`}>
                                                    {ocr.mode.imagesFirst}
                                                </p>
                                                <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                                                    {ocr.mode.imagesFirstDesc}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="pt-2">
                                    <Button
                                        className="w-full h-12 text-lg font-medium shadow-primary/20 shadow-lg bg-primary hover:bg-primary/90 transition-all rounded-xl"
                                        onClick={handleRun}
                                        disabled={isRunning || !excelFile || imageFiles.length === 0}
                                    >
                                        {isRunning ? (
                                            <>
                                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                                {ocr.actions.processing}
                                            </>
                                        ) : (
                                            <>
                                                <Play className="mr-2 h-5 w-5" />
                                                {ocr.actions.start}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>

                            {/* 进度条区域 */}
                            {isRunning && progress && (
                                <div className="space-y-2 pt-2">
                                    <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                                        <span>{ocr.status.progressLabel}</span>
                                        <span className="font-mono font-medium">
                                            {progress.current} / {progress.total}
                                        </span>
                                    </div>
                                    <div className="h-2 bg-[var(--background-secondary)] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-primary transition-all duration-300 ease-out"
                                            style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-[var(--text-secondary)] text-center">
                                        {ocr.status.remaining.replace('{count}', String(progress.total - progress.current))}
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* 右侧：日志与结果 */}
                <div className="lg:col-span-7 flex flex-col h-full space-y-6">
                    {/* 结果下载卡片 (动态出现) */}
                    {/* 结果下载卡片 (动态出现) */}
                    {downloadUrl && (
                        <div className="animate-in fade-in slide-in-from-top-4 duration-500 mt-8">
                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center shrink-0">
                                        <Download className="w-6 h-6 text-green-600 dark:text-green-300" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-green-800 dark:text-green-200">{partialResult ? ocr.status.partial : ocr.status.completed}</h3>
                                        <p className="text-green-700 dark:text-green-300 text-sm">{partialResult ? ocr.status.partialDesc : ocr.status.completedDesc}</p>
                                    </div>
                                </div>
                                <Button
                                    className="w-full shrink-0 md:w-auto bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-600/20"
                                    onClick={() => void handleDownload()}
                                    disabled={downloading}
                                >
                                    {downloading ? ocr.actions.downloading : ocr.actions.download}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* 日志终端 */}
                    <Card className="flex-1 flex flex-col border-0 shadow-xl bg-[#1e1e1e] ring-1 ring-white/10 overflow-hidden min-h-[500px]">
                        <CardHeader className="bg-[#2d2d2d] py-3 px-4 border-b border-white/5 flex flex-row items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                                </div>
                                <span className="ml-3 text-xs font-mono text-gray-400">task_output.log</span>
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                                {logs.length} lines
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 relative">
                            <div
                                ref={scrollRef}
                                onScroll={handleScroll}
                                className="absolute inset-0 p-4 overflow-y-auto font-mono text-sm leading-relaxed scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
                            >
                                {logs.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
                                        <Loader2 className="w-8 h-8 opacity-20 mb-2" />
                                        <p className="text-sm font-medium">{ocr.status.waiting}</p>
                                    </div>
                                ) : (
                                    logs.map((log, index) => {
                                        // 简单的日志着色
                                        let colorClass = "text-gray-300";
                                        if (log.includes("❌") || log.includes("Error") || log.includes("失败")) colorClass = "text-red-400";
                                        else if (log.includes("✅") || log.includes("完成") || log.includes("成功")) colorClass = "text-emerald-400";
                                        else if (log.includes("⚠️") || log.includes("警告")) colorClass = "text-yellow-400";
                                        else if (log.includes("开始") || log.includes("上传")) colorClass = "text-blue-400";

                                        return (
                                            <div key={index} className={`mb-1 break-all ${colorClass}`}>
                                                <span className="opacity-30 mr-2 select-none">›</span>
                                                {log}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* 确认退出对话框 */}
            <Dialog open={showBackConfirm} onOpenChange={setShowBackConfirm}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{ocr.dialog.backTitle}</DialogTitle>
                        <DialogDescription>
                            {ocr.dialog.backContent}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowBackConfirm(false)}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="destructive" onClick={confirmBack}>
                            {ocr.dialog.backConfirm}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 确认中止对话框 */}
            <Dialog open={showAbortConfirm} onOpenChange={setShowAbortConfirm}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{ocr.dialog.abortTitle}</DialogTitle>
                        <DialogDescription>
                            {ocr.dialog.abortContent}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAbortConfirm(false)}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="destructive" onClick={confirmAbort}>
                            {ocr.dialog.abortConfirm}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}
