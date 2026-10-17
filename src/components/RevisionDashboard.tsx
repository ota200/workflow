import React, { useMemo, useState } from 'react';
import { BookOpen, CalendarClock, Check, ChevronRight, CircleAlert, Clock3, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { SyllabusAnalysisResult, PrepMilestone, SyllabusItem } from '../types/syllabus';
import { addCalendarDays } from '../utils/date';
import { generateRevisionPlan, milestoneDate, revisionStats, sessionMinutes, isExam } from '../utils/studySchedule';

interface RevisionDashboardProps {
  documents: SyllabusAnalysisResult[];
  onChange: (documentId: string, data: SyllabusAnalysisResult) => void;
  onOpenDocument: (document: SyllabusAnalysisResult, itemId?: string) => void;
}

type SessionRecord = { document: SyllabusAnalysisResult; item: SyllabusItem; milestone: PrepMilestone; date: string | null };

const today = () => new Date(new Date().setHours(0, 0, 0, 0));

export const RevisionDashboard: React.FC<RevisionDashboardProps> = ({ documents, onChange, onOpenDocument }) => {
  const [courseFilter, setCourseFilter] = useState('all');
  const [message, setMessage] = useState('');
  const records = useMemo<SessionRecord[]>(
    () => documents.flatMap((document) => document.items.flatMap((item) => (
      item.prepingInfo?.milestones || []
    ).map((milestone) => ({
      document, item, milestone, date: milestoneDate(item, milestone),
    })))),
    [documents],
  );
  const stats = revisionStats(documents.flatMap((document) => document.items));
  const visible = records.filter(({ document }) => courseFilter === 'all' || document.id === courseFilter);
  const todayKey = today().toISOString().slice(0, 10);
  const todaySessions = visible.filter(({ date, milestone }) => date === todayKey && milestone.status !== 'completed');
  const upcomingExams = documents.flatMap((document) => document.items
    .filter((item) => isExam(item) && item.dueDate)
    .map((item) => ({ document, item })))
    .filter(({ item }) => new Date(item.dueDate) >= today())
    .sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate))
    .slice(0, 4);

  const updateMilestone = (record: SessionRecord, patch: Partial<PrepMilestone>) => {
    const items = record.document.items.map((item) => item.id === record.item.id
      ? { ...item, prepingInfo: { ...item.prepingInfo, milestones: (item.prepingInfo?.milestones || []).map((milestone) => milestone.id === record.milestone.id ? { ...milestone, ...patch } : milestone) } }
      : item);
    onChange(record.document.id || record.document.sourceDocument || '', { ...record.document, items });
  };

  const addSession = (record: SessionRecord) => {
    const next = { id: `revision-${Date.now()}`, dayOffset: 1, title: `Review ${record.item.title}`, durationMinutes: 60, status: 'planned' as const, manual: true };
    const items = record.document.items.map((item) => item.id === record.item.id
      ? { ...item, prepingInfo: { ...item.prepingInfo, milestones: [...(item.prepingInfo?.milestones || []), next] } }
      : item);
    onChange(record.document.id || record.document.sourceDocument || '', { ...record.document, items });
  };

  const generate = (document: SyllabusAnalysisResult, item: SyllabusItem) => {
    const existing = item.prepingInfo?.milestones || [];
    const preserved = existing.filter((milestone) => milestone.status === 'completed' || milestone.manual);
    const generated = generateRevisionPlan(item, document.items).filter((milestone) =>
      !preserved.some((saved) => saved.dayOffset === milestone.dayOffset),
    );
    const milestones = [...preserved, ...generated].sort((a, b) => (b.dayOffset || 0) - (a.dayOffset || 0));
    onChange(document.id || document.sourceDocument || '', { ...document, items: document.items.map((entry) => entry.id === item.id ? { ...entry, prepingInfo: { ...entry.prepingInfo, milestones } } : entry) });
    setMessage(`Generated ${generated.length} new sessions for ${item.title}; completed and manual sessions were preserved.`);
  };

  const remove = (record: SessionRecord) => {
    const items = record.document.items.map((item) => item.id === record.item.id
      ? { ...item, prepingInfo: { ...item.prepingInfo, milestones: (item.prepingInfo?.milestones || []).filter((milestone) => milestone.id !== record.milestone.id) } }
      : item);
    onChange(record.document.id || record.document.sourceDocument || '', { ...record.document, items });
    setMessage('Session deleted. The exam and course remain unchanged.');
  };

  return (
    <section className="revision-dashboard">
      <div className="wf-row revision-heading">
        <div>
          <div className="wf-landing-eyebrow" style={{ marginBottom: 6 }}><BookOpen className="w-4 h-4" /> Revision workspace</div>
          <h1 className="wf-h1">Study with a plan, not a scramble.</h1>
          <p className="wf-sub" style={{ marginBottom: 0 }}>Prioritize upcoming exams, keep weak topics visible, and make each session count.</p>
        </div>
        <select className="wf-input revision-filter" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
          <option value="all">All courses</option>
          {documents.map((document) => <option key={document.id || document.sourceDocument} value={document.id || document.sourceDocument}>{document.courseName || document.sourceDocument || 'Untitled course'}</option>)}
        </select>
      </div>
      <div className="revision-stats">
        <div className="workflow-card revision-stat"><span className="wf-muted wf-small">Planned time</span><strong>{Math.round(stats.plannedMinutes / 60)}h</strong><small>{stats.total} sessions</small></div>
        <div className="workflow-card revision-stat"><span className="wf-muted wf-small">Completed</span><strong>{stats.completed}</strong><small>{Math.round(stats.completedMinutes / 60)}h studied</small></div>
        <div className="workflow-card revision-stat"><span className="wf-muted wf-small">Today</span><strong>{todaySessions.length}</strong><small>{todaySessions.length ? 'Ready to start' : 'No sessions due'}</small></div>
        <div className="workflow-card revision-stat"><span className="wf-muted wf-small">Progress</span><strong>{stats.total ? Math.round((stats.completed / stats.total) * 100) : 0}%</strong><div className="revision-progress"><i style={{ width: `${stats.total ? (stats.completed / stats.total) * 100 : 0}%` }} /></div></div>
      </div>
      {message && <div className="wf-note">{message}</div>}
      <div className="revision-grid">
        <div className="workflow-card">
          <div className="revision-card-header"><div><h2 className="wf-h2">What to revise today</h2><p className="wf-small wf-muted">Complete sessions to keep your progress accurate.</p></div><CalendarClock className="w-5 h-5 wf-muted" /></div>
          {todaySessions.length ? todaySessions.map((record) => (
            <SessionRow key={record.milestone.id} record={record} onOpen={onOpenDocument} onComplete={() => updateMilestone(record, { status: 'completed', completedAt: new Date().toISOString() })} onEdit={(title, minutes, dayOffset) => updateMilestone(record, { title, durationMinutes: minutes, dayOffset })} onDelete={() => remove(record)} onAdd={() => addSession(record)} />
          )) : <div className="wf-empty"><Check className="w-7 h-7" style={{ margin: '0 auto 8px', color: 'var(--workflow-ok)' }} /><p style={{ margin: 0 }}>You’re clear for today.</p></div>}
        </div>
        <div className="workflow-card">
          <div className="revision-card-header"><div><h2 className="wf-h2">Upcoming exams</h2><p className="wf-small wf-muted">Generate or refresh a focused plan.</p></div><CircleAlert className="w-5 h-5 wf-muted" /></div>
          {upcomingExams.length ? upcomingExams.map(({ document, item }) => {
            const count = item.prepingInfo?.milestones?.filter((milestone) => milestone.status !== 'missed').length || 0;
            return <div className="revision-exam" key={`${document.id}-${item.id}`}><div><strong>{item.title}</strong><small>{document.courseName || document.courseCode || 'Course'} · {item.dueDate.slice(0, 10)}</small></div><button type="button" className="workflow-secondary-button" onClick={() => generate(document, item)}><RotateCcw className="w-3.5 h-3.5" /> {count ? 'Regenerate' : 'Generate plan'}</button></div>;
          }) : <div className="wf-empty">No upcoming exams found.</div>}
        </div>
      </div>
      <div className="workflow-card">
        <div className="revision-card-header"><div><h2 className="wf-h2">All revision sessions</h2><p className="wf-small wf-muted">Manual changes are preserved until you regenerate a plan.</p></div><Clock3 className="w-5 h-5 wf-muted" /></div>
        {visible.length ? visible.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((record) => (
          <SessionRow key={`${record.document.id}-${record.milestone.id}`} record={record} onOpen={onOpenDocument} onComplete={() => updateMilestone(record, { status: 'completed', completedAt: new Date().toISOString() })} onEdit={(title, minutes, dayOffset) => updateMilestone(record, { title, durationMinutes: minutes, dayOffset })} onDelete={() => remove(record)} onAdd={() => addSession(record)} />
        )) : <div className="wf-empty">Generate a plan from an upcoming exam to get started.</div>}
      </div>
    </section>
  );
};

