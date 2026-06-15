import * as fs from 'fs';
import * as path from 'path';

const outputFile = 'tong_hop_code_pickleball.txt';
fs.writeFileSync(outputFile, '');

function appendFile(filePath: string) {
    if (fs.existsSync(filePath)) {
        console.log(`Appending ${filePath}...`);
        let ext = path.extname(filePath).slice(1);
        if (ext === '') ext = 'json';
        const content = fs.readFileSync(filePath, 'utf-8');
        const header = `==================================================\n📁 FILE: ${filePath}\n==================================================\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
        fs.appendFileSync(outputFile, header);
    }
}

appendFile('package.json');
appendFile('vite.config.ts');
appendFile('tailwind.config.js');
appendFile('tailwind.config.ts');
appendFile('eslint.config.js');

function walkDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walkDir(fullPath);
        } else {
            if (fullPath.match(/\.(ts|tsx|js|jsx|css)$/)) {
                appendFile(fullPath);
            }
        }
    }
}

if (fs.existsSync('src')) {
    walkDir('src');
}

console.log('Successfully generated ' + outputFile);
