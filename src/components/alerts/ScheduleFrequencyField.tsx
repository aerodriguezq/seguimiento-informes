import React, { useState } from 'react';

const PRESET_OPTIONS = [
  '5 días antes del vencimiento',
  '3 días antes del vencimiento',
  'El mismo día del vencimiento',
  'Semanal todos los Lunes',
  'Diario a las 08:00 AM',
];

const RANGE_PATTERN = /^Del día (\d{1,2}) al día (\d{1,2}) de cada mes$/;

interface ScheduleFrequencyFieldProps {
  value: string;
  onChange: (schedule: string) => void;
}

export const ScheduleFrequencyField: React.FC<ScheduleFrequencyFieldProps> = ({ value, onChange }) => {
  const rangeMatch = value.match(RANGE_PATTERN);
  const [mode, setMode] = useState<'preset' | 'range'>(rangeMatch ? 'range' : 'preset');
  const [rangeStartDay, setRangeStartDay] = useState(rangeMatch?.[1] || '1');
  const [rangeEndDay, setRangeEndDay] = useState(rangeMatch?.[2] || '5');

  const composeRange = (start: string, end: string) => `Del día ${start} al día ${end} de cada mes`;

  const switchToPreset = () => {
    setMode('preset');
    onChange(PRESET_OPTIONS[0]);
  };

  const switchToRange = () => {
    setMode('range');
    onChange(composeRange(rangeStartDay, rangeEndDay));
  };

  const updateRange = (start: string, end: string) => {
    setRangeStartDay(start);
    setRangeEndDay(end);
    if (start && end) onChange(composeRange(start, end));
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
          Rango mensual
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
          <span className="whitespace-nowrap text-slate-500">Día</span>
          <input
            type="number"
            min={1}
            max={31}
            value={rangeStartDay}
            onChange={(e) => updateRange(e.target.value, rangeEndDay)}
            className="w-14 px-2 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
          />
          <span className="whitespace-nowrap text-slate-400">al día</span>
          <input
            type="number"
            min={1}
            max={31}
            value={rangeEndDay}
            onChange={(e) => updateRange(rangeStartDay, e.target.value)}
            className="w-14 px-2 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500"
          />
          <span className="whitespace-nowrap text-slate-500">de cada mes</span>
        </div>
      )}
    </div>
  );
};
