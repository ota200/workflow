import { SyllabusItem, SyllabusAnalysisResult } from '../types/syllabus';
import { addCalendarDays, parseScheduleDate } from './date';
import { milestoneDate } from './studySchedule';

/**
 * Formats a Date object or ISO string into an iCalendar date-time string (UTC): YYYYMMDDTHHMMSSZ
 */
function formatIcsDateTime(dateInput: string | Date): string {
  const d = typeof dateInput === 'string' ? parseScheduleDate(dateInput) : dateInput;
  if (!d || isNaN(d.getTime())) return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Formats a Date object or ISO string into an iCalendar all-day date: YYYYMMDD
 */
function formatIcsDate(dateInput: string | Date): string {
  const d = typeof dateInput === 'string' ? parseScheduleDate(dateInput) : dateInput;
  if (!d || isNaN(d.getTime())) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Escapes characters for iCalendar text values (RFC 5545)
 */
function escapeIcsText(text: string = ''): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Generates an RFC 5545 compliant .ics string from Syllabus items
 */
export function generateIcsCalendar(
  data: SyllabusAnalysisResult,
  options: { includePrepSessions?: boolean } = { includePrepSessions: true }
): string {
  const now = new Date();
  const dtstamp = formatIcsDateTime(now);
  const coursePrefix = data.courseCode || data.courseName || 'Course';

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Syllabus & Exam Prep AI//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`${coursePrefix} Schedule`)}`,
    `X-WR-CALDESC:${escapeIcsText(`Assignments, Exams and Prep Schedules for ${coursePrefix}`)}`,
  ];

  data.items.forEach((item) => {
    // 1. Due Date Event
    const dueDateObj = parseScheduleDate(item.dueDate);
    const isValidDate = dueDateObj !== null;
    const eventDate = isValidDate ? dueDateObj : now;

    // Check if time is specified (e.g., contains 'T' or hour != 0)
    const hasTime = Boolean(item.dueDate && item.dueDate.includes('T'));

    let dtStartLine = '';
    let dtEndLine = '';

    if (hasTime && isValidDate) {
      dtStartLine = `DTSTART:${formatIcsDateTime(eventDate)}`;
      const endDate = new Date(eventDate.getTime() + 60 * 60 * 1000); // 1 hour duration
      dtEndLine = `DTEND:${formatIcsDateTime(endDate)}`;
    } else {
      const dtDateStr = formatIcsDate(eventDate);
      dtStartLine = `DTSTART;VALUE=DATE:${dtDateStr}`;
      // All day end date is next day per RFC 5545
      const nextDay = addCalendarDays(eventDate, 1);
      dtEndLine = `DTEND;VALUE=DATE:${formatIcsDate(nextDay)}`;
    }

    const description = [
      `Type: ${item.type.toUpperCase()}`,
      `Grading Weight: ${item.weight}`,
      item.description ? `Details: ${item.description}` : '',
      `Prep Duration: ${item.prepingInfo?.duration || 'N/A'}`,
      item.prepingInfo?.summary ? `Prep Advice: ${item.prepingInfo.summary}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    ics.push(
      'BEGIN:VEVENT',
      `UID:${item.id}-due@syllabus-ai`,
      `DTSTAMP:${dtstamp}`,
      dtStartLine,
      dtEndLine,
      `SUMMARY:[DUE] ${escapeIcsText(item.title)} (${item.weight})`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `CATEGORIES:${escapeIcsText(item.type.toUpperCase())}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:Reminder: ${escapeIcsText(item.title)} is due tomorrow`,
      'END:VALARM',
      'END:VEVENT'
    );

    // 2. Prep Session Events (if requested)
    if (options.includePrepSessions && item.prepingInfo) {
      const prep = item.prepingInfo;

      // If specific prep start date is provided
      if (prep.prepDate) {
        const prepStartObj = parseScheduleDate(prep.prepDate);
        if (prepStartObj) {
          const prepDateStr = formatIcsDate(prepStartObj);
          const nextPrepDay = addCalendarDays(prepStartObj, 1);

          const prepDesc = [
            `Preparation for: ${item.title} (Due: ${item.dueDate})`,
            `Total Recommended Duration: ${prep.duration}`,
            `Preparation Strategy: ${prep.summary}`,
          ].join('\n');

          ics.push(
            'BEGIN:VEVENT',
            `UID:${prep.id || `${item.id}-prep`}@syllabus-ai`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;VALUE=DATE:${prepDateStr}`,
            `DTEND;VALUE=DATE:${formatIcsDate(nextPrepDay)}`,
            `SUMMARY:[PREP START] Study for: ${escapeIcsText(item.title)}`,
            `DESCRIPTION:${escapeIcsText(prepDesc)}`,
            'CATEGORIES:STUDY,PREPARATION',
            'STATUS:CONFIRMED',
            'END:VEVENT'
          );
        }
      }

      // Milestones
      if (prep.milestones && prep.milestones.length > 0 && isValidDate) {
        prep.milestones.forEach((m) => {
          const offsetDays = m.dayOffset ?? 1;
          const scheduledDate = milestoneDate(item, m);
          if (!scheduledDate) return;
          const milestoneStart = parseScheduleDate(`${scheduledDate}T18:00:00`);
          if (!milestoneStart) return;

          // Set time to evening study session (e.g. 18:00)
          const milestoneEnd = new Date(milestoneStart.getTime() + (m.durationMinutes || 60) * 60 * 1000);

          ics.push(
            'BEGIN:VEVENT',
            `UID:${m.id || `${item.id}-m`}-${offsetDays}@syllabus-ai`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART:${formatIcsDateTime(milestoneStart)}`,
            `DTEND:${formatIcsDateTime(milestoneEnd)}`,
            `SUMMARY:[STUDY BLOCK] ${escapeIcsText(m.title)} (${escapeIcsText(item.title)})`,
            `DESCRIPTION:${escapeIcsText(`Milestone preparation block for ${item.title} (due in ${offsetDays} days).\nDuration: ${m.durationMinutes || 60} minutes`)}`,
            'CATEGORIES:STUDY,MILESTONE',
            'STATUS:CONFIRMED',
            'END:VEVENT'
          );
        });
      }
    }
  });

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

/**
 * Triggers a browser download of a generated text or json blob
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
