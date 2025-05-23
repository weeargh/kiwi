#!/bin/bash

echo "=== FIXING PRODUCTION LOGIN ISSUES ==="
echo ""

# Check if we're running as root
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  This script should be run as root on your Linode server"
    echo "   Run: sudo bash fix-production-login.sh"
    exit 1
fi

# Navigate to application directory
cd /root/kiwi || {
    echo "❌ Could not find /root/kiwi directory"
    echo "   Make sure you're running this on your Linode server"
    exit 1
}

echo "✅ In application directory: $(pwd)"

# 0. Clean up duplicate PM2 processes first
echo ""
echo "0. Cleaning up duplicate PM2 processes..."
pm2 delete all
pm2 flush
echo "   Cleaned up all PM2 processes"

# 0.1. Fix trust proxy issue
echo ""
echo "0.1. Fixing trust proxy configuration..."
if ! grep -q "app.set('trust proxy', true)" src/app.js; then
    # Find the line after 'const app = express();' and add trust proxy
    sed -i "/const app = express();/a\\
\\
// Trust proxy for production deployment behind Nginx\\
app.set('trust proxy', true);" src/app.js
    echo "   ✅ Added trust proxy configuration"
else
    echo "   ✅ Trust proxy already configured"
fi

# 1. Set environment variables
echo ""
echo "1. Setting environment variables..."

# Generate a secure session secret if one doesn't exist
if [ -z "$SESSION_SECRET" ]; then
    export SESSION_SECRET=$(openssl rand -base64 32)
    echo "   Generated new SESSION_SECRET"
fi

export NODE_ENV=production
echo "   Set NODE_ENV=production"

# 2. Create environment file for PM2
echo ""
echo "2. Creating PM2 environment configuration..."
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'kiwi',
    script: 'src/app.js',
    env: {
      NODE_ENV: 'production',
      SESSION_SECRET: '$SESSION_SECRET',
      PORT: 3000
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
};
EOF
echo "   Created ecosystem.config.js with single instance"

# 3. Start the application with proper environment
echo ""
echo "3. Starting application with correct configuration..."
pm2 start ecosystem.config.js
pm2 save
echo "   Started application with PM2"

# 4. Wait a moment for the app to start
echo ""
echo "4. Waiting for application to start..."
sleep 5

# 5. Check Nginx configuration
echo ""
echo "5. Checking Nginx configuration..."
if nginx -t > /dev/null 2>&1; then
    echo "   ✅ Nginx configuration is valid"
    systemctl reload nginx
    echo "   Reloaded Nginx"
else
    echo "   ⚠️  Nginx configuration has issues:"
    nginx -t
fi

# 6. Check SSL certificate
echo ""
echo "6. Checking SSL certificate..."
if command -v certbot &> /dev/null; then
    certbot certificates 2>/dev/null | grep "app.kiwi-equity.com" && echo "   ✅ SSL certificate found" || echo "   ⚠️  SSL certificate not found"
else
    echo "   ⚠️  Certbot not installed"
fi

# 7. Test local connectivity
echo ""
echo "7. Testing local connectivity..."
if curl -s -I http://localhost:3000/auth/login | grep -q "200 OK"; then
    echo "   ✅ Application responds locally"
else
    echo "   ❌ Application not responding locally"
    echo "   Checking if port 3000 is in use..."
    lsof -i :3000 || echo "   No process using port 3000"
fi

# 8. Display status
echo ""
echo "=== STATUS SUMMARY ==="
pm2 list
echo ""
echo "Application logs (last 10 lines):"
pm2 logs kiwi --lines 10

echo ""
echo "=== NEXT STEPS ==="
echo "1. Test login at: https://app.kiwi-equity.com/auth/login"
echo "2. Check logs if issues persist: pm2 logs kiwi --lines 50"
echo "3. If still not working, run the diagnostic: node production-debug.js"
echo ""
echo "Environment variables set:"
echo "- NODE_ENV: $NODE_ENV"
echo "- SESSION_SECRET: ${SESSION_SECRET:0:10}... (truncated)"

echo ""
echo "🔧 CRITICAL FIXES APPLIED:"
echo "✅ Cleaned up duplicate PM2 processes"
echo "✅ Added trust proxy configuration for Nginx"
echo "✅ Set proper environment variables"
echo "✅ Single PM2 instance configuration" 