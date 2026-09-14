import React from 'react';
import { ReportStatus } from '../../types';
import { Clock, Edit3, Send, CheckCircle2 } from 'lucide-react';

interface StatusBadgeProps {
  status: ReportStatus;
  size?: 'sm' | 'md' | 'lg';
  id?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md', id }) => {
  const config = {
    'Pendientes Evidencias': {
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
      dot: 'bg-amber-500',
      icon: Clock,
      label: 'Pendientes Evidencias',
    },
    'Informe en Elaboración': {
      bg: 'bg-blue-50',
      text: 'text-blue-800',
      border: 'border-blue-200',
      dot: 'bg-blue-500',
      icon: Edit3,
      label: 'En Elaboración',
    },
    'Entregado a Of. Proyectos': {
      bg: 'bg-indigo-50',
      text: 'text-indigo-800',
      border: 'border-indigo-200',
      dot: 'bg-indigo-500',
      icon: Send,
      label: 'Entregado a Of. Proyectos',
    },
    'Enviado': {
      bg: 'bg-emerald-50',
      text: 'text-emerald-800',
      border: 'border-emerald-200',
      dot: 'bg-emerald-500',
      icon: CheckCircle2,
      label: 'Enviado',
    },
  }[status] || {
    bg: 'bg-slate-50',
    text: 'text-slate-800',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
    icon: Clock,
    label: status,
  };

  const Icon = config.icon;
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-medium',
    lg: 'text-sm px-3 py-1.5 gap-2 font-medium',
  }[size];

  return (
    <span
      id={id}
      className={`inline-flex items-center rounded-full border whitespace-nowrap ${config.bg} ${config.text} ${config.border} ${sizeClasses}`}
      title={`Estado del ciclo: ${status}`}
    >
      <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      <span>{config.label}</span>
    </span>
  );
};
