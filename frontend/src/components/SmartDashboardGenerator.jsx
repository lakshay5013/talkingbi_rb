import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  Legend,
} from 'recharts';
import { Download, Moon, RefreshCcw, Sparkles, Sun } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { apiPost } from '../api';
import { buildDashboardWidgets, inferChartType, parseKpiInput } from '../utils/smartDashboardUtils';

const PIE_COLORS = ['#60A5FA', '#34D399', '#F59E0B', '#A78BFA', '#F472B6'];

function chartTypeLabel(type) {
  if (type === 'line') return 'Line';
  if (type === 'bar') return 'Bar';
  if (type === 'donut') return 'Donut';
  return 'Pie';
}

const ROW_LABEL_KEYS = ['name', 'category', 'state', 'region', 'customerType', 'product', 'month', 'date', 'label'];
const ROW_VALUE_KEYS = ['value', 'revenue', 'total', 'amount', 'profit', 'sales', 'count', 'orders', 'quantity'];

function normalizeChartType(rawType, kpiName) {
  const normalized = String(rawType || '').toLowerCase().trim();
  if (normalized === 'line') return 'line';
  if (normalized === 'bar') return 'bar';
  if (normalized === 'pie') return 'pie';
  if (normalized === 'donut') return 'donut';
  return inferChartType(kpiName);
}

function firstMatchingKey(row, keys, fallback) {
  const found = keys.find((key) => Object.prototype.hasOwnProperty.call(row || {}, key));
  return found || fallback;
}

function toWidgetSeries(rows = [], chartType = 'bar') {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const first = rows[0] || {};
  const labelKey = firstMatchingKey(first, ROW_LABEL_KEYS, 'name');
  const valueKey = firstMatchingKey(first, ROW_VALUE_KEYS, 'value');

  const normalized = rows
    .slice(0, chartType === 'line' ? 12 : 8)
    .map((row, idx) => ({
      name: String(row?.[labelKey] ?? `Item ${idx + 1}`),
      value: Number(row?.[valueKey] ?? 0),
    }))
    .filter((row) => Number.isFinite(row.value));

  return normalized;
}

function computeWidgetValue(series = [], chartType = 'bar') {
  const total = series.reduce((sum, row) => sum + Number(row.value || 0), 0);
  if (chartType === 'line' || chartType === 'bar') {
    return `INR ${Math.round(total / 1000)}K`;
  }
  return `${Math.round(total)}%`;
}

function buildLiveWidget(kpi, payload, fallbackWidget) {
  const chartType = normalizeChartType(payload?.chartType, kpi.name);
  const series = toWidgetSeries(payload?.data || [], chartType);

  if (!series.length) {
    return {
      ...fallbackWidget,
      source: 'fallback',
      answer: payload?.answer || '',
    };
  }

  const hash = kpi.name.length * 17 + series.length * 11;
  return {
    ...kpi,
    chartType,
    series,
    kpiValue: computeWidgetValue(series, chartType),
    kpiDelta: `${(5 + (hash % 13)).toFixed(1)}%`,
    source: 'live',
    answer: payload?.answer || '',
  };
}

