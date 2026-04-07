import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Moon, Sun } from 'lucide-react';
import ChartSelector, { CHART_OPTIONS } from './custom-dashboard/ChartSelector';
import Dashboard from './custom-dashboard/Dashboard';
import { apiGet, apiPost } from '../api';
import { parseKpiInput } from '../utils/smartDashboardUtils';

const ROW_LABEL_KEYS = ['name', 'category', 'state', 'region', 'customerType', 'product', 'month', 'date', 'label'];
const ROW_VALUE_KEYS = ['value', 'revenue', 'total', 'amount', 'profit', 'sales', 'count', 'orders', 'quantity'];

const isLineLikeChart = (title = '') => /line|area|histogram|gantt/i.test(title);

function firstMatchingKey(row, keys, fallback) {
  const found = keys.find((key) => Object.prototype.hasOwnProperty.call(row || {}, key));
  return found || fallback;
}

function toWidgetSeries(rows = [], chartTitle = '') {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const first = rows[0] || {};
  const labelKey = firstMatchingKey(first, ROW_LABEL_KEYS, 'name');
  const valueKey = firstMatchingKey(first, ROW_VALUE_KEYS, 'value');

  return rows
    .slice(0, isLineLikeChart(chartTitle) ? 12 : 8)
    .map((row, idx) => ({
      name: String(row?.[labelKey] ?? `Item ${idx + 1}`),
      value: Number(row?.[valueKey] ?? 0),
    }))
    .filter((row) => Number.isFinite(row.value));
}

function computeWidgetValue(series = []) {
  const total = series.reduce((sum, row) => sum + Number(row.value || 0), 0);
  return `INR ${Math.round(total / 1000)}K`;
}

function buildKpiInsight(kpiName = '', series = [], modelAnswer = '') {
  const text = String(modelAnswer || '').trim();
  if (text) return text;
  if (!Array.isArray(series) || series.length === 0) {
    return `No reliable data points were returned for ${kpiName}. Try broader filters or a clearer KPI phrase.`;
  }

  const topPoint = series.reduce((best, row) => (
    Number(row?.value || 0) > Number(best?.value || 0) ? row : best
  ), series[0]);

  return `Top observation for ${kpiName}: ${topPoint?.name || 'N/A'} at ${Number(topPoint?.value || 0).toLocaleString('en-IN')}.`;
}

function normalizeChartTitle(title = '') {
  const text = String(title).toLowerCase();
  if (/line|area|histogram|gantt/.test(text)) return 'time';
  if (/pie|donut|pictogram|funnel|treemap/.test(text)) return 'distribution';
  if (/scatter|bubble|heatmap/.test(text)) return 'scatter';
  return 'bar';
}

function mapKpiChartTypeToTitle(chartType = '') {
  const normalized = String(chartType || '').toLowerCase().trim();
  if (normalized === 'line') return 'Line Graph';
  if (normalized === 'pie') return 'Pie Chart';
  if (normalized === 'donut') return 'Donut Chart';
  return 'Bar Chart';
}

function buildFallbackFromEndpoints({ salesOverview, categoryAnalysis, regionalTrends }) {
  const lineSeries = Array.isArray(salesOverview?.monthlyRevenue)
    ? salesOverview.monthlyRevenue.map((row) => ({
      name: String(row?.month || ''),
      value: Number(row?.revenue || 0),
    }))
    : [];

  const categorySeries = Array.isArray(categoryAnalysis?.categorySales)
    ? categoryAnalysis.categorySales.map((row) => ({
      name: String(row?.name || 'Category'),
      value: Number(row?.value || 0),
    }))
    : [];

  const regionSeries = Array.isArray(regionalTrends?.topStates)
    ? regionalTrends.topStates.map((row) => ({
      name: String(row?.state || 'Region'),
      value: Number(row?.revenue || 0),
    }))
    : [];

  return {
    time: lineSeries,
    bar: categorySeries.length ? categorySeries : regionSeries,
    distribution: categorySeries.length ? categorySeries : regionSeries,
    scatter: lineSeries.length ? lineSeries : (categorySeries.length ? categorySeries : regionSeries),
  };
}

