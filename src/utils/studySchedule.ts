import { SyllabusItem, PrepMilestone } from '../types/syllabus';
import { addCalendarDays, dateOnly, parseScheduleDate } from './date';

export const DEFAULT_SESSION_MINUTES = 60;
const DEFAULT_OFFSETS = [7, 4, 2, 1];

export function milestoneDate(item: SyllabusItem, milestone: PrepMilestone): string | null {
  const due = parseScheduleDate(item.dueDate);
  if (!due) return null;
  return dateOnly(addCalendarDays(due, -(milestone.dayOffset ?? 1)));
}

export function isExam(item: SyllabusItem): boolean {
  return /exam|midterm|final|quiz|test/i.test(item.type) || /exam|midterm|final|quiz|test/i.test(item.title);
}

export function sessionMinutes(milestone: PrepMilestone): number {
  return Math.max(15, milestone.durationMinutes || DEFAULT_SESSION_MINUTES);
}

export function generateRevisionPlan(
  item: SyllabusItem,
  existingItems: SyllabusItem[] = [],
  options: { sessions?: number; minutesPerSession?: number } = {},
): PrepMilestone[] {
  const due = parseScheduleDate(item.dueDate);
  if (!due) return [];
  const sessions = Math.max(1, Math.min(6, options.sessions || (isExam(item) ? 4 : 2)));
  const minutes = Math.max(15, options.minutesPerSession || (isExam(item) ? 90 : 60));
  const occupied = new Set(
    existingItems
      .filter((entry) => entry.id !== item.id)
      .flatMap((entry) => {
        const dueDate = parseScheduleDate(entry.dueDate);
        return [
          ...(dueDate ? [dateOnly(dueDate)] : []),
          ...(entry.prepingInfo?.milestones || []).map((milestone) => milestoneDate(entry, milestone)),
        ];
      })
      .filter((date): date is string => Boolean(date)),
  );
  const availableOffsets = DEFAULT_OFFSETS
    .concat(Array.from({ length: 21 }, (_, index) => index + 8))
    .filter((offset, index, values) => values.indexOf(offset) === index)
    .filter((offset) => addCalendarDays(due, -offset) >= new Date(new Date().setHours(0, 0, 0, 0)));
  const selectedOffsets: number[] = [];
  for (const offset of availableOffsets) {
    const date = dateOnly(addCalendarDays(due, -offset));
    if (!occupied.has(date) && !selectedOffsets.includes(offset)) selectedOffsets.push(offset);
    if (selectedOffsets.length === sessions) break;
  }
  if (selectedOffsets.length < sessions) {
    for (const offset of availableOffsets) {
      if (!selectedOffsets.includes(offset)) selectedOffsets.push(offset);
      if (selectedOffsets.length === sessions) break;
    }
  }
  return selectedOffsets
    .sort((a, b) => b - a)
    .map((dayOffset, index) => ({
      id: `revision-${item.id}-${dayOffset}-${index}`,
      dayOffset,
      title: index === 0 ? `Review ${item.title} fundamentals` : index === selectedOffsets.length - 1 ? `Final review: ${item.title}` : `Practice ${item.title}`,
      durationMinutes: minutes,
      status: 'planned',
      manual: false,
    }));
}

export function revisionStats(items: SyllabusItem[]) {
  const sessions = items.flatMap((item) => (item.prepingInfo?.milestones || []).map((milestone) => ({ item, milestone })));
  const activeSessions = sessions.filter(({ milestone }) => milestone.status !== 'missed');
  const completed = activeSessions.filter(({ milestone }) => milestone.status === 'completed').length;
  const plannedMinutes = activeSessions.reduce((total, { milestone }) => total + sessionMinutes(milestone), 0);
  const completedMinutes = sessions
    .filter(({ milestone }) => milestone.status === 'completed')
    .reduce((total, { milestone }) => total + sessionMinutes(milestone), 0);
  return { sessions, completed, total: sessions.length, plannedMinutes, completedMinutes };
}
