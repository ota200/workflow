import React, { useRef, useState } from 'react';
import { AlertCircle, Link as LinkIcon, UploadCloud, X } from 'lucide-react';

interface PdfUploaderProps {
  onAnalyzePdf: (base64Data: string, filename: string) => Promise<void>;
  onAnalyzeWebsite: (url: string) => Promise<void>;
  onLoadSample: () => void;
  isAnalyzing: boolean;
  error: string | null;
}

const MAX_BYTES = 25 * 1024 * 1024;
const LOOKING_FOR = [
  'Assignment deadlines',
  'Exams and quizzes',
  'Project milestones',
  'Classes and recurring events',
  'Other important dates',
];

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
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shownError = localError || error;
  const busy = isAnalyzing || isFetchingUrl;

  const processFile = (file: File) => {
    setLocalError(null);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setLocalError(`“${file.name}” isn’t a PDF. Convert it to PDF and upload it again.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError(`“${file.name}” is ${(file.size / 1048576).toFixed(0)} MB. The limit is 25 MB. Compress the file or split it.`);
      return;
    }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setFileBase64(e.target?.result as string);
    reader.onerror = () => {
      setLocalError(`We couldn’t read “${file.name}”. The file may be damaged. Re-export it and try again.`);
      setSelectedFile(null);
    };
    reader.readAsDataURL(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setFileBase64(null);
    setLocalError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFetchWebsite = async () => {
    if (!websiteUrl.trim()) return;
    setLocalError(null);
    setIsFetchingUrl(true);
    try {
      await onAnalyzeWebsite(websiteUrl.trim());
    } catch {
      /* App sets the error message */
    } finally {
      setIsFetchingUrl(false);
    }
  };

  if (busy) {
    return (
      <div className="workflow-card" style={{ padding: 24, maxWidth: 560 }}>
        <div className="wf-row" style={{ padding: '0 0 16px' }}>
          <div className="wf-fileicon">PDF</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }} className="truncate">{selectedFile?.name || websiteUrl}</div>
            <div className="wf-small wf-muted">Extracting events. This can take a minute.</div>
          </div>
        </div>
        <div className="wf-progress" role="progressbar" aria-label="Extracting events"><i /></div>
        <p className="wf-small wf-muted" style={{ margin: '14px 0 6px' }}>Looking for</p>
        <ul style={{ margin: 0, paddingLeft: 18 }} className="wf-muted">
          {LOOKING_FOR.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
    );
  }

  return (
    <div>
      {shownError && (
        <div className="wf-alert" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle className="w-4 h-4" style={{ flex: 'none', marginTop: 3 }} />
          <div>{shownError}</div>
        </div>
      )}

      {selectedFile ? (
        <div className="workflow-card">
          <div className="wf-row">
            <div className="wf-fileicon">PDF</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }} className="truncate">{selectedFile.name}</div>
              <div className="wf-small wf-muted">
                {(selectedFile.size / 1048576).toFixed(2)} MB · {fileBase64 ? 'Ready to extract' : 'Reading file…'}
              </div>
            </div>
            <button type="button" className="icon-button" aria-label="Remove file" onClick={handleClear}>
              <X className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="workflow-primary-button"
              disabled={!fileBase64}
              onClick={() => fileBase64 && onAnalyzePdf(fileBase64, selectedFile.name)}
            >
              Extract events
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`wf-drop ${dragActive ? 'over' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="wf-drop-icon"><UploadCloud className="w-5 h-5" /></div>
          <h2 className="wf-h2" style={{ fontSize: 17 }}>Drop a PDF here</h2>
          <p className="wf-muted" style={{ margin: '2px 0 16px' }}>
            Syllabi, schedules, assignment sheets, event flyers
          </p>
          <button type="button" className="workflow-primary-button btn-lg" onClick={() => fileInputRef.current?.click()}>
            Browse files
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
          <p className="wf-small wf-muted" style={{ margin: '14px 0 0' }}>PDF only · up to 25 MB</p>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '20px 0 0' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <LinkIcon className="w-4 h-4 wf-muted" style={{ position: 'absolute', left: 10, top: 9 }} />
          <input
            type="url"
            className="wf-input"
            style={{ paddingLeft: 32 }}
            value={websiteUrl}
            disabled={Boolean(selectedFile)}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleFetchWebsite()}
            placeholder="Or paste a link to a syllabus page or PDF"
            aria-label="Syllabus URL"
          />
        </div>
        <button
          type="button"
          className="workflow-secondary-button"
          disabled={!websiteUrl.trim() || Boolean(selectedFile)}
          onClick={() => void handleFetchWebsite()}
        >
          Extract from link
        </button>
      </div>

      <p className="wf-small wf-muted" style={{ margin: '14px 0 0' }}>
        No file handy?{' '}
        <button type="button" onClick={onLoadSample} style={{ color: 'var(--workflow-accent)', background: 'none', border: 0, padding: 0, font: 'inherit' }}>
          Try a sample syllabus
        </button>
      </p>
    </div>
  );
};