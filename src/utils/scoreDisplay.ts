import type { Match, MatchSet } from '../types';

type TeamLike = { id?: string; name?: string } | undefined;

function getMatchSets(match: Partial<Match>, allSets: MatchSet[] = []) {
  const fromMatch = Array.isArray(match.matchSets) ? match.matchSets : [];
  const sets = fromMatch.length > 0 ? fromMatch : allSets.filter((row) => row.match_id === match.id);

  return sets
    .filter((row) => row.deleted_at === null || row.deleted_at === undefined)
    .filter((row) => row.score_a !== null && row.score_a !== undefined && row.score_b !== null && row.score_b !== undefined)
    .sort((a, b) => a.set_number - b.set_number);
}

export function attachMatchSets<T extends Match>(matches: T[], matchSets: MatchSet[] = []): T[] {
  if (matchSets.length === 0) return matches;
  const setsByMatch = new Map<string, MatchSet[]>();
  matchSets.forEach((row) => {
    const rows = setsByMatch.get(row.match_id) || [];
    rows.push(row);
    setsByMatch.set(row.match_id, rows);
  });

  return matches.map((match) => ({
    ...match,
    matchSets: (setsByMatch.get(match.id) || []).sort((a, b) => a.set_number - b.set_number),
  }));
}

export function getSetScoreText(match: Partial<Match>, allSets: MatchSet[] = []) {
  const sets = getMatchSets(match, allSets);
  if (sets.length > 0) {
    return sets.map((row) => `${row.score_a}-${row.score_b}`).join(', ');
  }

  if (match.status === 'finished' && match.scoreA !== null && match.scoreA !== undefined && match.scoreB !== null && match.scoreB !== undefined) {
    return `${match.scoreA}-${match.scoreB}`;
  }

  return '';
}

export function getPrimarySetScoreText(match: Partial<Match>, allSets: MatchSet[] = []) {
  const sets = getMatchSets(match, allSets);
  if (sets[0]) return `${sets[0].score_a}-${sets[0].score_b}`;
  return getSetScoreText(match, allSets);
}

export function getSingleSetScoreValue(match: Partial<Match>, allSets: MatchSet[] = []) {
  const firstSet = getMatchSets(match, allSets)[0];
  return {
    a: firstSet?.score_a !== null && firstSet?.score_a !== undefined ? String(firstSet.score_a) : '',
    b: firstSet?.score_b !== null && firstSet?.score_b !== undefined ? String(firstSet.score_b) : '',
  };
}

export function getMatchResultLabel(match: Partial<Match>, teamA: string, teamB: string) {
  if (match.status !== 'finished' || match.scoreA === null || match.scoreA === undefined || match.scoreB === null || match.scoreB === undefined) {
    return 'Chưa có kết quả trận';
  }

  const winnerName = match.winnerId === match.teamAId ? teamA : match.winnerId === match.teamBId ? teamB : 'Đội thắng';
  return `${winnerName} thắng ${match.scoreA}-${match.scoreB}`;
}

export function getSeedLabel(match: Partial<Match>, slot: 'A' | 'B', fallback: string) {
  const metadata = (match.metadata || {}) as Record<string, any>;
  const key = slot === 'A' ? 'seed_label_a' : 'seed_label_b';
  return String(metadata[key] || fallback || 'Chưa xác định');
}

export function getResolvedTeamName(match: Partial<Match>, slot: 'A' | 'B', teams: Record<string, TeamLike>, fallbackId?: string | null) {
  const metadata = (match.metadata || {}) as Record<string, any>;
  const resolvedId = slot === 'A' ? metadata.resolved_team_id_a : metadata.resolved_team_id_b;
  const teamId = String(resolvedId || fallbackId || '');
  return teamId && teams[teamId]?.name ? String(teams[teamId]?.name) : '';
}
