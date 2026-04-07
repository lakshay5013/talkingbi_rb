import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, RefreshCcw, RotateCcw } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
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

const PIE_COLORS = ['#60A5FA', '#34D399', '#F59E0B', '#A78BFA', '#F472B6'];

function renderPieDataLabel({ name, percent }) {
  if (!percent || percent < 0.08) return '';
  return `${(percent * 100).toFixed(0)}%`;
}

const WIDGET_CHART_OPTIONS = [
  'Bar Chart',
  'Line Graph',
  'Pie Chart',
  'Donut Chart',
  'Column Chart',
  'Scatter Plot',
  'Area Chart',
  'Histogram',
  'Bubble Chart',
  'Stacked Bar Chart',
  'Treemap',
  'Radar (Spider) Chart',
  'Funnel Chart',
  'Sankey Diagram',
  'Heatmap',
  'Waterfall Chart',
  'Gantt Chart',
  'Box and Whisker Plot',
  'Bullet Graph',
  'Pictogram',
];

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

function renderWidgetChart(widget, darkMode) {
  const chartType = String(widget?.chartType || 'Bar Chart');
  const series = normalizeSeries(widget?.series);
  const scatter = toScatter(series);
  const settings = widget?.settings || {};
  const axisColor = darkMode ? '#CBD5E1' : '#475569';
  const gridColor = darkMode ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.25)';
  const lineColor = settings.lineColor || (darkMode ? '#60A5FA' : '#2563EB');
  const barColor = settings.barColor || (darkMode ? '#38BDF8' : '#0EA5E9');
  const lineWidth = Number(settings.lineWidth || 2.5);
  const xAxisLabel = settings.xAxisLabel || (chartType === 'Line Graph' || chartType === 'Area Chart' ? 'Months' : 'Categories');
  const yAxisLabel = settings.yAxisLabel || 'Value';
  const pieColors = Array.isArray(settings.pieColors) && settings.pieColors.length > 0
    ? settings.pieColors
    : PIE_COLORS;
  const activeBarStyle = { fill: barColor, stroke: barColor, strokeWidth: 1, opacity: 0.95 };
  const tooltipContentStyle = {
    background: darkMode ? '#0f172a' : '#ffffff',
    border: darkMode ? '1px solid #334155' : '1px solid #cbd5e1',
    borderRadius: '8px',
    color: darkMode ? '#f8fafc' : '#0f172a',
  };
  const tooltipLabelStyle = { color: darkMode ? '#f8fafc' : '#0f172a', fontWeight: 600 };
  const tooltipItemStyle = { color: darkMode ? '#f8fafc' : '#0f172a' };

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
          <Area type="monotone" dataKey="value" stroke={lineColor} fill={lineColor} fillOpacity={0.25} strokeWidth={lineWidth} />
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
            wrapperStyle={{ color: darkMode ? '#e2e8f0' : '#334155', fontSize: 10 }}
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

