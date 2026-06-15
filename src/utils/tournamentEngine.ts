/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Team, Match, GroupStanding, ThirdPlaceStanding, SeedType, TournamentSettings } from '../types';

/**
 * Tạo lịch thi đấu vòng tròn (Round-robin) cho một danh sách đội.
 * Sử dụng thuật toán xoay vòng (Circle Method / Berger Tables).
 */
export function generateRoundRobinMatches(
  groupId: string,
  teamIds: string[],
  settings: TournamentSettings
): Match[] {
  if (teamIds.length < 2) return [];

  const list = [...teamIds];
  const hasBye = list.length % 2 !== 0;
  if (hasBye) {
    list.push('BYE'); // Thêm một thực thể ảo nếu số đội lẻ
  }

  const n = list.length;
  const numRounds = n - 1;
  const matchesPerRound = n / 2;
  const matches: Match[] = [];

  // Tạo ID ngẫu nhiên đơn giản
  const randomId = () => Math.random().toString(36).substring(2, 9);

  for (let round = 1; round <= numRounds; round++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const home = list[i];
      const away = list[n - 1 - i];

      // Nếu có đội BYE, bỏ qua trận này (đội kia được nghỉ)
      if (home !== 'BYE' && away !== 'BYE') {
        matches.push({
          id: `${groupId}-m-${round}-${i}-${randomId()}`,
          groupId,
          teamAId: home,
          teamBId: away,
          scoreA: null,
          scoreB: null,
          winnerId: null,
          status: 'pending',
          round,
        });
      }
    }

    // Xoay vòng danh sách (giữ phần tử đầu tiên cố định)
    list.splice(1, 0, list.pop()!);
  }

  return matches;
}

/**
 * Tính toán bảng xếp hạng cho mỗi bảng đấu dựa trên kết quả trận đấu.
 * Áp dụng Quy tắc sắp xếp theo yêu cầu của BTC:
 * Điểm số > Hiệu số điểm (Point Diff) > Đối đầu trực tiếp > Tổng điểm các séc.
 */
export function calculateGroupStandings(
  groupId: string,
  teamIds: string[],
  groupMatches: Match[],
  teamsMap: Record<string, Team>,
  settings: TournamentSettings
): GroupStanding[] {
  const standings: Record<string, GroupStanding> = {};

  // Khởi tạo bảng xếp hạng ban đầu
  teamIds.forEach((tId) => {
    const team = teamsMap[tId];
    standings[tId] = {
      teamId: tId,
      teamName: team ? team.name : `Đội đã xóa (${tId})`,
      seed: team ? team.seed : 'none',
      matchesPlayed: 0,
      matchesWon: 0,
      matchesLost: 0,
      points: 0,
      setsWon: 0,
      setsLost: 0,
      pointsWon: 0,
      pointsLost: 0,
      pointDiff: 0,
      rank: 0,
    };
  });

  // Điền thông số từ các trận đấu đã kết thúc
  groupMatches.forEach((m) => {
    if (m.status !== 'finished' || m.scoreA === null || m.scoreB === null) return;
    const { teamAId, teamBId, scoreA, scoreB, winnerId } = m;

    if (!standings[teamAId] || !standings[teamBId]) return;

    // Cập nhật đội A
    standings[teamAId].matchesPlayed += 1;
    standings[teamAId].pointsWon += scoreA;
    standings[teamAId].pointsLost += scoreB;

    // Cập nhật đội B
    standings[teamBId].matchesPlayed += 1;
    standings[teamBId].pointsWon += scoreB;
    standings[teamBId].pointsLost += scoreA;

    if (winnerId === teamAId) {
      standings[teamAId].matchesWon += 1;
      standings[teamAId].setsWon += 1;
      standings[teamAId].points += settings.winPoint;

      standings[teamBId].matchesLost += 1;
      standings[teamBId].setsLost += 1;
      standings[teamBId].points += settings.lossPoint;
    } else if (winnerId === teamBId) {
      standings[teamBId].matchesWon += 1;
      standings[teamBId].setsWon += 1;
      standings[teamBId].points += settings.winPoint;

      standings[teamAId].matchesLost += 1;
      standings[teamAId].setsLost += 1;
      standings[teamAId].points += settings.lossPoint;
    }
  });

  // Tính hiệu số
  const resultList = Object.values(standings).map((st) => {
    st.pointDiff = st.pointsWon - st.pointsLost;
    return st;
  });

  // Thuật toán sắp xếp theo yêu cầu: Điểm > Hiệu số > Đối đầu > Tổng điểm ghi được
  resultList.sort((a, b) => {
    // 1. So sánh Điểm (Points)
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    // 2. So sánh Hiệu số điểm ghi được/bị ghi (Point Diff)
    if (b.pointDiff !== a.pointDiff) {
      return b.pointDiff - a.pointDiff;
    }

    // 3. So sánh Đối đầu trực tiếp (Head-to-head)
    const matchBetween = groupMatches.find(
      (m) =>
        m.status === 'finished' &&
        ((m.teamAId === a.teamId && m.teamBId === b.teamId) ||
          (m.teamAId === b.teamId && m.teamBId === a.teamId))
    );
    if (matchBetween) {
      if (matchBetween.winnerId === a.teamId) return -1;
      if (matchBetween.winnerId === b.teamId) return 1;
    }

    // 4. So sánh Tổng điểm ghi được (Points Won)
    if (b.pointsWon !== a.pointsWon) {
      return b.pointsWon - a.pointsWon;
    }

    // 5. Nếu bằng nhau hoàn toàn, ưu tiên Đội có hạt giống cao hơn hoặc ngẫu nhiên
    return getSeedPriority(a.seed) - getSeedPriority(b.seed);
  });

  // Gán thứ hạng cuối cùng (Rank)
  resultList.forEach((st, idx) => {
    st.rank = idx + 1;
  });

  return resultList;
}

