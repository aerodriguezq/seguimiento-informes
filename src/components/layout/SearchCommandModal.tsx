import React, { useEffect, useRef, useState } from 'react';
import { Search, X, FileText, FolderKanban, ArrowRight } from 'lucide-react';
import { Project, Report } from '../../types';

interface SearchCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  reports: Report[];
  projects: Project[];
  onSelectReport: (reportId: string) => void;
  onSelectProject: (projectId: string) => void;
}

export const SearchCommandModal: React.FC<SearchCommandModalProps> = ({
  isOpen,
  onClose,
  reports,
  projects,
  onSelectReport,
  onSelectProject,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();
  const matchedReports = q
    ? reports.filter((r) =>
        r.consecutive.toLowerCase().includes(q) ||
        r.typeName.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q) ||
        r.projectBpin.toLowerCase().includes(q),
      ).slice(0, 6)
    : [];
  const matchedProjects = q
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.bpin.toLowerCase().includes(q) ||
        p.company.toLowerCase().includes(q),
      ).slice(0, 5)
    : [];
  const hasResults = matchedReports.length > 0 || matchedProjects.length > 0;

  return (
    <div
      className="fixed inset-0 z-70 flex items-start justify-center pt-24 px-4 bg-slate-900/40 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por consecutivo, tipo, proyecto, BPIN..."
            className="flex-1 text-sm outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Cerrar búsqueda"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {!q ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Escribe para buscar informes o proyectos.
            </div>
          ) : !hasResults ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Sin resultados para "{query}".
            </div>
          ) : (
            <>
              {matchedReports.length > 0 && (
                <div className="py-1.5">
                  <div className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Informes
                  </div>
                  {matchedReports.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        onSelectReport(r.id);
                        onClose();
                      }}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">{r.consecutive} · {r.typeName}</div>
                          <div className="text-[11px] text-slate-500 truncate">{r.projectName} · BPIN {r.projectBpin}</div>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {matchedProjects.length > 0 && (
                <div className="py-1.5 border-t border-slate-100">
                  <div className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Proyectos
                  </div>
                  {matchedProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelectProject(p.id);
                        onClose();
                      }}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FolderKanban className="w-4 h-4 text-indigo-500 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">{p.name}</div>
                          <div className="text-[11px] text-slate-500 truncate">BPIN {p.bpin} · {p.company}</div>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
          <span>Enter para abrir · Esc para cerrar</span>
          <kbd className="px-1.5 py-0.5 font-mono bg-white rounded border border-slate-200">⌘K</kbd>
        </div>
      </div>
    </div>
  );
};