function WidgetEditPanel({ widget, onChange, premiumEnabled }) {
  if (!premiumEnabled) return null;

  const settings = widget?.settings || {};
  const chartType = String(widget?.chartType || '');
  const isLineLike = chartType === 'Line Graph' || chartType === 'Area Chart';
  const isBarLike = chartType === 'Bar Chart' || chartType === 'Column Chart' || chartType === 'Stacked Bar Chart' || chartType === 'Histogram';
  const isPieLike = chartType === 'Pie Chart' || chartType === 'Donut Chart' || chartType === 'Pictogram';
  const pieColors = Array.isArray(settings.pieColors) && settings.pieColors.length > 0
    ? settings.pieColors
    : PIE_COLORS;

  return (
    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/8 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-200">Premium edit</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {isBarLike ? (
          <label className="flex flex-col gap-1 text-xs text-slate-300">
            Bar color
            <input
              type="color"
              value={settings.barColor || '#3B82F6'}
              onChange={(event) => onChange({ settings: { barColor: event.target.value } })}
              className="h-9 w-full rounded border border-slate-700 bg-slate-950 p-1"
            />
          </label>
        ) : null}

        {isLineLike ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Line color
              <input
                type="color"
                value={settings.lineColor || '#60A5FA'}
                onChange={(event) => onChange({ settings: { lineColor: event.target.value } })}
                className="h-9 w-full rounded border border-slate-700 bg-slate-950 p-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Line thickness
              <input
                type="range"
                min="1"
                max="8"
                step="0.5"
                value={settings.lineWidth || 2.5}
                onChange={(event) => onChange({ settings: { lineWidth: Number(event.target.value) } })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              X label
              <input
                type="text"
                value={settings.xAxisLabel || 'Months'}
                onChange={(event) => onChange({ settings: { xAxisLabel: event.target.value } })}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Y label
              <input
                type="text"
                value={settings.yAxisLabel || 'Value'}
                onChange={(event) => onChange({ settings: { yAxisLabel: event.target.value } })}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none"
              />
            </label>
          </>
        ) : null}

        {isPieLike ? (
          <div className="sm:col-span-2">
            <div className="mb-1 text-xs text-slate-300">Pie colors</div>
            <div className="grid grid-cols-5 gap-2">
              {pieColors.slice(0, 5).map((color, idx) => (
                <label key={`${widget.id}-pie-color-${idx}`} className="flex flex-col gap-1 text-[11px] text-slate-400">
                  C{idx + 1}
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => {
                      const next = [...pieColors];
                      next[idx] = event.target.value;
                      onChange({ settings: { pieColors: next } });
                    }}
                    className="h-9 w-full rounded border border-slate-700 bg-slate-950 p-1"
                  />
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function Dashboard({ widgets = [], generationNote = '', darkMode = true, dashboardMode = 'standard', premiumEnabled = false, onWidgetChange, onBack, onRegenerate }) {
  const boardRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  const waitForPaint = async () => {
    if (document?.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch (_err) {
        // Ignore font readiness failures and continue export.
      }
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  };

  const UNSUPPORTED_COLOR_REGEX = /oklab|oklch|lch|lab|color\s*\(/gi;

  const isUnsupportedColor = (value) => {
    if (!value) return false;
    UNSUPPORTED_COLOR_REGEX.lastIndex = 0;
    return UNSUPPORTED_COLOR_REGEX.test(value);
  };

  const copyComputedStyles = (sourceNode, targetNode) => {
    if (!sourceNode || !targetNode || sourceNode.nodeType !== 1 || targetNode.nodeType !== 1) {
      return;
    }

    const computed = window.getComputedStyle(sourceNode);
    const targetStyle = targetNode.style;

    for (const propertyName of computed) {
      const value = computed.getPropertyValue(propertyName);
      const priority = computed.getPropertyPriority(propertyName);
      // Skip unsupported color values to avoid oklab parsing errors
      if (value && !isUnsupportedColor(value)) {
        targetStyle.setProperty(propertyName, value, priority);
      }
    }

    const sourceChildren = Array.from(sourceNode.children || []);
    const targetChildren = Array.from(targetNode.children || []);
    sourceChildren.forEach((child, index) => {
      if (targetChildren[index]) {
        copyComputedStyles(child, targetChildren[index]);
      }
    });
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

    // Also clean up style attribute if it has oklab
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

    // Recursively process children
    Array.from(element.children || []).forEach(child => stripUnsupportedColors(child));
  };

  const captureBoardCanvas = async () => {
    const target = boardRef.current;
    if (!target) {
      throw new Error('Dashboard container not found');
    }

    await waitForPaint();

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = `${target.getBoundingClientRect().width || 1200}px`;
    iframe.style.height = `${target.getBoundingClientRect().height || 900}px`;
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      iframe.remove();
      throw new Error('Unable to prepare export document');
    }

    iframeDoc.open();
    iframeDoc.write('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:' + (darkMode ? '#0b1220' : '#ffffff') + ';}</style></head><body></body></html>');
    iframeDoc.close();

    const clonedRoot = target.cloneNode(true);
    iframeDoc.body.appendChild(clonedRoot);
    copyComputedStyles(target, clonedRoot);
    stripUnsupportedColors(clonedRoot);

    try {
      const canvasPromise = html2canvas(clonedRoot, {
        scale: 1.5, // Reduced for faster rendering
        backgroundColor: darkMode ? '#0b1220' : '#ffffff',
        useCORS: true,
        allowTaint: true,
        logging: false,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Canvas capture timeout (primary)')), 30000)
      );

      return await Promise.race([canvasPromise, timeoutPromise]);
    } catch (_firstErr) {
      console.warn('Primary canvas capture failed, trying fallback:', _firstErr.message);
      const fallbackPromise = html2canvas(clonedRoot, {
        scale: 1,
        backgroundColor: darkMode ? '#0b1220' : '#ffffff',
        useCORS: true,
        allowTaint: true,
        foreignObjectRendering: false,
        logging: false,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Canvas capture timeout (fallback)')), 20000)
      );

      return await Promise.race([fallbackPromise, timeoutPromise]);
    } finally {
      iframe.remove();
    }
  };

  const downscaleCanvasForPdf = (sourceCanvas) => {
    const maxDimension = 2400;
    const { width, height } = sourceCanvas;
    const largest = Math.max(width, height);
    if (largest <= maxDimension) return sourceCanvas;

    const ratio = maxDimension / largest;
    const out = document.createElement('canvas');
    out.width = Math.round(width * ratio);
    out.height = Math.round(height * ratio);
    const ctx = out.getContext('2d');
    if (!ctx) return sourceCanvas;
    ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
    return out;
  };

  const downloadAs = async (format) => {
    if (!boardRef.current) {
      alert('Dashboard is not ready for export yet.');
      return;
    }

    setIsExporting(true);
    try {
      const canvas = await captureBoardCanvas();

      if (format === 'png') {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Unable to create PNG file');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `custom-dashboard-${Date.now()}.png`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          link.remove();
        }, 1500);
        return;
      }

      const pdfCanvas = downscaleCanvasForPdf(canvas);
      const image = pdfCanvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageRatio = pdfCanvas.width / pdfCanvas.height;

      let renderWidth = pageWidth - 36;
      let renderHeight = renderWidth / imageRatio;
      if (renderHeight > pageHeight - 36) {
        renderHeight = pageHeight - 36;
        renderWidth = renderHeight * imageRatio;
      }

      const x = (pageWidth - renderWidth) / 2;
      const y = (pageHeight - renderHeight) / 2;
      pdf.addImage(image, 'PNG', x, y, renderWidth, renderHeight, undefined, 'FAST');
      const pdfBlob = pdf.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const pdfLink = document.createElement('a');
      pdfLink.href = pdfUrl;
      pdfLink.download = `custom-dashboard-${Date.now()}.pdf`;
      pdfLink.style.display = 'none';
      document.body.appendChild(pdfLink);
      pdfLink.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(pdfUrl);
        pdfLink.remove();
      }, 1500);
    } catch (err) {
      alert(`Unable to download dashboard. ${err?.message ? `Reason: ${err.message}` : 'Please try again.'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-[0_16px_38px_rgba(2,6,23,0.45)]"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Step 2: Generated Dashboard</h3>
          <p className="text-sm text-slate-400">Power BI style analytics board generated from KPI + selected graphs + dataset filters.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={onBack}
          >
            <RotateCcw size={15} /> Back to Selection
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={onRegenerate}
          >
            <RefreshCcw size={15} /> Regenerate Dashboard
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => downloadAs('pdf')}
            disabled={isExporting}
          >
            <Download size={15} /> {isExporting ? 'Exporting...' : 'Download PDF'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => downloadAs('png')}
            disabled={isExporting}
          >
            <Download size={15} /> {isExporting ? 'Exporting...' : 'Download PNG'}
          </button>
        </div>
      </div>

      {generationNote ? <p className="mb-3 text-xs text-slate-300">{generationNote}</p> : null}

      <div ref={boardRef} className="rounded-2xl border border-slate-700/80 bg-[#0b1220] p-4">
        {widgets.some((item) => item.id === 'kpi-cards') && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {widgets.filter((item) => item.id !== 'kpi-cards').slice(0, 4).map((widget) => (
              <article key={`kpi-${widget.id}`} className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                <p className="text-xs text-slate-400">{widget.name}</p>
                <p className="mt-1 text-lg font-semibold text-slate-100">{widget.kpiValue || 'N/A'}</p>
                <p className="text-xs text-emerald-400">+{widget.kpiDelta || '0.0%'} </p>
              </article>
            ))}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {widgets.filter((item) => item.id !== 'kpi-cards').map((widget) => (
            <article key={widget.id} className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-100">{widget.name}</h4>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{widget.chartType}</span>
              </div>
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-slate-400">Chart Type</label>
                <select
                  value={widget.chartType}
                  onChange={(event) => onWidgetChange?.(widget.id, { chartType: event.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500"
                >
                  {WIDGET_CHART_OPTIONS.map((chartName) => (
                    <option key={`${widget.id}-option-${chartName}`} value={chartName}>
                      {chartName}
                    </option>
                  ))}
                </select>
              </div>
              {widget.failureReason ? (
                <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <span className="font-semibold">Why graph may not be accurate: </span>
                  {widget.failureReason}
                </div>
              ) : null}
              {widget.insightText ? (
                <div className="mb-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                  <span className="font-semibold">KPI Insight: </span>
                  {widget.insightText}
                </div>
              ) : null}
              {dashboardMode === 'premium' ? (
                <WidgetEditPanel
                  widget={widget}
                  premiumEnabled={premiumEnabled}
                  onChange={(patch) => onWidgetChange?.(widget.id, patch)}
                />
              ) : null}
              <div className="h-64">
                {renderWidgetChart(widget, darkMode)}
              </div>
            </article>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
