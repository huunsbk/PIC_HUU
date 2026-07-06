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

function getFinishedSetRows(match: Match) {
  return (match.matchSets || [])
    .filter((setRow) => setRow.deleted_at === null || setRow.deleted_at === undefined)
    .filter((setRow) => setRow.score_a !== null && setRow.score_a !== undefined && setRow.score_b !== null && setRow.score_b !== undefined)
    .map((setRow) => ({
      scoreA: Number(setRow.score_a || 0),
      scoreB: Number(setRow.score_b || 0),
    }));
}

function getMatchScoreBreakdown(match: Match) {
  const finishedSets = getFinishedSetRows(match);

  if (finishedSets.length > 0) {
    return finishedSets.reduce(
      (acc, setRow) => {
        acc.pointsA += setRow.scoreA;
        acc.pointsB += setRow.scoreB;
        if (setRow.scoreA > setRow.scoreB) acc.setsA += 1;
        if (setRow.scoreB > setRow.scoreA) acc.setsB += 1;
        return acc;
      },
      { pointsA: 0, pointsB: 0, setsA: 0, setsB: 0 },
    );
  }

  const scoreA = Number(match.scoreA || 0);
  const scoreB = Number(match.scoreB || 0);
  const looksLikeAggregateSets = scoreA <= 3 && scoreB <= 3 && scoreA + scoreB <= 3;

  if (looksLikeAggregateSets) {
    return { pointsA: scoreA, pointsB: scoreB, setsA: scoreA, setsB: scoreB };
  }

  return {
    pointsA: scoreA,
    pointsB: scoreB,
    setsA: match.winnerId === match.teamAId ? 1 : 0,
    setsB: match.winnerId === match.teamBId ? 1 : 0,
  };
}

/**
 * Tính toán bảng xếp hạng cho mỗi bảng đấu dựa trên kết quả trận đấu.
 * Áp dụng Quy tắc sắp xếp theo yêu cầu của BTC:
 * Điểm số > Hiệu số séc > Hiệu số điểm > Đối đầu trực tiếp.
 */
