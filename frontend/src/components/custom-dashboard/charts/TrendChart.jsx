import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

export default function TrendChart({ title, data, dataKey, color }) {
  return (
    <article className="rounded-xl border border-slate-700/80 bg-slate-900/90 p-4 shadow-[0_10px_24px_rgba(2,6,23,0.34)]">
      <h4 className="mb-3 text-sm font-semibold text-slate-100">{title}</h4>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.6} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
