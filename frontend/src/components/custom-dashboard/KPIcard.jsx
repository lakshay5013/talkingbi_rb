import React from 'react';

function formatCurrency(value) {
  return `INR ${Number(value || 0).toLocaleString()}`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

export default function KPIcard({ title, value, growth, type = 'currency' }) {
  const valueText = type === 'count' ? formatCount(value) : formatCurrency(value);

  return (
    <article className="rounded-xl border border-slate-700/80 bg-slate-900/90 p-4 shadow-[0_10px_24px_rgba(2,6,23,0.34)]">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{valueText}</p>
      <p className="mt-1 text-xs font-medium text-emerald-400">+{growth}% vs previous period</p>
    </article>
  );
}