function getSeedPriority(seed: SeedType): number {
  if (seed === '1') return 1;
  if (seed === '2') return 2;
  if (seed === '3') return 3;
  if (seed === '4') return 4;
  return 5;
}

/**
 * Xếp hạng "Đội hạng 3 xuất sắc nhất" - Áp dụng Luật UEFA.
 * Nếu số lượng đội giữa các bảng không đều nhau (ví dụ bảng 4 đội, bảng 3 đội):
 * + Luật UEFA quy định: Để so sánh công bằng giữa các bảng, kết quả của đội hạng 3 đối đầu
 *   với Đội xếp bét bảng (hạng chót) trong bảng đấu đó sẽ bị TRỪ ra khỏi bảng xếp hạng so sánh.
 * + Nếu các bảng có số đội đều nhau: Giữ nguyên kết quả để so sánh.
 */
export function calculateBestThirdPlaces(
  allStandings: Record<string, GroupStanding[]>, // GroupId -> Standings của bảng đó, xếp hạng từ 1 đến N
  allMatches: Match[],
  settings: TournamentSettings,
  groupNamesMap: Record<string, string>
): ThirdPlaceStanding[] {
  const thirdPlaceCandidates: ThirdPlaceStanding[] = [];

  // Xác định số lượng đội tối thiểu ở các bảng đấu
  let minTeamsInGroup = 999;
  let maxTeamsInGroup = 0;
  const groupsList = Object.keys(allStandings);

  if (groupsList.length === 0) return [];

  groupsList.forEach((gId) => {
    const len = allStandings[gId].length;
    if (len > 0) {
      if (len < minTeamsInGroup) minTeamsInGroup = len;
      if (len > maxTeamsInGroup) maxTeamsInGroup = len;
    }
  });

  const isUneven = minTeamsInGroup !== maxTeamsInGroup;

  groupsList.forEach((gId) => {
    const standings = allStandings[gId];
    // Tìm đội xếp thứ 3 trong bảng này
    const thirdTeamStanding = standings.find((s) => s.rank === 3);
    if (!thirdTeamStanding) return;

    const tId = thirdTeamStanding.teamId;

    // Nếu số lượng đội giữa các bảng không đều, ta áp dụng điều chỉnh UEFA
    // Loại bỏ kết quả thi đấu với đội cuối bảng (đối với bảng có số đội nhiều hơn số đội tối thiểu)
    const isUefaAdjusted = isUneven && standings.length > minTeamsInGroup;
    let adjustedMatchesPlayed = thirdTeamStanding.matchesPlayed;
    let adjustedMatchesWon = thirdTeamStanding.matchesWon;
    let adjustedMatchesLost = thirdTeamStanding.matchesLost;
    let adjustedPoints = thirdTeamStanding.points;
    let adjustedPointsWon = thirdTeamStanding.pointsWon;
    let adjustedPointsLost = thirdTeamStanding.pointsLost;

    if (isUefaAdjusted) {
      // Tìm đội bét bảng trong bảng này
      const lastTeam = standings[standings.length - 1];
      if (lastTeam && lastTeam.teamId !== tId) {
        // Tìm trận đấu giữa đội hạng 3 và đội bét bảng này
        const penaltyMatch = allMatches.find(
          (m) =>
            m.groupId === gId &&
            m.status === 'finished' &&
            ((m.teamAId === tId && m.teamBId === lastTeam.teamId) ||
              (m.teamAId === lastTeam.teamId && m.teamBId === tId))
        );

        if (penaltyMatch && penaltyMatch.scoreA !== null && penaltyMatch.scoreB !== null) {
          // Trừ đi thông số của trận đấu này
          adjustedMatchesPlayed -= 1;
          const isHome = penaltyMatch.teamAId === tId;
          const scoreUs = isHome ? penaltyMatch.scoreA : penaltyMatch.scoreB;
          const scoreThem = isHome ? penaltyMatch.scoreB : penaltyMatch.scoreA;

          adjustedPointsWon -= scoreUs;
          adjustedPointsLost -= scoreThem;

          if (penaltyMatch.winnerId === tId) {
            adjustedMatchesWon -= 1;
            adjustedPoints -= settings.winPoint;
          } else {
            adjustedMatchesLost -= 1;
            adjustedPoints -= settings.lossPoint;
          }
        }
      }
    }

    thirdPlaceCandidates.push({
      teamId: tId,
      teamName: thirdTeamStanding.teamName,
      groupId: gId,
      groupName: groupNamesMap[gId] || `Bảng ${gId}`,
      matchesPlayed: adjustedMatchesPlayed,
      matchesWon: adjustedMatchesWon,
      matchesLost: adjustedMatchesLost,
      points: adjustedPoints,
      pointsWon: adjustedPointsWon,
      pointsLost: adjustedPointsLost,
      pointDiff: adjustedPointsWon - adjustedPointsLost,
      rank: 0,
      originalRanking: standings,
      isUefaAdjusted,
    });
  });

  // So sánh các đội hạng 3 theo thứ tự: Điểm -> Hiệu số -> Điểm ghi -> Hạt giống
  thirdPlaceCandidates.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsWon !== a.pointsWon) return b.pointsWon - a.pointsWon;
    return b.teamName.localeCompare(a.teamName); // Tên bảng / chữ cái nếu tất cả đều bằng nhau
  });

  // Gán thứ hạng so sánh hạng 3
  thirdPlaceCandidates.forEach((cand, idx) => {
    cand.rank = idx + 1;
  });

  return thirdPlaceCandidates;
}

