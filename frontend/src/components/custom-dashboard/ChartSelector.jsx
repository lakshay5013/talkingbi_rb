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
    <section className="rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-[0_12px_36px_rgba(2,6,23,0.45)]">
      <div className="mb-5 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <h3 className="text-lg font-semibold text-slate-100">Step 1: Tell KPI Requirement</h3>
        <p className="mt-1 text-sm text-slate-400">Graph type will be auto-selected based on each KPI, and you can change it later using toggles on dashboard cards.</p>

        <div className="mt-3 flex flex-col gap-3">
          <textarea
            value={kpiPrompt}
            onChange={(event) => onKpiPromptChange(event.target.value)}
            className="min-h-[82px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500"
            placeholder="Enter KPI goals..."
          />
          <div className="flex flex-col gap-2 sm:flex-row">
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
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500"
              placeholder="Add KPI manually (e.g. Profit by State)"
            />
            <button
              type="button"
              onClick={onAddKpi}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Plus size={14} /> Add KPI
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onParseKpis}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700"
            >
              Analyze KPI
            </button>
            <span className={`text-xs ${hasParsedKpis ? 'text-emerald-400' : 'text-amber-400'}`}>
              {hasParsedKpis ? 'KPI analyzed' : 'You can generate directly too'}
            </span>
          </div>
        </div>

        {parsedKpis?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {parsedKpis.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-950 px-3 py-1 text-xs text-slate-300"
              >
                {item.name}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
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

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          onClick={onGenerate}
        >
          Generate Dashboard
        </button>
      </div>
    </section>
  );
}
