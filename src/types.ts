/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TournamentSettings {
  winPoint: number;       // Điểm cho trận thắng (mặc định: 2)
  lossPoint: number;      // Điểm cho trận thua (mặc định: 1)
  maxScore: number;       // Điểm chạm đích của séc (mặc định: 15)
  capScore: number;       // Điểm trần tối đa, ví dụ chạm tối đa 17 (mặc định: 17)
  advanceCount: number;   // Số đội mỗi bảng đi tiếp (1 hoặc 2 hoặc 3)
  numBestThirds?: number; // Số đội đứng thứ ba xuất sắc nhất
}

export type MatchSetMode = 'single' | 'best_of_3';
export type EventFormatType = 'round_robin_only' | 'knockout_only' | 'group_then_knockout';
export type CompetitionType = 'singles' | 'doubles' | 'team' | 'individual_time' | 'custom';

export interface ScoringConfig {
  matchSetMode: MatchSetMode;
  numberOfSets: 1 | 3;
  setsToWin: 1 | 2;
  maxScore: number;
  capScore: number;
  winByTwo: boolean;
  allowDraw?: boolean;
}

export interface RankingConfig {
  pointsWin?: number;
  pointsLoss?: number;
  pointsDraw?: number;
  tieBreakers?: Array<'points' | 'setDiff' | 'pointDiff' | 'pointsWon' | 'headToHead' | 'manual'>;
  bestThirds?: {
    enabled: boolean;
    count: number;
    excludeBottomTeamResults?: boolean;
  };
}

export interface Sport {
  id: string;
  name: string;
  slug: string;
  scoring_type: 'sets' | string;
  default_settings: Partial<ScoringConfig> & Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  organization: string;
  location: string;
  date: string;
  settings: TournamentSettings;
  tenant_id?: string;
  current_event_id?: string;
}

export type SeedType = 'none' | '1' | '2' | '3' | '4';

export interface Team {
  id: string;
  name: string;
  groupId: string | null;  // Bảng đấu mà đội thuộc về, null nếu chưa gán
  seed: SeedType;          // Hạt giống (none hoặc 1, 2, 3, 4)
  tenant_id?: string;
  event_id?: string;
}

export interface Group {
  id: string;
  name: string; // VD: Bảng A, Bảng B...
  teamIds: string[];
  tenant_id?: string;
  event_id?: string;
}

export interface Match {
  id: string;
  groupId: string; // ID bảng đấu, hoặc "knockout" nếu ở vòng đấu loại trực tiếp
  teamAId: string | null;
  teamBId: string | null;
  scoreA: number | null; // Điểm đội A (null nếu chưa đấu)
  scoreB: number | null; // Điểm đội B (null nếu chưa đấu)
  winnerId: string | null; // ID đội thắng (null nếu chưa đấu hoặc hòa)
  status: 'pending' | 'playing' | 'finished';
  round: number; // Vòng đấu (chỉ số 1, 2, 3...)
  knockoutRoundName?: string; // Tên vòng loại trực tiếp, VD: "Vòng 16", "Tứ kết", "Bán kết", "Chung kết"
  knockoutMatchId?: string; // Định danh trận trong nhánh loại trực tiếp (VD: "QF1", "SF1", "F")
  nextMatchId?: string; // Trận tiếp theo mà đội thắng sẽ chuyển tới
  nextMatchSlot?: 'A' | 'B'; // Đội thắng sẽ vào slot A hay slot B trong trận tiếp theo
  placeholderA?: string;
  placeholderB?: string;
  courtNumber?: number | null;
  slotNumber?: number | null;
  displayOrder?: number | null;
  metadata?: Record<string, unknown> | null;
  tenant_id?: string;
  event_id?: string;
  matchSets?: MatchSet[];
}

export interface MatchSet {
  id: string;
  match_id: string;
  tenant_id: string;
  event_id: string;
  set_number: number;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  status: 'pending' | 'playing' | 'finished';
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AuditLog {
  timestamp: string; // ISO string hoặc định dạng xem được
  action: string;    // Hành động chính
  details: string;   // Chi tiết hành động
  tenant_id?: string;
}

export interface GroupStanding {
  teamId: string;
  teamName: string;
  seed: SeedType;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  points: number;       // Tổng điểm tích lũy theo luật thắng/thua
  setsWon: number;      // Số séc thắng (bằng matchesWon trong thể thức 1 séc)
  setsLost: number;     // Số séc thua
  setDiff: number;      // Hiệu số séc thắng - séc thua
  pointsWon: number;    // Tổng số điểm ghi
  pointsLost: number;   // Tổng số điểm bị ghi
  pointDiff: number;    // Hiệu số điểm ghi/bị ghi (pointsWon - pointsLost)
  rank: number;
}

// Cấu trúc cho so sánh Đội hạng 3 xuất sắc (Luật UEFA)
export interface ThirdPlaceStanding {
  teamId: string;
  teamName: string;
  groupId: string;
  groupName: string;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  points: number;
  setsWon: number;
  setsLost: number;
  setDiff: number;
  pointsWon: number;
  pointsLost: number;
  pointDiff: number;
  rank: number;
  originalRanking: GroupStanding[]; // Để kiểm chứng
  isUefaAdjusted: boolean;          // Đã điều chỉnh bằng cách loại bỏ kết quả đối đầu đội bét bảng chưa
}

export interface EventData {
  id: string;
  name: string;
  teams: Record<string, Team>;
  groups: Record<string, Group>;
  matches: Match[];
  tenant_id?: string;
  sport_id?: string;
  sport?: Sport;
  competition_type?: CompetitionType;
  format_type?: EventFormatType;
  scoring_config?: Partial<ScoringConfig>;
  ranking_config?: RankingConfig;
  settings: TournamentSettings;
  activeGroupId: string | null;
  advanceSelectionMode: 'auto' | 'manual';
  manualQualifiedTeamIds: string[];
}

export interface Tenant {
  id: string; // UUID of the tenant
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  created_at?: string;
  updated_at?: string;
}

export interface AppRole {
  id: string; // UUID of the role
  name: string;
  description?: string;
  is_system: boolean;
  level: number; // 1 = super admin, 2 = tenant admin, 3 = event admin
}

export interface EnterpriseAccount {
  id: string; // UUID from auth.users
  username: string; // Used for login display
  display_name: string;
  tenant_id?: string; // Foreign key to tenants
  role_id: string; // Foreign key to roles
  status: 'active' | 'inactive';
  last_login?: string;
  created_at?: string;
  updated_at?: string;

  // Joined properties
  tenant?: Tenant;
  role?: AppRole;
  permittedEventIds?: string[]; // Array of strings (populated manually for event_admins)
  permissions?: string[]; // Array of permission codes
}

export interface ActiveSession {
  id: string;
  account_id: string; // UUID
  session_token: string;
  ip_address?: string;
  user_agent?: string;
  last_activity: string;
  created_at: string;
}

export interface LoginLog {
  id: string;
  account_id: string; // UUID
  login_time: string;
  ip_address?: string;
  user_agent?: string;
  status: 'success' | 'failed';
  reason?: string;
}

// Keeping the older Account type around for any non-migrated components until they are updated
// but we will mainly rely on EnterpriseAccount
export interface Account {
  id?: string;
  username: string;
  password?: string;
  displayName?: string;
  tournamentName?: string;
  role?: string; // Capabilities now rely on permissions, role is just informational
  permittedEventIds?: string[];
  tenant_id?: string;
  role_id?: string;
}


