import React from 'react';
import { BookOpen, Clock3, FileText, GraduationCap, MapPin, ShieldCheck } from 'lucide-react';
import { CourseKeyInfo } from '../types/syllabus';

interface CourseKeyInfoCardProps {
  info?: CourseKeyInfo;
}

const InfoBlock: React.FC<{ icon: React.ReactNode; label: string; value?: string }> = ({
  icon,
  label,
  value,
}) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-slate-950/70 border border-slate-800 p-3">
      <div className="text-blue-400 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
        <p className="text-xs text-slate-300 leading-relaxed mt-1 whitespace-pre-line">{value}</p>
      </div>
    </div>
  );
};

export const CourseKeyInfoCard: React.FC<CourseKeyInfoCardProps> = ({ info }) => {
  const hasInfo =
    info &&
    (info.overview ||
      info.meetingSchedule ||
      info.location ||
      info.gradingPolicy ||
      info.requiredMaterials?.length ||
      info.policies?.length ||
      info.officeHours ||
      info.importantNotes?.length);

  if (!hasInfo) return null;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
          <BookOpen className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">Key Course Information</h2>
          <p className="text-xs text-slate-400">Important details extracted from the source document</p>
        </div>
      </div>

      {info.overview && (
        <p className="text-sm text-slate-300 leading-relaxed bg-indigo-950/20 border border-indigo-900/50 rounded-2xl p-4">
          {info.overview}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <InfoBlock icon={<Clock3 className="w-4 h-4" />} label="Meeting schedule" value={info.meetingSchedule} />
        <InfoBlock icon={<MapPin className="w-4 h-4" />} label="Location" value={info.location} />
        <InfoBlock icon={<GraduationCap className="w-4 h-4" />} label="Grading policy" value={info.gradingPolicy} />
        <InfoBlock icon={<FileText className="w-4 h-4" />} label="Office hours" value={info.officeHours} />
      </div>

      {(info.requiredMaterials?.length || info.policies?.length || info.importantNotes?.length) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {[
            ['Required materials', info.requiredMaterials, <FileText className="w-3.5 h-3.5" />],
            ['Policies', info.policies, <ShieldCheck className="w-3.5 h-3.5" />],
            ['Important notes', info.importantNotes, <BookOpen className="w-3.5 h-3.5" />],
          ].map(([label, values, icon]) =>
            Array.isArray(values) && values.length ? (
              <div key={String(label)} className="rounded-2xl bg-slate-950/70 border border-slate-800 p-3">
                <p className="flex items-center gap-1.5 text-slate-300 font-semibold">
                  {icon}
                  {label}
                </p>
                <ul className="mt-2 space-y-1 text-slate-400 list-disc list-inside">
                  {values.map((value) => <li key={value}>{value}</li>)}
                </ul>
              </div>
            ) : null
          )}
        </div>
      )}
    </section>
  );
};