export function calculateGroupStandings(
  groupId: string,
  teamIds: string[],
  groupMatches: Match[],
  teamsMap: Record<string, Team>,
  settings: TournamentSettings
): GroupStanding[] {
  const standings: Record<string, GroupStanding> = {};
  const winPoint = Number.isFinite(Number(settings?.winPoint)) ? Number(settings.winPoint) : 2;
  const lossPoint = Number.isFinite(Number(settings?.lossPoint)) ? Number(settings.lossPoint) : 1;

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
      setDiff: 0,
      pointsWon: 0,
      pointsLost: 0,
      pointDiff: 0,
      rank: 0,
    };
  });

  // Điền thông số từ các trận đấu đã kết thúc
  groupMatches.forEach((m) => {
    if (m.status !== 'finished' || m.scoreA === null || m.scoreB === null) return;
    const { teamAId, teamBId, winnerId } = m;

    if (!teamAId || !teamBId || !standings[teamAId] || !standings[teamBId]) return;

    const breakdown = getMatchScoreBreakdown(m);

    // Cập nhật đội A
    standings[teamAId].matchesPlayed += 1;
    standings[teamAId].pointsWon += breakdown.pointsA;
    standings[teamAId].pointsLost += breakdown.pointsB;
    standings[teamAId].setsWon += breakdown.setsA;
    standings[teamAId].setsLost += breakdown.setsB;

    // Cập nhật đội B
    standings[teamBId].matchesPlayed += 1;
    standings[teamBId].pointsWon += breakdown.pointsB;
    standings[teamBId].pointsLost += breakdown.pointsA;
    standings[teamBId].setsWon += breakdown.setsB;
    standings[teamBId].setsLost += breakdown.setsA;

    if (winnerId === teamAId) {
      standings[teamAId].matchesWon += 1;
      standings[teamAId].points += winPoint;

      standings[teamBId].matchesLost += 1;
      standings[teamBId].points += lossPoint;
    } else if (winnerId === teamBId) {
      standings[teamBId].matchesWon += 1;
      standings[teamBId].points += winPoint;

      standings[teamAId].matchesLost += 1;
      standings[teamAId].points += lossPoint;
    }
  });

  // Tính hiệu số
  const resultList = Object.values(standings).map((st) => {
    st.setDiff = st.setsWon - st.setsLost;
    st.pointDiff = st.pointsWon - st.pointsLost;
    return st;
  });

  // Thuật toán sắp xếp theo yêu cầu: Điểm > Hiệu số séc > Hiệu số điểm > Đối đầu
  resultList.sort((a, b) => {
    // 1. So sánh Điểm (Points)
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    // 2. So sánh Hiệu số séc thắng/thua
    if (b.setDiff !== a.setDiff) {
      return b.setDiff - a.setDiff;
    }

    // 3. So sánh Hiệu số điểm ghi được/bị ghi (Point Diff)
    if (b.pointDiff !== a.pointDiff) {
      return b.pointDiff - a.pointDiff;
    }

    // 4. So sánh Đối đầu trực tiếp (Head-to-head)
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

    // 5. So sánh Tổng điểm ghi được (Points Won)
    if (b.pointsWon !== a.pointsWon) {
      return b.pointsWon - a.pointsWon;
    }

    // 6. Nếu bằng nhau hoàn toàn, ưu tiên Đội có hạt giống cao hơn hoặc ngẫu nhiên
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
  const winPoint = Number.isFinite(Number(settings?.winPoint)) ? Number(settings.winPoint) : 2;
  const lossPoint = Number.isFinite(Number(settings?.lossPoint)) ? Number(settings.lossPoint) : 1;

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
    let adjustedSetsWon = thirdTeamStanding.setsWon;
    let adjustedSetsLost = thirdTeamStanding.setsLost;
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
          const breakdown = getMatchScoreBreakdown(penaltyMatch);
          const scoreUs = isHome ? breakdown.pointsA : breakdown.pointsB;
          const scoreThem = isHome ? breakdown.pointsB : breakdown.pointsA;
          const setsUs = isHome ? breakdown.setsA : breakdown.setsB;
          const setsThem = isHome ? breakdown.setsB : breakdown.setsA;

          adjustedPointsWon -= scoreUs;
          adjustedPointsLost -= scoreThem;
          adjustedSetsWon -= setsUs;
          adjustedSetsLost -= setsThem;

          if (penaltyMatch.winnerId === tId) {
            adjustedMatchesWon -= 1;
            adjustedPoints -= winPoint;
          } else {
            adjustedMatchesLost -= 1;
            adjustedPoints -= lossPoint;
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
      setsWon: adjustedSetsWon,
      setsLost: adjustedSetsLost,
      setDiff: adjustedSetsWon - adjustedSetsLost,
      pointsWon: adjustedPointsWon,
      pointsLost: adjustedPointsLost,
      pointDiff: adjustedPointsWon - adjustedPointsLost,
      rank: 0,
      originalRanking: standings,
      isUefaAdjusted,
    });
  });

  // So sánh các đội hạng 3 theo thứ tự: Điểm -> Hiệu số séc -> Hiệu số điểm -> Điểm ghi
  thirdPlaceCandidates.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.setDiff !== a.setDiff) return b.setDiff - a.setDiff;
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
      placeholderA: advancingTeams[0] ? advancingTeams[0].placeholder : 'Hạng 1 Bảng A',
      placeholderB: advancingTeams[1] ? advancingTeams[1].placeholder : 'Hạng 2 Bảng B',
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
      placeholderA: advancingTeams[2] ? advancingTeams[2].placeholder : 'Hạng 1 Bảng B',
      placeholderB: advancingTeams[3] ? advancingTeams[3].placeholder : 'Hạng 2 Bảng A',
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
 * Thiết lập bộ chuyển đổi (Adapter) chuẩn hóa phím Slot (Slot Key).
 * Đảm bảo tương thích ngược 100% với dữ liệu thô cũ đồng thời nâng cấp kiến trúc hiển thị.
 */
