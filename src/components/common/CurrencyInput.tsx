import React, { useRef } from 'react';

function formatThousands(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

interface CurrencyInputProps {
  value: string;
  onChange: (rawDigits: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

// Input de valores en pesos colombianos: mientras se escribe, agrupa los
// dígitos de a 3 con punto como separador de miles (8478101840 ->
// 8.478.101.840). El valor que sale por onChange son solo los dígitos
// (sin puntos), igual que antes -- el resto del formulario no cambia.
export const CurrencyInput: React.FC<CurrencyInputProps> = ({ value, onChange, placeholder, className, id }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formattedBefore = e.target.value;
    const cursorPos = e.target.selectionStart ?? formattedBefore.length;
    const digitsBeforeCursor = formattedBefore.slice(0, cursorPos).replace(/\D/g, '').length;
    const rawDigits = formattedBefore.replace(/\D/g, '');

    onChange(rawDigits);

    // Reubica el cursor después del mismo número de dígitos que tenía
    // antes -- sin esto, el cursor salta al final cada vez que se agrega
    // o se quita un punto de miles al escribir en medio del número.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      const formattedAfter = formatThousands(rawDigits);
      let seen = 0;
      let pos = formattedAfter.length;
      for (let i = 0; i < formattedAfter.length; i++) {
        if (/\d/.test(formattedAfter[i])) seen++;
        if (seen === digitsBeforeCursor) {
          pos = i + 1;
          break;
        }
      }
      input.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none select-none">$</span>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        value={formatThousands(value)}
        onChange={handleChange}
        placeholder={placeholder}
        className={className ?? 'w-full pl-5 pr-2.5 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-indigo-500'}
      />
    </div>
  );
};
