import fs from 'fs';
const text = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');
fs.writeFileSync('src/components/Dashboard.tsx', text.replace(/activeTenantId/g, 'currentTenantId'));
