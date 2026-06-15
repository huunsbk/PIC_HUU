import fs from 'fs';
let content = fs.readFileSync('src/components/KnockoutBracket.tsx', 'utf8');

content = content.replace(/\{m\.teamAId \? resolveSlotName\(m\.teamAId\) : 'Thả đội vào đây'\}/g, "{m.teamAId ? teams[m.teamAId]?.name : (m.placeholderA || 'Thả đội vào đây')}");
content = content.replace(/\{m\.teamBId \? resolveSlotName\(m\.teamBId\) : 'Thả đội vào đây'\}/g, "{m.teamBId ? teams[m.teamBId]?.name : (m.placeholderB || 'Thả đội vào đây')}");

content = content.replace(/resolveSlotName\(m\.teamAId\)/g, "(m.teamAId ? teams[m.teamAId]?.name : (m.placeholderA || 'Chờ...'))");
content = content.replace(/resolveSlotName\(m\.teamBId\)/g, "(m.teamBId ? teams[m.teamBId]?.name : (m.placeholderB || 'Chờ...'))");

// Also update the select options
content = content.replace(/value=\{t\.name\}/g, "value={t.id}");
content = content.replace(/\!teamNames\.includes\(m\.teamAId\)/g, "!m.teamAId");
content = content.replace(/\!teamNames\.includes\(m\.teamBId\)/g, "!m.teamBId");

// And replace `m.teamAId === t.name` with `m.teamAId === t.id`
content = content.replace(/m\.teamAId === t\.name/g, "m.teamAId === t.id");
content = content.replace(/m\.teamBId === t\.name/g, "m.teamBId === t.id");

fs.writeFileSync('src/components/KnockoutBracket.tsx', content);