function SessionRow({ record, onOpen, onComplete, onEdit, onDelete, onAdd }: { record: SessionRecord; onOpen: (document: SyllabusAnalysisResult, itemId?: string) => void; onComplete: () => void; onEdit: (title: string, minutes: number, dayOffset: number) => void; onDelete: () => void; onAdd: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(record.milestone.title);
  const [minutes, setMinutes] = useState(sessionMinutes(record.milestone));
  const [dayOffset, setDayOffset] = useState(record.milestone.dayOffset || 1);
  const overdue = record.date ? record.date < today().toISOString().slice(0, 10) && record.milestone.status !== 'completed' : false;
  return <div className={`revision-session ${record.milestone.status === 'completed' ? 'complete' : overdue ? 'overdue' : ''}`}>
    <span className="revision-session-date">{record.date?.slice(5) || '—'}</span>
    <div className="revision-session-body">{editing ? <div className="revision-edit"><input className="wf-input" aria-label="Session title" value={title} onChange={(event) => setTitle(event.target.value)} /><input className="wf-input" aria-label="Minutes" type="number" min="15" step="15" value={minutes} onChange={(event) => setMinutes(Math.max(15, Number(event.target.value) || 15))} /><input className="wf-input" aria-label="Days before exam" type="number" min="1" value={dayOffset} onChange={(event) => setDayOffset(Math.max(1, Number(event.target.value) || 1))} /><button type="button" className="workflow-primary-button" onClick={() => { onEdit(title.trim() || record.milestone.title, minutes, dayOffset); setEditing(false); }}>Save</button></div> : <><strong>{record.milestone.title}</strong><small>{record.item.title} · {minutes} min · {record.milestone.status === 'completed' ? 'Completed' : overdue ? 'Missed' : 'Planned'}</small></>}</div>
    <div className="revision-session-actions"><button type="button" className="icon-button" title="Open course event" onClick={() => onOpen(record.document, record.item.id)}><ChevronRight className="w-4 h-4" /></button>{record.milestone.status !== 'completed' && <button type="button" className="icon-button" title="Mark complete" onClick={onComplete}><Check className="w-4 h-4" /></button>}<button type="button" className="icon-button" title="Edit session" onClick={() => setEditing((value) => !value)}>✎</button><button type="button" className="icon-button danger" title="Archive session" onClick={onDelete}><Trash2 className="w-4 h-4" /></button><button type="button" className="icon-button" title="Add another session" onClick={onAdd}><Plus className="w-4 h-4" /></button></div>
  </div>;
}
