import React from 'react';
import { SemaforoStatus } from '../../types';
import { AlertCircle, AlertTriangle, CheckCircle, Minus } from 'lucide-react';

interface SemaforoBadgeProps {
  status: SemaforoStatus;
  daysRemaining?: number;
  showDaysText?: boolean;
  id?: string;
}

export const SemaforoBadge: React.FC<SemaforoBadgeProps> = ({
  status,
  daysRemaining,
  showDaysText = true,
  id,
}) => {
  if (status === 'vencido') {
    return (
      <span
        id={id}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap"
      >
        <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" />
        <AlertCircle className="w-3.5 h-3.5" />
        {showDaysText && (
          <span>
            {daysRemaining !== undefined
              ? `Vencido hace ${Math.abs(daysRemaining)} d`
              : 'Vencido'}
          </span>
        )}
      </span>
    );
  }

  if (status === 'proximo') {
    return (
      <span
        id={id}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap"
      >
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <AlertTriangle className="w-3.5 h-3.5" />
        {showDaysText && (
          <span>
            {daysRemaining !== undefined
              ? `Vence en ${daysRemaining} ${daysRemaining === 1 ? 'día' : 'días'}`
              : 'Próximo a vencer'}
          </span>
        )}
      </span>
    );
  }

  if (status === 'en_tiempo') {
    return (
      <span
        id={id}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <CheckCircle className="w-3.5 h-3.5" />
        {showDaysText && (
          <span>
            {daysRemaining !== undefined && daysRemaining > 0
              ? `${daysRemaining} días restantes`
              : 'Cumplido / Al día'}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      id={id}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap"
    >
      <Minus className="w-3 h-3" />
      <span>No aplica</span>
    </span>
  );
};
