# Kiwi4 Deployment Guide

This guide explains how to deploy the Kiwi4 RSU/ESOP Platform to various environments.

## GitHub Deployment

### Prerequisites

- GitHub account
- Git installed on your local machine

### Initial Setup

1. Create a new repository on GitHub:
   - Go to https://github.com/new
   - Name your repository (e.g., `kiwi4`)
   - Set visibility as needed (public or private)
   - Click "Create repository"

2. Connect your local repository to GitHub:
   ```bash
   # If you're starting with an existing repository:
   git remote set-url origin https://github.com/yourusername/kiwi4.git
   
   # If you're starting with a new repository:
   git remote add origin https://github.com/yourusername/kiwi4.git
   ```

3. Push your code to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push -u origin main
   ```

### Continuous Deployment

#### Option 1: Deploy to a VPS or Dedicated Server

1. Set up a server with Node.js (v18+) and SQLite installed
2. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/kiwi4.git
   cd kiwi4
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create a `.env` file with appropriate settings:
   ```
   NODE_ENV=production
   PORT=3000
   SESSION_SECRET=your-secure-session-secret
   ```

5. Initialize the database:
   ```bash
   npm run setup-db
   ```

6. Start the application with PM2:
   ```bash
   npm install -g pm2
   pm2 start npm --name "kiwi4" -- start
   pm2 save
   pm2 startup
   ```

7. Set up a reverse proxy with Nginx:
   ```nginx
   server {
     listen 80;
     server_name your-domain.com;
     
     location / {
       proxy_pass http://localhost:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_cache_bypass $http_upgrade;
     }
   }
   ```

8. Enable HTTPS with Certbot:
   ```bash
   certbot --nginx -d your-domain.com
   ```

#### Option 2: Deploy to Heroku

1. Create a Heroku account and install the Heroku CLI
2. Create a new Heroku app:
   ```bash
   heroku create kiwi4-app
   ```

3. Add a Procfile to the repository:
   ```
   web: npm start
   ```

4. Configure environment variables:
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set SESSION_SECRET=your-secure-session-secret
   ```

5. Push to Heroku:
   ```bash
   git push heroku main
   ```

### Automated Deployment with GitHub Actions

You can set up GitHub Actions to automatically deploy your application whenever changes are pushed:

1. Create a `.github/workflows/deploy.yml` file:
   ```yaml
   name: Deploy

   on:
     push:
       branches: [ main ]

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v2
         - name: Use Node.js
           uses: actions/setup-node@v2
           with:
             node-version: '18'
         - name: Install dependencies
           run: npm ci
         - name: Run tests
           run: npm test
         - name: Deploy to server
           uses: appleboy/ssh-action@master
           with:
             host: ${{ secrets.HOST }}
             username: ${{ secrets.USERNAME }}
             key: ${{ secrets.SSH_KEY }}
             port: ${{ secrets.PORT }}
             script: |
               cd /path/to/app
               git pull origin main
               npm ci
               npm run db:migrate
               pm2 restart kiwi4
   ```

2. Configure GitHub repository secrets:
   - Go to your GitHub repository
   - Navigate to Settings > Secrets and variables > Actions
   - Add the following secrets:
     - `HOST`: Your server's IP address
     - `USERNAME`: SSH username
     - `SSH_KEY`: Private SSH key
     - `PORT`: SSH port (usually 22)

## Backup Strategy

The application includes automatic backup functionality:

1. Set up a cron job to run the backup script daily:
   ```bash
   node scripts/setup-cron.js
   ```

2. To manually backup the database:
   ```bash
   npm run db:backup
   ```

## Monitoring and Maintenance

1. Monitor application logs:
   ```bash
   pm2 logs kiwi4
   ```

2. Set up log rotation:
   ```bash
   npm run archive
   ```

3. Use PM2 monitoring dashboard:
   ```bash
   pm2 monit
   ```

## Troubleshooting

Common deployment issues:

1. **Database connection errors**: Ensure SQLite is installed and the data directory is writable
2. **Port conflicts**: Change the PORT environment variable if port 3000 is already in use
3. **Session errors**: Verify that the SESSION_SECRET is set and that session data is persisting correctly

For more detailed troubleshooting, check the application logs in the `logs/` directory. 