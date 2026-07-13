import type { CompetitionType, MatchSetMode, Sport } from '../types';

export const COMPETITION_TYPE_LABELS: Record<CompetitionType, string> = {
  singles: 'Đơn',
  doubles: 'Đôi',
  team: 'Đồng đội',
  individual_time: 'Cá nhân tính giờ',
  custom: 'Tùy chỉnh',
};

const DEFAULT_COMPETITION_TYPES: CompetitionType[] = ['singles', 'doubles', 'team', 'custom'];
const DEFAULT_MATCH_SET_MODES: MatchSetMode[] = ['single', 'best_of_3'];

export function getSportCompetitionTypes(sport?: Sport): CompetitionType[] {
  const values = sport?.capabilities?.competitionTypes;
  return values?.length ? values : DEFAULT_COMPETITION_TYPES;
}

export function getSportMatchSetModes(sport?: Sport): MatchSetMode[] {
  const values = sport?.capabilities?.supportedMatchSetModes;
  return values?.length ? values : DEFAULT_MATCH_SET_MODES;
}

export function getSportDefaultMatchSetMode(sport?: Sport): MatchSetMode {
  const configured = sport?.default_settings?.matchSetMode;
  const supported = getSportMatchSetModes(sport);
  return configured === 'best_of_3' && supported.includes(configured) ? configured : supported[0] || 'single';
}

export function getSportName(sportId: string | undefined, sports: Sport[]): string {
  return sports.find((sport) => sport.id === sportId)?.name || (sportId === 'sport_pickleball' ? 'Pickleball' : 'Chưa xác định');
}
