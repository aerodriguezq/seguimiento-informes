import React, { useState } from 'react';

const PRESET_OPTIONS = [
  '5 días antes del vencimiento',
  '3 días antes del vencimiento',
  'El mismo día del vencimiento',
  'Semanal todos los Lunes',
  'Diario a las 08:00 AM',
];

const RANGE_PATTERN = /^Del (\d{4}-\d{2}-\d{2}) al (\d{4}-\d{2}-\d{2})$/;

interface ScheduleFrequencyFieldProps {
  value: string;
  onChange: (schedule: string) => void;
}

export const ScheduleFrequencyField: React.FC<ScheduleFrequencyFieldProps> = ({ value, onChange }) => {
  const rangeMatch = value.match(RANGE_PATTERN);
  const [mode, setMode] = useState<'preset' | 'range'>(rangeMatch ? 'range' : 'preset');
  const [rangeStart, setRangeStart] = useState(rangeMatch?.[1] || '');
  const [rangeEnd, setRangeEnd] = useState(rangeMatch?.[2] || '');

  const switchToPreset = () => {
    setMode('preset');
    onChange(PRESET_OPTIONS[0]);
  };

  const switchToRange = () => {
    setMode('range');
    onChange(rangeStart && rangeEnd ? `Del ${rangeStart} al ${rangeEnd}` : '');
  };

  const updateRange = (start: string, end: string) => {
    setRangeStart(start);
    setRangeEnd(end);
    onChange(start && end ? `Del ${start} al ${end}` : '');
  };

  return (
    <div>
      <div className="mb-1.5 inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px] font-semibold">
        <button
          type="button"
          onClick={switchToPreset}
          className={`rounded-md px-2 py-1 transition-colors ${mode === 'preset' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Predefinida
        </button>
        <button
          type="button"
          onClick={switchToRange}
          className={`rounded-md px-2 py-1 transition-colors ${mode === 'range' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Rango de fechas
        </button>
      </div>

      {mode === 'preset' ? (
        <select
          value={PRESET_OPTIONS.includes(value) ? value : PRESET_OPTIONS[0]}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={rangeStart}
            onChange={(e) => updateRange(e.target.value, rangeEnd)}
            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
          />
          <span className="text-slate-400">al</span>
          <input
            type="date"
            value={rangeEnd}
            onChange={(e) => updateRange(rangeStart, e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
          />
        </div>
      )}
    </div>
  );
};
