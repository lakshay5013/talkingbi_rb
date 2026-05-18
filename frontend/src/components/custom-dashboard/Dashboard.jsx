import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, RefreshCcw, RotateCcw } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { createRoot } from 'react-dom/client';
import { renderWidgetChart, PIE_COLORS } from './chartRenderer.jsx';
import ExportDashboardView from './ExportDashboardView';

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
    <div className="mb-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#2563EB]">Premium edit</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {isBarLike ? (
          <label className="flex flex-col gap-1 text-xs text-[#6B7280]">
            Bar color
            <input
              type="color"
              value={settings.barColor || '#3B82F6'}
              onChange={(event) => onChange({ settings: { barColor: event.target.value } })}
              className="h-9 w-full rounded border border-[#E5E7EB] bg-white p-1"
            />
          </label>
        ) : null}

        {isLineLike ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-[#6B7280]">
              Line color
              <input
                type="color"
                value={settings.lineColor || '#60A5FA'}
                onChange={(event) => onChange({ settings: { lineColor: event.target.value } })}
                className="h-9 w-full rounded border border-[#E5E7EB] bg-white p-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#6B7280]">
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
            <label className="flex flex-col gap-1 text-xs text-[#6B7280]">
              X label
              <input
                type="text"
                value={settings.xAxisLabel || 'Months'}
                onChange={(event) => onChange({ settings: { xAxisLabel: event.target.value } })}
                className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[rgba(37,99,235,0.16)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#6B7280]">
              Y label
              <input
                type="text"
                value={settings.yAxisLabel || 'Value'}
                onChange={(event) => onChange({ settings: { yAxisLabel: event.target.value } })}
                className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[rgba(37,99,235,0.16)]"
              />
            </label>
          </>
        ) : null}

        {isPieLike ? (
          <div className="sm:col-span-2">
            <div className="mb-1 text-xs text-[#6B7280]">Pie colors</div>
            <div className="grid grid-cols-5 gap-2">
              {pieColors.slice(0, 5).map((color, idx) => (
                <label key={`${widget.id}-pie-color-${idx}`} className="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
                  C{idx + 1}
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => {
                      const next = [...pieColors];
                      next[idx] = event.target.value;
                      onChange({ settings: { pieColors: next } });
                    }}
                    className="h-9 w-full rounded border border-[#E5E7EB] bg-white p-1"
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
    iframeDoc.write('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#F5F7FB;}</style></head><body></body></html>');
    iframeDoc.close();

    const clonedRoot = target.cloneNode(true);
    iframeDoc.body.appendChild(clonedRoot);
    copyComputedStyles(target, clonedRoot);
    stripUnsupportedColors(clonedRoot);

    try {
      const canvasPromise = html2canvas(clonedRoot, {
        scale: 1.5, // Reduced for faster rendering
        backgroundColor: '#F5F7FB',
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
        backgroundColor: '#F5F7FB',
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

  const captureExportCanvas = async () => {
    await waitForPaint();

    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.width = '1200px';
    container.style.padding = '24px';
    container.style.background = '#F8FAFC';
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(<ExportDashboardView widgets={widgets} generatedOn={new Date()} />);

    // allow render and fonts to settle
    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      const canvas = await html2canvas(container, {
        scale: 2,
        backgroundColor: '#F8FAFC',
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      return canvas;
    } finally {
      try { root.unmount(); } catch (e) { /* ignore */ }
      container.remove();
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
      const canvas = await captureExportCanvas();

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
      className="rounded-[28px] border border-[#E5E7EB] bg-white p-5 md:p-7"
      style={{ boxShadow: '0 10px 30px rgba(37,99,235,0.08)' }}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[28px] font-bold tracking-[-0.02em] text-[#111827]">Step 2: Generated Dashboard</h3>
          <p className="mt-1 text-sm text-[#6B7280]">Power BI style analytics board generated from KPI + selected graphs + dataset filters.</p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2563EB] bg-white px-4 py-2 text-sm font-semibold text-[#2563EB] shadow-[0_1px_2px_rgba(17,24,39,0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#EFF6FF] hover:shadow-[0_10px_20px_rgba(37,99,235,0.16)]"
            onClick={onBack}
          >
            <RotateCcw size={15} /> Back to Selection
          </button>
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-2 text-sm font-semibold text-[#2563EB] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#DBEAFE] hover:shadow-[0_10px_20px_rgba(37,99,235,0.16)]"
            onClick={onRegenerate}
          >
            <RefreshCcw size={15} /> Regenerate Dashboard
          </button>
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#22C55E,#16A34A)] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(34,197,94,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_26px_rgba(34,197,94,0.34)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => downloadAs('pdf')}
            disabled={isExporting}
          >
            <Download size={15} /> {isExporting ? 'Exporting...' : 'Download PDF'}
          </button>
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#4F46E5,#3B82F6)] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(79,70,229,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_26px_rgba(79,70,229,0.34)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => downloadAs('png')}
            disabled={isExporting}
          >
            <Download size={15} /> {isExporting ? 'Exporting...' : 'Download PNG'}
          </button>
        </div>
      </div>

      {generationNote ? <p className="mb-4 text-xs font-medium text-[#6B7280]">{generationNote}</p> : null}

      <div ref={boardRef} className="rounded-[24px] border border-[#E5E7EB] bg-[#F5F7FB] p-4 md:p-5">
        {widgets.some((item) => item.id === 'kpi-cards') && (
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {widgets.filter((item) => item.id !== 'kpi-cards').slice(0, 4).map((widget) => (
              <motion.article
                key={`kpi-${widget.id}`}
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_8px_22px_rgba(37,99,235,0.08)]"
              >
                <p className="text-xs font-medium text-[#9CA3AF]">{widget.name}</p>
                <p className="mt-1.5 text-xl font-bold text-[#111827]">{widget.kpiValue || 'N/A'}</p>
                <p className="text-xs font-semibold text-[#22C55E]">+{widget.kpiDelta || '0.0%'} </p>
              </motion.article>
            ))}
          </div>
        )}

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          {widgets.filter((item) => item.id !== 'kpi-cards').map((widget) => (
            <motion.article
              key={widget.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              transition={{ duration: 0.25 }}
              className="rounded-[24px] border border-[#E5E7EB] bg-white p-4 shadow-[0_8px_22px_rgba(37,99,235,0.08)]"
            >
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#E5E7EB] pb-3">
                <h4 className="text-sm font-semibold text-[#111827]">{widget.name}</h4>
                <span className="rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-semibold text-[#2563EB]">{widget.chartType}</span>
              </div>
              <div className="mb-3">
                <label className="mb-1.5 block text-xs font-semibold text-[#6B7280]">Chart Type</label>
                <select
                  value={widget.chartType}
                  onChange={(event) => onWidgetChange?.(widget.id, { chartType: event.target.value })}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none transition-all duration-300 focus:border-[#2563EB] focus:ring-4 focus:ring-[rgba(37,99,235,0.16)]"
                >
                  {WIDGET_CHART_OPTIONS.map((chartName) => (
                    <option key={`${widget.id}-option-${chartName}`} value={chartName}>
                      {chartName}
                    </option>
                  ))}
                </select>
              </div>
              {widget.failureReason ? (
                <div className="mb-3 rounded-xl border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                  <span className="font-semibold">Why graph may not be accurate: </span>
                  {widget.failureReason}
                </div>
              ) : null}
              {widget.insightText ? (
                <div className="mb-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E3A8A]">
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
              <div className="h-64 rounded-2xl border border-[#E5E7EB] bg-white p-2">
                {renderWidgetChart(widget, darkMode)}
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
