import type { CdsAutomaticMatchExplanation } from '@nysc/database';

export type CdsMatchCandidate = {
  id: string;
  activeCount: number;
  maxCapacity: number;
  createdAt: Date;
};

export type CdsMatchSelectionCriterion =
  CdsAutomaticMatchExplanation['selectionCriterion'];

function compareUtilisation(a: CdsMatchCandidate, b: CdsMatchCandidate): number {
  return (a.activeCount / a.maxCapacity) - (b.activeCount / b.maxCapacity);
}

function hasSameUtilisation(a: CdsMatchCandidate, b: CdsMatchCandidate): boolean {
  return a.activeCount * b.maxCapacity === b.activeCount * a.maxCapacity;
}

export function selectCdsGroupByCapacityUtilisation<T extends CdsMatchCandidate>(
  candidates: readonly T[]
): { selected: T; criterion: CdsMatchSelectionCriterion } | null {
  const available = candidates.filter((candidate) =>
    candidate.maxCapacity > 0 && candidate.activeCount < candidate.maxCapacity
  );
  if (available.length === 0) return null;

  const sorted = [...available].sort((a, b) =>
    compareUtilisation(a, b) ||
    a.activeCount - b.activeCount ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
  const selected = sorted[0];
  if (!selected) return null;

  const tiedAtLowestUtilisation = available.filter((candidate) =>
    hasSameUtilisation(candidate, selected)
  );
  if (tiedAtLowestUtilisation.length === 1) {
    return { selected, criterion: 'lowest_utilisation' };
  }

  const fewestActiveMembers = Math.min(
    ...tiedAtLowestUtilisation.map((candidate) => candidate.activeCount)
  );
  const tiedAtMemberCount = tiedAtLowestUtilisation.filter((candidate) =>
    candidate.activeCount === fewestActiveMembers
  );
  if (tiedAtMemberCount.length === 1) {
    return { selected, criterion: 'fewest_active_members' };
  }

  const oldestCreatedAt = Math.min(
    ...tiedAtMemberCount.map((candidate) => candidate.createdAt.getTime())
  );
  const tiedAtCreationDate = tiedAtMemberCount.filter((candidate) =>
    candidate.createdAt.getTime() === oldestCreatedAt
  );
  if (tiedAtCreationDate.length === 1) {
    return { selected, criterion: 'oldest_group' };
  }

  return { selected, criterion: 'stable_group_id' };
}

export function buildCdsAutomaticMatchExplanation(input: {
  matchedCourseId: string;
  matchedCourseName: string | null;
  eligibleGroupCount: number;
  availableGroupCount: number;
  selectedGroup: CdsMatchCandidate;
  selectionCriterion: CdsMatchSelectionCriterion;
  selectedAt: string;
}): CdsAutomaticMatchExplanation {
  return {
    version: 1,
    algorithm: 'lowest_utilisation_v1',
    matchedCourseId: input.matchedCourseId,
    matchedCourseName: input.matchedCourseName,
    eligibleGroupCount: input.eligibleGroupCount,
    availableGroupCount: input.availableGroupCount,
    activeMemberCountAtAssignment: input.selectedGroup.activeCount,
    maxCapacityAtAssignment: input.selectedGroup.maxCapacity,
    utilisationPercentAtAssignment: Math.round(
      (input.selectedGroup.activeCount / input.selectedGroup.maxCapacity) * 1000
    ) / 10,
    selectionCriterion: input.selectionCriterion,
    selectedAt: input.selectedAt
  };
}
