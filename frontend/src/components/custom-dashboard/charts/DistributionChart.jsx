import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

const COLORS = ['#60A5FA', '#34D399', '#F59E0B', '#A78BFA', '#F472B6'];

export default function DistributionChart({ title, data, donut = true }) {
  return (
    <article className="rounded-xl border border-slate-700/80 bg-slate-900/90 p-4 shadow-[0_10px_24px_rgba(2,6,23,0.34)]">
      <h4 className="mb-3 text-sm font-semibold text-slate-100">{title}</h4>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={donut ? 52 : 0}
              outerRadius={92}
            >
              {data.map((entry, idx) => (
                <Cell key={`${entry.name}-${idx}`} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
