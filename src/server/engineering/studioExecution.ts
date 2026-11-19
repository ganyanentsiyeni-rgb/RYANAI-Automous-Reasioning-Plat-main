import { createStudioProject, type StudioProjectType } from './studioNativeCore.js';

export interface StudioProjectRequest {
  readonly ownerId: string;
  readonly brief: string;
  readonly projectType: StudioProjectType;
}

export interface StudioProjectReceipt {
  readonly id: string;
  readonly status: string;
  readonly queue: string;
}

const nativeStudioAdapter: StudioExecutionAdapter = Object.freeze({
  id: 'ryanai-native-studio-worker',
  displayName: 'RyanAI-native Studio task queue',
  independent: true,
  async submit(request: StudioProjectRequest): Promise<StudioProjectReceipt> {
    const result = await createStudioProject({
      ownerUserId: request.ownerId,
      title: request.brief.slice(0, 200) || 'RyanAI Studio project',
      objective: request.brief,
      projectType: request.projectType,
      initialTasks: [{
        title: 'Coordinate Studio project',
        objective: request.brief,
        taskType: 'coordination',
        requiredCapabilities: ['read-task', 'record-progress'],
      }],
    });
    return {
      id: result.project.id,
      status: result.project.status,
      queue: 'studio_tasks',
    };
  },
});

export interface StudioExecutionAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly independent: boolean;
  submit(request: StudioProjectRequest): Promise<StudioProjectReceipt>;
}

let activeAdapter: StudioExecutionAdapter = nativeStudioAdapter;

export async function submitStudioProject(request: StudioProjectRequest): Promise<StudioProjectReceipt> {
  return activeAdapter.submit(request);
}

export function getStudioExecutionDescriptor() {
  return {
    adapterId: activeAdapter.id,
    adapterName: activeAdapter.displayName,
    independentRuntime: activeAdapter.independent,
    lifecycleOwner: 'RyanAI Studio',
    authorizationAuthority: 'RyanAI platform policy',
    state: 'native_task_queue',
    note: 'Studio project intake persists work directly into the RyanAI Studio task queue. Independent worker liveness is reported by the Studio worker heartbeat service.',
  } as const;
}

export function setStudioExecutionAdapterForTests(adapter: StudioExecutionAdapter): () => void {
  const previous = activeAdapter;
  activeAdapter = adapter;
  return () => { activeAdapter = previous; };
}
