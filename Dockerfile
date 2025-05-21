FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install SQLite and other dependencies
RUN apk add --no-cache sqlite sqlite-dev python3 make g++

# Copy package.json files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create necessary directories
RUN mkdir -p data/reports data/backup data/cache logs
RUN touch data/reports/.gitkeep data/backup/.gitkeep data/cache/.gitkeep logs/.gitkeep

# Set permissions
RUN chmod +x scripts/db/backup-database.js
RUN chmod +x scripts/archive-logs.js

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 