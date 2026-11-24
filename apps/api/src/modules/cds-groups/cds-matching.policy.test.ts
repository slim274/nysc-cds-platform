import { describe, expect, it } from 'bun:test';
import {
  buildCdsAutomaticMatchExplanation,
  selectCdsGroupByCapacityUtilisation
} from './cds-matching.policy';

function candidate(
  id: string,
  activeCount: number,
  maxCapacity: number,
  createdAt = new Date('2026-01-01T00:00:00.000Z')
) {
  return { id, activeCount, maxCapacity, createdAt };
}

describe('CDS automatic matching selection policy', () => {
  it('prefers the lowest utilisation ratio rather than the lowest raw member count', () => {
    const result = selectCdsGroupByCapacityUtilisation([
      candidate('larger-group', 4, 20),
      candidate('smaller-group', 2, 5)
    ]);
    expect(result?.selected.id).toBe('larger-group');
    expect(result?.criterion).toBe('lowest_utilisation');
  });

  it('uses fewer active members when utilisation is tied', () => {
    const result = selectCdsGroupByCapacityUtilisation([
      candidate('two-of-ten', 2, 10),
      candidate('one-of-five', 1, 5)
    ]);
    expect(result?.selected.id).toBe('one-of-five');
    expect(result?.criterion).toBe('fewest_active_members');
  });

  it('uses the oldest group when utilisation and member count are tied', () => {
    const result = selectCdsGroupByCapacityUtilisation([
      candidate('newer', 2, 10, new Date('2026-02-01T00:00:00.000Z')),
      candidate('older', 2, 10, new Date('2026-01-01T00:00:00.000Z'))
    ]);
    expect(result?.selected.id).toBe('older');
    expect(result?.criterion).toBe('oldest_group');
  });

  it('uses the group ID as a stable final tie-breaker', () => {
    const result = selectCdsGroupByCapacityUtilisation([
      candidate('b-group', 2, 10),
      candidate('a-group', 2, 10)
    ]);
    expect(result?.selected.id).toBe('a-group');
    expect(result?.criterion).toBe('stable_group_id');
  });

  it('does not select a group that has reached capacity', () => {
    const result = selectCdsGroupByCapacityUtilisation([
      candidate('full', 10, 10)
    ]);
    expect(result).toBeNull();
  });

  it('stores the assignment-time capacity snapshot and selected criterion', () => {
    const explanation = buildCdsAutomaticMatchExplanation({
      matchedCourseId: 'course-1',
      matchedCourseName: 'Computer Science',
      eligibleGroupCount: 4,
      availableGroupCount: 3,
      selectedGroup: candidate('selected', 2, 8),
      selectionCriterion: 'lowest_utilisation',
      selectedAt: '2026-11-24T09:00:00.000Z'
    });
    expect(explanation.matchedCourseName).toBe('Computer Science');
    expect(explanation.eligibleGroupCount).toBe(4);
    expect(explanation.availableGroupCount).toBe(3);
    expect(explanation.activeMemberCountAtAssignment).toBe(2);
    expect(explanation.maxCapacityAtAssignment).toBe(8);
    expect(explanation.utilisationPercentAtAssignment).toBe(25);
    expect(explanation.selectionCriterion).toBe('lowest_utilisation');
  });
});
