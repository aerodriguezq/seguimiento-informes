import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, MapPin, CheckCheck } from 'lucide-react';
import { MUNICIPIOS_COLOMBIA, MunicipioColombia, municipioLabel } from '../../data/municipiosColombia';

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normalize(s: string): string {
  return stripAccents(s).toLowerCase();
}

// Umbral mínimo antes de filtrar en serio -- con 1 sola letra casi cualquier
// nombre "contiene" esa letra en algún lado y el resultado se siente
// aleatorio, no cercano a lo que se escribió.
const MIN_QUERY_LENGTH = 2;
const MAX_MUNICIPIO_MATCHES = 40;
const DEFAULT_LIST_SIZE = 40;

interface MunicipiosMultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

type DepartmentGroup = { departamento: string; municipios: MunicipioColombia[] };

// Selector múltiple con búsqueda sobre el catálogo completo de municipios de
// Colombia (1.104) -- un <select> normal sería inmanejable a ese tamaño, así
// que se filtra en vivo mientras se escribe y las selecciones quedan como
// chips removibles, igual al patrón de "Áreas Intervienen" en Peticiones
// pero con cuadro de búsqueda porque ahí la lista es de miles, no de unas pocas.
//
// Se identifica cada municipio por su "etiqueta" (municipioLabel): el
// nombre solo si es único en el catálogo, o "Nombre (Departamento)" cuando
// hay más de uno igual (ej. tres "Córdoba" distintos) -- así la selección y
// las llaves de React nunca chocan entre sí.
//
// Dos modos de coincidencia a la vez: por nombre de municipio (rankeado --
// primero los que EMPIEZAN con lo escrito, luego los que solo lo contienen)
// y por nombre de departamento (si lo escrito calza con un departamento,
// p.ej. "bolivar", se agrupan sus municipios aparte con un botón para
// agregarlos todos de una).
export const MunicipiosMultiSelect: React.FC<MunicipiosMultiSelectProps> = ({
  value,
  onChange,
  placeholder = 'Buscar municipio o departamento...',
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

  const { departmentGroups, municipioMatches } = useMemo(() => {
    const q = normalize(query.trim());

    if (q.length < MIN_QUERY_LENGTH) {
      // Sin búsqueda (o muy corta todavía): prioriza los ya seleccionados
      // para que sea fácil revisarlos, y completa con los primeros del catálogo.
      const selected = MUNICIPIOS_COLOMBIA.filter((m) => selectedSet.has(municipioLabel(m)));
      const rest = MUNICIPIOS_COLOMBIA.filter((m) => !selectedSet.has(municipioLabel(m))).slice(0, DEFAULT_LIST_SIZE - selected.length);
      return { departmentGroups: [] as DepartmentGroup[], municipioMatches: [...selected, ...rest] };
    }

    // Departamentos cuyo nombre calza con lo escrito -- se agrupan aparte
    // (y completos, sin el tope de 40) para que "bolivar" muestre TODO bolívar.
    const allDepartamentos = Array.from(new Set(MUNICIPIOS_COLOMBIA.map((m) => m.departamento)));
    const matchedDeps = allDepartamentos
      .filter((dep) => normalize(dep).includes(q))
      .sort((a, b) => {
        const aStarts = normalize(a).startsWith(q) ? 0 : 1;
        const bStarts = normalize(b).startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      });
    const groups: DepartmentGroup[] = matchedDeps.map((dep) => ({
      departamento: dep,
      municipios: MUNICIPIOS_COLOMBIA.filter((m) => m.departamento === dep),
    }));
    const groupedDeps = new Set(matchedDeps);

    // Municipios por nombre, excluyendo los que ya aparecen en un grupo de
    // departamento de arriba (para no repetirlos dos veces en la lista) --
    // rankeados: primero los que empiezan con lo escrito, luego el resto.
    const nameMatches = MUNICIPIOS_COLOMBIA.filter(
      (m) => !groupedDeps.has(m.departamento) && normalize(m.municipio).includes(q)
    );
    nameMatches.sort((a, b) => {
      const aStarts = normalize(a.municipio).startsWith(q) ? 0 : 1;
      const bStarts = normalize(b.municipio).startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.municipio.localeCompare(b.municipio);
    });

    return { departmentGroups: groups, municipioMatches: nameMatches.slice(0, MAX_MUNICIPIO_MATCHES) };
  }, [query, selectedSet]);

  const toggle = (m: MunicipioColombia) => {
    const label = municipioLabel(m);
    if (selectedSet.has(label)) {
      onChange(value.filter((v) => v !== label));
    } else {
      onChange([...value, label]);
    }
  };

  const remove = (label: string) => {
    onChange(value.filter((v) => v !== label));
  };

  const addAllFromDepartment = (group: DepartmentGroup) => {
    const labels = group.municipios.map(municipioLabel);
    const merged = new Set([...value, ...labels]);
    onChange(Array.from(merged));
  };

  const noResults = departmentGroups.length === 0 && municipioMatches.length === 0;

  return (
    <div ref={containerRef} className="relative">
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-medium text-indigo-800"
            >
              <MapPin className="w-2.5 h-2.5" />
              {label}
              <button
                type="button"
                onClick={() => remove(label)}
                className="ml-0.5 text-indigo-400 hover:text-indigo-700"
                aria-label={`Quitar ${label}`}
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
          autoComplete="off"
          className="w-full pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 text-xs"
        />
      </div>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
            <p className="px-3 py-3 text-[11px] text-slate-400 text-center">Escribe al menos {MIN_QUERY_LENGTH} letras para buscar.</p>
          )}

          {noResults && query.trim().length >= MIN_QUERY_LENGTH && (
            <p className="px-3 py-3 text-xs text-slate-400 text-center">Sin coincidencias.</p>
          )}

          {departmentGroups.map((group) => {
            const allSelected = group.municipios.every((m) => selectedSet.has(municipioLabel(m)));
            return (
              <div key={group.departamento} className="border-b border-slate-100">
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Departamento: {group.departamento} ({group.municipios.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => addAllFromDepartment(group)}
                    disabled={allSelected}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:text-slate-300 disabled:cursor-default"
                  >
                    <CheckCheck className="w-3 h-3" />
                    {allSelected ? 'Todos agregados' : 'Agregar todos'}
                  </button>
                </div>
                {group.municipios.map((m) => {
                  const label = municipioLabel(m);
                  const checked = selectedSet.has(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggle(m)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${checked ? 'bg-indigo-50/60' : ''}`}
                    >
                      <span className={checked ? 'font-semibold text-indigo-800' : 'text-slate-800'}>{m.municipio}</span>
                      {checked && <span className="shrink-0 text-indigo-600 font-bold">✓</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {municipioMatches.map((m) => {
            const label = municipioLabel(m);
            const checked = selectedSet.has(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggle(m)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${checked ? 'bg-indigo-50/60' : ''}`}
              >
                <span className="truncate">
                  <span className={checked ? 'font-semibold text-indigo-800' : 'text-slate-800'}>{m.municipio}</span>
                  <span className="text-slate-400"> · {m.departamento}</span>
                </span>
                {checked && <span className="shrink-0 text-indigo-600 font-bold">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
