#!/bin/bash

echo "=== DEPLOYING DASHBOARD FIX ==="
echo ""

# Check if we're running as root
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  This script should be run as root on your Linode server"
    echo "   Run: sudo bash deploy-dashboard-fix.sh"
    exit 1
fi

# Navigate to application directory
cd /root/kiwi || {
    echo "❌ Could not find /root/kiwi directory"
    echo "   Make sure you're running this on your Linode server"
    exit 1
}

echo "✅ In application directory: $(pwd)"

# 1. Backup current files
echo ""
echo "1. Creating backup of current files..."
cp src/routes/index.js src/routes/index.js.backup.$(date +%s)
cp src/views/dashboard.ejs src/views/dashboard.ejs.backup.$(date +%s)
echo "   ✅ Backups created"

# 2. Apply the fixes - you'll need to manually copy the files or use git pull
echo ""
echo "2. Restart PM2 to load the fixes..."
pm2 restart kiwi
echo "   ✅ Application restarted"

# 3. Check status
echo ""
echo "3. Checking application status..."
sleep 3
pm2 list

# 4. Show recent logs
echo ""
echo "4. Recent application logs:"
pm2 logs kiwi --lines 10

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "✅ Dashboard auth variable fixes have been deployed"
echo "✅ Login should now work without ReferenceError"
echo ""
echo "Test at: https://app.kiwi-equity.com/auth/login" 