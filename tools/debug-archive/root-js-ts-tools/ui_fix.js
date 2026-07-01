import fs from 'fs';
let content = fs.readFileSync('src/components/KnockoutBracket.tsx', 'utf8');

content = content.replace(/\{m\.teamAId \? teams\[m\.teamAId\]\?\.name : \(m\.placeholderA \|\| 'Thả đội vào đây'\)\}/g, "{m.teamAId ? (teams[m.teamAId]?.name || m.placeholderA || m.teamAId) : (m.placeholderA || 'Thả đội vào đây')}");
content = content.replace(/\{m\.teamBId \? teams\[m\.teamBId\]\?\.name : \(m\.placeholderB \|\| 'Thả đội vào đây'\)\}/g, "{m.teamBId ? (teams[m.teamBId]?.name || m.placeholderB || m.teamBId) : (m.placeholderB || 'Thả đội vào đây')}");

content = content.replace(/\(m\.teamAId \? teams\[m\.teamAId\]\?\.name : \(m\.placeholderA \|\| 'Chờ\.\.\.'\)\)/g, "(m.teamAId ? (teams[m.teamAId]?.name || m.placeholderA || m.teamAId) : (m.placeholderA || 'Chờ...'))");
content = content.replace(/\(m\.teamBId \? teams\[m\.teamBId\]\?\.name : \(m\.placeholderB \|\| 'Chờ\.\.\.'\)\)/g, "(m.teamBId ? (teams[m.teamBId]?.name || m.placeholderB || m.teamBId) : (m.placeholderB || 'Chờ...'))");

fs.writeFileSync('src/components/KnockoutBracket.tsx', content);