export function normalizeSlotKey(slotKey: string | null | undefined, groups?: Record<string, any>): string {
  if (!slotKey) return '';
  let clean = slotKey.trim().replace(/__e$/, '').replace(/__event-[a-z0-9-]+$/i, '');
  
  if (clean.startsWith('__1st_')) {
    const gid = clean.replace('__1st_', '').replace(/__$/, '');
    const letter = parseGroupLetterForNormalize(gid, groups);
    return `1ST_${letter}`;
  }
  if (clean.startsWith('__2nd_')) {
    const gid = clean.replace('__2nd_', '').replace(/__$/, '');
    const letter = parseGroupLetterForNormalize(gid, groups);
    return `2ND_${letter}`;
  }
  if (clean.startsWith('__3rd_')) {
    const gid = clean.replace('__3rd_', '').replace(/__$/, '');
    const numOnly = gid.match(/^\d+$/);
    if (numOnly) {
      return `BEST_3RD_${numOnly[0]}`;
    }
    const letter = parseGroupLetterForNormalize(gid, groups);
    return `BEST_3RD_${letter}`;
  }
  
  const upper = clean.toUpperCase();
  if (upper.startsWith('1ST_') || upper.startsWith('2ND_') || upper.startsWith('BEST_3RD_')) {
    return upper;
  }
  
  return clean;
}

/**
 * Trích xuất an toàn tên chữ cái của Bảng đấu ứng dụng cho việc chuẩn hóa.
 */
function parseGroupLetterForNormalize(gid: string, groups?: Record<string, any>): string {
  if (groups && groups[gid]) {
    const name = groups[gid].name || '';
    const m = name.match(/Bảng\s+([a-zA-Z0-9]+)/i) || name.match(/Group\s+([a-zA-Z0-9]+)/i);
    if (m) return m[1].toUpperCase();
    return name.replace(/^Bảng\s+/i, '').replace(/^Group\s+/i, '').trim().toUpperCase();
  }
  if (groups) {
    const found = Object.values(groups).find(
      (g: any) => g.id === gid || g.id === gid.replace(/__e$/, '') || g.id.startsWith(gid + '-') || gid.startsWith(g.id + '-') || g.id.split('__')[0] === gid.split('__')[0]
    );
    if (found) {
      const name = found.name || '';
      const m = name.match(/Bảng\s+([a-zA-Z0-9]+)/i) || name.match(/Group\s+([a-zA-Z0-9]+)/i);
      if (m) return m[1].toUpperCase();
      return name.replace(/^Bảng\s+/i, '').replace(/^Group\s+/i, '').trim().toUpperCase();
    }
  }
  return parseGroupLetter(gid);
}

/**
 * Ánh xạ chữ cái Group từ chuẩn hóa về GroupID thực tuyển trong event.
 */
function findGroupIdByLetter(letter: string, groups: Record<string, any>): string | null {
  for (const g of Object.values(groups)) {
    const name = g.name || '';
    const m = name.match(/Bảng\s+([a-zA-Z0-9]+)/i) || name.match(/Group\s+([a-zA-Z0-9]+)/i);
    if (m && m[1].toUpperCase() === letter.toUpperCase()) {
      return g.id;
    }
    if (name.replace(/^Bảng\s+/i, '').replace(/^Group\s+/i, '').trim().toUpperCase() === letter.toUpperCase()) {
      return g.id;
    }
  }
  for (const g of Object.values(groups)) {
    if (g.id.toUpperCase().endsWith(`-${letter.toUpperCase()}`) || g.id.toUpperCase() === letter.toUpperCase()) {
      return g.id;
    }
  }
  return null;
}