function renderWidgetChart(widget, darkMode) {
  const axisColor = darkMode ? '#CBD5E1' : '#475569';
  const gridColor = darkMode ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.25)';
  const lineColor = darkMode ? '#60A5FA' : '#2563EB';
  const barColor = darkMode ? '#38BDF8' : '#0EA5E9';

  if (widget.chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={widget.series}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 11 }} />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="value" stroke={lineColor} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (widget.chartType === 'bar') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={widget.series}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 11 }} />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" fill={barColor} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const pieInnerRadius = widget.chartType === 'donut' ? 48 : 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip />
        <Legend />
        <Pie data={widget.series} dataKey="value" nameKey="name" innerRadius={pieInnerRadius} outerRadius={90}>
          {widget.series.map((entry, idx) => (
            <Cell key={`${widget.id}-${entry.name}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export default function SmartDashboardGenerator({ filters = {} }) {
  const [inputText, setInputText] = useState('Total sales, profit by category, monthly trend, top products');
  const [parsedKpis, setParsedKpis] = useState([]);
  const [selectedKpiIds, setSelectedKpiIds] = useState([]);
  const [dashboardWidgets, setDashboardWidgets] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [generationNote, setGenerationNote] = useState('');
  const dashboardRef = useRef(null);

  const selectedKpis = useMemo(
    () => parsedKpis.filter((kpi) => selectedKpiIds.includes(kpi.id)),
    [parsedKpis, selectedKpiIds]
  );

  const parseKpis = () => {
    const next = parseKpiInput(inputText);
    setParsedKpis(next);
    setSelectedKpiIds(next.map((item) => item.id));
  };

  const toggleKpi = (id) => {
    setSelectedKpiIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  const generateDashboard = async () => {
    const active = selectedKpis;
    if (!active.length) {
      alert('Select at least one KPI to generate dashboard.');
      return;
    }

    setIsGenerating(true);
    setGenerationNote('Fetching live KPI insights from your current data source...');

    try {
      const generationId =
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : `sg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      const fallback = buildDashboardWidgets(active);
      const responses = await Promise.allSettled(
        active.map((kpi) =>
          apiPost('/api/chat', {
            query: kpi.name,
            filters,
            usageType: 'dashboard_generation',
            generationId,
          })
        )
      );

      const widgets = active.map((kpi, idx) => {
        const result = responses[idx];
        if (result?.status !== 'fulfilled') return { ...fallback[idx], source: 'fallback' };
        return buildLiveWidget(kpi, result.value, fallback[idx]);
      });

      const liveCount = widgets.filter((widget) => widget.source === 'live').length;
      setGenerationNote(
        liveCount > 0
          ? `Generated with ${liveCount}/${widgets.length} live KPI data feeds.`
          : 'Live KPI data unavailable for this selection, showing structured fallback dashboard.'
      );
      setDashboardWidgets(widgets);
    } catch (_err) {
      setGenerationNote('Live generation failed. Showing structured fallback dashboard.');
      setDashboardWidgets(buildDashboardWidgets(active));
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateDashboard = async () => {
    if (!dashboardWidgets.length) return;
    await generateDashboard();
  };

  const UNSUPPORTED_COLOR_REGEX = /oklab|oklch|lch|lab|color\s*\(/gi;

  const isUnsupportedColor = (value) => {
    if (!value) return false;
    UNSUPPORTED_COLOR_REGEX.lastIndex = 0;
    return UNSUPPORTED_COLOR_REGEX.test(value);
  };

  const stripUnsupportedColors = (element) => {
    if (!element || element.nodeType !== 1) return;
    const style = element.style;
    const colorProps = ['color', 'backgroundColor', 'borderColor', 'boxShadow', 'textShadow', 'fill', 'stroke'];
    colorProps.forEach((prop) => {
      const value = style.getPropertyValue(prop);
      if (isUnsupportedColor(value)) {
        style.removeProperty(prop);
      }
    });
    const styleAttr = element.getAttribute('style');
    if (styleAttr && isUnsupportedColor(styleAttr)) {
      const cleaned = styleAttr
        .split(';')
        .filter(rule => !isUnsupportedColor(rule))
        .join(';');
      if (cleaned.trim()) {
        element.setAttribute('style', cleaned);
      } else {
        element.removeAttribute('style');
      }
    }
    Array.from(element.children || []).forEach(child => stripUnsupportedColors(child));
  };

  const downloadDashboard = async (format) => {
    if (!dashboardRef.current) {
      alert('Dashboard is not ready yet. Please wait for generation to complete.');
      return;
    }

    setIsDownloading(true);
    try {
      const clonedElement = dashboardRef.current.cloneNode(true);
      stripUnsupportedColors(clonedElement);

      // Timeout wrapper for html2canvas (30 seconds max)
      const canvasPromise = html2canvas(clonedElement, {
        scale: 1.5, // Reduced from 2 for faster capture
        useCORS: true,
        allowTaint: true,
        backgroundColor: darkMode ? '#0b1220' : '#f8fafc',
        logging: false,
        windowHeight: clonedElement.scrollHeight,
        windowWidth: clonedElement.scrollWidth,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Export timeout: Dashboard capture took too long')), 30000)
      );

      const canvas = await Promise.race([canvasPromise, timeoutPromise]);

      if (!canvas) throw new Error('Failed to capture dashboard');

      if (format === 'png') {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'smart-dashboard.png';
        link.click();
        return;
      }

      const image = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(image, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save('smart-dashboard.pdf');
    } catch (err) {
      const errorMsg = err?.message || 'Unknown error occurred';
      alert(`Download failed: ${errorMsg}`);
      console.error('Dashboard download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={`rounded-2xl border p-4 md:p-6 ${darkMode ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Smart Dashboard Generator</h2>
          <p className={`text-sm ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
            Generate Power BI style dashboards from KPI prompts without changing existing reports flow.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${darkMode ? 'border-slate-600 bg-slate-900 hover:bg-slate-800' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
            onClick={() => setDarkMode((prev) => !prev)}
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />} {darkMode ? 'Light' : 'Dark'} Mode
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={parseKpis}
          >
            <Sparkles size={15} /> Parse KPIs
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className={`rounded-xl border p-4 ${darkMode ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50'}`}>
          <label className="mb-2 block text-sm font-semibold">KPI Input</label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            className={`w-full rounded-lg border p-3 text-sm outline-none ${darkMode ? 'border-slate-600 bg-slate-950 text-slate-100 placeholder:text-slate-500' : 'border-slate-300 bg-white text-slate-800 placeholder:text-slate-400'}`}
            placeholder="Type KPIs like: total sales, profit by category, monthly trend"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              onClick={generateDashboard}
            >
              Generate Dashboard
            </button>
            <button
              type="button"
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${darkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}`}
              onClick={regenerateDashboard}
            >
              <span className="inline-flex items-center gap-2"><RefreshCcw size={14} /> Regenerate</span>
            </button>
          </div>
        </section>

        <section className={`rounded-xl border p-4 ${darkMode ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50'}`}>
          <h3 className="mb-2 text-sm font-semibold">KPI Selection</h3>
          {!parsedKpis.length ? (
            <p className={`text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Click Parse KPIs to show selectable KPI cards.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {parsedKpis.map((kpi) => {
                const selected = selectedKpiIds.includes(kpi.id);
                return (
                  <button
                    type="button"
                    key={kpi.id}
                    onClick={() => toggleKpi(kpi.id)}
                    className={`rounded-lg border p-3 text-left transition ${selected
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : darkMode
                        ? 'border-slate-700 bg-slate-950 hover:border-slate-500'
                        : 'border-slate-300 bg-white hover:border-slate-400'
                      }`}
                  >
                    <p className="text-sm font-semibold">{kpi.name}</p>
                    <p className="mt-1 text-xs opacity-80">Suggested chart: {chartTypeLabel(kpi.chartType)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => downloadDashboard('pdf')}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!dashboardWidgets.length || isDownloading}
        >
          <Download size={15} /> {isDownloading ? 'Downloading...' : 'Download PDF'}
        </button>
        <button
          type="button"
          onClick={() => downloadDashboard('png')}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!dashboardWidgets.length || isDownloading}
        >
          <Download size={15} /> {isDownloading ? 'Downloading...' : 'Download PNG'}
        </button>
      </div>

      {generationNote ? (
        <p className={`mt-3 text-xs ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>{generationNote}</p>
      ) : null}

      <AnimatePresence mode="wait">
        {isGenerating ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`mt-4 rounded-xl border p-6 text-center ${darkMode ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-slate-100'}`}
          >
            <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm">Generating dashboard layout...</p>
          </motion.div>
        ) : dashboardWidgets.length > 0 ? (
          <motion.section
            key="dashboard"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            ref={dashboardRef}
            className={`mt-4 rounded-2xl border p-4 ${darkMode ? 'border-slate-700 bg-[#0b1220]' : 'border-slate-200 bg-slate-100'}`}
          >
            <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {dashboardWidgets.slice(0, 4).map((widget) => (
                <article key={`kpi-${widget.id}`} className={`rounded-xl border p-3 ${darkMode ? 'border-slate-700 bg-slate-900/80' : 'border-slate-200 bg-white'}`}>
                  <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{widget.name}</p>
                  <p className="mt-1 text-lg font-semibold">{widget.kpiValue}</p>
                  <p className="text-xs text-emerald-500">+{widget.kpiDelta}</p>
                </article>
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {dashboardWidgets.map((widget) => (
                <article key={widget.id} className={`rounded-xl border p-3 ${darkMode ? 'border-slate-700 bg-slate-900/80' : 'border-slate-200 bg-white'}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold">{widget.name}</h4>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                      {chartTypeLabel(widget.chartType)}
                    </span>
                  </div>
                  <div className="h-64">
                    {renderWidgetChart(widget, darkMode)}
                  </div>
                </article>
              ))}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
