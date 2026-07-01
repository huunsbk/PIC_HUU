import fs from 'fs';
let content = fs.readFileSync('src/utils/tournamentEngine.ts', 'utf8');

content = content.replace(/teamAId: ('[^']+'|`[^`]+`)/g, 'teamAId: null, placeholderA: $1');
content = content.replace(/teamBId: ('[^']+'|`[^`]+`)/g, 'teamBId: null, placeholderB: $1');

// Now, handle the advancingTeams mapping (which was a variable, e.g. advancingTeams[0] ? advancingTeams[0].placeholder : 'Nhất Bảng A')
content = content.replace(/teamAId: ([^,]+advancingTeams[^,]+),/g, 'teamAId: null, placeholderA: $1,');
content = content.replace(/teamBId: ([^,]+advancingTeams[^,]+),/g, 'teamBId: null, placeholderB: $1,');

// Wait! advancingTeams[i * 2 + 1] ? advancingTeams[i * 2 + 1].placeholder : `Đội hạng ${i * 2 + 2}`
content = content.replace(/teamAId: (tA|tB),/g, 'teamAId: null, placeholderA: $1,');
content = content.replace(/teamBId: (tA|tB),/g, 'teamBId: null, placeholderB: $1,');

fs.writeFileSync('src/utils/tournamentEngine.ts', content);