/**
 * Tạo Sơ đồ loại trực tiếp (Knockout Bracket) tự động.
 * Sinh cấu trúc cây nhịp nhàng dựa trên quy mô (8, 12, 16, 24, 32 đội).
 * Trả về danh sách trận đấu knockout rỗng (hoặc có sẵn đội đại diện tùy theo trạng thái vòng bảng).
 */
export function generateKnockoutMatchesSchema(
  size: 4 | 8 | 12 | 16 | 24 | 32,
  advancingTeams: { label: string; placeholder: string; sourceRank?: number; sourceGroupId?: string }[]
): Match[] {
  const matches: Match[] = [];
  const randomId = () => Math.random().toString(36).substring(2, 9);

  // Bracket quy chuẩn cho 4 ĐỘI (Bán Kết -> Chung Kết / Tranh Hạng 3)
  if (size === 4) {
    const bronzeMatchId = `ko-BM-${randomId()}`;
    const finalMatchId = `ko-F-${randomId()}`;

    const bronzeMatch: Match = {
      id: bronzeMatchId,
      groupId: 'knockout',
      teamAId: null,
      teamBId: null,
      placeholderA: 'Thua Bán Kết 1',
      placeholderB: 'Thua Bán Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 2,
      knockoutRoundName: 'Tranh Hạng 3',
      knockoutMatchId: 'Y-BM',
    };

    const finalMatch: Match = {
      id: finalMatchId,
      groupId: 'knockout',
      teamAId: null,
      teamBId: null,
      placeholderA: 'Thắng Bán Kết 1',
      placeholderB: 'Thắng Bán Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 2,
      knockoutRoundName: 'Chung Kết',
      knockoutMatchId: 'Y-F',
    };

    const sf1: Match = {
      id: `ko-SF1-${randomId()}`,
      groupId: 'knockout',
      teamAId: null,
      teamBId: null,
      placeholderA: advancingTeams[0] ? advancingTeams[0].placeholder : 'Nhất Bảng A',
      placeholderB: advancingTeams[1] ? advancingTeams[1].placeholder : 'Nhì Bảng B',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 1,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: 'SF-1',
      nextMatchId: finalMatchId,
      nextMatchSlot: 'A',
    };

    const sf2: Match = {
      id: `ko-SF2-${randomId()}`,
      groupId: 'knockout',
      teamAId: null,
      teamBId: null,
      placeholderA: advancingTeams[2] ? advancingTeams[2].placeholder : 'Nhất Bảng B',
      placeholderB: advancingTeams[3] ? advancingTeams[3].placeholder : 'Nhì Bảng A',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 1,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: 'SF-2',
      nextMatchId: finalMatchId,
      nextMatchSlot: 'B',
    };

    return [sf1, sf2, bronzeMatch, finalMatch];
  }

  // Ví dụ quy chuẩn với Tournament Bracket 8 đội:
  // Vòng 1 (Tứ kết - Quarterfinals): 4 trận đấu (QF1, QF2, QF3, QF4)
  // Vòng 2 (Bán kết - Semifinals): 2 trận đấu (SF1, SF2)
  // Vòng 3 (Chung kết & Ba Tư - Finals/Bronze): 2 trận đấu (F, Bronz)

  if (size === 8) {
    // TỨ KẾT (Quarterfinals)
    // QF1: Trận 1
    // QF2: Trận 2
    // QF3: Trận 3
    // QF4: Trận 4
    const qfIds = ['QF1', 'QF2', 'QF3', 'QF4'];
    const sfIds = ['SF1', 'SF2'];
    const finalId = 'F';
    const bronzeId = 'BM'; // Bronze Match (Tranh hạng Ba)

    // Tạo các trận Chung kết và Tranh hạng Ba trước để lấy làm đích đỗ tiếp theo
    const bronzeMatch: Match = {
      id: `ko-${bronzeId}-${randomId()}`,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'L-SF1', // Nhãn giữ chỗ cho đội thua SF1
      teamBId: null, placeholderB: 'L-SF2', // Thua SF2
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 3,
      knockoutRoundName: 'Tranh Hạng 3',
      knockoutMatchId: bronzeId,
    };

    const finalMatch: Match = {
      id: `ko-${finalId}-${randomId()}`,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'W-SF1', // Thắng SF1
      teamBId: null, placeholderB: 'W-SF2', // Thắng SF2
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 3,
      knockoutRoundName: 'Chung Kết',
      knockoutMatchId: finalId,
    };

    // Tạo các trận Bán kết
    const sf1: Match = {
      id: `ko-${sfIds[0]}-${randomId()}`,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'W-QF1',
      teamBId: null, placeholderB: 'W-QF2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 2,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: sfIds[0],
      nextMatchId: finalMatch.id,
      nextMatchSlot: 'A',
    };

    const sf2: Match = {
      id: `ko-${sfIds[1]}-${randomId()}`,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'W-QF3',
      teamBId: null, placeholderB: 'W-QF4',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 2,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: sfIds[1],
      nextMatchId: finalMatch.id,
      nextMatchSlot: 'B',
    };

    // Tạo các trận Tứ kết
    const qfMatches: Match[] = [];
    for (let i = 0; i < 4; i++) {
      const nextSF = i < 2 ? sf1 : sf2;
      const slot: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';

      // Lấy đội gán ban đầu nếu có tên gợi nhớ sẵn
      const tA = advancingTeams[i * 2] ? advancingTeams[i * 2].placeholder : `Đội hạng ${i * 2 + 1}`;
      const tB = advancingTeams[i * 2 + 1] ? advancingTeams[i * 2 + 1].placeholder : `Đội hạng ${i * 2 + 2}`;

      qfMatches.push({
        id: `ko-${qfIds[i]}-${randomId()}`,
        groupId: 'knockout',
        teamAId: null, placeholderA: tA,
        teamBId: null, placeholderB: tB,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'pending',
        round: 1,
        knockoutRoundName: 'Tứ Kết',
        knockoutMatchId: qfIds[i],
        nextMatchId: nextSF.id,
        nextMatchSlot: slot,
      });
    }

    return [...qfMatches, sf1, sf2, bronzeMatch, finalMatch];
  }

  // Bracket quy chuẩn cho 32 ĐỘI
  if (size === 32) {
    const r32Ids = Array.from({ length: 16 }, (_, i) => `R32-${i + 1}`);
    const r16Ids = Array.from({ length: 8 }, (_, i) => `R16-${i + 1}`);
    const qfIds = Array.from({ length: 4 }, (_, i) => `QF-${i + 1}`);
    const sfIds = ['SF-1', 'SF-2'];

    const bronzeMatchId = `ko-BM-${randomId()}`;
    const finalMatchId = `ko-F-${randomId()}`;

    const bronzeMatch: Match = {
      id: bronzeMatchId,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thua Bán Kết 1',
      teamBId: null, placeholderB: 'Thua Bán Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 5,
      knockoutRoundName: 'Tranh Hạng 3',
      knockoutMatchId: 'Y-BM',
    };

    const finalMatch: Match = {
      id: finalMatchId,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thắng Bán Kết 1',
      teamBId: null, placeholderB: 'Thắng Bán Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 5,
      knockoutRoundName: 'Chung Kết',
      knockoutMatchId: 'Y-F',
    };

    const sf1Id = `ko-SF1-${randomId()}`;
    const sf2Id = `ko-SF2-${randomId()}`;

    const sf1: Match = {
      id: sf1Id,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thắng Tứ Kết 1',
      teamBId: null, placeholderB: 'Thắng Tứ Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 4,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: 'SF-1',
      nextMatchId: finalMatchId,
      nextMatchSlot: 'A',
    };

    const sf2: Match = {
      id: sf2Id,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thắng Tứ Kết 3',
      teamBId: null, placeholderB: 'Thắng Tứ Kết 4',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 4,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: 'SF-2',
      nextMatchId: finalMatchId,
      nextMatchSlot: 'B',
    };

    // Tạo các trận Tứ kết
    const qfMatches: Match[] = [];
    const qfMatchIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const parentSFId = i < 2 ? sf1Id : sf2Id;
      const slot = i % 2 === 0 ? 'A' : 'B';
      const qfIdStr = `ko-QF${i + 1}-${randomId()}`;
      qfMatchIds.push(qfIdStr);

      qfMatches.push({
        id: qfIdStr,
        groupId: 'knockout',
        teamAId: null, placeholderA: `Thắng Vòng 1/8 (Trận ${i * 2 + 1})`,
        teamBId: null, placeholderB: `Thắng Vòng 1/8 (Trận ${i * 2 + 2})`,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'pending',
        round: 3,
        knockoutRoundName: 'Tứ Kết',
        knockoutMatchId: `QF-${i + 1}`,
        nextMatchId: parentSFId,
        nextMatchSlot: slot as 'A' | 'B',
      });
    }

    // Tạo các trận Vòng 1/8 (Round of 16)
    const r16Matches: Match[] = [];
    const r16MatchIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const parentQFId = qfMatchIds[Math.floor(i / 2)];
      const slot = i % 2 === 0 ? 'A' : 'B';
      const r16IdStr = `ko-R16-${i + 1}-${randomId()}`;
      r16MatchIds.push(r16IdStr);

      r16Matches.push({
        id: r16IdStr,
        groupId: 'knockout',
        teamAId: null, placeholderA: `Thắng Vòng 32 (Trận ${i * 2 + 1})`,
        teamBId: null, placeholderB: `Thắng Vòng 32 (Trận ${i * 2 + 2})`,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'pending',
        round: 2,
        knockoutRoundName: 'Vòng 16 Đội',
        knockoutMatchId: `R16-${i + 1}`,
        nextMatchId: parentQFId,
        nextMatchSlot: slot as 'A' | 'B',
      });
    }

    // Tạo các trận Vòng 1/16 (Round of 32)
    const r32Matches: Match[] = [];
    for (let i = 0; i < 16; i++) {
      const parentR16Id = r16MatchIds[Math.floor(i / 2)];
      const slot = i % 2 === 0 ? 'A' : 'B';

      const tA = advancingTeams[i * 2] ? advancingTeams[i * 2].placeholder : `Đội hạng ${i * 2 + 1}`;
      const tB = advancingTeams[i * 2 + 1] ? advancingTeams[i * 2 + 1].placeholder : `Đội hạng ${i * 2 + 2}`;

      r32Matches.push({
        id: `ko-R32-${i + 1}-${randomId()}`,
        groupId: 'knockout',
        teamAId: null, placeholderA: tA,
        teamBId: null, placeholderB: tB,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'pending',
        round: 1,
        knockoutRoundName: 'Vòng 32 Đội',
        knockoutMatchId: `R32-${i + 1}`,
        nextMatchId: parentR16Id,
        nextMatchSlot: slot as 'A' | 'B',
      });
    }

    return [...r32Matches, ...r16Matches, ...qfMatches, sf1, sf2, bronzeMatch, finalMatch];
  }

  // Bracket quy chuẩn cho 16 ĐỘI (Vòng 16 -> Tứ kết -> Bán kết -> Chung kết)
  if (size === 16 || size === 12 || size === 24) {
    // Để thiết kế của chúng ta luôn tương thích và mượt mà mà không lo bị treo, ta tự động dựng Bracket 16 đội hoặc 8 đội.
    // Đối với cỡ 16 đội: 8 trận Vòng 16đ, 4 trận Tứ kết, 2 trận Bán kết, 1 trận Tranh hạng 3, 1 trận Chung kết.
    const r16Ids = Array.from({ length: 8 }, (_, i) => `R16-${i + 1}`);
    const qfIds = Array.from({ length: 4 }, (_, i) => `QF-${i + 1}`);
    const sfIds = ['SF-1', 'SF-2'];

    const bronzeMatchId = `ko-BM-${randomId()}`;
    const finalMatchId = `ko-F-${randomId()}`;

    const bronzeMatch: Match = {
      id: bronzeMatchId,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thua Bán Kết 1',
      teamBId: null, placeholderB: 'Thua Bán Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 4,
      knockoutRoundName: 'Tranh Hạng 3',
      knockoutMatchId: 'Y-BM',
    };

    const finalMatch: Match = {
      id: finalMatchId,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thắng Bán Kết 1',
      teamBId: null, placeholderB: 'Thắng Bán Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 4,
      knockoutRoundName: 'Chung Kết',
      knockoutMatchId: 'Y-F',
    };

    const sf1Id = `ko-SF1-${randomId()}`;
    const sf2Id = `ko-SF2-${randomId()}`;

    const sf1: Match = {
      id: sf1Id,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thắng Tứ Kết 1',
      teamBId: null, placeholderB: 'Thắng Tứ Kết 2',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 3,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: 'SF-1',
      nextMatchId: finalMatchId,
      nextMatchSlot: 'A',
    };

    const sf2: Match = {
      id: sf2Id,
      groupId: 'knockout',
      teamAId: null, placeholderA: 'Thắng Tứ Kết 3',
      teamBId: null, placeholderB: 'Thắng Tứ Kết 4',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      round: 3,
      knockoutRoundName: 'Bán Kết',
      knockoutMatchId: 'SF-2',
      nextMatchId: finalMatchId,
      nextMatchSlot: 'B',
    };

    // Tạo các trận Tứ kết
    const qfMatches: Match[] = [];
    const qfMatchIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const parentSFId = i < 2 ? sf1Id : sf2Id;
      const slot = i % 2 === 0 ? 'A' : 'B';
      const qfIdStr = `ko-QF${i + 1}-${randomId()}`;
      qfMatchIds.push(qfIdStr);

      qfMatches.push({
        id: qfIdStr,
        groupId: 'knockout',
        teamAId: null, placeholderA: `Thắng Vòng 16 (Trận ${i * 2 + 1})`,
        teamBId: null, placeholderB: `Thắng Vòng 16 (Trận ${i * 2 + 2})`,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'pending',
        round: 2,
        knockoutRoundName: 'Tứ Kết',
        knockoutMatchId: `QF-${i + 1}`,
        nextMatchId: parentSFId,
        nextMatchSlot: slot as 'A' | 'B',
      });
    }

    // Tạo các trận Vòng 16
    const r16Matches: Match[] = [];
    for (let i = 0; i < 8; i++) {
      const parentQFId = qfMatchIds[Math.floor(i / 2)];
      const slot = i % 2 === 0 ? 'A' : 'B';

      const tA = advancingTeams[i * 2] ? advancingTeams[i * 2].placeholder : `Đội hạng ${i * 2 + 1}`;
      const tB = advancingTeams[i * 2 + 1] ? advancingTeams[i * 2 + 1].placeholder : `Đội hạng ${i * 2 + 2}`;

      r16Matches.push({
        id: `ko-R16-${i + 1}-${randomId()}`,
        groupId: 'knockout',
        teamAId: null, placeholderA: tA,
        teamBId: null, placeholderB: tB,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'pending',
        round: 1,
        knockoutRoundName: 'Vòng 16 Đội',
        knockoutMatchId: `R16-${i + 1}`,
        nextMatchId: parentQFId,
        nextMatchSlot: slot as 'A' | 'B',
      });
    }

    return [...r16Matches, ...qfMatches, sf1, sf2, bronzeMatch, finalMatch];
  }

  // Mặc định nhỏ hơn hoặc khẩn cấp, trả về trống
  return [];
}

