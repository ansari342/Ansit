import { buildLadderPlan, LadderConfig } from '../src/core/ladderPlan';

const classic: LadderConfig = {
  listenNew: 10,
  reciteNew: 3,
  listenCombined: 5,
  reciteCombined: 3,
  combineStyle: 'cumulative',
  reciteTiming: 'auto',
};

const short = (plan: ReturnType<typeof buildLadderPlan>) =>
  plan
    .map(s => `${s.kind === 'listen' ? 'L' : 'R'}${s.fromVerse === s.toVerse ? s.fromVerse : `${s.fromVerse}-${s.toVerse}`}x${s.reps}`)
    .join(' ');

describe('buildLadderPlan', () => {
  it('expands the classic cumulative ladder exactly as specified', () => {
    expect(short(buildLadderPlan(1, 4, classic))).toBe(
      'L1x10 R1x3 L2x10 R2x3 L1-2x5 R1-2x3 L3x10 R3x3 L1-3x5 R1-3x3 L4x10 R4x3 L1-4x5 R1-4x3'
    );
  });

  it('handles a single verse without combine steps', () => {
    expect(short(buildLadderPlan(3, 3, classic))).toBe('L3x10 R3x3');
  });

  it('normalises reversed ranges', () => {
    expect(short(buildLadderPlan(4, 1, classic))).toBe(short(buildLadderPlan(1, 4, classic)));
  });

  it('skips zero-rep steps', () => {
    expect(short(buildLadderPlan(1, 2, { ...classic, reciteNew: 0, reciteCombined: 0 }))).toBe('L1x10 L2x10 L1-2x5');
  });

  it('chunked style reviews pairs, fours and the whole passage', () => {
    const plan = short(buildLadderPlan(1, 6, { ...classic, combineStyle: 'chunked' }));
    expect(plan).toContain('L1-2x5');
    expect(plan).toContain('L3-4x5');
    expect(plan).toContain('L1-4x5');
    expect(plan).toContain('L5-6x5');
    expect(plan.endsWith('L1-6x5 R1-6x3')).toBe(true);
  });

  it('has sequential indices', () => {
    buildLadderPlan(1, 5, classic).forEach((s, i) => expect(s.index).toBe(i));
  });
});
