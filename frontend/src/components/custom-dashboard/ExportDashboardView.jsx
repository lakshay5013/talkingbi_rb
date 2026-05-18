import React from 'react';
import { renderWidgetChart } from './chartRenderer';

function formatDate(d) {
  try {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) { return String(d); }
}

export default function ExportDashboardView({ widgets = [], generatedOn = new Date() }) {
  const kpiWidgets = widgets.filter((w) => w.id === 'kpi-cards');
  const otherWidgets = widgets.filter((w) => w.id !== 'kpi-cards');

  return (
    <div style={{ width: '100%', background: '#F8FAFC', padding: 28, fontFamily: 'Segoe UI, Inter, system-ui, -apple-system' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', color: '#111827' }}>
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Sales Performance Dashboard</h1>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
            <div style={{ color: '#6B7280', fontSize: 13 }}>Generated on: {formatDate(generatedOn)}</div>
            <div style={{ marginLeft: 'auto', color: '#6B7280', fontSize: 13 }}>Talking BI Analytics Report</div>
          </div>
        </header>

        {kpiWidgets.length > 0 && (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
            {widgets.filter((item) => item.id !== 'kpi-cards').slice(0, 4).map((widget) => (
              <div key={`export-kpi-${widget.id}`} style={{ background: '#FFFFFF', borderRadius: 12, padding: 16, boxShadow: '0 8px 22px rgba(37,99,235,0.06)', border: '1px solid #E5E7EB' }}>
                <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>{widget.name}</div>
                <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800, color: '#111827' }}>{widget.kpiValue || 'N/A'}</div>
                <div style={{ fontSize: 12, color: '#22C55E', fontWeight: 700 }}>+{widget.kpiDelta || '0.0%'}</div>
              </div>
            ))}
          </section>
        )}

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 18 }}>
          {otherWidgets.map((widget) => (
            <article key={`export-chart-${widget.id}`} style={{ background: '#FFFFFF', borderRadius: 20, padding: 18, boxShadow: '0 10px 26px rgba(17,24,39,0.04)', border: '1px solid #E5E7EB' }}>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>{widget.name}</h3>
              </div>
              <div style={{ height: 320 }}>
                {renderWidgetChart(widget, false)}
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