/**
 * Chuyển đổi tên đội giữ chỗ / mã vòng đấu loại trực tiếp sang tiếng Việt rõ nghĩa theo yêu cầu của BTC.
 */
export function getReadableTeamName(teamName: string, groups?: Record<string, any>): string {
  if (!teamName) return '';
  
  let clean = teamName.trim();
  
  // Dọn dẹp đuôi __e hoặc dấu __ dư thừa do hệ thống ghép/chuẩn hóa mã phòng
  clean = clean.replace(/__e$/, '');
  
  if (clean.startsWith('__1st_')) {
    const gid = clean.replace('__1st_', '').replace(/__$/, '');
    if (groups && groups[gid]) {
      return `Nhất ${groups[gid].name}`;
    }
    if (groups) {
      const found = Object.values(groups).find(
        (g: any) => g.id === gid || g.id === gid.replace(/__e$/, '') || g.id.startsWith(gid + '-') || gid.startsWith(g.id + '-')
      );
      if (found) return `Nhất ${found.name}`;
    }
    // Parse dự phòng số thứ tự group
    const numMatch = gid.match(/group-(\d+)/i) || gid.match(/-(\d+)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      const letter = String.fromCharCode(64 + idx);
      return `Nhất Bảng ${letter}`;
    }
    return `Nhất ${gid.replace('group-', 'Bảng ').toUpperCase()}`;
  }

  if (clean.startsWith('__2nd_')) {
    const gid = clean.replace('__2nd_', '').replace(/__$/, '');
    if (groups && groups[gid]) {
      return `Nhì ${groups[gid].name}`;
    }
    if (groups) {
      const found = Object.values(groups).find(
        (g: any) => g.id === gid || g.id === gid.replace(/__e$/, '') || g.id.startsWith(gid + '-') || gid.startsWith(g.id + '-')
      );
      if (found) return `Nhì ${found.name}`;
    }
    const numMatch = gid.match(/group-(\d+)/i) || gid.match(/-(\d+)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      const letter = String.fromCharCode(64 + idx);
      return `Nhì Bảng ${letter}`;
    }
    return `Nhì ${gid.replace('group-', 'Bảng ').toUpperCase()}`;
  }

  if (clean.startsWith('__3rd_')) {
    const gid = clean.replace('__3rd_', '').replace(/__$/, '');
    if (groups && groups[gid]) {
      return `Ba ${groups[gid].name}`;
    }
    if (groups) {
      const found = Object.values(groups).find(
        (g: any) => g.id === gid || g.id === gid.replace(/__e$/, '') || g.id.startsWith(gid + '-') || gid.startsWith(g.id + '-')
      );
      if (found) return `Ba ${found.name}`;
    }
    const numMatch = gid.match(/group-(\d+)/i) || gid.match(/-(\d+)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      const letter = String.fromCharCode(64 + idx);
      return `Ba Bảng ${letter}`;
    }
    return `Ba XS ${gid}`;
  }

  const nameUpper = clean.toUpperCase().trim();

  // Handle QF winners / losers
  if (nameUpper === 'W-QF1' || nameUpper === 'W_QF1') return 'W-QF1 (Thắng Tứ Kết 1)';
  if (nameUpper === 'W-QF2' || nameUpper === 'W_QF2') return 'W-QF2 (Thắng Tứ Kết 2)';
  if (nameUpper === 'W-QF3' || nameUpper === 'W_QF3') return 'W-QF3 (Thắng Tứ Kết 3)';
  if (nameUpper === 'W-QF4' || nameUpper === 'W_QF4') return 'W-QF4 (Thắng Tứ Kết 4)';

  if (nameUpper === 'L-SF1' || nameUpper === 'L_SF1') return 'L-SF1 (Thua Bán Kết 1)';
  if (nameUpper === 'L-SF2' || nameUpper === 'L_SF2') return 'L-SF2 (Thua Bán Kết 2)';
  
  if (nameUpper === 'W-SF1' || nameUpper === 'W_SF1') return 'W-SF1 (Thắng Bán Kết 1)';
  if (nameUpper === 'W-SF2' || nameUpper === 'W_SF2') return 'W-SF2 (Thắng Bán Kết 2)';

  if (nameUpper === 'THẮNG BÁN KẾT 1' || nameUpper === 'THANG BAN KET 1') return 'W-SF1 (Thắng Bán Kết 1)';
  if (nameUpper === 'THẮNG BÁN KẾT 2' || nameUpper === 'THANG BAN KET 2') return 'W-SF2 (Thắng Bán Kết 2)';
  if (nameUpper === 'THUA BÁN KẾT 1' || nameUpper === 'THUA BAN KET 1') return 'L-SF1 (Thua Bán Kết 1)';
  if (nameUpper === 'THUA BÁN KẾT 2' || nameUpper === 'THUA BAN KET 2') return 'L-SF2 (Thua Bán Kết 2)';

  if (nameUpper === 'THẮNG TỨ KẾT 1' || nameUpper === 'THANG TU KET 1') return 'W-QF1 (Thắng Tứ Kết 1)';
  if (nameUpper === 'THẮNG TỨ KẾT 2' || nameUpper === 'THANG TU KET 2') return 'W-QF2 (Thắng Tứ Kết 2)';
  if (nameUpper === 'THẮNG TỨ KẾT 3' || nameUpper === 'THANG TU KET 3') return 'W-QF3 (Thắng Tứ Kết 3)';
  if (nameUpper === 'THẮNG TỨ KẾT 4' || nameUpper === 'THANG TU KET 4') return 'W-QF4 (Thắng Tứ Kết 4)';

  const r16WinnerMatch = nameUpper.match(/THẮNG VÒNG 16 \(TRẬN (\d+)\)/) || nameUpper.match(/THANG VONG 16 \(TRAN (\d+)\)/) || clean.match(/Thắng Vòng 1\/8 \(Trận (\d+)\)/i) || clean.match(/Thắng Vòng 16 \(Trận (\d+)\)/i);
  if (r16WinnerMatch) {
    const num = r16WinnerMatch[1];
    return `W16 (Trận ${num})`;
  }

  const r32WinnerMatch = nameUpper.match(/THẮNG VÒNG 32 \(TRẬN (\d+)\)/) || nameUpper.match(/THANG VONG 32 \(TRAN (\d+)\)/) || clean.match(/Thắng Vòng 32 \(Trận (\d+)\)/i);
  if (r32WinnerMatch) {
    const num = r32WinnerMatch[1];
    return `W32 (Trận ${num})`;
  }

  const qfWinnerMatch = nameUpper.match(/THẮNG TỨ KẾT (\d+)/) || nameUpper.match(/THANG TU KET (\d+)/) || clean.match(/Thắng Tứ Kết (\d+)/i) || nameUpper.match(/W-QF(\d+)/) || nameUpper.match(/W_QF(\d+)/);
  if (qfWinnerMatch) {
     const num = qfWinnerMatch[1];
     return `W Tứ Kết (Trận ${num})`;
  }

  const sfWinnerMatch = nameUpper.match(/THẮNG BÁN KẾT (\d+)/) || nameUpper.match(/THANG BAN KET (\d+)/) || clean.match(/Thắng Bán Kết (\d+)/i) || nameUpper.match(/W-SF(\d+)/) || nameUpper.match(/W_SF(\d+)/);
  if (sfWinnerMatch) {
     const num = sfWinnerMatch[1];
     return `W Bán Kết (Trận ${num})`;
  }

  const sfLoserMatch = nameUpper.match(/THUA BÁN KẾT (\d+)/) || nameUpper.match(/THUA BAN KET (\d+)/) || clean.match(/Thua Bán Kết (\d+)/i) || nameUpper.match(/L-SF(\d+)/) || nameUpper.match(/L_SF(\d+)/);
  if (sfLoserMatch) {
     const num = sfLoserMatch[1];
     return `L Bán Kết (Trận ${num})`;
  }

  // Handle placeholders like Nhất Bảng A, Nhì Bảng B
  if (nameUpper.startsWith('NHẤT BẢNG ')) {
      return clean;
  }
  if (nameUpper.startsWith('NHÌ BẢNG ')) {
      return clean;
  }
  if (nameUpper.startsWith('BA BẢNG ')) {
      return clean;
  }

  return clean;
}

