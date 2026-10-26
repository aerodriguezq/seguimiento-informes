import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, MapPin } from 'lucide-react';
import { MUNICIPIOS_COLOMBIA } from '../../data/municipiosColombia';

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normalize(s: string): string {
  return stripAccents(s).toLowerCase();
}

interface MunicipiosMultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

// Selector múltiple con búsqueda sobre el catálogo completo de municipios de
// Colombia (1.104) -- un <select> normal sería inmanejable a ese tamaño, así
// que se filtra en vivo mientras se escribe y las selecciones quedan como
// chips removibles, igual al patrón de "Áreas Intervienen" en Peticiones
// pero con cuadro de búsqueda porque ahí la lista es de miles, no de unas pocas.
export const MunicipiosMultiSelect: React.FC<MunicipiosMultiSelectProps> = ({
  value,
  onChange,
  placeholder = 'Buscar municipio...',
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (q === '') {
      // Sin búsqueda: prioriza los ya seleccionados para que sea fácil
      // revisarlos, y completa con los primeros del catálogo.
      const selected = MUNICIPIOS_COLOMBIA.filter((m) => selectedSet.has(m.municipio));
      const rest = MUNICIPIOS_COLOMBIA.filter((m) => !selectedSet.has(m.municipio)).slice(0, 40 - selected.length);
      return [...selected, ...rest];
    }
    return MUNICIPIOS_COLOMBIA
      .filter((m) => normalize(m.municipio).includes(q) || normalize(m.departamento).includes(q))
      .slice(0, 60);
  }, [query, selectedSet]);

  const toggle = (municipio: string) => {
    if (selectedSet.has(municipio)) {
      onChange(value.filter((v) => v !== municipio));
    } else {
      onChange([...value, municipio]);
    }
  };

  const remove = (municipio: string) => {
    onChange(value.filter((v) => v !== municipio));
  };

  return (
    <div ref={containerRef} className="relative">
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((m) => (
            <span
              key={m}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-medium text-indigo-800"
            >
              <MapPin className="w-2.5 h-2.5" />
              {m}
              <button
                type="button"
                onClick={() => remove(m)}
                className="ml-0.5 text-indigo-400 hover:text-indigo-700"
                aria-label={`Quitar ${m}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 text-xs"
        />
      </div>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400 text-center">Sin coincidencias.</p>
          ) : (
            matches.map((m) => {
              const checked = selectedSet.has(m.municipio);
              return (
                <button
                  key={m.municipio}
                  type="button"
                  onClick={() => toggle(m.municipio)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${checked ? 'bg-indigo-50/60' : ''}`}
                >
                  <span className="truncate">
                    <span className={checked ? 'font-semibold text-indigo-800' : 'text-slate-800'}>{m.municipio}</span>
                    <span className="text-slate-400"> · {m.departamento}</span>
                  </span>
                  {checked && <span className="shrink-0 text-indigo-600 font-bold">✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
