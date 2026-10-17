import React, { useState } from 'react';
import {
  Calendar,
  Sparkles,
  FileText,
  Clock,
  Download,
  FileCode,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  BookOpen,
  LayoutDashboard,
  FileStack,
  Settings,
} from 'lucide-react';
import { SyllabusAnalysisResult } from './types/syllabus';
import { sampleSyllabusData } from './utils/sampleData';
import { PdfUploader } from './components/PdfUploader';
import { SyllabusSummaryCard } from './components/SyllabusSummaryCard';
import { SyllabusItemList } from './components/SyllabusItemList';
import { JsonViewerModal } from './components/JsonViewerModal';
import { CalendarPreviewModal } from './components/CalendarPreviewModal';
import { CourseKeyInfoCard } from './components/CourseKeyInfoCard';
import { ClassWorkspace } from './components/ClassWorkspace';

export default function App() {
  const [syllabusData, setSyllabusData] = useState<SyllabusAnalysisResult | null>(() => {
    try {
      const saved = localStorage.getItem('workflow-course-workspace');
      return saved ? JSON.parse(saved) as SyllabusAnalysisResult : null;
    } catch {
      return null;
    }
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourcePdf, setSourcePdf] = useState<string | null>(null);

  // Modals
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [isCalendarPreviewOpen, setIsCalendarPreviewOpen] = useState(false);

  const handleAnalyzePdf = async (base64Data: string, filename: string) => {
    setIsAnalyzing(true);
    setError(null);
    setSourcePdf(base64Data);

    try {
      const response = await fetch('/api/analyze-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pdfBase64: base64Data,
          filename,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || 'Failed to analyze PDF with Gemini API');
      }

      if (result.data && Array.isArray(result.data.items)) {
        const analyzedData = {
          ...result.data,
          analyzedAt: new Date().toISOString(),
          sourceDocument: filename,
          items: result.data.items.map((item: SyllabusAnalysisResult['items'][number]) => ({
            ...item,
            reviewStatus: item.reviewStatus || (item.confidence === 'low' ? 'needs-review' : 'reviewed'),
            includeInExport: item.includeInExport !== false,
          })),
        };
        setSyllabusData(analyzedData);
        localStorage.setItem('workflow-course-workspace', JSON.stringify(analyzedData));
      } else {
        throw new Error('Invalid response structure received from Gemini API.');
      }
    } catch (err: any) {
      console.error('Analysis error:', err);
      setError(err?.message || 'Error communicating with Gemini API. Please check your document and try again.');
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
        const analyzedData = {
          ...result.data,
          analyzedAt: new Date().toISOString(),
          sourceDocument: scraped.title || url,
          items: result.data.items.map((item: SyllabusAnalysisResult['items'][number]) => ({
            ...item,
            reviewStatus: item.reviewStatus || (item.confidence === 'low' ? 'needs-review' : 'reviewed'),
            includeInExport: item.includeInExport !== false,
          })),
        };
        setSyllabusData(analyzedData);
        localStorage.setItem('workflow-course-workspace', JSON.stringify(analyzedData));
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
    setSyllabusData({ ...sampleSyllabusData, analyzedAt: new Date().toISOString(), sourceDocument: 'sample-syllabus.pdf' });
  };

  const handleReset = () => {
    setSyllabusData(null);
    setError(null);
    setSourcePdf(null);
    localStorage.removeItem('workflow-course-workspace');
  };

  const handleWorkspaceChange = (nextData: SyllabusAnalysisResult) => {
    setSyllabusData(nextData);
    localStorage.setItem('workflow-course-workspace', JSON.stringify(nextData));
  };

  return (
    <div className="workflow-shell">
      <aside className="workflow-sidebar" aria-label="Primary navigation">
        <div className="workflow-logo">
          <span className="workflow-logo-mark"><CheckCircle2 className="w-3.5 h-3.5" /></span>
          Workflow
        </div>
        <button className="workflow-nav-item active" type="button">
          <LayoutDashboard className="w-4 h-4" />
          Dashboard
        </button>
        <button className="workflow-nav-item" type="button">
          <FileStack className="w-4 h-4" />
          My Documents
        </button>
        <button
          className={`workflow-nav-item ${syllabusData ? 'active' : ''}`}
          type="button"
          onClick={() => syllabusData && setIsCalendarPreviewOpen(true)}
        >
          <Calendar className="w-4 h-4" />
          Calendar Preview
        </button>
        <button className="workflow-nav-item" type="button">
          <Settings className="w-4 h-4" />
          Settings
        </button>
        <div className="workflow-profile">
          <div className="workflow-avatar">AI</div>
          <div>
            <div className="text-sm font-medium">Personal</div>
            <div className="text-xs text-slate-500">Calendar workspace</div>
          </div>
        </div>
      </aside>

      <div className="workflow-content">
      {/* Header */}
      <header className="workflow-header border-b border-slate-800 bg-slate-900/70 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-sm sm:text-base text-white tracking-tight">
                  Syllabus &amp; Exam Prep AI
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950 border border-blue-800 text-blue-300 font-medium">
                  Gemini 3.8 Flash
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Extract assignments, exams, weights &amp; export iCal (.ics) + JSON
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {syllabusData ? (
              <>
                <button
                  onClick={() => setIsCalendarPreviewOpen(true)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Calendar className="w-3.5 h-3.5 text-purple-400" />
                  <span className="hidden sm:inline">Timeline Preview</span>
                </button>

                <button
                  onClick={() => setIsJsonModalOpen(true)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5 text-blue-400" />
                  <span className="hidden sm:inline">View JSON</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleLoadSample}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                <span>Load Sample Syllabus</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="workflow-main flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {!syllabusData ? (
          <div className="space-y-8 max-w-3xl mx-auto py-6">
            {/* Hero text */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/80 border border-blue-800/80 text-blue-300 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>Automated Course Schedule &amp; Study Prep Intelligence</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Turn your course syllabus into an actionable study calendar
              </h2>
              <p className="text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
                Upload any syllabus PDF. Gemini AI extracts every exam, assignment, due date, grading weight, and generates a personalized preparation plan with milestone study blocks downloadable as <strong className="text-slate-200">.ics</strong> and <strong className="text-slate-200">JSON</strong>.
              </p>
            </div>

            {/* Uploader Component */}
            <PdfUploader
              onAnalyzePdf={handleAnalyzePdf}
              onAnalyzeWebsite={handleAnalyzeWebsite}
              onLoadSample={handleLoadSample}
              isAnalyzing={isAnalyzing}
              error={error}
            />

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
              <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <FileText className="w-4 h-4 text-blue-400" />
                  <span>Precise Extraction</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Extracts item ID, title, type (assignment, exam, quiz, project), exact due date, and grading weight percentage.
                </p>
              </div>

              <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Clock className="w-4 h-4 text-purple-400" />
                  <span>Smart Prep Recommendations</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Generates preparation duration, strategic study summaries, prep start dates, and progressive milestones.
                </p>
              </div>

              <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  <span>iCal (.ics) &amp; JSON Export</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  One-click export directly into Google Calendar, Apple Calendar, and Outlook, or programmatic JSON for your apps.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2" aria-label="Workflow progress">
              {['Upload', 'Extract', 'Review', 'Export'].map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-800/70 bg-emerald-950/30 text-xs text-emerald-300"
                >
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white grid place-items-center text-[10px] font-bold">
                    {index < 2 ? '✓' : index + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>

            <ClassWorkspace
              data={syllabusData}
              pdfData={sourcePdf || undefined}
              onChange={handleWorkspaceChange}
              onOpenJson={() => setIsJsonModalOpen(true)}
              onReset={handleReset}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Syllabus &amp; Exam Prep AI • Built with React 19 &amp; Gemini 3.8 Flash</span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span>Import .ics files directly into Google Calendar, Apple Calendar, or Outlook</span>
          </div>
        </div>
      </footer>

      {/* JSON Viewer Modal */}
      <JsonViewerModal
        isOpen={isJsonModalOpen}
        onClose={() => setIsJsonModalOpen(false)}
        data={syllabusData}
      />

      {/* Calendar Timeline Preview Modal */}
      <CalendarPreviewModal
        isOpen={isCalendarPreviewOpen}
        onClose={() => setIsCalendarPreviewOpen(false)}
        data={syllabusData}
      />
      </div>
    </div>
  );
}
