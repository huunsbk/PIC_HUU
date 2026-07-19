import { balanceMatchesRestTime } from '../../src/utils/tournamentEngine';
import type { Match } from '../../src/types';

const makeMatch = (
  id: string,
  groupId: string,
  round: number,
  displayOrder: number,
): Match => ({
  id,
  groupId,
  round,
  displayOrder,
  teamAId: `${id}-a`,
  teamBId: `${id}-b`,
  scoreA: null,
  scoreB: null,
  winnerId: null,
  status: 'pending',
});

// IDs are deliberately opposite to the required A -> B -> C display order.
const matches: Match[] = [
  makeMatch('A1', 'group-z', 1, 1),
  makeMatch('B1', 'group-m', 1, 2),
  makeMatch('C1', 'group-a', 1, 3),
  makeMatch('A2', 'group-z', 1, 4),
  makeMatch('B2', 'group-m', 1, 5),
  makeMatch('A3', 'group-z', 2, 6),
  makeMatch('B3', 'group-m', 2, 7),
  makeMatch('C2', 'group-a', 2, 8),
];

const actual = balanceMatchesRestTime(matches).map((match) => match.id);
const expected = ['A1', 'B1', 'C1', 'A2', 'B2', 'A3', 'B3', 'C2'];

if (actual.join(',') !== expected.join(',')) {
  throw new Error(`Group cycle mismatch: ${actual.join(',')} != ${expected.join(',')}`);
}

console.log('PASS: group cycle preserves backend order and skips exhausted groups.');
