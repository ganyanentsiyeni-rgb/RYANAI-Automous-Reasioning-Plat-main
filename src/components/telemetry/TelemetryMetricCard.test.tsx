import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TelemetryMetricCard from './TelemetryMetricCard';
import { createTelemetryMetricSnapshot } from '@/lib/telemetry/contracts';

function renderCard(props: Partial<ComponentProps<typeof TelemetryMetricCard>> = {}) {
  return renderToStaticMarkup(createElement(TelemetryMetricCard, {
    label: 'API uptime',
    value: '42 seconds',
    detail: 'Process uptime only.',
    source: '/api/admin/metrics',
    ...props,
  }));
}

describe('TelemetryMetricCard', () => {
  it('labels a recent source timestamp as fresh and displays provenance', () => {
    const nowMs = Date.parse('2026-11-18T12:00:00.000Z');
    const html = renderCard({ observedAt: new Date(nowMs - 1_000).toISOString(), nowMs });
    expect(html).toContain('Fresh');
    expect(html).toContain('Source: /api/admin/metrics');
    expect(html).toContain('API uptime');
  });

  it('keeps old observations visibly stale', () => {
    const nowMs = Date.parse('2026-11-18T12:00:00.000Z');
    const html = renderCard({ observedAt: new Date(nowMs - 120_000).toISOString(), nowMs });
    expect(html).toContain('Stale');
  });

  it('does not infer freshness when the observation timestamp is missing', () => {
    const html = renderCard({ observedAt: null });
    expect(html).toContain('Freshness unknown');
    expect(html).toContain('Not reported');
  });

  it('preserves unavailable and error states rather than showing healthy', () => {
    expect(renderCard({ status: 'unavailable', observedAt: null })).toContain('Unavailable');
    expect(renderCard({ status: 'error', observedAt: null })).toContain('Error');
  });
});


describe('TelemetryMetricCard with shared snapshots', () => {
  it('renders contract source, observation time and unit', () => {
    const snapshot = createTelemetryMetricSnapshot({
      metricId: 'api.process.uptime',
      label: 'API process uptime',
      value: 42,
      unit: 'seconds',
      source: '/api/admin/metrics',
      observedAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const html = renderCard({ snapshot, source: 'untrusted fallback source' });
    expect(html).toContain('Source: /api/admin/metrics');
    expect(html).toContain('Unit: seconds');
    expect(html).not.toContain('untrusted fallback source');
    expect(html).toContain('Fresh');
  });

  it('uses contract freshness and unavailable state without promoting missing data', () => {
    const snapshot = createTelemetryMetricSnapshot({
      metricId: 'providers.healthy.count',
      label: 'Verified healthy providers',
      value: null,
      unit: 'count',
      source: '/api/agent/ops/brains',
      observedAt: null,
      status: 'unavailable',
    });
    const html = renderCard({ snapshot, status: 'available', observedAt: new Date().toISOString() });
    expect(html).toContain('Unavailable');
    expect(html).toContain('Not reported');
    expect(html).toContain('Unit: count');
  });

  it('keeps an old contract snapshot stale', () => {
    const snapshot = createTelemetryMetricSnapshot({
      metricId: 'api.process.uptime',
      label: 'API process uptime',
      value: 42,
      unit: 'seconds',
      source: '/api/admin/metrics',
      observedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    expect(renderCard({ snapshot })).toContain('Stale');
  });
});
