import fs from 'fs';
const files = ['src/store.ts', 'src/components/Dashboard.tsx'];
for (const f of files) {
   if (fs.existsSync(f)) {
       let text = fs.readFileSync(f, 'utf8');
       text = text.replace(/tenant_id\s*:\s*[a-zA-Z0-9_\.]+\s*,?/g, '');
       fs.writeFileSync(f, text);
       console.log("Stripped from", f);
   }
}
