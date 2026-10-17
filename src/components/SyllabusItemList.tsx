import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Award,
  CheckCircle2,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Download,
  Search,
  Filter,
  CheckSquare,
  Square,
  Sparkles,
} from 'lucide-react';
import { SyllabusItem, SyllabusAnalysisResult } from '../types/syllabus';
import { generateIcsCalendar, downloadFile } from '../utils/calendarExport';

interface SyllabusItemListProps {
  items: SyllabusItem[];
  courseData: SyllabusAnalysisResult;
}

export const SyllabusItemList: React.FC<SyllabusItemListProps> = ({
  items,
  courseData,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [completedMilestones, setCompletedMilestones] = useState<Record<string, boolean>>({});
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const toggleMilestone = (milestoneId: string) => {
    setCompletedMilestones((prev) => ({
      ...prev,
      [milestoneId]: !prev[milestoneId],
    }));
  };

  const toggleExpand = (itemId: string) => {
    setExpandedCards((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const exportSingleItemIcs = (item: SyllabusItem) => {
    const singleData: SyllabusAnalysisResult = {
      ...courseData,
      items: [item],
    };
    const icsContent = generateIcsCalendar(singleData, { includePrepSessions: true });
    const filename = `${item.id}_${item.type}.ics`;
    downloadFile(icsContent, filename, 'text/calendar;charset=utf-8');
  };

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType =
      typeFilter === 'all' ||
      (typeFilter === 'exams' && ['exam', 'midterm', 'final', 'quiz'].includes(item.type.toLowerCase())) ||
      (typeFilter === 'assignments' && ['assignment', 'homework', 'lab', 'paper'].includes(item.type.toLowerCase())) ||
      (typeFilter === 'projects' && item.type.toLowerCase() === 'project') ||
      item.type.toLowerCase() === typeFilter;

    return matchesSearch && matchesType;
  });

  const getTypeBadgeColor = (type: string) => {
    const t = type.toLowerCase();
    if (['exam', 'midterm', 'final'].includes(t)) {
      return 'bg-red-950/80 text-red-300 border-red-800/80';
    }
    if (['project', 'presentation'].includes(t)) {
      return 'bg-purple-950/80 text-purple-300 border-purple-800/80';
    }
    if (['quiz'].includes(t)) {
      return 'bg-amber-950/80 text-amber-300 border-amber-800/80';
    }
    return 'bg-blue-950/80 text-blue-300 border-blue-800/80';
  };

  const formatDateDisplay = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: dateStr.includes('T') ? 'numeric' : undefined,
        minute: dateStr.includes('T') ? '2-digit' : undefined,
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-3 rounded-2xl">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by title, id, or keywords..."
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-400">Category:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 capitalize"
          >
            <option value="all">All Items</option>
            <option value="exams">Exams &amp; Quizzes</option>
            <option value="assignments">Assignments &amp; Labs</option>
            <option value="projects">Projects</option>
          </select>
        </div>
      </div>

      {/* Items Cards */}
      <div className="space-y-4">
        {filteredItems.map((item) => {
          const isExpanded = expandedCards[item.id] !== false; // Default expanded
          const prep = item.prepingInfo;

          return (
            <div
              key={item.id}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl transition-all duration-200 hover:border-slate-700/80 space-y-4"
            >
              {/* Header row: ID, Type, Title, Weight, Export */}
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      id: {item.id}
                    </span>

                    <span
                      className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] font-semibold uppercase tracking-wider border ${getTypeBadgeColor(
                        item.type
                      )}`}
                    >
                      {item.type}
                    </span>

                    <span className="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/80 flex items-center gap-1">
                      <Award className="w-3 h-3 text-amber-400" />
                      {item.weight}
                    </span>
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {item.title}
                  </h3>

                  {item.description && (
                    <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
                      {item.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => exportSingleItemIcs(item)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center gap-1.5 border border-slate-700/80 transition-colors cursor-pointer"
                    title="Export single item to .ics calendar"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-400" />
                    <span>iCal (.ics)</span>
                  </button>

                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Due Date & Prep Dates Bar */}
              <div className="flex flex-wrap items-center gap-4 text-xs pt-1 pb-1 font-mono">
                <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-emerald-400">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    Due Date: <strong className="text-white font-sans">{formatDateDisplay(item.dueDate)}</strong>
                  </span>
                </div>

                {prep?.prepDate && (
                  <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-purple-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      Prep Starts: <strong className="text-white font-sans">{formatDateDisplay(prep.prepDate)}</strong>
                    </span>
                  </div>
                )}
                {item.location && (
                  <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-blue-400">
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>
                      Location: <strong className="text-white font-sans">{item.location}</strong>
                    </span>
                  </div>
                )}
                {item.confidence && (
                  <span
                    className={`px-2.5 py-1 rounded-xl border text-[10px] uppercase tracking-wide font-semibold ${
                      item.confidence.toLowerCase() === 'high'
                        ? 'text-emerald-300 border-emerald-800 bg-emerald-950/30'
                        : item.confidence.toLowerCase() === 'low'
                        ? 'text-amber-300 border-amber-800 bg-amber-950/30'
                        : 'text-slate-300 border-slate-700 bg-slate-950'
                    }`}
                  >
                    {item.confidence} confidence
                  </span>
                )}
              </div>

              {/* Prep Information Section */}
              {isExpanded && prep && (
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                        Preparation Plan
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        (id: {prep.id})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-indigo-950/70 border border-indigo-800/80 text-indigo-300 font-mono text-[11px] font-medium">
                      <Clock className="w-3 h-3 text-indigo-400" />
                      <span>Duration: {prep.duration}</span>
                    </div>
                  </div>

                  {/* Summary of Prep Advice */}
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <strong className="text-slate-100 font-medium">Strategy &amp; Guidance: </strong>
                    {prep.summary}
                  </div>

                  {item.sourceQuote && (
                    <div className="border-l-2 border-blue-500/70 bg-blue-950/20 rounded-r-xl px-3 py-2 text-[11px] text-slate-400">
                      <span className="text-blue-300 font-semibold">Source evidence: </span>
                      {item.sourceQuote}
                    </div>
                  )}

                  {/* Milestones checklist */}
                  {prep.milestones && prep.milestones.length > 0 && (
                    <div className="pt-2 space-y-2">
                      <span className="text-[11px] font-semibold uppercase font-mono text-slate-400 block">
                        Milestones &amp; Scheduled Study Blocks ({prep.milestones.length}):
                      </span>

                      <div className="space-y-1.5">
                        {prep.milestones.map((m) => {
                          const isDone = !!completedMilestones[m.id];
                          return (
                            <div
                              key={m.id}
                              onClick={() => toggleMilestone(m.id)}
                              className={`flex items-start gap-2.5 p-2 rounded-xl border transition-all cursor-pointer ${
                                isDone
                                  ? 'bg-emerald-950/20 border-emerald-800/60 line-through text-slate-500'
                                  : 'bg-slate-900/80 border-slate-800/80 hover:border-slate-700 text-slate-200'
                              }`}
                            >
                              <div className="mt-0.5 text-blue-400 shrink-0">
                                {isDone ? (
                                  <CheckSquare className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-500" />
                                )}
                              </div>

                              <div className="flex-1 text-xs">
                                <span>{m.title}</span>
                              </div>

                              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 shrink-0">
                                {m.dayOffset !== undefined && (
                                  <span>{m.dayOffset} days prior</span>
                                )}
                                {m.durationMinutes && (
                                  <span className="bg-slate-800 px-1.5 py-0.5 rounded">
                                    {m.durationMinutes}m
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