export function getReadableKoMatchName(knockoutMatchId: string): string {
  if (!knockoutMatchId) return '';
  const cleanId = knockoutMatchId.toUpperCase().replace('-', '');
  if (cleanId === 'SF1') return '#SF1: Bán Kết 1';
  if (cleanId === 'SF2') return '#SF2: Bán Kết 2';
  if (cleanId === 'BM' || cleanId === 'YBM') return '#BM: Tranh Hạng 3';
  if (cleanId === 'F' || cleanId === 'YF') return '#F: Chung Kết';
  if (cleanId === 'QF1') return '#QF1: Tứ Kết 1';
  if (cleanId === 'QF2') return '#QF2: Tứ Kết 2';
  if (cleanId === 'QF3') return '#QF3: Tứ Kết 3';
  if (cleanId === 'QF4') return '#QF4: Tứ Kết 4';
  
  if (cleanId.startsWith('R16')) {
    const num = cleanId.replace('R16', '');
    return `#R16-${num}: Vòng 1/8 (Trận ${num})`;
  }
  if (cleanId.startsWith('R32')) {
    const num = cleanId.replace('R32', '');
    return `#R32-${num}: Vòng 1/16 (Trận ${num})`;
  }
  return `Trận đấu #${knockoutMatchId}`;
}

