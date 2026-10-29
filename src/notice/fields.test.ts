import { describe, expect, it } from 'vitest';
import { FIELDS, NOTICE_REQUIREMENTS, isFieldKey, requirementFor } from './fields';
import { REGIMES } from '../rules';

const stageKeys = new Set(REGIMES.flatMap((r) => r.stages.map((s) => s.key)));

describe('notice requirements', () => {
  it('only refer to stages that exist in the rulebook', () => {
    for (const r of NOTICE_REQUIREMENTS) expect(stageKeys, r.stageKey).toContain(r.stageKey);
  });

  it('only refer to known fields, and every requirement cites its source', () => {
    for (const r of NOTICE_REQUIREMENTS) {
      for (const key of Object.keys(r.fields)) expect(isFieldKey(key), `${r.stageKey}: ${key}`).toBe(true);
      expect(r.citation.quote.length).toBeGreaterThan(50);
      expect(r.citation.url).toMatch(/^https:\/\//);
      expect(r.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('asks the GDPR authority notice for the four Art. 33(3) items and delay reasons only when late', () => {
    const gdpr = requirementFor('gdpr-33-authority');
    expect(gdpr?.fields).toMatchObject({ nature: 'required', dpoContact: 'required', consequences: 'required', measures: 'required' });
    expect(gdpr?.fields.delayReasons).toBe('ifLate');
  });

  it('treats NIS2 indicators of compromise as "where available"', () => {
    expect(requirementFor('nis2-incident-notification')?.fields.indicators).toBe('ifAvailable');
  });

  it('maps every notice except those regulators collect through their own forms', () => {
    const unmapped = [...stageKeys].filter((key) => !requirementFor(key)).sort();
    // HHS reports go through the HHS breach portal form; PDPA content is set by separate regulations not yet verified.
    expect(unmapped).toEqual(['hipaa-hhs-500', 'hipaa-hhs-under-500', 'pdpa-assessment', 'pdpa-commission', 'pdpa-individuals']);
    expect(requirementFor('npc-subjects')?.fields).toMatchObject({ harmReduction: 'required', assistance: 'required' });
    expect(requirementFor('sec-8k-105')?.citation.label).toBe('Form 8-K Item 1.05(a)');
  });

  it('gives every field a label and a plain-language prompt', () => {
    for (const field of Object.values(FIELDS)) {
      expect(field.label.length).toBeGreaterThan(3);
      expect(field.prompt.length).toBeGreaterThan(10);
    }
  });
});
