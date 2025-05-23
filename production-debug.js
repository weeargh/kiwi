const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

console.log('=== PRODUCTION LOGIN DIAGNOSTIC ===\n');

// Check environment
console.log('Environment Variables:');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'undefined');
console.log('- SESSION_SECRET:', process.env.SESSION_SECRET ? 'SET (length: ' + process.env.SESSION_SECRET.length + ')' : 'NOT SET');
console.log('- PORT:', process.env.PORT || '3000 (default)');
console.log('');

// Check database
const dbPath = './data/rsu_platform.db';
console.log('Database Check:');
console.log('- Database path:', dbPath);

try {
  const db = new Database(dbPath);
  
  // Check if database exists and is accessible
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
  console.log('- Database accessible: YES');
  console.log('- Tables found:', tables.length);
  
  // Check user accounts
  const users = db.prepare('SELECT email, name, role, created_at FROM user_account WHERE deleted_at IS NULL').all();
  console.log('- Active users:', users.length);
  
  if (users.length > 0) {
    console.log('\nUser Accounts:');
    users.forEach(user => {
      console.log(`  - ${user.email} (${user.role}) - created: ${user.created_at}`);
    });
    
    // Test password verification for the most recent user
    const latestUser = db.prepare(`
      SELECT email, password_hash 
      FROM user_account 
      WHERE deleted_at IS NULL 
      ORDER BY created_at DESC 
      LIMIT 1
    `).get();
    
    if (latestUser) {
      console.log('\nPassword Hash Check:');
      console.log('- Latest user:', latestUser.email);
      console.log('- Hash format:', latestUser.password_hash.substring(0, 7) + '...');
      console.log('- Hash length:', latestUser.password_hash.length);
      
      // Test common passwords
      const testPasswords = ['Test123!', 'password', 'admin123'];
      console.log('- Testing common passwords...');
      
      for (const pwd of testPasswords) {
        try {
          const matches = bcrypt.compareSync(pwd, latestUser.password_hash);
          if (matches) {
            console.log(`  ✅ Password "${pwd}" MATCHES!`);
          }
        } catch (err) {
          console.log(`  ❌ Error testing "${pwd}":`, err.message);
        }
      }
    }
  }
  
  db.close();
  
} catch (err) {
  console.log('- Database accessible: NO');
  console.log('- Error:', err.message);
}

console.log('\n=== RECOMMENDATIONS ===');

if (process.env.NODE_ENV !== 'production') {
  console.log('⚠️  NODE_ENV is not set to "production"');
  console.log('   Run: export NODE_ENV=production');
}

if (!process.env.SESSION_SECRET) {
  console.log('⚠️  SESSION_SECRET is not set');
  console.log('   Run: export SESSION_SECRET="your-secure-random-string-here"');
}

console.log('\n🔧 To test login on production server:');
console.log('1. SSH into your Linode server');
console.log('2. cd /root/kiwi');
console.log('3. node production-debug.js');
console.log('4. Check pm2 logs: pm2 logs kiwi --lines 50');
console.log('5. Test local access: curl -I http://localhost:3000/auth/login');
console.log('6. Check Nginx: nginx -t && systemctl status nginx'); 