/**
 * Trả về tên suất thi đấu định dạng đẹp mắt dành riêng cho Sơ đồ nhánh.
 * LUÔN LUÔN hiển thị nhãn suất đấu (ví dụ "Hạng 1 bảng A", "Hạng 3 xuất sắc 1")
 * theo yêu cầu nghiêm ngặt của BTC, kể cả khi các đội thật đã được xác định.
 */
export function getBracketDisplayName(slotKey: string | null | undefined, groups?: Record<string, any>): string {
  if (!slotKey || slotKey === 'null' || slotKey === 'undefined' || slotKey === '') {
    return 'Chờ phân nhánh';
  }

  const normalized = normalizeSlotKey(slotKey, groups);
  if (!normalized) return 'Chờ phân nhánh';

  if (normalized.startsWith('1ST_')) {
    const letter = normalized.replace('1ST_', '');
    return `Hạng 1 bảng ${letter}`;
  }
  if (normalized.startsWith('2ND_')) {
    const letter = normalized.replace('2ND_', '');
    return `Hạng 2 bảng ${letter}`;
  }
  if (normalized.startsWith('BEST_3RD_')) {
    const rank = normalized.replace('BEST_3RD_', '');
    return `Hạng 3 xuất sắc ${rank}`;
  }

  const upper = normalized.toUpperCase();

  const legacyFirst = normalized.match(/^nhất\s+(?:bảng\s+)?(.+)$/i);
  if (legacyFirst) return `Hạng 1 bảng ${legacyFirst[1].trim()}`;

  const legacySecond = normalized.match(/^nhì\s+(?:bảng\s+)?(.+)$/i);
  if (legacySecond) return `Hạng 2 bảng ${legacySecond[1].trim()}`;

  const legacyThird = normalized.match(/^(?:ba\s+(?:bảng\s+)?xuất\s+sắc|ba\s+xs|hạng\s+ba\s+xuất\s+sắc)\s*(\d*)$/i);
  if (legacyThird) return `Hạng 3 xuất sắc ${legacyThird[1] || ''}`.trim();

  // Compact knockout source labels for TV/bracket cards.
  if (upper === 'W-QF1' || upper === 'W_QF1' || upper === 'THẮNG TỨ KẾT 1') return 'W TK 1';
  if (upper === 'W-QF2' || upper === 'W_QF2' || upper === 'THẮNG TỨ KẾT 2') return 'W TK 2';
  if (upper === 'W-QF3' || upper === 'W_QF3' || upper === 'THẮNG TỨ KẾT 3') return 'W TK 3';
  if (upper === 'W-QF4' || upper === 'W_QF4' || upper === 'THẮNG TỨ KẾT 4') return 'W TK 4';

  if (upper === 'W-SF1' || upper === 'W_SF1' || upper === 'THẮNG BÁN KẾT 1') return 'W BK 1';
  if (upper === 'W-SF2' || upper === 'W_SF2' || upper === 'THẮNG BÁN KẾT 2') return 'W BK 2';

  if (upper === 'L-SF1' || upper === 'L_SF1' || upper === 'THUA BÁN KẾT 1') return 'L BK 1';
  if (upper === 'L-SF2' || upper === 'L_SF2' || upper === 'THUA BÁN KẾT 2') return 'L BK 2';

  const qfWinnerMatch = upper.match(/THẮNG TỨ KẾT (\d+)/) || upper.match(/W-QF(\d+)/) || upper.match(/W_QF(\d+)/);
  if (qfWinnerMatch) {
    return `W TK ${qfWinnerMatch[1]}`;
  }

  const sfWinnerMatch = upper.match(/THẮNG BÁN KẾT (\d+)/) || upper.match(/W-SF(\d+)/) || upper.match(/W_SF(\d+)/);
  if (sfWinnerMatch) {
    return `W BK ${sfWinnerMatch[1]}`;
  }

  const sfLoserMatch = upper.match(/THUA BÁN KẾT (\d+)/) || upper.match(/L-SF(\d+)/) || upper.match(/L_SF(\d+)/);
  if (sfLoserMatch) {
    return `L BK ${sfLoserMatch[1]}`;
  }

  const r16WinnerMatch = upper.match(/THẮNG VÒNG 16 \(TRẬN (\d+)\)/) || upper.match(/THANG VONG 16 \(TRAN (\d+)\)/) || normalized.match(/Thắng Vòng 1\/8 \(Trận (\d+)\)/i) || normalized.match(/Thắng Vòng 16 \(Trận (\d+)\)/i) || upper.match(/W16 \(TRẬN (\d+)\)/);
  if (r16WinnerMatch) {
    return `W ${r16WinnerMatch[1]}`;
  }

  const r32WinnerMatch = upper.match(/THẮNG VÒNG 32 \(TRẬN (\d+)\)/) || upper.match(/THANG VONG 32 \(TRAN (\d+)\)/) || normalized.match(/Thắng Vòng 32 \(Trận (\d+)\)/i) || upper.match(/W32 \(TRẬN (\d+)\)/);
  if (r32WinnerMatch) {
    return `W ${r32WinnerMatch[1]}`;
  }

  return normalized;
}

