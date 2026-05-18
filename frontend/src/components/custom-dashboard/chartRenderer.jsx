import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ScatterChart,
  Scatter,
  ZAxis,
  AreaChart,
  Area,
  Treemap,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  FunnelChart,
  Funnel,
  Sankey,
  Legend,
} from 'recharts';

export const PIE_COLORS = ['#60A5FA', '#34D399', '#F59E0B', '#A78BFA', '#F472B6'];

function renderPieDataLabel({ name, percent }) {
  if (!percent || percent < 0.08) return '';
  return `${(percent * 100).toFixed(0)}%`;
}

function compactLegendName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > 10 ? `${text.slice(0, 10)}...` : text;
}

function normalizeSeries(series = []) {
  if (!Array.isArray(series) || series.length === 0) {
    return [
      { name: 'A', value: 10 },
      { name: 'B', value: 14 },
      { name: 'C', value: 8 },
      { name: 'D', value: 13 },
    ];
  }
  return series.map((item, idx) => ({
    name: String(item?.name ?? `Item ${idx + 1}`),
    value: Number(item?.value ?? 0),
  }));
}

function toScatter(series = []) {
  return normalizeSeries(series).map((item, idx) => ({
    x: idx + 1,
    y: Number(item.value || 0),
    z: Math.max(60, Math.round(Number(item.value || 0) / 10)),
    name: item.name,
  }));
}

export function renderWidgetChart(widget, darkMode) {
  const _unusedDarkMode = darkMode;
  const chartType = String(widget?.chartType || 'Bar Chart');
  const series = normalizeSeries(widget?.series);
  const scatter = toScatter(series);
  const settings = widget?.settings || {};
  const axisColor = '#6B7280';
  const gridColor = 'rgba(148,163,184,0.2)';
  const lineColor = settings.lineColor || '#3B82F6';
  const barColor = settings.barColor || '#3B82F6';
  const lineWidth = Number(settings.lineWidth || 2.5);
  const xAxisLabel = settings.xAxisLabel || (chartType === 'Line Graph' || chartType === 'Area Chart' ? 'Months' : 'Categories');
  const yAxisLabel = settings.yAxisLabel || 'Value';
  const pieColors = Array.isArray(settings.pieColors) && settings.pieColors.length > 0
    ? settings.pieColors
    : PIE_COLORS;
  const activeBarStyle = { fill: barColor, stroke: barColor, strokeWidth: 1, opacity: 0.95 };
  const tooltipContentStyle = {
    background: '#ffffff',
    border: '1px solid #E5E7EB',
    borderRadius: '12px',
    color: '#111827',
    boxShadow: '0 10px 24px rgba(37,99,235,0.12)',
  };
  const tooltipLabelStyle = { color: '#111827', fontWeight: 700 };
  const tooltipItemStyle = { color: '#111827' };

  if (chartType === 'Line Graph') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 11 }} label={{ value: xAxisLabel, position: 'insideBottom', offset: -6, fill: axisColor }} />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: axisColor }} />
          <Tooltip cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: '3 3' }} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
          <Line type="monotone" dataKey="value" stroke={lineColor} strokeWidth={lineWidth} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Area Chart') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 11 }} label={{ value: xAxisLabel, position: 'insideBottom', offset: -6, fill: axisColor }} />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: axisColor }} />
          <Tooltip cursor={{ fill: 'rgba(59,130,246,0.14)' }} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
          <Area type="monotone" dataKey="value" stroke={lineColor} fill={lineColor} fillOpacity={0.18} strokeWidth={lineWidth} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Pie Chart' || chartType === 'Donut Chart' || chartType === 'Pictogram') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
          <Pie
            data={series}
            dataKey="value"
            nameKey="name"
            innerRadius={chartType === 'Donut Chart' ? 48 : 0}
            outerRadius={84}
            labelLine={false}
            label={renderPieDataLabel}
            fontSize={10}
          >
            {series.map((entry, idx) => (
              <Cell key={`${widget.id}-${entry.name}`} fill={pieColors[idx % pieColors.length]} />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            height={30}
            wrapperStyle={{ color: '#6B7280', fontSize: 10 }}
            formatter={(value) => compactLegendName(value)}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Scatter Plot' || chartType === 'Bubble Chart' || chartType === 'Heatmap') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis type="number" dataKey="x" tick={{ fill: axisColor, fontSize: 11 }} />
          <YAxis type="number" dataKey="y" tick={{ fill: axisColor, fontSize: 11 }} />
          <ZAxis type="number" dataKey="z" range={chartType === 'Bubble Chart' ? [80, 700] : [50, 350]} />
          <Tooltip cursor={{ stroke: barColor, strokeWidth: 1, strokeDasharray: '3 3' }} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
          <Scatter data={scatter} fill={barColor} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Stacked Bar Chart') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={series.map((item) => ({
            name: item.name,
            actual: Math.round(item.value * 0.7),
            projected: Math.round(item.value * 0.3),
          }))}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 11 }} />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} />
          <Tooltip cursor={{ fill: 'rgba(59,130,246,0.14)' }} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
          <Bar stackId="stack" dataKey="actual" fill={barColor} activeBar={activeBarStyle} />
          <Bar stackId="stack" dataKey="projected" fill="#10B981" activeBar={{ fill: '#10B981', stroke: '#10B981', strokeWidth: 1, opacity: 0.95 }} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Treemap') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Treemap data={series.map((item) => ({ name: item.name, size: item.value }))} dataKey="size" stroke="#FFFFFF" fill="#3B82F6" />
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Radar (Spider) Chart') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={series}>
          <PolarGrid stroke={gridColor} />
          <PolarAngleAxis dataKey="name" stroke={axisColor} />
          <PolarRadiusAxis stroke={axisColor} />
          <Radar name="Value" dataKey="value" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.35} />
          <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Funnel Chart') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <FunnelChart>
          <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
          <Funnel dataKey="value" data={series} isAnimationActive nameKey="name">
            {series.map((entry, idx) => (
              <Cell key={`${widget.id}-funnel-${entry.name}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
            ))}
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'Sankey Diagram') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{
            nodes: series.map((item) => ({ name: item.name })),
            links: series.slice(0, Math.max(series.length - 1, 0)).map((item, idx) => ({
              source: idx,
              target: idx + 1,
              value: Math.max(1, Math.round(item.value / 1000)),
            })),
          }}
          nodePadding={30}
          nodeWidth={12}
        />
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={series}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 11 }} />
        <YAxis tick={{ fill: axisColor, fontSize: 11 }} />
        <Tooltip cursor={{ fill: 'rgba(59,130,246,0.14)' }} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
        <Bar dataKey="value" fill={barColor} radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default renderWidgetChart;
