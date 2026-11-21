import React from 'react';

interface CommandCenterProps {
  activeEngineState: string;
  inferenceAvailable?: boolean;
  inferenceDetail?: string;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  activeEngineState,
  inferenceAvailable = false,
  inferenceDetail = 'Provider capability has not been verified by the backend.',
}) => {
  return (
    <div className="command-center min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI workspace</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">RyanAI Command Center</h1>
        </div>
        <span role="status" className="rounded-full border border-emerald-300/20 bg-emerald-900/30 px-3 py-1 text-xs font-mono text-emerald-200">
          Engine: {activeEngineState}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4" aria-labelledby="react-pipeline-title">
          <h2 id="react-pipeline-title" className="font-semibold">Active ReAct Pipeline</h2>
          <p className="mt-2 text-sm text-slate-400">Monitoring execution streams and memory vectors.</p>
          <span className="mt-3 inline-flex rounded-full border border-cyan-300/20 px-2 py-1 text-[10px] text-cyan-100">Execution state: {activeEngineState}</span>
        </section>
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4" aria-labelledby="inference-module-title">
          <h2 id="inference-module-title" className="font-semibold">Inference capability</h2>
          <p className="mt-2 text-sm text-slate-400">{inferenceAvailable ? 'Backend inference capability is currently reported as available.' : 'Inference is not verified as available in this session.'}</p>
          <p className="mt-2 text-xs text-slate-500">{inferenceDetail}</p>
          <span className="mt-3 inline-flex rounded-full border border-amber-300/20 px-2 py-1 text-[10px] text-amber-200">
            {inferenceAvailable ? 'Backend-reported' : 'Not verified'}
          </span>
        </section>
      </div>
    </div>
  );
};
