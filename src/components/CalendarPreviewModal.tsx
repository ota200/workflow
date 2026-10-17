import React from 'react';
import { Download, X } from 'lucide-react';
import { SyllabusAnalysisResult } from '../types/syllabus';
import { downloadFile, generateIcsCalendar } from '../utils/calendarExport';
import { colorOf } from '../utils/eventCategory.ts';
import { parseScheduleDate } from '../utils/date';
import { milestoneDate } from '../utils/studySchedule';

type TimelineKind = 'due' | 'prep' | 'milestone';

interface TimelineEvent {
  id: string;
  itemId: string;
  milestoneId?: string;
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
  return { ...data, items: data.items.filter((item) => item.includeInExport !== false && parseScheduleDate(item.dueDate)) };
}

export function buildTimeline(data: SyllabusAnalysisResult, includePrep: boolean): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  exportableData(data).items.forEach((item) => {
    if (item.dueDate) {
      events.push({ id: `${item.id}-due`, itemId: item.id, date: item.dueDate, title: item.title, kind: 'due', type: item.type, details: item.description });
    }
    if (!includePrep) return;

    if (item.prepingInfo?.prepDate) {
      events.push({
        date: item.prepingInfo.prepDate,
        title: `Study for ${item.title}`,
        id: `${item.id}-prep`,
        itemId: item.id,
        kind: 'prep',
        type: item.type,
        details: [item.prepingInfo.duration && `Duration: ${item.prepingInfo.duration}`, item.prepingInfo.summary].filter(Boolean).join('. '),
      });
    }

    const due = parseScheduleDate(item.dueDate);
    if (item.prepingInfo?.milestones && due) {
      item.prepingInfo.milestones.forEach((m) => {
        const date = milestoneDate(item, m);
        if (!date) return;
        events.push({
          date,
          title: m.title,
          id: m.id,
          itemId: item.id,
          milestoneId: m.id,
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

interface CalendarTimelineProps {
  data: SyllabusAnalysisResult;
  includePrep: boolean;
  onChange?: (data: SyllabusAnalysisResult) => void;
  documents?: SyllabusAnalysisResult[];
  onSelectedData?: (data: SyllabusAnalysisResult) => void;
}

export const CalendarTimeline: React.FC<CalendarTimelineProps> = ({ data, includePrep, onChange, documents = [], onSelectedData }) => {
  const options = documents.length ? documents : [data];
  const [selectedId, setSelectedId] = React.useState(data.id || data.sourceDocument || '');
  const selectedData = options.find((entry) => (entry.id || entry.sourceDocument || '') === selectedId) || data;
  const events = buildTimeline(selectedData, includePrep);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  React.useEffect(() => {
    onSelectedData?.(selectedData);
  }, [onSelectedData, selectedData]);

  return (
    <div>
      {options.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <label htmlFor="calendar-course-select" className="wf-small wf-muted">Class</label>
          <select
            id="calendar-course-select"
            className="wf-input"
            style={{ maxWidth: 360 }}
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setEditingId(null);
              const next = options.find((entry) => (entry.id || entry.sourceDocument || '') === event.target.value);
              if (next) onSelectedData?.(next);
            }}
          >
            {options.map((entry, index) => {
              const id = entry.id || entry.sourceDocument || `document-${index}`;
              return <option key={id} value={id}>{entry.courseName || entry.courseCode || entry.sourceDocument || 'Untitled class'}</option>;
            })}
          </select>
        </div>
      )}
      {!events.length && <div className="wf-empty">No events selected for export.</div>}
      {events.map((evt) => {
        const item = selectedData.items.find((entry) => entry.id === evt.itemId);
        const editing = editingId === evt.id;
        if (!item) return null;
        return (
        <div key={evt.id} className="wf-row" style={{ alignItems: 'flex-start' }}>
          <span className="wf-dot" style={{ background: colorOf(evt.type), marginTop: 7 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing && onChange ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <input className="wf-input" aria-label="Calendar event title" defaultValue={evt.title} id={`calendar-title-${evt.id}`} />
                <input className="wf-input" aria-label="Calendar event date" type="date" defaultValue={evt.date.slice(0, 10)} id={`calendar-date-${evt.id}`} />
              </div>
            ) : (
              <>
                <div style={{ fontWeight: 500 }}>{evt.title}</div>
                {evt.details && <div className="wf-small wf-muted" style={{ marginTop: 2 }}>{evt.details}</div>}
              </>
            )}
          </div>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            {!editing && <div className="wf-small">{evt.date.slice(0, 10)}</div>}
            <span className={`wf-tag ${evt.kind === 'due' ? 'accent' : ''}`} style={{ marginTop: 2 }}>{KIND_LABEL[evt.kind]}</span>
            {onChange && (
              editing ? (
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <button type="button" className="workflow-primary-button" onClick={() => {
                    const title = (document.getElementById(`calendar-title-${evt.id}`) as HTMLInputElement)?.value.trim();
                    const date = (document.getElementById(`calendar-date-${evt.id}`) as HTMLInputElement)?.value;
                    if (!title || !date) return;
                    const items = selectedData.items.map((entry) => {
                      if (entry.id !== item.id) return entry;
                      if (evt.kind === 'due') return { ...entry, title, dueDate: entry.dueDate.includes('T') ? `${date}T${entry.dueDate.slice(11)}` : date };
                      if (evt.kind === 'prep') return { ...entry, prepingInfo: { ...entry.prepingInfo, prepDate: date } };
                      const dueDate = parseScheduleDate(entry.dueDate);
                      const selectedDate = parseScheduleDate(date);
                      const dayOffset = dueDate && selectedDate
                        ? Math.max(1, Math.round((dueDate.getTime() - selectedDate.getTime()) / 86_400_000))
                        : undefined;
                      const milestone = entry.prepingInfo?.milestones?.map((candidate) => candidate.id === evt.milestoneId
                        ? { ...candidate, title, ...(dayOffset === undefined ? {} : { dayOffset }) }
                        : candidate);
                      return { ...entry, prepingInfo: { ...entry.prepingInfo, milestones: milestone } };
                    });
                    onChange({ ...selectedData, items });
                    setEditingId(null);
                  }}>Save</button>
                  <button type="button" className="wf-ghost-button" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : <button type="button" className="wf-ghost-button" onClick={() => setEditingId(evt.id)}>Edit</button>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
};

interface CalendarPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: SyllabusAnalysisResult | null;
  includePrep?: boolean;
  onChange?: (data: SyllabusAnalysisResult) => void;
  documents?: SyllabusAnalysisResult[];
}

export const CalendarPreviewModal: React.FC<CalendarPreviewModalProps> = ({ isOpen, onClose, data, includePrep = true, onChange, documents = [] }) => {
  if (!isOpen || !data) return null;
  return <CalendarPreviewContent
    data={data}
    includePrep={includePrep}
    onChange={onChange}
    documents={documents}
    onClose={onClose}
  />;
};

const CalendarPreviewContent: React.FC<Omit<CalendarPreviewModalProps, 'isOpen'> & { data: SyllabusAnalysisResult }> = ({ onClose, data, includePrep = true, onChange, documents = [] }) => {
  const [selectedData, setSelectedData] = React.useState(data);

  return (
    <div className="wf-backdrop" role="dialog" aria-modal="true" aria-label="Calendar preview" onClick={onClose}>
      <div className="wf-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="wf-modal-head">
          <div>
            <h2 className="wf-h2">Calendar preview</h2>
            <p className="wf-small wf-muted" style={{ margin: 0 }}>What will be added when you import the .ics file</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="workflow-primary-button" onClick={() => downloadIcs(selectedData, includePrep)}>
              <Download className="w-3.5 h-3.5" /> Download .ics
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="wf-modal-body">
          <CalendarTimeline
            data={data}
            includePrep={includePrep}
            onChange={onChange}
            documents={documents}
            onSelectedData={setSelectedData}
          />
        </div>
      </div>
    </div>
  );
};