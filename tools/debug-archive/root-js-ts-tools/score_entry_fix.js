import fs from 'fs';
let content = fs.readFileSync('src/components/ScoreEntry.tsx', 'utf8');

// Fix teamA and teamB display to support placeholderA/B
content = content.replace(/const teamA = currentEvt\.teams\[m\.teamAId\]\?\.name \|\| getReadableTeamName\(m\.teamAId\);/g, "const teamA = m.teamAId && currentEvt.teams[m.teamAId] ? currentEvt.teams[m.teamAId].name : (m.placeholderA || getReadableTeamName(m.teamAId));");
content = content.replace(/const teamB = currentEvt\.teams\[m\.teamBId\]\?\.name \|\| getReadableTeamName\(m\.teamBId\);/g, "const teamB = m.teamBId && currentEvt.teams[m.teamBId] ? currentEvt.teams[m.teamBId].name : (m.placeholderB || getReadableTeamName(m.teamBId));");

// Disable button if teams are missing
content = content.replace(
    /onClick=\{\(\) => handleSetPlaying\(m\.id\)\}\s*disabled=\{!isPermitted\}\s*className=\{`text-\[9px\]/g,
    `onClick={() => handleSetPlaying(m.id)}
                            disabled={!isPermitted || !m.teamAId || !m.teamBId}
                            className={\`text-[9px]`
);

content = content.replace(
    /\{\!isPermitted \? 'text-zinc-400 bg-zinc-100/g,
    `{(!isPermitted || !m.teamAId || !m.teamBId) ? 'text-zinc-400 bg-zinc-100`
);

// Under playing matches block: Fix team names and placeholders
content = content.replace(/const teamA = currentEvt\.teams\[m\.teamAId\]\?\.name \|\| getReadableTeamName\(m\.teamAId\);/g, "const teamA = m.teamAId && currentEvt.teams[m.teamAId] ? currentEvt.teams[m.teamAId].name : (m.placeholderA || getReadableTeamName(m.teamAId));");
content = content.replace(/const teamB = currentEvt\.teams\[m\.teamBId\]\?\.name \|\| getReadableTeamName\(m\.teamBId\);/g, "const teamB = m.teamBId && currentEvt.teams[m.teamBId] ? currentEvt.teams[m.teamBId].name : (m.placeholderB || getReadableTeamName(m.teamBId));");

fs.writeFileSync('src/components/ScoreEntry.tsx', content);
