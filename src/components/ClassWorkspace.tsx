import React, { useMemo, useState } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { SyllabusAnalysisResult, SyllabusItem } from '../types/syllabus';
import { downloadFile, generateIcsCalendar } from '../utils/calendarExport';

interface ClassWorkspaceProps {
  data: SyllabusAnalysisResult;
  onChange: (data: SyllabusAnalysisResult) => void;
  onOpenJson: () => void;
  onReset: () => void;
  pdfData?: string;
}

type WorkspaceTab = 'overview' | 'calendar' | 'assignments' | 'documents' | 'details';

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-indigo-400';

function statusFor(item: SyllabusItem) {
  return item.reviewStatus || (item.confidence === 'low' ? 'needs-review' : 'reviewed');
}

export const ClassWorkspace: React.FC<ClassWorkspaceProps> = ({ data, onChange, onOpenJson, onReset, pdfData }) => {
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(data.items[0]?.id || null);
  const [sourcePage, setSourcePage] = useState(1);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<string[]>(['Ask me to find, review, or update an event.']);
  const [lastDeleted, setLastDeleted] = useState<SyllabusItem | null>(null);

  const update = (items: SyllabusItem[]) => onChange({ ...data, items, analyzedAt: data.analyzedAt || new Date().toISOString() });
  const selected = data.items.find((item) => item.id === selectedId) || data.items[0];
  const visibleItems = useMemo(() => data.items.filter((item) => {
    const matchesQuery = `${item.title} ${item.type} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'review' ? statusFor(item) === 'needs-review' : item.type.toLowerCase() === filter);
    return matchesQuery && matchesFilter;
  }), [data.items, filter, query]);

  const editItem = (id: string, patch: Partial<SyllabusItem>) => {
    update(data.items.map((item) => item.id === id ? { ...item, ...patch, reviewStatus: 'reviewed' } : item));
  };

  const addEvent = () => {
    const item: SyllabusItem = {
      id: `event-${Date.now()}`, title: 'New event', type: 'assignment', dueDate: '', weight: '',
      description: '', sourcePage: undefined, reviewStatus: 'needs-review', includeInExport: true,
      prepingInfo: { id: `prep-${Date.now()}`, duration: '', summary: '' },
    };
    update([item, ...data.items]);
    setSelectedId(item.id);
    setTab('assignments');
  };

  const deleteEvent = (id: string) => {
    const item = data.items.find((entry) => entry.id === id);
    if (item) setLastDeleted(item);
    update(data.items.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateEvent = (item: SyllabusItem) => {
    const copy = { ...item, id: `event-${Date.now()}`, title: `${item.title} (copy)`, reviewStatus: 'needs-review' };
    update([copy, ...data.items]);
    setSelectedId(copy.id);
  };

  const sendChat = () => {
    const request = chatInput.trim();
    if (!request) return;
    const lower = request.toLowerCase();
    const target = data.items.find((item) => lower.includes(item.title.toLowerCase().slice(0, 18)) || lower.includes(item.type.toLowerCase()));
    const dateMatch = request.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (target && dateMatch && /(move|change|reschedule|date)/.test(lower)) {
      editItem(target.id, { dueDate: dateMatch[1], reviewStatus: 'approved' });
      setMessages((current) => [...current, `Updated “${target.title}” to ${dateMatch[1]}.`]);
    } else if (/uncertain|review/.test(lower)) {
      const count = data.items.filter((item) => statusFor(item) === 'needs-review').length;
      setMessages((current) => [...current, `${count} event${count === 1 ? '' : 's'} need review.`]);
    } else {
      setMessages((current) => [...current, 'I can apply an unambiguous date change (for example, “Move Midterm to 2026-11-04”) or show events needing review.']);
    }
    setChatInput('');
  };

  const exportCalendar = () => {
    const exportData = { ...data, items: data.items.filter((item) => item.includeInExport !== false) };
    downloadFile(generateIcsCalendar(exportData, { includePrepSessions: true }), `${(data.courseCode || 'course').toLowerCase()}_calendar.ics`, 'text/calendar;charset=utf-8');
  };

  const tabs: Array<[WorkspaceTab, string]> = [['overview', 'Overview'], ['calendar', 'Calendar'], ['assignments', 'Events'], ['documents', 'Documents'], ['details', 'Course details']];

  return (
    <section className="space-y-4">
      <div className="workflow-card overflow-hidden">
        <div className="p-5 sm:p-6 bg-gradient-to-r from-indigo-50 to-white border-b border-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-indigo-600 font-semibold"><Archive className="w-4 h-4" /> CLASS WORKSPACE</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">{data.courseName || 'Untitled course'}</h2>
              <p className="mt-1 text-sm text-slate-500">{data.courseCode || 'Course code unavailable'} · {data.semester || 'Term unavailable'} · {data.instructor || 'Instructor unavailable'}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={onOpenJson} className="workflow-secondary-button">View JSON</button>
              <button onClick={exportCalendar} className="workflow-primary-button"><Download className="w-3.5 h-3.5" /> Export approved</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-5" role="tablist">
            {tabs.map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`workspace-tab ${tab === value ? 'active' : ''}`}>{label}</button>)}
          </div>
        </div>

        {tab === 'overview' && (
          <div className="p-5 sm:p-6 grid lg:grid-cols-[1fr_320px] gap-5">
            <div>
              <h3 className="font-semibold">Course overview</h3>
              <p className="text-sm text-slate-600 mt-2 leading-6">{data.keyInfo?.overview || 'Overview unavailable. Add it in Course details.'}</p>
              <div className="grid sm:grid-cols-3 gap-3 mt-5">
                <div className="workspace-stat"><span>Events</span><strong>{data.items.length}</strong></div>
                <div className="workspace-stat"><span>Needs review</span><strong>{data.items.filter((item) => statusFor(item) === 'needs-review').length}</strong></div>
                <div className="workspace-stat"><span>Next deadline</span><strong>{data.items.filter((item) => item.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate?.slice(0, 10) || '—'}</strong></div>
              </div>
              <h3 className="font-semibold mt-6 mb-3">Upcoming deadlines</h3>
              <div className="divide-y divide-slate-100">{data.items.filter((item) => item.dueDate).slice(0, 4).map((item) => <button key={item.id} onClick={() => { setSelectedId(item.id); setTab('assignments'); }} className="w-full py-3 flex items-center justify-between text-left hover:bg-slate-50"><span className="text-sm">{item.title}</span><span className="text-xs text-slate-500">{item.dueDate.slice(0, 16).replace('T', ' ')}</span></button>)}</div>
            </div>
            <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-semibold text-sm">AI review assistant</h3>
              <div className="mt-3 space-y-2 max-h-36 overflow-auto">{messages.map((message, index) => <p key={index} className="text-xs text-slate-600 bg-white rounded-lg p-2.5">{message}</p>)}</div>
              <div className="flex gap-2 mt-3"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sendChat()} placeholder="Ask about this course..." className={inputClass} /><button onClick={sendChat} aria-label="Send message" className="workflow-primary-button px-3"><MessageCircle className="w-4 h-4" /></button></div>
            </aside>
          </div>
        )}

        {tab === 'assignments' && (
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap gap-2 justify-between mb-4"><div className="flex gap-2 flex-1 min-w-[240px]"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events..." className={`${inputClass} pl-9`} /></div><select value={filter} onChange={(event) => setFilter(event.target.value)} className={inputClass + ' max-w-[150px]'}><option value="all">All events</option><option value="review">Needs review</option><option value="assignment">Assignments</option><option value="exam">Exams</option><option value="quiz">Quizzes</option><option value="project">Projects</option></select></div><button onClick={addEvent} className="workflow-primary-button"><Plus className="w-4 h-4" /> Add event</button></div>
            {lastDeleted && <div className="mb-3 flex justify-between items-center rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">Event deleted. <button onClick={() => { update([lastDeleted, ...data.items]); setLastDeleted(null); }} className="font-semibold inline-flex gap-1 items-center"><Undo2 className="w-3.5 h-3.5" /> Undo</button></div>}
            <div className="overflow-x-auto border border-slate-200 rounded-xl"><table className="w-full text-left text-xs min-w-[920px]"><thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>{['Include', 'Event', 'Type', 'Due date', 'Status', 'Source', 'Actions'].map((heading) => <th key={heading} className="px-3 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visibleItems.map((item) => <tr key={item.id} className={selectedId === item.id ? 'bg-indigo-50/40' : ''}><td className="px-3 py-2"><input type="checkbox" checked={item.includeInExport !== false} onChange={(event) => editItem(item.id, { includeInExport: event.target.checked })} /></td><td className="px-3 py-2 w-[280px]"><input aria-label="Event title" value={item.title} onChange={(event) => editItem(item.id, { title: event.target.value })} className={inputClass} onFocus={() => setSelectedId(item.id)} /></td><td className="px-3 py-2"><select value={item.type} onChange={(event) => editItem(item.id, { type: event.target.value })} className={inputClass}><option>assignment</option><option>exam</option><option>quiz</option><option>project</option><option>lab</option><option>presentation</option></select></td><td className="px-3 py-2"><input aria-label="Due date" type="datetime-local" value={item.dueDate.length === 10 ? `${item.dueDate}T23:59` : item.dueDate.slice(0, 16)} onChange={(event) => editItem(item.id, { dueDate: event.target.value })} className={inputClass} /></td><td className="px-3 py-2"><select value={statusFor(item)} onChange={(event) => editItem(item.id, { reviewStatus: event.target.value })} className={inputClass}><option value="needs-review">Needs review</option><option value="reviewed">Reviewed</option><option value="approved">Approved</option></select></td><td className="px-3 py-2 text-slate-500">{item.sourcePage ? `Page ${item.sourcePage}` : 'Unavailable'}</td><td className="px-3 py-2"><div className="flex gap-1"><button title="Duplicate" onClick={() => duplicateEvent(item)} className="icon-button"><Copy className="w-3.5 h-3.5" /></button><button title="Delete" onClick={() => deleteEvent(item.id)} className="icon-button text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button></div></td></tr>)}</tbody></table></div>
          </div>
        )}

        {tab === 'calendar' && <div className="p-5 sm:p-6"><div className="flex items-center justify-between mb-4"><h3 className="font-semibold">Calendar view</h3><span className="text-xs text-slate-500">Same records as Events</span></div><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{data.items.filter((item) => item.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((item) => <button key={item.id} onClick={() => { setSelectedId(item.id); setTab('assignments'); }} className="text-left border border-slate-200 rounded-xl p-4 hover:border-indigo-300"><div className="text-xs text-indigo-600 font-semibold">{item.dueDate.slice(0, 10)}</div><div className="font-medium text-sm mt-2">{item.title}</div><div className="text-xs text-slate-500 mt-1 capitalize">{item.type} · {statusFor(item)}</div></button>)}</div></div>}

        {tab === 'documents' && <div className="p-5 sm:p-6 grid lg:grid-cols-[1fr_280px] gap-5"><div className="rounded-xl border border-slate-200 bg-slate-50 min-h-[280px] flex flex-col"><div className="flex items-center justify-between p-3 border-b border-slate-200"><span className="text-sm font-semibold"><FileText className="inline w-4 h-4 mr-2 text-indigo-500" />{data.sourceDocument || 'Original syllabus'}</span><span className="text-xs text-slate-500">Page {sourcePage}</span></div><div className="flex-1 min-h-[420px]">{pdfData ? <iframe title="Source PDF" src={`${pdfData}#page=${sourcePage}`} className="w-full h-full min-h-[420px] rounded-b-xl" /> : <div className="h-full grid place-items-center text-center p-8 text-sm text-slate-500"><div><FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" /><p>PDF preview is ready when a source document is attached.</p><p className="text-xs mt-1">Select an event with a source page to jump to its evidence.</p></div></div>}</div><div className="flex justify-center gap-2 p-3 border-t border-slate-200"><button onClick={() => setSourcePage(Math.max(1, sourcePage - 1))} className="icon-button"><ChevronLeft className="w-4 h-4" /></button><input aria-label="Source page" value={sourcePage} onChange={(event) => setSourcePage(Math.max(1, Number(event.target.value) || 1))} className="w-16 text-center border rounded-lg text-xs" /><button onClick={() => setSourcePage(sourcePage + 1)} className="icon-button"><ChevronRight className="w-4 h-4" /></button></div></div><div className="rounded-xl border border-slate-200 p-4"><h3 className="font-semibold text-sm">Selected evidence</h3><p className="text-xs text-slate-500 mt-2">{selected?.sourceQuote || 'No source evidence recorded for this event.'}</p>{selected?.sourcePage && <button onClick={() => setSourcePage(selected.sourcePage || 1)} className="text-xs text-indigo-600 mt-4">Jump to page {selected.sourcePage}</button>}</div></div>}

        {tab === 'details' && <div className="p-5 sm:p-6 grid sm:grid-cols-2 gap-4"><label className="text-xs font-semibold text-slate-600">Course name<input value={data.courseName || ''} onChange={(event) => onChange({ ...data, courseName: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600">Course code<input value={data.courseCode || ''} onChange={(event) => onChange({ ...data, courseCode: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600">Instructor<input value={data.instructor || ''} onChange={(event) => onChange({ ...data, instructor: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600">Semester<input value={data.semester || ''} onChange={(event) => onChange({ ...data, semester: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Meeting schedule<textarea value={data.keyInfo?.meetingSchedule || ''} onChange={(event) => onChange({ ...data, keyInfo: { ...data.keyInfo, meetingSchedule: event.target.value } })} className={`${inputClass} mt-1`} rows={2} /></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Overview<textarea value={data.keyInfo?.overview || ''} onChange={(event) => onChange({ ...data, keyInfo: { ...data.keyInfo, overview: event.target.value } })} className={`${inputClass} mt-1`} rows={3} /></label><div className="sm:col-span-2 flex justify-between items-center pt-3 border-t"><span className="text-xs text-slate-500">Missing information stays unavailable until you add it.</span><button onClick={onReset} className="text-xs text-rose-600">Remove course</button></div></div>}
      </div>
    </section>
  );
};
