import React from 'react';
import { Download, X } from 'lucide-react';
import { SyllabusAnalysisResult } from '../types/syllabus';
import { downloadFile, generateIcsCalendar } from '../utils/calendarExport';
import { colorOf } from '../utils/eventCategory.ts';

type TimelineKind = 'due' | 'prep' | 'milestone';

interface TimelineEvent {
  date: string;
  title: string;
  kind: TimelineKind;
  type: string;
  details?: string;
}

const KIND_LABEL: Record<TimelineKind, string> = {
  due: 'Due',
  prep: 'Prep starts',
  milestone: 'Study block',
};

export function exportableData(data: SyllabusAnalysisResult): SyllabusAnalysisResult {
  return { ...data, items: data.items.filter((item) => item.includeInExport !== false) };
}

export function buildTimeline(data: SyllabusAnalysisResult, includePrep: boolean): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  exportableData(data).items.forEach((item) => {
    if (item.dueDate) {
      events.push({ date: item.dueDate, title: item.title, kind: 'due', type: item.type, details: item.description });
    }
    if (!includePrep) return;

    if (item.prepingInfo?.prepDate) {
      events.push({
        date: item.prepingInfo.prepDate,
        title: `Study for ${item.title}`,
        kind: 'prep',
        type: item.type,
        details: [item.prepingInfo.duration && `Duration: ${item.prepingInfo.duration}`, item.prepingInfo.summary].filter(Boolean).join('. '),
      });
    }

    const due = new Date(item.dueDate);
    if (item.prepingInfo?.milestones && !isNaN(due.getTime())) {
      item.prepingInfo.milestones.forEach((m) => {
        const d = new Date(due);
        d.setDate(d.getDate() - (m.dayOffset ?? 2));
        events.push({
          date: d.toISOString().slice(0, 10),
          title: m.title,
          kind: 'milestone',
          type: item.type,
          details: `For ${item.title} · ${m.durationMinutes || 60} min`,
        });
      });
    }
  });

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function downloadIcs(data: SyllabusAnalysisResult, includePrep: boolean) {
  const ics = generateIcsCalendar(exportableData(data), { includePrepSessions: includePrep });
  const name = `${(data.courseCode || 'course').toLowerCase().replace(/[^a-z0-9]/g, '_')}_calendar.ics`;
  downloadFile(ics, name, 'text/calendar;charset=utf-8');
}

export const CalendarTimeline: React.FC<{ data: SyllabusAnalysisResult; includePrep: boolean }> = ({ data, includePrep }) => {
  const events = buildTimeline(data, includePrep);
  if (!events.length) return <div className="wf-empty">No events selected for export.</div>;

  return (
    <div>
      {events.map((evt, i) => (
        <div key={i} className="wf-row" style={{ alignItems: 'flex-start' }}>
          <span className="wf-dot" style={{ background: colorOf(evt.type), marginTop: 7 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{evt.title}</div>
            {evt.details && <div className="wf-small wf-muted" style={{ marginTop: 2 }}>{evt.details}</div>}
          </div>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            <div className="wf-small">{evt.date.slice(0, 10)}</div>
            <span className={`wf-tag ${evt.kind === 'due' ? 'accent' : ''}`} style={{ marginTop: 2 }}>{KIND_LABEL[evt.kind]}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

interface CalendarPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: SyllabusAnalysisResult | null;
  includePrep?: boolean;
}

export const CalendarPreviewModal: React.FC<CalendarPreviewModalProps> = ({ isOpen, onClose, data, includePrep = true }) => {
  if (!isOpen || !data) return null;

  return (
    <div className="wf-backdrop" role="dialog" aria-modal="true" aria-label="Calendar preview" onClick={onClose}>
      <div className="wf-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="wf-modal-head">
          <div>
            <h2 className="wf-h2">Calendar preview</h2>
            <p className="wf-small wf-muted" style={{ margin: 0 }}>What will be added when you import the .ics file</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="workflow-primary-button" onClick={() => downloadIcs(data, includePrep)}>
              <Download className="w-3.5 h-3.5" /> Download .ics
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="wf-modal-body">
          <CalendarTimeline data={data} includePrep={includePrep} />
        </div>
      </div>
    </div>
  );
};