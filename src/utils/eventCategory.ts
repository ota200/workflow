export type EventCategory = 'Assignment' | 'Exam' | 'Project' | 'Class' | 'Other';

export const CATEGORY_COLORS: Record<EventCategory, string> = {
  Assignment: '#5b4fe0',
  Exam: '#d6455d',
  Project: '#c47d0e',
  Class: '#1f8a5b',
  Other: '#6b7a90',
};

export function categoryOf(type?: string): EventCategory {
  const t = (type || '').toLowerCase();
  if (['exam', 'midterm', 'final', 'quiz'].includes(t)) return 'Exam';
  if (['assignment', 'homework', 'lab', 'paper'].includes(t)) return 'Assignment';
  if (['project', 'presentation'].includes(t)) return 'Project';
  if (['class', 'lecture'].includes(t)) return 'Class';
  return 'Other';
}

export const colorOf = (type?: string) => CATEGORY_COLORS[categoryOf(type)];