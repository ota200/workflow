export interface PrepMilestone {
  id: string;
  dayOffset?: number;
  title: string;
  durationMinutes?: number;
}

export interface PrepingInfo {
  id: string;
  duration: string;
  summary: string;
  prepDate?: string;
  milestones?: PrepMilestone[];
}

export interface SyllabusItem {
  id: string;
  title: string;
  type: 'assignment' | 'exam' | 'quiz' | 'project' | 'midterm' | 'final' | 'lab' | 'homework' | 'paper' | string;
  dueDate: string;
  weight: string;
  description?: string;
  location?: string;
  sourceQuote?: string;
  courseId?: string;
  sourceDocumentId?: string;
  sourcePage?: number;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  reviewStatus?: 'needs-review' | 'reviewed' | 'approved' | string;
  includeInExport?: boolean;
  confidence?: 'high' | 'medium' | 'low' | string;
  prepingInfo: PrepingInfo;
}

export interface CourseKeyInfo {
  overview?: string;
  meetingSchedule?: string;
  location?: string;
  gradingPolicy?: string;
  requiredMaterials?: string[];
  policies?: string[];
  officeHours?: string;
  importantNotes?: string[];
}

export interface SyllabusAnalysisResult {
  id?: string;
  sourceDocument?: string;
  analyzedAt?: string;
  courseName?: string;
  courseCode?: string;
  instructor?: string;
  semester?: string;
  keyInfo?: CourseKeyInfo;
  items: SyllabusItem[];
}
