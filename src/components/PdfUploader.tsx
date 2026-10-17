import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  X,
  FileCheck,
  Link,
} from 'lucide-react';

interface PdfUploaderProps {
  onAnalyzePdf: (base64Data: string, filename: string) => Promise<void>;
  onAnalyzeWebsite: (url: string) => Promise<void>;
  onLoadSample: () => void;
  isAnalyzing: boolean;
  error: string | null;
}

export const PdfUploader: React.FC<PdfUploaderProps> = ({
  onAnalyzePdf,
  onAnalyzeWebsite,
  onLoadSample,
  isAnalyzing,
  error,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please upload a valid PDF document (.pdf).');
      return;
    }

    setSelectedFile(file);
    setSourceName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setFileBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleStartAnalysis = async () => {
    if (!fileBase64 || !sourceName) return;
    await onAnalyzePdf(fileBase64, sourceName);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setFileBase64(null);
    setSourceName(null);
    setWebsiteUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFetchWebsite = async () => {
    if (!websiteUrl.trim()) return;

    setIsFetchingUrl(true);
    try {
      await onAnalyzeWebsite(websiteUrl.trim());
      setSourceName(websiteUrl.trim());
    } catch (fetchError: any) {
      alert(fetchError?.message || 'Unable to scrape the website.');
    } finally {
      setIsFetchingUrl(false);
    }
  };

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur-sm space-y-4">
      {/* Upload Dropzone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !selectedFile && !sourceName && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
          dragActive
            ? 'border-blue-500 bg-blue-950/20'
            :             selectedFile || sourceName
            ? 'border-emerald-500/60 bg-emerald-950/10'
            : 'border-slate-700/80 hover:border-slate-600 bg-slate-950/60 hover:bg-slate-950/80'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleChange}
          className="hidden"
        />

        {selectedFile || sourceName ? (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 text-left">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center text-emerald-400 shrink-0">
                <FileCheck className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white truncate max-w-sm">
                  {sourceName}
                </p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                    : 'Fetched from website'}{' '}
                  • Ready for Gemini Analysis
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear();
                }}
                disabled={isAnalyzing}
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
                title="Remove file"
              >
                <X className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartAnalysis();
                }}
                disabled={isAnalyzing}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Analyzing Syllabus...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-cyan-300" />
                    <span>Analyze with Gemini</span>
                  </>
                )}
              </button>
            </div>

          </div>
        ) : (
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mx-auto">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Drop your syllabus or exam PDF here, or <span className="text-blue-400 underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Supports syllabus documents, assignment rubrics, exam review guides, and semester calendars (.pdf)
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-500">
        <span className="h-px flex-1 bg-slate-800" />
        <span>OR USE A WEBSITE</span>
        <span className="h-px flex-1 bg-slate-800" />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Link className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleFetchWebsite();
              }
            }}
            placeholder="Paste a syllabus PDF or webpage URL"
            disabled={isFetchingUrl || isAnalyzing || Boolean(selectedFile || sourceName)}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleFetchWebsite()}
          disabled={!websiteUrl.trim() || isFetchingUrl || isAnalyzing || Boolean(selectedFile || sourceName)}
          className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
        >
          <Link className="w-3.5 h-3.5" />
          {isFetchingUrl ? 'Scraping website...' : 'Scrape Website'}
        </button>
      </div>

      <p className="text-[11px] text-slate-500">
        Works with a direct PDF link or a webpage containing a downloadable syllabus PDF.
      </p>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800/80 rounded-2xl text-red-300 text-xs flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-200">Analysis Error</p>
            <p className="text-red-300/90 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Bottom Sample Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs">
        <span className="text-slate-400 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          Powered by Gemini 3.8 Flash • Scrapes course pages and extracts events, weights, prep info &amp; milestones
        </span>

        <button
          onClick={onLoadSample}
          disabled={isAnalyzing}
          className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-950/40 border border-cyan-800/50 hover:bg-cyan-950/60 transition-all cursor-pointer whitespace-nowrap"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Try with Sample ML Syllabus (1-Click)</span>
        </button>
      </div>
    </div>
  );
};
