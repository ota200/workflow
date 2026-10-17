import React, { useState } from 'react';
import { Calendar, CheckCircle2, FileStack, LayoutDashboard, Settings } from 'lucide-react';
import { SyllabusAnalysisResult } from './types/syllabus';
import { sampleSyllabusData } from './utils/sampleData';
import { PdfUploader } from './components/PdfUploader';
import { JsonViewerModal } from './components/JsonViewerModal';
import { CalendarPreviewModal } from './components/CalendarPreviewModal';
import { ClassWorkspace } from './components/ClassWorkspace';

type View = 'dashboard' | 'documents' | 'calendar' | 'settings';
type Item = SyllabusAnalysisResult['items'][number];

const STORAGE_KEY = 'workflow-course-workspace';
const SETTINGS_KEY = 'workflow-settings';

const withReviewDefaults = (items: Item[]) =>
  items.map((item) => ({
    ...item,
    reviewStatus: item.reviewStatus || (item.confidence === 'low' ? 'needs-review' : 'reviewed'),
    includeInExport: item.includeInExport !== false,
  }));

const NAV: Array<[View, string, React.ComponentType<{ className?: string }>]> = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['documents', 'My Documents', FileStack],
  ['calendar', 'Calendar Preview', Calendar],
  ['settings', 'Settings', Settings],
];

const STEPS = ['Upload', 'Extract', 'Review', 'Export'];

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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourcePdf, setSourcePdf] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [includePrep, setIncludePrep] = useState<boolean>(() => {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').includePrep !== false;
    } catch {
      return true;
    }
  });

  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [isCalendarPreviewOpen, setIsCalendarPreviewOpen] = useState(false);

  const save = (data: SyllabusAnalysisResult) => {
    setSyllabusData(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const handleAnalyzePdf = async (base64Data: string, filename: string) => {
    setIsAnalyzing(true);
    setError(null);
    setSourcePdf(base64Data);

    try {
      const response = await fetch('/api/analyze-pdf', {
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
        throw new Error('Invalid response structure received from Gemini API.');
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
      const scrapeResponse = await fetch('/api/scrape-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const scraped = await scrapeResponse.json();
      if (!scrapeResponse.ok) {
        throw new Error(scraped.message || scraped.error || 'Unable to scrape website.');
      }

      const analyzeResponse = await fetch('/api/analyze-pdf', {
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
        throw new Error('Invalid response structure received from website analysis.');
      }
    } catch (err: any) {
      console.error('Website analysis error:', err);
      setError(err?.message || 'Error scraping or analyzing the website.');
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLoadSample = () => {
    setError(null);
    setSyllabusData({
      ...sampleSyllabusData,
      analyzedAt: new Date().toISOString(),
      sourceDocument: 'sample-syllabus.pdf',
    });
  };

  const handleReset = () => {
    setSyllabusData(null);
    setError(null);
    setSourcePdf(null);
    setView('dashboard');
    localStorage.removeItem(STORAGE_KEY);
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
      <button type="button" className="workflow-primary-button" onClick={() => setView('dashboard')}>
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
        <div className="workflow-profile">
          <div className="workflow-avatar">ME</div>
          <div>
            <div style={{ fontWeight: 500 }}>Personal</div>
            <div className="wf-small wf-muted">Calendar workspace</div>
          </div>
        </div>
      </aside>

      <div className="workflow-content">
        <div className="workflow-mobilebar">
          <span className="workflow-logo-mark"><CheckCircle2 className="w-3.5 h-3.5" /></span>
          Workflow
        </div>

        <main className="workflow-main">
          {view === 'dashboard' && !syllabusData && (
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
              <Stepper current={2} />
              <ClassWorkspace
                data={syllabusData}
                pdfData={sourcePdf || undefined}
                onChange={save}
                onOpenJson={() => setIsJsonModalOpen(true)}
                onOpenCalendar={() => setIsCalendarPreviewOpen(true)}
                onReset={handleReset}
              />
            </>
          )}

          {view === 'documents' && (
            <>
              <h1 className="wf-h1">My documents</h1>
              <p className="wf-sub">Every PDF you’ve converted, with its status.</p>
              {syllabusData ? (
                <div className="workflow-card">
                  <div className="wf-row">
                    <div className="wf-fileicon">PDF</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }} className="truncate">
                        {syllabusData.sourceDocument || syllabusData.courseName || 'Untitled document'}
                      </div>
                      <div className="wf-small wf-muted">
                        {syllabusData.items.length} events
                        {syllabusData.analyzedAt ? ` · ${new Date(syllabusData.analyzedAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <span className={`wf-tag ${needsReview ? 'warn' : 'ok'}`}>
                      {needsReview ? `${needsReview} need review` : 'Reviewed'}
                    </span>
                    <button type="button" className="workflow-secondary-button" onClick={() => setView('dashboard')}>
                      Open
                    </button>
                  </div>
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
                <div className="workflow-card">
                  <p style={{ margin: '0 0 14px' }}>
                    Preview your imported events and export them to your calendar.
                  </p>
                  <button
                    type="button"
                    className="workflow-primary-button"
                    onClick={() => setIsCalendarPreviewOpen(true)}
                  >
                    Open calendar preview
                  </button>
                </div>
              ) : (
                <EmptyState text="Nothing to preview yet. Upload a PDF to see its events." />
              )}
            </>
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
        />
      </div>
    </div>
  );
}