function createDefaultWidgetSettings(option) {
  const title = String(option?.title || '').toLowerCase();
  const isLineLike = /line graph|area chart/.test(title);
  const isPieLike = /pie chart|donut chart|pictogram/.test(title);

  return {
    barColor: '#3B82F6',
    lineColor: '#60A5FA',
    lineWidth: 2.5,
    xAxisLabel: isLineLike ? 'Months' : 'Categories',
    yAxisLabel: 'Value',
    segmentColor: '#60A5FA',
    pointColor: '#38BDF8',
    pieColors: ['#60A5FA', '#34D399', '#F59E0B', '#A78BFA', '#F472B6'],
    isLineLike,
    isPieLike,
  };
}

const mapKpisToChartSelection = (kpis = []) => {
  const selected = new Set();

  kpis.forEach((kpi) => {
    const text = String(kpi?.name || '').toLowerCase();

    if (/kpi|sales|profit|revenue|order/.test(text)) {
      selected.add('kpi-cards');
    }

    if (/trend|monthly|weekly|daily|growth|over time|timeline|forecast/.test(text)) {
      selected.add('line-graph');
    }

    if (/category/.test(text)) {
      selected.add('bar-chart');
    }

    if (/distribution|segment|share|mix|composition|ratio|split/.test(text)) {
      selected.add('pie-chart');
    }

    if (/region|state|zone|location|territory/.test(text)) {
      selected.add('column-chart');
    }

    if (/top|product|sku|item|brand|ranking/.test(text)) {
      selected.add('stacked-bar-chart');
    }
  });

  if (selected.size === 0) {
    return CHART_OPTIONS.map((item) => item.id);
  }

  return Array.from(selected);
};

