import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMatchScore } from '../shared/matching';

test('match score weights hard requirements and distinguishes evidence states', () => {
  const result = calculateMatchScore([
    {
      id: 'hard-met',
      requirement: 'TypeScript',
      hard: true,
      jobEvidence: [{ sourceId: 'job', quote: 'TypeScript' }],
      status: 'met',
      evidence: [{ sourceId: 'resume', quote: 'TypeScript' }],
      note: '',
    },
    {
      id: 'hard-missing',
      requirement: 'Degree',
      hard: true,
      jobEvidence: [{ sourceId: 'job', quote: 'Degree' }],
      status: 'not-found',
      evidence: [],
      note: '',
    },
    {
      id: 'partial',
      requirement: 'Testing',
      hard: false,
      jobEvidence: [{ sourceId: 'job', quote: 'Testing' }],
      status: 'partial',
      evidence: [{ sourceId: 'resume', quote: 'Testing' }],
      note: '',
    },
    {
      id: 'uncertain',
      requirement: 'Cloud',
      hard: false,
      jobEvidence: [{ sourceId: 'job', quote: 'Cloud' }],
      status: 'uncertain',
      evidence: [],
      note: 'Needs confirmation',
    },
  ]);

  assert.deepEqual(result, {
    score: 42,
    breakdown: {
      met: 1,
      partial: 1,
      uncertain: 1,
      notFound: 1,
      hardTotal: 2,
      hardMet: 1,
      hardUnmet: ['Degree'],
    },
  });
});

test('match score is null when no requirements are available', () => {
  assert.deepEqual(calculateMatchScore([]), {
    score: null,
    breakdown: {
      met: 0,
      partial: 0,
      uncertain: 0,
      notFound: 0,
      hardTotal: 0,
      hardMet: 0,
      hardUnmet: [],
    },
  });
});