/**
 * Helper trích xuất chữ cái tên bảng hoặc tự phát sinh từ thứ tự
 */
function parseGroupLetter(gid: string): string {
  const mLetter = gid.match(/group-\d+-([a-zA-Z0-9]+)/i);
  if (mLetter) return mLetter[1].toUpperCase();

  const mLetter2 = gid.match(/group-([a-zA-Z0-9]+)/i);
  if (mLetter2) return mLetter2[1].toUpperCase();

  const mNum = gid.match(/group-(\d+)/i) || gid.match(/-(\d+)/) || gid.match(/group(\d+)/i);
  if (mNum) {
    const idx = parseInt(mNum[1], 10);
    if (idx >= 1 && idx <= 26) {
      return String.fromCharCode(64 + idx);
    }
  }
  return gid.split('__')[0].replace('group-', '').toUpperCase();
}

/**
 * Trả về tên phân giải đẹp mắt cho Lịch Thi Đấu (ưu tiên đội thực tế, nếu chưa có thì hiển thị suất đấu).
 */
export function getMatchDisplayName(
  teamIdOrSlot: string | null | undefined,
  placeholder: string | null | undefined,
  teams: Record<string, any>,
  groups: Record<string, any>,
  matches: any[],
  settings: any
): string {
  // 1. Trả về tên thực nếu ID chính là một ID đội hợp lệ trong object teams
  if (teamIdOrSlot && teams[teamIdOrSlot]) {
    return teams[teamIdOrSlot].name;
  }

  // 2. Kiểm tra chuỗi thô để tránh hiển thị null/undefined hoặc các placeholder kỹ thuật khác 
  const keyToCheck = teamIdOrSlot || placeholder || '';
  if (!keyToCheck || keyToCheck === 'null' || keyToCheck === 'undefined') {
    return 'Chưa xác định';
  }
  if (/^team-[a-z0-9-]+$/i.test(keyToCheck.trim())) {
    return 'Đội đã xóa hoặc không còn hoạt động';
  }

  // 3. Nếu ID khớp trực tiếp với tên của một đội trong hệ thống (phòng khi được gán trực tiếp bằng chuỗi tên)
  const matchedRealTeam = Object.values(teams).find(
    (t) => t.name.trim().toLowerCase() === keyToCheck.trim().toLowerCase() || t.id === keyToCheck
  );
  if (matchedRealTeam) {
    return matchedRealTeam.name;
  }

  // 4. Nếu là slot đấu bảng hoặc slot hạng 3 xuất sắc hoặc mã trận trước đó
  const resolvedRealTeam = resolveSlotToRealTeam(keyToCheck, teams, groups, matches, settings);
  if (resolvedRealTeam) {
    return resolvedRealTeam;
  }

  // 5. Nếu không phân giải được đội thực, hiển thị nhãn suất đấu dạng rút gọn đẹp mắt (VD "Hạng 1 bảng A")
  return getBracketDisplayName(keyToCheck, groups);
}

