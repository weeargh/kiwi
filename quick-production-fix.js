// Quick production fix for trust proxy issue
// This should be added to src/app.js after line 28 (after const app = express();)

const fs = require('fs');
const path = require('path');

console.log('Applying quick production fix for trust proxy...');

const appJsPath = path.join(__dirname, 'src', 'app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

// Check if trust proxy is already set
if (appJsContent.includes('app.set(\'trust proxy\', true)')) {
  console.log('✅ Trust proxy is already configured');
  process.exit(0);
}

// Find the line after 'const app = express();' and add trust proxy
const lines = appJsContent.split('\n');
let insertIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const app = express()')) {
    insertIndex = i + 1;
    break;
  }
}

if (insertIndex === -1) {
  console.log('❌ Could not find "const app = express()" line');
  process.exit(1);
}

// Insert the trust proxy configuration
lines.splice(insertIndex, 0, '', '// Trust proxy for production deployment behind Nginx');
lines.splice(insertIndex + 1, 0, 'app.set(\'trust proxy\', true);');

const newContent = lines.join('\n');
fs.writeFileSync(appJsPath, newContent);

console.log('✅ Added trust proxy configuration to src/app.js');
console.log('Now restart your application with: pm2 restart kiwi'); 