import fs from 'fs';
let content = fs.readFileSync('src/components/ScoreEntry.tsx', 'utf8');

// Move early return down.
content = content.replace(/  if \(eventList\.length === 0\) \{\n    return <div className="text-center py-20 text-zinc-500 font-bold bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800">Chưa có nội dung thi đấu nào\. Vui lòng tạo nội dung trước\.<\/div>;\n  \}\n\n  \/\/ Safe checks for currentEventId\n  const currentEvt = currentEventId && events\[currentEventId\] \? events\[currentEventId\] : eventList\[0\];\n  \n  const isPermitted = React\.useMemo\(\(\) => \{\n    if \(userRole !== 'admin3'\) return true;\n    const admin3Acc = accounts\.find\(a => a\.username === currentUser\);\n    return admin3Acc\?\.permittedEventIds\?\.includes\(currentEvt\.id\) \|\| false;\n  \}, \[userRole, accounts, currentUser, currentEvt\.id\]\);/g, `  // Safe checks for currentEventId
  const currentEvt = currentEventId && events[currentEventId] ? events[currentEventId] : eventList[0];
  
  const isPermitted = React.useMemo(() => {
    if (userRole !== 'admin3') return true;
    if (!currentEvt) return false;
    const admin3Acc = accounts.find(a => a.username === currentUser);
    return admin3Acc?.permittedEventIds?.includes(currentEvt.id) || false;
  }, [userRole, accounts, currentUser, currentEvt?.id]);

  if (eventList.length === 0) {
    return <div className="text-center py-20 text-zinc-500 font-bold bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800">Chưa có nội dung thi đấu nào. Vui lòng tạo nội dung trước.</div>;
  }`);

fs.writeFileSync('src/components/ScoreEntry.tsx', content);
