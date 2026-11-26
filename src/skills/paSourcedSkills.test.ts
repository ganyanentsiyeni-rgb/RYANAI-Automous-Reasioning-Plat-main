import { describe, expect, it } from 'vitest';
import { ACTIVE_PA_SOURCED_SKILLS, PA_SOURCED_SKILLS } from './paSourcedSkills.js';

describe('PA sourced skill registry', () => {
  it('contains governed skills derived from vendor patterns and approved project skills', () => {
    const ids = PA_SOURCED_SKILLS.map((skill) => skill.id);
    expect(ids).toEqual([
      'pa-research',
      'pa-observability-verification',
      'pa-correction-to-guardrail',
      'pa-database-governance',
      'pa-edge-security-watch',
      'pa-provider-model-routing',
      'pa-incident-evidence',
    ]);
  });

  it('does not activate the paused model-routing proposal', () => {
    expect(ACTIVE_PA_SOURCED_SKILLS.some((skill) => skill.id === 'pa-provider-model-routing')).toBe(false);
    expect(PA_SOURCED_SKILLS.find((skill) => skill.id === 'pa-provider-model-routing')?.enabled).toBe(false);
  });

  it('keeps active sourced skills read-only or proposal-only', () => {
    for (const skill of ACTIVE_PA_SOURCED_SKILLS) {
      expect(['read-only', 'propose']).toContain(skill.mode);
      expect(skill.capabilities).toContain('evidence.record');
      expect(skill.sourceRef.length).toBeGreaterThan(0);
    }
  });
});