/**
 * Phân giải slot key hoặc nhãn suất đấu thành tên đại diện đội thực tế nếu vòng bảng/vòng trước đã có kết quả
 */
function resolveSlotToRealTeam(
  slotText: string,
  teams: Record<string, any>,
  groups: Record<string, any>,
  matches: any[],
  settings: any
): string | null {
  const normalized = normalizeSlotKey(slotText, groups);
  if (!normalized) return null;

  if (normalized.startsWith('1ST_') || normalized.startsWith('2ND_') || normalized.startsWith('BEST_3RD_')) {
    const isFirst = normalized.startsWith('1ST_');
    const isSecond = normalized.startsWith('2ND_');
    const isThird = normalized.startsWith('BEST_3RD_');
    
    if (isThird) {
      const rankStr = normalized.replace('BEST_3RD_', '');
      const rank = parseInt(rankStr, 10);
      
      const groupMatchesAll = matches.filter((m) => m.groupId !== 'knockout');
      const allGroupsFinished = groupMatchesAll.length > 0 && groupMatchesAll.every((m) => m.status === 'finished');
      
      if (allGroupsFinished) {
        const standingsByGroup: Record<string, any[]> = {};
        Object.keys(groups).forEach((gId) => {
          const g = groups[gId];
          const gMatches = matches.filter((m) => m.groupId === gId);
          standingsByGroup[gId] = calculateGroupStandings(gId, g.teamIds, gMatches, teams, settings);
        });
        const groupNamesMap: Record<string, string> = {};
        Object.keys(groups).forEach((gId) => {
          groupNamesMap[gId] = groups[gId].name;
        });
        const bestThirds = calculateBestThirdPlaces(standingsByGroup, matches, settings, groupNamesMap);
        if (bestThirds[rank - 1]) {
          return teams[bestThirds[rank - 1].teamId]?.name || bestThirds[rank - 1].teamName;
        }
      }
    } else {
      const letter = normalized.replace('1ST_', '').replace('2ND_', '');
      const groupId = findGroupIdByLetter(letter, groups);
      if (groupId) {
        const group = groups[groupId];
        if (group) {
          const groupMatches = matches.filter((m) => m.groupId === group.id);
          const isFinished = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'finished');
          if (isFinished) {
            const standings = calculateGroupStandings(group.id, group.teamIds, groupMatches, teams, settings);
            if (isFirst && standings[0]) {
              return teams[standings[0].teamId]?.name || standings[0].teamName;
            }
            if (isSecond && standings[1]) {
              return teams[standings[1].teamId]?.name || standings[1].teamName;
            }
          }
        }
      }
    }
  }

  // Tự động phân giải các trận loại trực tiếp trước: VD W-SF1, SF-1, SF1
  const matchCode = normalized.toUpperCase().replace('-', '').replace('_', '');
  const prevMatchNode = matches.find(
    (m) =>
      m.groupId === 'knockout' &&
      m.knockoutMatchId &&
      m.knockoutMatchId.toUpperCase().replace('-', '').replace('_', '') === matchCode
  );
  if (prevMatchNode && prevMatchNode.status === 'finished' && prevMatchNode.winnerId) {
    return teams[prevMatchNode.winnerId]?.name || prevMatchNode.winnerId;
  }

  // Hoặc fallback kiểm định nếu clean khớp với nhãn tiếng Việt thô (VD "Hạng 1 bảng A")
  const clean = normalized.toLowerCase();
  for (const g of Object.values(groups)) {
    const gNameClean = g.name.replace(/^Bảng\s+/i, '').trim().toLowerCase();
    const isFirstLabel =
      clean === `hạng 1 bảng ${gNameClean}` ||
      clean === `hạng 1 ${gNameClean}` ||
      clean === `nhất bảng ${gNameClean}` ||
      clean === `nhất ${gNameClean}`;
    const isSecondLabel =
      clean === `hạng 2 bảng ${gNameClean}` ||
      clean === `hạng 2 ${gNameClean}` ||
      clean === `nhì bảng ${gNameClean}` ||
      clean === `nhì ${gNameClean}`;

    if (isFirstLabel || isSecondLabel) {
      const gMatches = matches.filter((m) => m.groupId === g.id);
      const isFinished = gMatches.length > 0 && gMatches.every((m) => m.status === 'finished');
      if (isFinished) {
        const standings = calculateGroupStandings(g.id, g.teamIds, gMatches, teams, settings);
        if (isFirstLabel && standings[0]) {
          return teams[standings[0].teamId]?.name || standings[0].teamName;
        }
        if (isSecondLabel && standings[1]) {
          return teams[standings[1].teamId]?.name || standings[1].teamName;
        }
      }
    }
  }

  return null;
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
      return `Hạng 1 ${groups[gid].name}`;
    }
    if (groups) {
      const found = Object.values(groups).find(
        (g: any) => g.id === gid || g.id === gid.replace(/__e$/, '') || g.id.startsWith(gid + '-') || gid.startsWith(g.id + '-')
      );
      if (found) return `Hạng 1 ${found.name}`;
    }
    // Parse dự phòng số thứ tự group
    const numMatch = gid.match(/group-(\d+)/i) || gid.match(/-(\d+)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      const letter = String.fromCharCode(64 + idx);
      return `Hạng 1 Bảng ${letter}`;
    }
    return `Hạng 1 ${gid.replace('group-', 'Bảng ').toUpperCase()}`;
  }

  if (clean.startsWith('__2nd_')) {
    const gid = clean.replace('__2nd_', '').replace(/__$/, '');
    if (groups && groups[gid]) {
      return `Hạng 2 ${groups[gid].name}`;
    }
    if (groups) {
      const found = Object.values(groups).find(
        (g: any) => g.id === gid || g.id === gid.replace(/__e$/, '') || g.id.startsWith(gid + '-') || gid.startsWith(g.id + '-')
      );
      if (found) return `Hạng 2 ${found.name}`;
    }
    const numMatch = gid.match(/group-(\d+)/i) || gid.match(/-(\d+)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      const letter = String.fromCharCode(64 + idx);
      return `Hạng 2 Bảng ${letter}`;
    }
    return `Hạng 2 ${gid.replace('group-', 'Bảng ').toUpperCase()}`;
  }

  if (clean.startsWith('__3rd_')) {
    const gid = clean.replace('__3rd_', '').replace(/__$/, '');
    if (groups && groups[gid]) {
      return `Hạng 3 ${groups[gid].name}`;
    }
    if (groups) {
      const found = Object.values(groups).find(
        (g: any) => g.id === gid || g.id === gid.replace(/__e$/, '') || g.id.startsWith(gid + '-') || gid.startsWith(g.id + '-')
      );
      if (found) return `Hạng 3 ${found.name}`;
    }
    const numMatch = gid.match(/group-(\d+)/i) || gid.match(/-(\d+)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10);
      const letter = String.fromCharCode(64 + idx);
      return `Hạng 3 Bảng ${letter}`;
    }
    return `Hạng 3 xuất sắc ${gid}`;
  }

  const nameUpper = clean.toUpperCase().trim();

  // Handle QF winners / losers
  if (nameUpper === 'W-QF1' || nameUpper === 'W_QF1') return 'W TK 1';
  if (nameUpper === 'W-QF2' || nameUpper === 'W_QF2') return 'W TK 2';
  if (nameUpper === 'W-QF3' || nameUpper === 'W_QF3') return 'W TK 3';
  if (nameUpper === 'W-QF4' || nameUpper === 'W_QF4') return 'W TK 4';

  if (nameUpper === 'L-SF1' || nameUpper === 'L_SF1') return 'L BK 1';
  if (nameUpper === 'L-SF2' || nameUpper === 'L_SF2') return 'L BK 2';
  
  if (nameUpper === 'W-SF1' || nameUpper === 'W_SF1') return 'W BK 1';
  if (nameUpper === 'W-SF2' || nameUpper === 'W_SF2') return 'W BK 2';

  if (nameUpper === 'THẮNG BÁN KẾT 1' || nameUpper === 'THANG BAN KET 1') return 'W BK 1';
  if (nameUpper === 'THẮNG BÁN KẾT 2' || nameUpper === 'THANG BAN KET 2') return 'W BK 2';
  if (nameUpper === 'THUA BÁN KẾT 1' || nameUpper === 'THUA BAN KET 1') return 'L BK 1';
  if (nameUpper === 'THUA BÁN KẾT 2' || nameUpper === 'THUA BAN KET 2') return 'L BK 2';

  if (nameUpper === 'THẮNG TỨ KẾT 1' || nameUpper === 'THANG TU KET 1') return 'W TK 1';
  if (nameUpper === 'THẮNG TỨ KẾT 2' || nameUpper === 'THANG TU KET 2') return 'W TK 2';
  if (nameUpper === 'THẮNG TỨ KẾT 3' || nameUpper === 'THANG TU KET 3') return 'W TK 3';
  if (nameUpper === 'THẮNG TỨ KẾT 4' || nameUpper === 'THANG TU KET 4') return 'W TK 4';

  const r16WinnerMatch = nameUpper.match(/THẮNG VÒNG 16 \(TRẬN (\d+)\)/) || nameUpper.match(/THANG VONG 16 \(TRAN (\d+)\)/) || clean.match(/Thắng Vòng 1\/8 \(Trận (\d+)\)/i) || clean.match(/Thắng Vòng 16 \(Trận (\d+)\)/i);
  if (r16WinnerMatch) {
    const num = r16WinnerMatch[1];
    return `W ${num}`;
  }

  const r32WinnerMatch = nameUpper.match(/THẮNG VÒNG 32 \(TRẬN (\d+)\)/) || nameUpper.match(/THANG VONG 32 \(TRAN (\d+)\)/) || clean.match(/Thắng Vòng 32 \(Trận (\d+)\)/i);
  if (r32WinnerMatch) {
    const num = r32WinnerMatch[1];
    return `W ${num}`;
  }

  const qfWinnerMatch = nameUpper.match(/THẮNG TỨ KẾT (\d+)/) || nameUpper.match(/THANG TU KET (\d+)/) || clean.match(/Thắng Tứ Kết (\d+)/i) || nameUpper.match(/W-QF(\d+)/) || nameUpper.match(/W_QF(\d+)/);
  if (qfWinnerMatch) {
     const num = qfWinnerMatch[1];
     return `W TK ${num}`;
  }

  const sfWinnerMatch = nameUpper.match(/THẮNG BÁN KẾT (\d+)/) || nameUpper.match(/THANG BAN KET (\d+)/) || clean.match(/Thắng Bán Kết (\d+)/i) || nameUpper.match(/W-SF(\d+)/) || nameUpper.match(/W_SF(\d+)/);
  if (sfWinnerMatch) {
     const num = sfWinnerMatch[1];
     return `W BK ${num}`;
  }

  const sfLoserMatch = nameUpper.match(/THUA BÁN KẾT (\d+)/) || nameUpper.match(/THUA BAN KET (\d+)/) || clean.match(/Thua Bán Kết (\d+)/i) || nameUpper.match(/L-SF(\d+)/) || nameUpper.match(/L_SF(\d+)/);
  if (sfLoserMatch) {
     const num = sfLoserMatch[1];
     return `L BK ${num}`;
  }

  // Handle placeholders like Hạng 1 Bảng A, Hạng 2 Bảng B and legacy rank labels.
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