/**
 * Sắp xếp thứ tự danh sách trận đấu sao cho các đội có thời gian nghỉ tốt nhất.
 * Thể thức: Xen kẽ đầy đủ toàn bộ các trận đấu của các bảng đấu (ví dụ: Trận 1 Bảng A, Trận 2 Bảng B, Trận 3 Bảng C, Trận 4 Bảng A...)
 * và tổ chức cuốn chiếu theo từng vòng (Round 1 trước, sau đó đến Round 2...) để tránh xung đột lịch đấu và bảo đảm thời lượng nghỉ tối đa.
 */
export function balanceMatchesRestTime(matches: Match[]): Match[] {
  if (matches.length <= 1) return matches;

  // Tách riêng trận knockout để không can thiệp vào thứ tự nhánh trực tiếp
  const knockoutMatches = matches.filter((m) => m.groupId === 'knockout');
  const groupMatches = matches.filter((m) => m.groupId !== 'knockout');

  if (groupMatches.length <= 1) return matches;

  // 1. Nhóm các trận đấu theo vòng đấu (round)
  const roundsMap: Record<number, Match[]> = {};
  groupMatches.forEach((m) => {
    const r = m.round || 1;
    if (!roundsMap[r]) {
      roundsMap[r] = [];
    }
    roundsMap[r].push(m);
  });

  // Tách khóa vòng đấu và sắp xếp tăng dần
  const sortedRounds = Object.keys(roundsMap)
    .map(Number)
    .sort((a, b) => a - b);

  const orderedGroupMatches: Match[] = [];

  // 2. Với mỗi vòng đấu, tiến hành xếp xen kẽ các bảng (groupId)
  sortedRounds.forEach((r) => {
    const roundMatches = roundsMap[r];

    // Nhóm các trận trong vòng này theo groupId
    const groupsInRoundMap: Record<string, Match[]> = {};
    roundMatches.forEach((m) => {
      const gId = m.groupId;
      if (!groupsInRoundMap[gId]) {
        groupsInRoundMap[gId] = [];
      }
      groupsInRoundMap[gId].push(m);
    });

    // Lấy danh sách các groupId và sắp xếp theo tự nhiên (Bảng A -> group-1, Bảng B -> group-2, Bảng C -> group-3...)
    const sortedGroupIds = Object.keys(groupsInRoundMap).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Tạo các mảng xếp hàng đợi (queue) trận đấu tương ứng của mỗi bảng trong vòng này
    const groupQueues = sortedGroupIds.map((gId) => [...groupsInRoundMap[gId]]);

    // Tiến hành gỡ dần từng trận ở đầu hàng đợi của mỗi bảng đấu theo chu kỳ vòng tròn (Interleaving)
    let hasMore = true;
    while (hasMore) {
      hasMore = false;
      for (let i = 0; i < groupQueues.length; i++) {
        const queue = groupQueues[i];
        if (queue.length > 0) {
          const match = queue.shift();
          if (match) {
            orderedGroupMatches.push(match);
          }
          if (queue.length > 0) {
            hasMore = true;
          }
        }
      }
    }
  });

  // Ghép các trận đấu vòng bảng đã xen kẽ tối ưu xếp cùng các trận đấu knockout sau cùng
  return [...orderedGroupMatches, ...knockoutMatches];
}