export default function CustomDashboardBuilder({
  filters = {},
  initialConfig = null,
  onStateChange,
  onBeforeGenerate,
  currentPlanId = 'trial',
}) {
  const [step, setStep] = useState('select');
  const [selectedIds, setSelectedIds] = useState([]);
  const [widgets, setWidgets] = useState([]);
  const [generationNote, setGenerationNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [dashboardMode, setDashboardMode] = useState('standard');
  const [kpiPrompt, setKpiPrompt] = useState('');
  const [manualKpiInput, setManualKpiInput] = useState('');
  const [parsedKpis, setParsedKpis] = useState([]);
  const [hasParsedKpis, setHasParsedKpis] = useState(false);

  const normalizedPlanId = String(currentPlanId || 'trial')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

  const compactPlanId = normalizedPlanId.replace(/_/g, '');
  const isPremiumAllowed =
    normalizedPlanId === 'max_plus' ||
    normalizedPlanId === 'pro_max' ||
    compactPlanId === 'maxplus' ||
    compactPlanId === 'promax';

  const selectedCount = useMemo(() => selectedIds.length, [selectedIds]);

  const toggleSelection = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  const parseAndSuggest = () => {
    const parsed = parseKpiInput(kpiPrompt);
    setParsedKpis(parsed);
    setSelectedIds(mapKpisToChartSelection(parsed));
    setHasParsedKpis(true);
  };

  const addManualKpi = () => {
    const name = String(manualKpiInput || '').trim();
    if (!name) return;

    const exists = parsedKpis.some((item) => item.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      setManualKpiInput('');
      return;
    }

    const nextKpi = {
      id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
      name,
      chartType: 'bar',
    };

    const next = [...parsedKpis, nextKpi];
    setParsedKpis(next);
    setSelectedIds(mapKpisToChartSelection(next));
    setHasParsedKpis(true);
    setManualKpiInput('');
  };

  const removeManualKpi = (id) => {
    const next = parsedKpis.filter((item) => item.id !== id);
    setParsedKpis(next);
    setSelectedIds(mapKpisToChartSelection(next));
    setHasParsedKpis(next.length > 0);
  };

  const generate = async () => {
    if (typeof onBeforeGenerate === 'function') {
      const allowed = await onBeforeGenerate();
      if (!allowed) {
        return;
      }
    }

    setLoading(true);

    try {
      const activeKpis = parsedKpis.length ? parsedKpis : parseKpiInput(kpiPrompt);
      if (!activeKpis.length) {
        alert('Please enter at least one KPI.');
        setLoading(false);
        return;
      }

      if (!hasParsedKpis) {
        setParsedKpis(activeKpis);
        setHasParsedKpis(true);
      }

      const generationId =
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : `dg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      const useFallbackDataset = !filters?.useUserDb && !filters?.datasetId;
      let fallbackSeriesByFamily = {
        time: [],
        bar: [],
        distribution: [],
        scatter: [],
      };

      if (useFallbackDataset) {
        const [salesOverview, categoryAnalysis, regionalTrends] = await Promise.allSettled([
          apiGet('/api/dashboards/sales-overview', filters),
          apiGet('/api/dashboards/category-analysis', filters),
          apiGet('/api/dashboards/regional-trends', filters),
        ]);

        fallbackSeriesByFamily = buildFallbackFromEndpoints({
          salesOverview: salesOverview.status === 'fulfilled' ? salesOverview.value : null,
          categoryAnalysis: categoryAnalysis.status === 'fulfilled' ? categoryAnalysis.value : null,
          regionalTrends: regionalTrends.status === 'fulfilled' ? regionalTrends.value : null,
        });
      }

      const responses = await Promise.allSettled(
        activeKpis.map((kpi) =>
          apiPost('/api/chat', {
            query: `${kpi.name}. Build a chart using dataset-aware aggregation.`,
            filters,
            usageType: 'dashboard_generation',
            generationId,
          })
        )
      );

      const liveWidgets = activeKpis.map((kpi, index) => {
        const result = responses[index];
        const payload = result?.status === 'fulfilled' ? result.value : null;
        const initialChartTitle = mapKpiChartTypeToTitle(kpi.chartType);
        const primarySeries = toWidgetSeries(payload?.data || [], initialChartTitle);
        const family = normalizeChartTitle(initialChartTitle);
        const fallbackSeries = fallbackSeriesByFamily[family] || fallbackSeriesByFamily.bar || [];
        const series = primarySeries.length ? primarySeries : fallbackSeries;
        const hash = kpi.name.length * 13 + series.length * 17;
        const usedFallback = !primarySeries.length && fallbackSeries.length > 0;
        const hasAnySeries = series.length > 0;

        let failureReason = '';
        if (result?.status === 'rejected') {
          failureReason = result?.reason?.message
            ? `Live query failed: ${result.reason.message}`
            : 'Live query failed for this KPI.';
        } else if (!primarySeries.length && !fallbackSeries.length) {
          failureReason = 'No rows found for this KPI with current filters and dataset.';
        } else if (usedFallback) {
          failureReason = useFallbackDataset
            ? 'Live rows were not available, so fallback dataset values were used.'
            : 'Live rows were not available for current filters, fallback aggregation was used.';
        }

        return {
          id: kpi.id,
          name: kpi.name,
          chartType: initialChartTitle,
          series,
          settings: createDefaultWidgetSettings({ title: initialChartTitle }),
          kpiValue: hasAnySeries ? computeWidgetValue(series) : 'N/A',
          kpiDelta: `${(4 + (hash % 15)).toFixed(1)}%`,
          source: primarySeries.length ? 'live' : (usedFallback ? 'fallback' : 'empty'),
          failureReason,
          insightText: buildKpiInsight(kpi.name, series, payload?.answer),
        };
      });

      const liveCount = liveWidgets.filter((widget) => widget.source === 'live').length;
      setGenerationNote(
        liveCount > 0
          ? `Generated with ${liveCount}/${liveWidgets.length} live dataset-backed charts.`
          : (useFallbackDataset
            ? 'Database not connected. Dashboard generated using fallback app datasets (Orders + Details).'
            : 'Live chart data unavailable for this selection. Try changing KPI prompt or dataset filters.')
      );
      setWidgets(liveWidgets);
      setStep('dashboard');
    } catch (_err) {
      setGenerationNote('Live chart generation failed. Please retry.');
      setWidgets([]);
    } finally {
      setLoading(false);
    }
  };

  const regenerate = async () => {
    await generate();
  };

  useEffect(() => {
    if (!initialConfig || typeof initialConfig !== 'object') return;

    if (typeof initialConfig.kpiPrompt === 'string') {
      setKpiPrompt(initialConfig.kpiPrompt);
      setParsedKpis(parseKpiInput(initialConfig.kpiPrompt));
      setHasParsedKpis(true);
    }

    if (Array.isArray(initialConfig.selectedIds) && initialConfig.selectedIds.length > 0) {
      setSelectedIds(initialConfig.selectedIds);
    }

    if (Array.isArray(initialConfig.widgets)) {
      setWidgets(initialConfig.widgets);
    }

    if (typeof initialConfig.generationNote === 'string') {
      setGenerationNote(initialConfig.generationNote);
    }

    if (initialConfig.step === 'dashboard' || initialConfig.step === 'select') {
      setStep(initialConfig.step);
    }

    if (typeof initialConfig.darkMode === 'boolean') {
      setDarkMode(initialConfig.darkMode);
    }

    if (initialConfig.dashboardMode === 'premium' && isPremiumAllowed) {
      setDashboardMode('premium');
    }
  }, [initialConfig]);

  useEffect(() => {
    if (!isPremiumAllowed && dashboardMode === 'premium') {
      setDashboardMode('standard');
    }
  }, [dashboardMode, isPremiumAllowed]);

  const handleWidgetChange = (widgetId, patch) => {
    setWidgets((prev) => prev.map((widget) => (
      widget.id === widgetId
        ? { ...widget, ...patch, settings: { ...widget.settings, ...(patch.settings || {}) } }
        : widget
    )));
  };

  useEffect(() => {
    if (typeof onStateChange !== 'function') return;
    onStateChange({
      step,
      kpiPrompt,
      selectedIds,
      widgets,
      generationNote,
      darkMode,
      dashboardMode,
    });
  }, [step, kpiPrompt, selectedIds, widgets, generationNote, darkMode, dashboardMode, onStateChange]);

  return (
    <div className={`rounded-2xl border p-4 md:p-6 ${darkMode ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Custom Dashboard Builder</h2>
          <p className={`text-sm ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
            Enter KPI requirements and generate one graph per KPI in a unified dashboard.
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
          <div className={`rounded-full px-3 py-2 text-xs font-medium ${darkMode ? 'bg-slate-900 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
            {selectedCount} charts selected
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
        <div className="text-sm font-semibold text-slate-100">Dashboard Mode</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${dashboardMode === 'standard' ? 'bg-slate-100 text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            onClick={() => setDashboardMode('standard')}
          >
            Standard
          </button>
          <button
            type="button"
            disabled={!isPremiumAllowed}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${dashboardMode === 'premium' ? 'bg-amber-500 text-slate-950' : isPremiumAllowed ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'cursor-not-allowed bg-slate-800 text-slate-500'}`}
            onClick={() => isPremiumAllowed && setDashboardMode('premium')}
          >
            Premium Dashboard
          </button>
          {!isPremiumAllowed ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
              Locked for current plan
            </span>
          ) : null}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="builder-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`rounded-xl border p-10 text-center ${darkMode ? 'border-slate-700 bg-slate-900/70' : 'border-slate-200 bg-slate-100'}`}
          >
            <Loader2 className="mx-auto mb-3 animate-spin text-blue-500" size={28} />
            <p className="text-sm">Generating dashboard layout...</p>
          </motion.div>
        ) : step === 'select' ? (
          <motion.div key="selector" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <ChartSelector
              selectedIds={selectedIds}
              onToggle={toggleSelection}
              onGenerate={generate}
              kpiPrompt={kpiPrompt}
              manualKpiInput={manualKpiInput}
              onKpiPromptChange={(value) => {
                setKpiPrompt(value);
                setHasParsedKpis(false);
              }}
              onManualKpiInputChange={setManualKpiInput}
              onAddKpi={addManualKpi}
              onRemoveKpi={removeManualKpi}
              onParseKpis={parseAndSuggest}
              parsedKpis={parsedKpis}
              hasParsedKpis={hasParsedKpis}
            />
          </motion.div>
        ) : (
          <motion.div key="dashboard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Dashboard
              widgets={widgets}
              darkMode={darkMode}
              generationNote={generationNote}
              dashboardMode={dashboardMode}
              premiumEnabled={isPremiumAllowed}
              onWidgetChange={handleWidgetChange}
              onBack={() => setStep('select')}
              onRegenerate={regenerate}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
