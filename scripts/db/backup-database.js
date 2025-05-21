#!/usr/bin/env node

/**
 * Database Backup Script
 * 
 * This script creates a timestamped backup of the SQLite database
 * and stores it in the backup directory.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

// Configuration
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/rsu_platform.db');
const BACKUP_DIR = path.join(__dirname, '../../data/backup');
const ARCHIVE_DIR = path.join(__dirname, '../../archive/db_backups');
const MAX_BACKUPS = 5; // Maximum number of recent backups to keep

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Ensure archive directory exists
if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

/**
 * Create a backup of the database
 */
function createBackup() {
  const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const backupFilename = `rsu_platform_backup_${timestamp}.db`;
  const backupPath = path.join(BACKUP_DIR, backupFilename);
  
  console.log(`Creating backup: ${backupPath}`);
  
  try {
    // Check if source database exists
    if (!fs.existsSync(DB_PATH)) {
      console.error(`Error: Source database not found at ${DB_PATH}`);
      process.exit(1);
    }
    
    // Use the sqlite3 .backup command for a consistent backup
    const command = `sqlite3 "${DB_PATH}" ".backup '${backupPath}'"`;
    execSync(command);
    
    console.log(`Backup created successfully: ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.error('Error creating backup:', error.message);
    process.exit(1);
  }
}

/**
 * Manage the number of backups and archive old ones
 */
function manageBackups() {
  console.log('Managing backup files...');
  
  try {
    // Get all backup files
    const backupFiles = fs.readdirSync(BACKUP_DIR)
      .filter(file => file.endsWith('.db'))
      .map(file => ({
        name: file,
        path: path.join(BACKUP_DIR, file),
        time: fs.statSync(path.join(BACKUP_DIR, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // Sort by time, newest first
    
    // Keep only the MAX_BACKUPS most recent backups
    if (backupFiles.length > MAX_BACKUPS) {
      console.log(`Found ${backupFiles.length} backups, keeping ${MAX_BACKUPS} most recent`);
      
      const filesToArchive = backupFiles.slice(MAX_BACKUPS);
      
      filesToArchive.forEach(file => {
        const archivePath = path.join(ARCHIVE_DIR, file.name + '.gz');
        console.log(`Archiving ${file.name} to ${archivePath}`);
        
        // Compress and move to archive
        execSync(`gzip -c "${file.path}" > "${archivePath}"`);
        
        // Remove the original backup file
        fs.unlinkSync(file.path);
        console.log(`Removed original backup file: ${file.path}`);
      });
    } else {
      console.log(`Found ${backupFiles.length} backups, no archiving needed`);
    }
  } catch (error) {
    console.error('Error managing backups:', error.message);
  }
}

// Main execution
console.log('Starting database backup process...');
const backupPath = createBackup();
manageBackups();
console.log('Database backup process completed successfully!'); 