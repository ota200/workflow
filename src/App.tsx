import React, { useEffect, useState } from 'react';
import { ArrowRight, BrainCircuit, BookOpen, Calendar, CalendarDays, CheckCircle2, FileStack, LayoutDashboard, Settings, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import { SyllabusAnalysisResult } from './types/syllabus';
import { sampleSyllabusData } from './utils/sampleData';
import { PdfUploader } from './components/PdfUploader';
import { JsonViewerModal } from './components/JsonViewerModal';
import { CalendarPreviewModal, CalendarTimeline, downloadIcs } from './components/CalendarPreviewModal';
import { ClassWorkspace } from './components/ClassWorkspace';
import { RevisionDashboard } from './components/RevisionDashboard';

type View = 'dashboard' | 'documents' | 'calendar' | 'revision' | 'settings';
type Item = SyllabusAnalysisResult['items'][number];

const STORAGE_KEY = 'workflow-course-workspace';
const DOCUMENTS_KEY = 'workflow-documents';
const ACTIVE_DOCUMENT_KEY = 'workflow-active-document';
const SETTINGS_KEY = 'workflow-settings';

const withReviewDefaults = (items: Item[]) =>
  items.map((item) => ({
    ...item,
    prepingInfo: item.prepingInfo || { id: `prep-${item.id}`, duration: '', summary: '', milestones: [] },
    reviewStatus: item.reviewStatus || (item.confidence === 'low' ? 'needs-review' : 'reviewed'),
    includeInExport: item.includeInExport !== false,
  }));

const NAV: Array<[View, string, React.ComponentType<{ className?: string }>]> = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['documents', 'My Documents', FileStack],
  ['calendar', 'Calendar Preview', Calendar],
  ['revision', 'Revision', BookOpen],
  ['settings', 'Settings', Settings],
];

