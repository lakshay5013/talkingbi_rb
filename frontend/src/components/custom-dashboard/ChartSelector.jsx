import React from 'react';
import {
  LayoutGrid,
  TrendingUp,
  BarChart3,
  PieChart,
  MapPinned,
  Boxes,
  ClipboardList,
  Plus,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as MiniPieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  FunnelChart,
  Funnel,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
} from 'recharts';

const MINI_LINE = [
  { x: 'M1', value: 20 },
  { x: 'M2', value: 28 },
  { x: 'M3', value: 22 },
  { x: 'M4', value: 34 },
  { x: 'M5', value: 29 },
];

const MINI_BAR = [
  { x: 'A', value: 35 },
  { x: 'B', value: 48 },
  { x: 'C', value: 42 },
  { x: 'D', value: 30 },
];

const MINI_SCATTER = [
  { x: 1, y: 12 },
  { x: 2, y: 18 },
  { x: 3, y: 15 },
  { x: 4, y: 23 },
  { x: 5, y: 19 },
];

const MINI_FUNNEL = [
  { name: 'Stage 1', value: 100 },
  { name: 'Stage 2', value: 72 },
  { name: 'Stage 3', value: 46 },
  { name: 'Stage 4', value: 25 },
];

const MINI_RADAR = [
  { name: 'A', value: 32 },
  { name: 'B', value: 46 },
  { name: 'C', value: 28 },
  { name: 'D', value: 40 },
  { name: 'E', value: 35 },
];

const MINI_PIE = [
  { name: 'A', value: 45 },
  { name: 'B', value: 32 },
  { name: 'C', value: 23 },
];

const MINI_COLORS = ['#60A5FA', '#34D399', '#F59E0B'];

export const CHART_OPTIONS = [
  { id: 'bar-chart', title: 'Bar Chart', subtitle: 'Category comparison', icon: BarChart3, family: 'comparison', chartType: 'bar', previewType: 'bar' },
  { id: 'line-graph', title: 'Line Graph', subtitle: 'Time trend', icon: TrendingUp, family: 'trend', chartType: 'line', previewType: 'line' },
  { id: 'pie-chart', title: 'Pie Chart', subtitle: 'Share distribution', icon: PieChart, family: 'distribution', chartType: 'pie', previewType: 'pie' },
  { id: 'column-chart', title: 'Column Chart', subtitle: 'Vertical bars', icon: BarChart3, family: 'comparison', chartType: 'bar', previewType: 'bar' },
  { id: 'scatter-plot', title: 'Scatter Plot', subtitle: 'Correlation points', icon: MapPinned, family: 'comparison', chartType: 'scatter', previewType: 'scatter' },
  { id: 'area-chart', title: 'Area Chart', subtitle: 'Trend area', icon: TrendingUp, family: 'trend', chartType: 'line', previewType: 'area' },
  { id: 'histogram', title: 'Histogram', subtitle: 'Distribution bins', icon: BarChart3, family: 'comparison', chartType: 'bar', previewType: 'bar' },
  { id: 'donut-chart', title: 'Donut Chart', subtitle: 'Ring distribution', icon: PieChart, family: 'distribution', chartType: 'donut', previewType: 'donut' },
  { id: 'bubble-chart', title: 'Bubble Chart', subtitle: 'Bubble correlation', icon: MapPinned, family: 'comparison', chartType: 'scatter', previewType: 'scatter' },
  { id: 'stacked-bar-chart', title: 'Stacked Bar Chart', subtitle: 'Split category totals', icon: BarChart3, family: 'comparison', chartType: 'bar', previewType: 'stackedBar' },
  { id: 'treemap', title: 'Treemap', subtitle: 'Nested share', icon: Boxes, family: 'distribution', chartType: 'bar', previewType: 'donut' },
  { id: 'radar-spider-chart', title: 'Radar (Spider) Chart', subtitle: 'Multi-metric shape', icon: MapPinned, family: 'comparison', chartType: 'bar', previewType: 'radar' },
  { id: 'funnel-chart', title: 'Funnel Chart', subtitle: 'Stage conversion', icon: BarChart3, family: 'distribution', chartType: 'bar', previewType: 'funnel' },
  { id: 'sankey-diagram', title: 'Sankey Diagram', subtitle: 'Flow movement', icon: Boxes, family: 'distribution', chartType: 'bar', previewType: 'stackedBar' },
  { id: 'heatmap', title: 'Heatmap', subtitle: 'Intensity matrix', icon: MapPinned, family: 'comparison', chartType: 'scatter', previewType: 'scatter' },
  { id: 'waterfall-chart', title: 'Waterfall Chart', subtitle: 'Incremental impact', icon: BarChart3, family: 'comparison', chartType: 'bar', previewType: 'bar' },
  { id: 'gantt-chart', title: 'Gantt Chart', subtitle: 'Timeline tasks', icon: BarChart3, family: 'comparison', chartType: 'bar', previewType: 'bar' },
  { id: 'box-and-whisker-plot', title: 'Box and Whisker Plot', subtitle: 'Spread and quartiles', icon: MapPinned, family: 'comparison', chartType: 'bar', previewType: 'bar' },
  { id: 'bullet-graph', title: 'Bullet Graph', subtitle: 'Target vs actual', icon: TrendingUp, family: 'comparison', chartType: 'bar', previewType: 'bar' },
  { id: 'pictogram', title: 'Pictogram', subtitle: 'Iconic share view', icon: PieChart, family: 'distribution', chartType: 'donut', previewType: 'donut' },
  { id: 'kpi-cards', title: 'KPI Cards', subtitle: 'Sales / Profit / Orders / Returns', icon: ClipboardList, family: 'kpi', chartType: 'kpi', previewType: 'kpi' },
];

