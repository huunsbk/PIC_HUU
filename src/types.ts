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
}

export interface Tournament {
  id: string;
  name: string;
  organization: string;
  location: string;
  date: string;
  settings: TournamentSettings;
}

export type SeedType = 'none' | '1' | '2' | '3' | '4';

export interface Team {
  id: string;
  name: string;
  groupId: string | null;  // Bảng đấu mà đội thuộc về, null nếu chưa gán
  seed: SeedType;          // Hạt giống (none hoặc 1, 2, 3, 4)
}

export interface Group {
  id: string;
  name: string; // VD: Bảng A, Bảng B...
  teamIds: string[];
}

export interface Match {
  id: string;
  groupId: string; // ID bảng đấu, hoặc "knockout" nếu ở vòng đấu loại trực tiếp
  teamAId: string;
  teamBId: string;
  scoreA: number | null; // Điểm đội A (null nếu chưa đấu)
  scoreB: number | null; // Điểm đội B (null nếu chưa đấu)
  winnerId: string | null; // ID đội thắng (null nếu chưa đấu hoặc hòa)
  status: 'pending' | 'playing' | 'finished';
  round: number; // Vòng đấu (chỉ số 1, 2, 3...)
  knockoutRoundName?: string; // Tên vòng loại trực tiếp, VD: "Vòng 16", "Tứ kết", "Bán kết", "Chung kết"
  knockoutMatchId?: string; // Định danh trận trong nhánh loại trực tiếp (VD: "QF1", "SF1", "F")
  nextMatchId?: string; // Trận tiếp theo mà đội thắng sẽ chuyển tới
  nextMatchSlot?: 'A' | 'B'; // Đội thắng sẽ vào slot A hay slot B trong trận tiếp theo
}

export interface AuditLog {
  timestamp: string; // ISO string hoặc định dạng xem được
  action: string;    // Hành động chính
  details: string;   // Chi tiết hành động
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
  settings: TournamentSettings;
  activeGroupId: string | null;
  advanceSelectionMode: 'auto' | 'manual';
  manualQualifiedTeamIds: string[];
}

export interface Account {
  username: string;
  password?: string;
  displayName: string;
  tournamentName: string;
  session_id?: string;
  role?: 'admin2' | 'admin3';
  parentTenantId?: string;
  permittedEventIds?: string[];
}


