// mcp/fix-imports.js
const fs = require('fs');
const path = require('path');

function fixImports(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !file.includes('node_modules') && !file.includes('dist')) {
      fixImports(fullPath);
    } else if (file.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Fix relative imports
      content = content.replace(
        /from ['"](\.[^'"]+)(?<!\.js)(?<!\.json)['"]/g,
        "from '$1.js'"
      );
      
      fs.writeFileSync(fullPath, content);
      console.log(`Fixed: ${fullPath}`);
    }
  });
}

fixImports('.');
console.log('Import fixes complete!');