const STEPS = ['Upload', 'Extract', 'Review', 'Export'];
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const isView = (value: string): value is View => ['dashboard', 'documents', 'calendar', 'revision', 'settings'].includes(value);

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!API_BASE_URL && window.location.hostname.endsWith('github.io')) {
    throw new Error('Document analysis needs a configured API service. Set VITE_API_BASE_URL to your deployed server and rebuild.');
  }
  return fetch(`${API_BASE_URL}${path}`, init);
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="wf-steps" aria-label="Workflow progress">
      {STEPS.map((step, i) => (
        <div key={step} className={`wf-step ${i === current ? 'on' : i < current ? 'done' : ''}`}>
          <b>{i < current ? '✓' : i + 1}</b>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [syllabusData, setSyllabusData] = useState<SyllabusAnalysisResult | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as SyllabusAnalysisResult) : null;
    } catch {
      return null;
    }
  });
  const [documents, setDocuments] = useState<SyllabusAnalysisResult[]>(() => {
    try {
      const saved = localStorage.getItem(DOCUMENTS_KEY);
      if (saved) return JSON.parse(saved) as SyllabusAnalysisResult[];
      const active = localStorage.getItem(STORAGE_KEY);
      return active ? [JSON.parse(active) as SyllabusAnalysisResult] : [];
    } catch {
      return [];
    }
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourcePdf, setSourcePdf] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.slice(1);
    return isView(hash) ? hash : 'dashboard';
  });
  const [includePrep, setIncludePrep] = useState<boolean>(() => {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').includePrep !== false;
    } catch {
      return true;
    }
  });

  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [isCalendarPreviewOpen, setIsCalendarPreviewOpen] = useState(false);
  const [showDocumentUploader, setShowDocumentUploader] = useState(false);
  const [isExportStep, setIsExportStep] = useState(false);
  const [showLanding, setShowLanding] = useState(() => !syllabusData);

  useEffect(() => {
    const syncViewFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (isView(hash) && hash !== view) setView(hash);
    };
    window.addEventListener('hashchange', syncViewFromHash);
    if (window.location.hash !== `#${view}`) window.history.replaceState(null, '', `#${view}`);
    return () => window.removeEventListener('hashchange', syncViewFromHash);
  }, [view]);

  const save = (data: SyllabusAnalysisResult) => {
    const savedData = { ...data, id: data.id || `${Date.now()}-${data.sourceDocument || 'document'}` };
    setSyllabusData(savedData);
    setShowLanding(false);
    setIsExportStep(false);
    if (savedData.id) localStorage.setItem(ACTIVE_DOCUMENT_KEY, savedData.id);
    setDocuments((current) => {
      const next = [savedData, ...current.filter((entry) => entry.id !== savedData.id)].slice(0, 20);
      localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(next));
      return next;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
  };

  const handleAnalyzePdf = async (base64Data: string, filename: string) => {
    setIsAnalyzing(true);
    setError(null);
    setSourcePdf(base64Data);

    try {
      const response = await apiFetch('/api/analyze-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64Data, filename }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || result.error || 'Failed to analyze PDF with Gemini API');
      }
      if (result.data && Array.isArray(result.data.items)) {
        save({
          ...result.data,
          analyzedAt: new Date().toISOString(),
          sourceDocument: filename,
          items: withReviewDefaults(result.data.items),
        });
      } else {
        const keys = result.data && typeof result.data === 'object' ? Object.keys(result.data).join(', ') : 'none';
        throw new Error(`Gemini returned no items array (received keys: ${keys}).`);
      }
    } catch (err: any) {
      console.error('Analysis error:', err);
      setError(err?.message || 'We couldn’t read this document. Check the file and try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeWebsite = async (url: string) => {
    setIsAnalyzing(true);
    setError(null);
    setSourcePdf(null);

    try {
      const scrapeResponse = await apiFetch('/api/scrape-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const scraped = await scrapeResponse.json();
      if (!scrapeResponse.ok) {
        throw new Error(scraped.message || scraped.error || 'Unable to scrape website.');
      }

      const analyzeResponse = await apiFetch('/api/analyze-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentText: scraped.text,
          filename: scraped.title || url,
          sourceUrl: scraped.sourceUrl || url,
        }),
      });
      const result = await analyzeResponse.json();
      if (!analyzeResponse.ok) {
        throw new Error(result.message || result.error || 'Failed to analyze website content.');
      }
      if (result.data && Array.isArray(result.data.items)) {
        save({
          ...result.data,
          analyzedAt: new Date().toISOString(),
          sourceDocument: scraped.title || url,
          items: withReviewDefaults(result.data.items),
        });
      } else {
        const keys = result.data && typeof result.data === 'object' ? Object.keys(result.data).join(', ') : 'none';
        throw new Error(`Website analysis returned no items array (received keys: ${keys}).`);
      }
    } catch (err: any) {
      console.error('Website analysis error:', err);
      setError(err?.message || 'Error scraping or analyzing the website.');
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGeneratePrep = async (item: Item) => {
    const response = await apiFetch('/api/generate-prep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentKey: syllabusData?.id || syllabusData?.sourceDocument || 'active-document',
        event: item,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.data) throw new Error(result.message || result.error || 'Unable to generate a study plan.');
    save({
      ...syllabusData!,
      items: syllabusData!.items.map((entry) => entry.id === item.id ? { ...entry, prepingInfo: result.data } : entry),
    });
  };

  const handleLoadSample = () => {
    setError(null);
    save({
      ...sampleSyllabusData,
      analyzedAt: new Date().toISOString(),
      sourceDocument: 'sample-syllabus.pdf',
      id: `sample-${Date.now()}`,
    });
    setView('dashboard');
  };

  const handleReset = () => {
    if (!window.confirm('Remove this course and its saved events? This cannot be undone.')) return;
    const currentId = syllabusData?.id;
    const remaining = currentId ? documents.filter((document) => document.id !== currentId) : documents;
    setDocuments(remaining);
    setSyllabusData(null);
    setError(null);
    setSourcePdf(null);
    setView('dashboard');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_DOCUMENT_KEY);
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(remaining));
    setIsExportStep(false);
    setShowDocumentUploader(false);
  };

  const handleStartNewDocument = () => {
    setSyllabusData(null);
    setError(null);
    setSourcePdf(null);
    setIsExportStep(false);
    setShowDocumentUploader(false);
    setShowLanding(false);
    setView('dashboard');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_DOCUMENT_KEY);
  };

  const handleOpenNewDocumentUploader = () => {
    setSyllabusData(null);
    setError(null);
    setSourcePdf(null);
    setIsExportStep(false);
    setShowLanding(false);
    setShowDocumentUploader(true);
    setView('documents');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_DOCUMENT_KEY);
  };

  const openDocument = (document: SyllabusAnalysisResult) => {
    setSyllabusData(document);
    setIsExportStep(false);
    setSourcePdf(null);
    if (document.id) {
      localStorage.setItem(ACTIVE_DOCUMENT_KEY, document.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    }
    setView('dashboard');
  };

  const updateDocument = (documentId: string, data: SyllabusAnalysisResult) => {
    const savedData = { ...data, id: data.id || documentId };
    setDocuments((current) => {
      const next = current.map((entry) => entry.id === documentId || entry.sourceDocument === documentId ? savedData : entry);
      localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(next));
      return next;
    });
    if (syllabusData?.id === documentId || syllabusData?.sourceDocument === documentId) {
      setSyllabusData(savedData);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
    }
  };

  const toggleIncludePrep = (value: boolean) => {
    setIncludePrep(value);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ includePrep: value }));
  };

  const needsReview = syllabusData
    ? syllabusData.items.filter((i) => (i.reviewStatus || (i.confidence === 'low' ? 'needs-review' : 'reviewed')) === 'needs-review').length
    : 0;

  const EmptyState = ({ text }: { text: string }) => (
    <div className="workflow-card wf-empty">
      <p style={{ margin: '0 0 14px' }}>{text}</p>
      <button type="button" className="workflow-primary-button" onClick={() => { setShowLanding(false); setView('dashboard'); }}>
        Upload a PDF
      </button>
    </div>
  );

  return (
    <div className="workflow-shell">
      <aside className="workflow-sidebar" aria-label="Primary navigation">
        <div className="workflow-logo">
          <span className="workflow-logo-mark"><CheckCircle2 className="w-3.5 h-3.5" /></span>
          Workflow
        </div>
        {NAV.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            className={`workflow-nav-item ${view === key ? 'active' : ''}`}
            aria-current={view === key ? 'page' : undefined}
            onClick={() => setView(key)}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </aside>

      <div className="workflow-content">
        <div className="workflow-mobilebar">
          <span className="workflow-logo-mark"><CheckCircle2 className="w-3.5 h-3.5" /></span>
          Workflow
        </div>

        <main className="workflow-main">
          {view === 'dashboard' && !syllabusData && showLanding && (
            <section className="wf-landing" aria-labelledby="landing-title">
              <div className="wf-landing-glow wf-landing-glow-one" />
              <div className="wf-landing-glow wf-landing-glow-two" />
              <div className="wf-landing-copy">
                <div className="wf-landing-eyebrow"><Sparkles className="w-4 h-4" /> Your academic command center</div>
                <h1 id="landing-title">Turn a syllabus into a plan you can actually follow.</h1>
                <p>
                  Workflow reads the dates hiding in your course documents, turns them into a clear schedule,
                  and gives you a calendar you can take anywhere.
                </p>
                <div className="wf-landing-actions">
                  <button type="button" className="workflow-primary-button btn-lg" onClick={() => setShowLanding(false)}>
                    Bring in a document <ArrowRight className="w-4 h-4" />
                  </button>
                  <button type="button" className="workflow-secondary-button btn-lg" onClick={handleLoadSample}>
                    Explore a sample
                  </button>
                </div>
                <div className="wf-landing-trust">
                  <span><ShieldCheck className="w-4 h-4" /> Review before export</span>
                  <span><UploadCloud className="w-4 h-4" /> PDF or web link</span>
                  <span><CalendarDays className="w-4 h-4" /> Works with any calendar</span>
                </div>
              </div>
              <div className="wf-landing-preview" aria-label="Preview of an organized course schedule">
                <div className="wf-preview-orbit orbit-one" />
                <div className="wf-preview-orbit orbit-two" />
                <div className="wf-preview-card wf-preview-card-main">
                  <div className="wf-preview-topline"><span className="wf-preview-dot" /> Fall semester plan <span className="wf-tag accent">Live</span></div>
                  <div className="wf-preview-date">October <strong>2026</strong></div>
                  <div className="wf-preview-calendar">
                    {['M', 'T', 'W', 'T', 'F'].map((day) => <span key={day}>{day}</span>)}
                    {['12', '13', '14', '15', '16', '19', '20', '21', '22', '23'].map((day, index) => (
                      <b key={day} className={index === 3 ? 'selected' : index === 6 ? 'accented' : ''}>{day}</b>
                    ))}
                  </div>
                  <div className="wf-preview-event"><span className="wf-preview-event-bar" /><div><strong>Midterm exam</strong><small>Thu, Oct 15 · 10:00 AM</small></div><CheckCircle2 className="w-4 h-4" /></div>
                  <div className="wf-preview-event"><span className="wf-preview-event-bar green" /><div><strong>Project milestone</strong><small>Tue, Oct 20 · Due</small></div><CheckCircle2 className="w-4 h-4" /></div>
                </div>
                <div className="wf-preview-card wf-preview-card-float">
                  <div className="wf-float-icon"><BrainCircuit className="w-4 h-4" /></div>
                  <div><small>Extracted from your syllabus</small><strong>18 important dates</strong></div>
                  <span className="wf-tag ok">Ready</span>
                </div>
              </div>
              <div className="wf-landing-features">
                {[
                  [FileStack, 'One clear source', 'Keep every syllabus and course document organized in one place.'],
                  [BrainCircuit, 'Thoughtful extraction', 'Find deadlines, exams, meetings, and the details around them.'],
                  [Calendar, 'Ready when you are', 'Review every event, then export a clean calendar in one click.'],
                ].map(([Icon, title, text]) => (
                  <div className="wf-landing-feature" key={title as string}>
                    <span className="wf-landing-feature-icon"><Icon className="w-4 h-4" /></span>
                    <div><strong>{title as string}</strong><p>{text as string}</p></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {view === 'dashboard' && !syllabusData && !showLanding && (
            <>
              <h1 className="wf-h1">Turn documents into your schedule.</h1>
              <p className="wf-sub">
                Upload a PDF and Workflow finds the deadlines, exams and classes in it. You check them,
                then download one calendar file for Google, Apple or Outlook.
              </p>
              <Stepper current={0} />
              <PdfUploader
                onAnalyzePdf={handleAnalyzePdf}
                onAnalyzeWebsite={handleAnalyzeWebsite}
                onLoadSample={handleLoadSample}
                isAnalyzing={isAnalyzing}
                error={error}
              />
            </>
          )}

          {view === 'dashboard' && syllabusData && (
            <>
              <Stepper current={isExportStep ? 3 : 2} />
              {isExportStep ? (
                <div className="workflow-card" style={{ padding: 24, maxWidth: 760 }}>
                  <p className="wf-small wf-muted" style={{ margin: 0 }}>Step 4 of 4</p>
                  <h1 className="wf-h1" style={{ marginTop: 6 }}>Ready to export</h1>
                  <p className="wf-sub">
                    Your reviewed events are saved locally. Download the calendar now, continue editing, or start another document.
                  </p>
                  <div className="wf-row" style={{ padding: '14px 0', justifyContent: 'space-between' }}>
                    <span>Events selected for export</span>
                    <strong>{syllabusData.items.filter((item) => item.includeInExport !== false && item.dueDate).length}</strong>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                    <button
                      type="button"
                      className="workflow-primary-button"
                      disabled={!syllabusData.items.some((item) => item.includeInExport !== false && item.dueDate)}
                      onClick={() => downloadIcs(syllabusData, includePrep)}
                    >
                      Download calendar (.ics)
                    </button>
                    <button type="button" className="workflow-secondary-button" onClick={() => setIsExportStep(false)}>
                      Back to review
                    </button>
                    <button type="button" className="workflow-secondary-button" onClick={handleOpenNewDocumentUploader}>
                      Upload new document
                    </button>
                    <button type="button" className="workflow-primary-button" onClick={handleOpenNewDocumentUploader}>
                      Finish
                    </button>
                    <button type="button" className="wf-ghost-button danger" onClick={handleReset}>
                      Cancel this document
                    </button>
                  </div>
                </div>
              ) : null}
              {showDocumentUploader && (
                <div className="workflow-card" style={{ padding: 16, marginBottom: 16 }}>
                  <div className="wf-row" style={{ justifyContent: 'space-between', padding: '0 0 14px' }}>
                    <div>
                      <h2 className="wf-h2">Add another document</h2>
                      <p className="wf-small wf-muted" style={{ margin: '4px 0 0' }}>
                        Your current document is saved locally. The new document will become the active workspace.
                      </p>
                    </div>
                    <button type="button" className="wf-ghost-button" onClick={() => setShowDocumentUploader(false)}>Close</button>
                  </div>
                  <PdfUploader
                    onAnalyzePdf={async (...args) => { await handleAnalyzePdf(...args); setShowDocumentUploader(false); }}
                    onAnalyzeWebsite={async (url) => { await handleAnalyzeWebsite(url); setShowDocumentUploader(false); }}
                    onLoadSample={handleLoadSample}
                    isAnalyzing={isAnalyzing}
                    error={error}
                  />
                </div>
              )}
              {!isExportStep && <ClassWorkspace
                data={syllabusData}
                pdfData={sourcePdf || undefined}
                onChange={save}
                onOpenJson={() => setIsJsonModalOpen(true)}
                onOpenCalendar={() => setIsCalendarPreviewOpen(true)}
                onAddDocument={handleStartNewDocument}
                onFinish={() => setIsExportStep(true)}
                onReset={handleReset}
                onGeneratePrep={handleGeneratePrep}
              />}
            </>
          )}

          {view === 'documents' && (
            <>
              <div className="wf-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <h1 className="wf-h1">My documents</h1>
                  <p className="wf-sub" style={{ marginBottom: 0 }}>Every PDF or website syllabus you’ve converted, with its status.</p>
                </div>
                <button type="button" className="workflow-primary-button" onClick={() => {
                  if (showDocumentUploader) {
                    setShowDocumentUploader(false);
                  } else {
                    handleOpenNewDocumentUploader();
                  }
                }}>
                  {showDocumentUploader ? 'Close uploader' : 'Add new document'}
                </button>
              </div>
              {showDocumentUploader && (
                <div className="workflow-card" style={{ padding: 16, marginBottom: 16 }}>
                  <PdfUploader
                    onAnalyzePdf={async (...args) => { await handleAnalyzePdf(...args); setShowDocumentUploader(false); }}
                    onAnalyzeWebsite={async (url) => { await handleAnalyzeWebsite(url); setShowDocumentUploader(false); }}
                    onLoadSample={handleLoadSample}
                    isAnalyzing={isAnalyzing}
                    error={error}
                  />
                </div>
              )}
              {documents.length ? (
                <div className="workflow-card">
                  {documents.map((document) => {
                    const documentNeedsReview = document.items.filter((item) => item.reviewStatus === 'needs-review').length;
                    return (
                      <div className="wf-row" key={document.id || document.sourceDocument}>
                        <div className="wf-fileicon">{document.sourceDocument?.startsWith('http') ? 'WEB' : 'PDF'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }} className="truncate">
                            {document.sourceDocument || document.courseName || 'Untitled document'}
                          </div>
                          <div className="wf-small wf-muted">
                            {document.items.length} events
                            {document.analyzedAt ? ` · ${new Date(document.analyzedAt).toLocaleDateString()}` : ''}
                          </div>
                        </div>
                        <span className={`wf-tag ${documentNeedsReview ? 'warn' : 'ok'}`}>
                          {documentNeedsReview ? `${documentNeedsReview} need review` : 'Reviewed'}
                        </span>
                        <button type="button" className="workflow-secondary-button" onClick={() => openDocument(document)}>
                          Open
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="No documents yet. Upload your first PDF to see it here." />
              )}
            </>
          )}

          {view === 'calendar' && (
            <>
              <h1 className="wf-h1">Calendar preview</h1>
              <p className="wf-sub">Upcoming events from your imported document, in date order.</p>
              {syllabusData ? (
                <div className="workflow-card" style={{ padding: 16 }}>
                  <CalendarTimeline data={syllabusData} includePrep={includePrep} onChange={save} />
                </div>
              ) : (
                <EmptyState text="Nothing to preview yet. Upload a PDF to see its events." />
              )}
            </>
          )}

          {view === 'revision' && (
            <RevisionDashboard
              documents={documents}
              onChange={updateDocument}
              onOpenDocument={(document) => openDocument(document)}
            />
          )}

          {view === 'settings' && (
            <>
              <h1 className="wf-h1">Settings</h1>
              <p className="wf-sub">Defaults used when you export.</p>
              <div className="workflow-card" style={{ maxWidth: 520, padding: 16 }}>
                <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includePrep}
                    onChange={(e) => toggleIncludePrep(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ fontWeight: 500, display: 'block' }}>Include prep and study blocks</span>
                    <span className="wf-small wf-muted">
                      Adds “prep starts” and study-block events to the .ics file alongside due dates.
                    </span>
                  </span>
                </label>
              </div>
            </>
          )}
        </main>

        <JsonViewerModal
          isOpen={isJsonModalOpen}
          onClose={() => setIsJsonModalOpen(false)}
          data={syllabusData}
        />
        <CalendarPreviewModal
          isOpen={isCalendarPreviewOpen}
          onClose={() => setIsCalendarPreviewOpen(false)}
          data={syllabusData}
          includePrep={includePrep}
          onChange={save}
        />
      </div>
    </div>
  );
}