function MiniPreview({ type }) {
  if (type === 'line') {
    return (
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={MINI_LINE}>
            <Line type="monotone" dataKey="value" stroke="#60A5FA" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'area') {
    return (
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={MINI_LINE}>
            <Area type="monotone" dataKey="value" stroke="#60A5FA" fill="#60A5FA" fillOpacity={0.25} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'bar' || type === 'horizontalBar' || type === 'stackedBar') {
    return (
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={MINI_BAR} layout={type === 'horizontalBar' ? 'vertical' : 'horizontal'}>
            {type === 'stackedBar' ? (
              <>
                <Bar stackId="s" dataKey="value" fill="#38BDF8" />
                <Bar stackId="s" dataKey="value" fill="#60A5FA" opacity={0.4} />
              </>
            ) : (
              <Bar dataKey="value" fill="#38BDF8" />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'scatter') {
    return (
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <Scatter data={MINI_SCATTER} fill="#60A5FA" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'funnel') {
    return (
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Funnel data={MINI_FUNNEL} dataKey="value" isAnimationActive={false}>
              {MINI_FUNNEL.map((entry, idx) => (
                <Cell key={`${entry.name}-${idx}`} fill={MINI_COLORS[idx % MINI_COLORS.length]} />
              ))}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'radar') {
    return (
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={MINI_RADAR}>
            <PolarGrid />
            <PolarAngleAxis dataKey="name" tick={false} />
            <Radar dataKey="value" stroke="#60A5FA" fill="#60A5FA" fillOpacity={0.25} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === 'donut' || type === 'pie') {
    return (
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <MiniPieChart>
            <Pie data={MINI_PIE} dataKey="value" innerRadius={type === 'donut' ? 12 : 0} outerRadius={20}>
              {MINI_PIE.map((entry, idx) => (
                <Cell key={`${entry.name}-${idx}`} fill={MINI_COLORS[idx % MINI_COLORS.length]} />
              ))}
            </Pie>
          </MiniPieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="flex h-14 w-full items-center justify-center rounded-md border border-dashed border-slate-600 text-[11px] text-slate-400">
      KPI Cards Preview
    </div>
  );
}

export default function ChartSelector({
  selectedIds,
  onToggle,
  onGenerate,
  kpiPrompt,
  manualKpiInput,
  onKpiPromptChange,
  onManualKpiInputChange,
  onAddKpi,
  onRemoveKpi,
  onParseKpis,
  parsedKpis,
  hasParsedKpis,
}) {
  return (
    <section className="rounded-2xl bg-transparent p-0">
      <div className="mb-6 rounded-[20px] border border-[#BFDBFE] bg-[rgba(219,234,254,0.25)] p-5 md:p-6">
        <h3 className="text-xl font-bold tracking-[-0.01em] text-[#111827]">Step 1: Tell KPI Requirement</h3>
        <p className="mt-1.5 text-sm text-[#6B7280]">Graph type will be auto-selected based on each KPI, and you can change it later using toggles on dashboard cards.</p>

        <div className="mt-4 flex flex-col gap-3">
          <textarea
            value={kpiPrompt}
            onChange={(event) => onKpiPromptChange(event.target.value)}
            className="min-h-[104px] w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm text-[#111827] shadow-[0_1px_2px_rgba(17,24,39,0.05)] outline-none transition-all duration-300 placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:ring-4 focus:ring-[rgba(37,99,235,0.16)]"
            placeholder="Enter KPI goals..."
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={manualKpiInput || ''}
              onChange={(event) => onManualKpiInputChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAddKpi?.();
                }
              }}
              className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm text-[#111827] shadow-[0_1px_2px_rgba(17,24,39,0.05)] outline-none transition-all duration-300 placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:ring-4 focus:ring-[rgba(37,99,235,0.16)]"
              placeholder="Add KPI manually (e.g. Profit by State)"
            />
            <button
              type="button"
              onClick={onAddKpi}
              className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2563EB,#3B82F6)] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(37,99,235,0.34)]"
            >
              <Plus size={14} /> Add KPI
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onParseKpis}
              className="rounded-xl border border-[#2563EB] bg-white px-4 py-2 text-sm font-semibold text-[#2563EB] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#EFF6FF]"
            >
              Analyze KPI
            </button>
            <span className={`text-xs font-semibold ${hasParsedKpis ? 'text-[#2563EB]' : 'text-[#6B7280]'}`}>
              {hasParsedKpis ? 'KPI analyzed' : 'You can generate directly too'}
            </span>
          </div>
        </div>

        {parsedKpis?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {parsedKpis.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-2 rounded-full border border-[#BFDBFE] bg-white px-3 py-1.5 text-xs font-medium text-[#1D4ED8] shadow-[0_1px_2px_rgba(17,24,39,0.04)]"
              >
                {item.name}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-[#6B7280] transition hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                  onClick={() => onRemoveKpi?.(item.id)}
                  aria-label={`Remove ${item.name}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="inline-flex min-h-[48px] items-center rounded-xl bg-[linear-gradient(135deg,#2563EB,#3B82F6)] px-6 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(37,99,235,0.36)]"
          onClick={onGenerate}
        >
          Generate Dashboard
        </button>
      </div>
    </section>
  );
}
