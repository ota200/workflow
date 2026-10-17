import React, { useMemo, useState } from 'react';
import {
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

function colorOf(type: string) {
  const colors: Record<string, string> = {
    assignment: '#2563eb',
    exam: '#dc2626',
    quiz: '#d97706',
    project: '#7c3aed',
    lab: '#059669',
    presentation: '#db2777',
  };
  return colors[type.toLowerCase()] || '#64748b';
}

interface ClassWorkspaceProps {
  data: SyllabusAnalysisResult;
  onChange: (data: SyllabusAnalysisResult) => void;
  onOpenJson: () => void;
  onOpenCalendar: () => void;
  onReset: () => void;
  pdfData?: string;
  includePrep?: boolean;
}

type WorkspaceTab = 'overview' | 'calendar' | 'assignments' | 'documents' | 'details';
type Flag = { tone: 'warn' | 'err'; label: string; title: string };

function statusFor(item: SyllabusItem) {
  return item.reviewStatus || (item.confidence === 'low' ? 'needs-review' : 'reviewed');
}

function flagsFor(item: SyllabusItem, all: SyllabusItem[]): Flag[] {
  const flags: Flag[] = [];
  if (!item.dueDate) flags.push({ tone: 'err', label: 'No date', title: 'This event has no date and cannot be exported.' });
  else if (!item.dueDate.includes('T')) flags.push({ tone: 'warn', label: 'No time', title: 'No time found. It will export as an all-day event.' });
  if (statusFor(item) === 'needs-review') flags.push({ tone: 'warn', label: 'Confirm', title: 'Check this against your document.' });
  if (item.dueDate.includes('T') && item.includeInExport !== false &&
      all.some((o) => o.id !== item.id && o.includeInExport !== false && o.dueDate === item.dueDate)) {
    flags.push({ tone: 'err', label: 'Conflict', title: 'Another selected event starts at the same time.' });
  }
  return flags;
}

function downloadIcs(data: SyllabusAnalysisResult, includePrep: boolean) {
  const escapeIcs = (value: string) => value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
  const events = data.items.filter((item) => item.includeInExport !== false && item.dueDate);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Syllabus Workspace//EN'];

  events.forEach((item) => {
    const date = item.dueDate.slice(0, 10).replace(/-/g, '');
    const hasTime = item.dueDate.includes('T');
    const start = hasTime
      ? `${date}T${item.dueDate.slice(11, 16).replace(':', '')}00`
      : date;
    lines.push('BEGIN:VEVENT', `UID:${item.id}@syllabus-workspace`, `DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, '').replace(/\d{3}Z$/, 'Z')}`);
    lines.push(hasTime ? `DTSTART:${start}` : `DTSTART;VALUE=DATE:${date}`);
    lines.push(hasTime ? `DTEND:${start}` : `DTEND;VALUE=DATE:${date}`);
    lines.push(`SUMMARY:${escapeIcs(item.title)}`);
    if (item.description) lines.push(`DESCRIPTION:${escapeIcs(item.description)}`);
    if (item.location) lines.push(`LOCATION:${escapeIcs(item.location)}`);
    lines.push('END:VEVENT');
  });

  if (includePrep) {
    // Preparation metadata has no independent date, so it cannot be exported as an event.
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(data.courseName || 'syllabus').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'syllabus'}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

const MONTH_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const ClassWorkspace: React.FC<ClassWorkspaceProps> = ({
  data, onChange, onOpenJson, onOpenCalendar, onReset, pdfData, includePrep = true,
}) => {
  const [tab, setTab] = useState<WorkspaceTab>('assignments');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(data.items[0]?.id || null);
  const [sourcePage, setSourcePage] = useState(1);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<string[]>(['Ask me to find, review, or update an event.']);
  const [lastDeleted, setLastDeleted] = useState<SyllabusItem | null>(null);
  const [month, setMonth] = useState(() => {
    const first = data.items.map((i) => i.dueDate).filter(Boolean).sort()[0];
    const d = first ? new Date(first.slice(0, 10) + 'T12:00') : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const update = (items: SyllabusItem[]) => onChange({ ...data, items, analyzedAt: data.analyzedAt || new Date().toISOString() });
  const selected = data.items.find((item) => item.id === selectedId) || data.items[0];
  const included = data.items.filter((item) => item.includeInExport !== false && item.dueDate);
  const needsReview = data.items.filter((item) => statusFor(item) === 'needs-review').length;

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
    update(data.items.filter((entry) => entry.id !== id));
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
      setMessages((current) => [...current, `${needsReview} event${needsReview === 1 ? '' : 's'} need review.`]);
    } else {
      setMessages((current) => [...current, 'I can apply an unambiguous date change (for example, “Move Midterm to 2026-11-04”) or show events needing review.']);
    }
    setChatInput('');
  };

  const goToEvent = (id: string) => { setSelectedId(id); setTab('assignments'); };
  const viewInDocument = (item: SyllabusItem) => { setSelectedId(item.id); if (item.sourcePage) setSourcePage(item.sourcePage); setTab('documents'); };

  const tabs: Array<[WorkspaceTab, string]> = [
    ['assignments', 'Events'], ['calendar', 'Calendar'], ['documents', 'Document'], ['overview', 'Overview'], ['details', 'Course details'],
  ];

  const renderMonth = () => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const lead = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < lead; i++) cells.push(<div key={`b${i}`} className="wf-cal-c" />);
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push(
        <div key={key} className="wf-cal-c">
          <span className="wf-cal-n">{d}</span>
          {data.items.filter((item) => item.dueDate.slice(0, 10) === key && item.includeInExport !== false).map((item) => (
            <button
              key={item.id}
              type="button"
              className="wf-pill"
              title={item.title}
              style={{ background: `${colorOf(item.type)}22`, borderLeft: `3px solid ${colorOf(item.type)}` }}
              onClick={() => goToEvent(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>,
      );
    }
    return (
      <div className="workflow-card" style={{ overflow: 'hidden' }}>
        <div className="wf-row" style={{ justifyContent: 'space-between' }}>
          <h3 className="wf-h2">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth(new Date(y, m - 1, 1))}><ChevronLeft className="w-4 h-4" /></button>
            <button type="button" className="icon-button" aria-label="Next month" onClick={() => setMonth(new Date(y, m + 1, 1))}><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="wf-cal">
          {MONTH_DAYS.map((d, i) => <div key={i} className="wf-cal-h">{d}</div>)}
          {cells}
        </div>
      </div>
    );
  };

  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="wf-h1" style={{ fontSize: 28 }}>{data.courseName || 'Untitled course'}</h1>
          <p className="wf-muted" style={{ margin: 0 }}>
            Found {data.items.length} events{data.courseCode ? ` in ${data.courseCode}` : ''}
            {needsReview ? <> · <b style={{ color: 'var(--workflow-warn)' }}>{needsReview} need your attention</b></> : ' · all reviewed'}
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="wf-ghost-button" onClick={onOpenJson}>View JSON</button>
          <button type="button" className="workflow-secondary-button" onClick={onOpenCalendar}>Preview export</button>
          <button type="button" className="workflow-primary-button" disabled={!included.length} onClick={() => downloadIcs(data, includePrep)}>
            <Download className="w-3.5 h-3.5" /> Download .ics ({included.length})
          </button>
        </div>
      </div>

      <div className="workflow-card" style={{ overflow: 'hidden' }}>
        <div className="wf-tabs" role="tablist">
          {tabs.map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`wf-tab ${tab === value ? 'active' : ''}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'assignments' && (
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, flex: '1 1 260px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search className="w-4 h-4 wf-muted" style={{ position: 'absolute', left: 10, top: 9 }} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" aria-label="Search events" className="wf-input" style={{ paddingLeft: 32 }} />
                </div>
                <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter events" className="wf-input" style={{ maxWidth: 160 }}>
                  <option value="all">All events</option>
                  <option value="review">Needs review</option>
                  <option value="assignment">Assignments</option>
                  <option value="exam">Exams</option>
                  <option value="quiz">Quizzes</option>
                  <option value="project">Projects</option>
                </select>
              </div>
              <button type="button" className="workflow-secondary-button" onClick={addEvent}><Plus className="w-4 h-4" /> Add event</button>
            </div>

            {lastDeleted && (
              <div className="wf-note" style={{ marginTop: 0, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Event deleted.
                <button type="button" onClick={() => { update([lastDeleted, ...data.items]); setLastDeleted(null); }} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontWeight: 600, background: 'none', border: 0 }}>
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
              </div>
            )}

            {!visibleItems.length ? (
              <div className="wf-empty">No events match this filter.</div>
            ) : (
              <div className="wf-table-wrap">
                <table className="wf-table">
                  <thead>
                    <tr>{['Export', 'Event', 'Type', 'Date and time', 'Review', 'Source', ''].map((h, i) => <th key={i}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const flags = flagsFor(item, data.items);
                      return (
                        <tr key={item.id} className={selectedId === item.id ? 'sel' : ''}>
                          <td><input type="checkbox" aria-label={`Export ${item.title}`} checked={item.includeInExport !== false} onChange={(e) => editItem(item.id, { includeInExport: e.target.checked })} /></td>
                          <td style={{ minWidth: 240 }}>
                            <input aria-label="Event title" value={item.title} onChange={(e) => editItem(item.id, { title: e.target.value })} onFocus={() => setSelectedId(item.id)} className="wf-input" />
                            {flags.length > 0 && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                                {flags.map((f) => <span key={f.label} title={f.title} className={`wf-tag ${f.tone}`}>{f.label}</span>)}
                              </div>
                            )}
                          </td>
                          <td>
                            <select value={item.type} onChange={(e) => editItem(item.id, { type: e.target.value })} aria-label="Type" className="wf-input">
                              <option>assignment</option><option>exam</option><option>quiz</option><option>project</option><option>lab</option><option>presentation</option>
                            </select>
                          </td>
                          <td>
                            <input
                              aria-label="Date and time"
                              type="datetime-local"
                              value={item.dueDate.length === 10 ? `${item.dueDate}T23:59` : item.dueDate.slice(0, 16)}
                              onChange={(e) => editItem(item.id, { dueDate: e.target.value })}
                              className={`wf-input ${item.dueDate.includes('T') ? '' : 'warn'}`}
                            />
                          </td>
                          <td>
                            <select value={statusFor(item)} onChange={(e) => editItem(item.id, { reviewStatus: e.target.value })} aria-label="Review status" className="wf-input">
                              <option value="needs-review">Needs review</option>
                              <option value="reviewed">Reviewed</option>
                              <option value="approved">Approved</option>
                            </select>
                          </td>
                          <td className="wf-muted">
                            {item.sourcePage ? (
                              <button type="button" onClick={() => viewInDocument(item)} style={{ color: 'var(--workflow-accent)', background: 'none', border: 0, padding: 0 }}>Page {item.sourcePage}</button>
                            ) : 'Not found'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button type="button" title="Duplicate" aria-label="Duplicate event" onClick={() => duplicateEvent(item)} className="icon-button"><Copy className="w-3.5 h-3.5" /></button>
                              <button type="button" title="Delete" aria-label="Delete event" onClick={() => deleteEvent(item.id)} className="icon-button danger"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selected && (
              <div style={{ marginTop: 16, display: 'grid', gap: 16 }} className="lg:grid-cols-2">
                <div>
                  <h3 className="wf-h2">Details: {selected.title}</h3>
                  <label className="wf-label" htmlFor="loc">Location</label>
                  <input id="loc" className="wf-input" value={selected.location || ''} onChange={(e) => editItem(selected.id, { location: e.target.value })} />
                  <label className="wf-label" htmlFor="desc">Description</label>
                  <textarea id="desc" rows={3} className="wf-input" value={selected.description || ''} onChange={(e) => editItem(selected.id, { description: e.target.value })} />
                </div>
                <div>
                  <h3 className="wf-h2">Found in your document</h3>
                  {selected.sourceQuote ? <div className="wf-src">{selected.sourceQuote}</div> : <p className="wf-muted wf-small">No source text was recorded for this event. Confirm it manually.</p>}
                  {selected.sourcePage && (
                    <button type="button" className="workflow-secondary-button" style={{ marginTop: 10 }} onClick={() => viewInDocument(selected)}>
                      <FileText className="w-3.5 h-3.5" /> View page {selected.sourcePage}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'calendar' && <div style={{ padding: 16 }}>{renderMonth()}</div>}

        {tab === 'overview' && (
          <div style={{ padding: 16, display: 'grid', gap: 20 }} className="lg:grid-cols-[1fr_320px]">
            <div>
              <h3 className="wf-h2">Course overview</h3>
              <p className="wf-muted" style={{ marginTop: 6, maxWidth: '65ch' }}>{data.keyInfo?.overview || 'Overview unavailable. Add it in Course details.'}</p>
              <h3 className="wf-h2" style={{ marginTop: 24 }}>Upcoming deadlines</h3>
              <div style={{ marginTop: 6 }}>
                {data.items.filter((item) => item.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5).map((item) => (
                  <button key={item.id} type="button" onClick={() => goToEvent(item.id)} className="wf-row" style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--workflow-line)', textAlign: 'left', justifyContent: 'space-between' }}>
                    <span><span className="wf-dot" style={{ background: colorOf(item.type), marginRight: 8 }} />{item.title}</span>
                    <span className="wf-small wf-muted">{item.dueDate.slice(0, 16).replace('T', ' ')}</span>
                  </button>
                ))}
              </div>
            </div>
            <aside style={{ border: '1px solid var(--workflow-line)', borderRadius: 12, padding: 16, background: 'var(--workflow-bg)', alignSelf: 'start' }}>
              <h3 className="wf-h2">Review assistant</h3>
              <div style={{ marginTop: 10, display: 'grid', gap: 8, maxHeight: 180, overflow: 'auto' }}>
                {messages.map((message, i) => <p key={i} className="wf-small" style={{ margin: 0, padding: 10, borderRadius: 8, background: 'var(--workflow-surface)' }}>{message}</p>)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} placeholder="Ask about this course" aria-label="Message" className="wf-input" />
                <button type="button" onClick={sendChat} aria-label="Send message" className="workflow-primary-button"><MessageCircle className="w-4 h-4" /></button>
              </div>
            </aside>
          </div>
        )}

        {tab === 'documents' && (
          <div style={{ padding: 16, display: 'grid', gap: 16 }} className="lg:grid-cols-[1fr_300px]">
            <div style={{ border: '1px solid var(--workflow-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--workflow-bg)' }}>
              <div className="wf-row" style={{ justifyContent: 'space-between', background: 'var(--workflow-surface)' }}>
                <span style={{ fontWeight: 500 }}><FileText className="inline w-4 h-4" style={{ marginRight: 8, color: 'var(--workflow-accent)' }} />{data.sourceDocument || 'Original document'}</span>
                <span className="wf-small wf-muted">Page {sourcePage}</span>
              </div>
              <div style={{ minHeight: 420 }}>
                {pdfData ? (
                  <iframe title="Source PDF" src={`${pdfData}#page=${sourcePage}`} style={{ width: '100%', height: 480, border: 0 }} />
                ) : (
                  <div className="wf-empty">
                    <FileText className="w-8 h-8" style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                    <p style={{ margin: 0 }}>The PDF preview isn’t available for this session.</p>
                    <p className="wf-small" style={{ margin: '4px 0 0' }}>Upload the file again to compare events against the original.</p>
                  </div>
                )}
              </div>
              <div className="wf-row" style={{ justifyContent: 'center', background: 'var(--workflow-surface)' }}>
                <button type="button" aria-label="Previous page" onClick={() => setSourcePage(Math.max(1, sourcePage - 1))} className="icon-button"><ChevronLeft className="w-4 h-4" /></button>
                <input aria-label="Source page" value={sourcePage} onChange={(e) => setSourcePage(Math.max(1, Number(e.target.value) || 1))} className="wf-input" style={{ width: 64, textAlign: 'center' }} />
                <button type="button" aria-label="Next page" onClick={() => setSourcePage(sourcePage + 1)} className="icon-button"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
            <div style={{ border: '1px solid var(--workflow-line)', borderRadius: 12, padding: 16, alignSelf: 'start' }}>
              <h3 className="wf-h2">Selected event</h3>
              {selected ? (
                <>
                  <p style={{ margin: '8px 0 0', fontWeight: 500 }}>{selected.title}</p>
                  <div className="wf-src">{selected.sourceQuote || 'No source text recorded for this event.'}</div>
                  {selected.sourcePage && <button type="button" onClick={() => setSourcePage(selected.sourcePage || 1)} style={{ marginTop: 10, color: 'var(--workflow-accent)', background: 'none', border: 0, padding: 0 }}>Jump to page {selected.sourcePage}</button>}
                </>
              ) : <p className="wf-muted wf-small">Select an event in the Events tab.</p>}
            </div>
          </div>
        )}

        {tab === 'details' && (
          <div style={{ padding: 16, display: 'grid', gap: 14 }} className="sm:grid-cols-2">
            {([['Course name', 'courseName'], ['Course code', 'courseCode'], ['Instructor', 'instructor'], ['Semester', 'semester']] as const).map(([label, key]) => (
              <label key={key} className="wf-small" style={{ fontWeight: 500 }}>
                <span className="wf-muted">{label}</span>
                <input value={(data as any)[key] || ''} onChange={(e) => onChange({ ...data, [key]: e.target.value })} className="wf-input" style={{ marginTop: 4 }} />
              </label>
            ))}
            <label className="wf-small sm:col-span-2" style={{ fontWeight: 500 }}>
              <span className="wf-muted">Meeting schedule</span>
              <textarea rows={2} value={data.keyInfo?.meetingSchedule || ''} onChange={(e) => onChange({ ...data, keyInfo: { ...data.keyInfo, meetingSchedule: e.target.value } })} className="wf-input" style={{ marginTop: 4 }} />
            </label>
            <label className="wf-small sm:col-span-2" style={{ fontWeight: 500 }}>
              <span className="wf-muted">Overview</span>
              <textarea rows={3} value={data.keyInfo?.overview || ''} onChange={(e) => onChange({ ...data, keyInfo: { ...data.keyInfo, overview: e.target.value } })} className="wf-input" style={{ marginTop: 4 }} />
            </label>
            <div className="sm:col-span-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--workflow-line)' }}>
              <span className="wf-small wf-muted">Missing information stays unavailable until you add it.</span>
              <button type="button" onClick={onReset} className="wf-ghost-button danger">Remove course</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};