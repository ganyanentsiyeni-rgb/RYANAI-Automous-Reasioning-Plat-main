import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const marketDataMocks = vi.hoisted(() => ({
  fetchAlpacaDailyBars: vi.fn(),
  fetchAlphaVantageFxDailyBars: vi.fn(),
}));

vi.mock('../quant/alpacaMarketData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quant/alpacaMarketData.js')>();
  return {
    ...actual,
    fetchAlpacaDailyBars: marketDataMocks.fetchAlpacaDailyBars,
    fetchAlphaVantageFxDailyBars: marketDataMocks.fetchAlphaVantageFxDailyBars,
  };
});

import { MarketDataError } from '../quant/alpacaMarketData.js';
import { quantRoutes } from './quantRoutes.js';

const prisma = {
  quantExperiment: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
};

const makeBars = (count = 80) => {
  let close = 100;
  return Array.from({ length: count }, (_, index) => {
    close += index < 20 ? -1.0 : index < 50 ? 1.4 : -1.6;
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    return { date, open: close - 0.2, high: close + 0.5, low: close - 0.5, close, volume: 1000 };
  });
};

function createTestApp() {
  const app = Fastify();
  app.decorate('prisma', prisma as unknown as PrismaClient);
  app.decorateRequest('authUser', null);
  app.addHook('preHandler', async (request) => {
    request.authUser = { id: 'user-quant-test', role: 'user', isOwner: false };
  });
  return app;
}

describe('Quant API routes', () => {
  afterEach(() => vi.clearAllMocks());

  it('uses the injected runtime Prisma client to persist a user-scoped backtest', async () => {
    const app = createTestApp();
    await app.register(quantRoutes);
    vi.mocked(prisma.quantExperiment.create).mockResolvedValue({
      id: 'experiment-1', strategy: 'sma_crossover', status: 'completed', createdAt: new Date(),
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/backtests',
      payload: { bars: makeBars(), fast_window: 3, slow_window: 8, initial_cash: 10000 },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.executionMode).toBe('historical_simulation_only');
    expect(body.result.metrics.final_equity).toBeTypeOf('number');
    expect(body.result.equity_curve).toHaveLength(80);
    expect(prisma.quantExperiment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-quant-test', status: 'completed' }),
    }));
    await app.close();
  });

  it('returns the selected provider when a provider error occurs before bars are imported', async () => {
    const app = createTestApp();
    await app.register(quantRoutes);
    marketDataMocks.fetchAlpacaDailyBars.mockRejectedValueOnce(
      new MarketDataError('not_configured', 'Market data provider is not configured.', 503),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/quant/market-data/imports',
      payload: { symbol: 'AAPL' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'not_configured',
      provider: 'alpaca',
    });
    await app.close();
  });

  it('scopes experiment history to the authenticated user through the injected client', async () => {
    const app = createTestApp();
    await app.register(quantRoutes);
    vi.mocked(prisma.quantExperiment.findMany).mockResolvedValue([] as never);
    const response = await app.inject({ method: 'GET', url: '/api/quant/experiments' });
    expect(response.statusCode).toBe(200);
    expect(prisma.quantExperiment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-quant-test' },
    }));
    await app.close();
  });

  it('exposes a versioned South African FX benchmark registry without promoting candidates', async () => {
    const app = createTestApp();
    await app.register(quantRoutes);
    const response = await app.inject({ method: 'GET', url: '/api/quant/model-registry' });
    expect(response.statusCode).toBe(200);
    const { registry } = response.json();
    expect(registry.instruments).toContain('USD/ZAR');
    expect(registry.candidates.some((item: { id: string }) => item.id === 'arimax_garch')).toBe(true);
    expect(registry.candidates.find((item: { id: string }) => item.id === 'lstm')?.status).toBe('benchmark_candidate_only');
    expect(registry.requiredMetrics).toContain('QLIKE');
    expect(registry.liveTradingEnabled).toBe(false);
    await app.close();
  });

});
