const { Sequelize } = require('sequelize');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const os = require('os');

// Create the database folder on desktop
function createDbFolder() {
  try {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const folder = path.join(desktopPath, 'bss-sender-db');
    
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      console.log(`Created database folder at: ${folder}`);
    }
    
    const whatsappSessionDir = path.join(folder, 'whatsapp-session');
    if (!fs.existsSync(whatsappSessionDir)) {
      fs.mkdirSync(whatsappSessionDir, { recursive: true });
      console.log(`Created WhatsApp session directory at: ${whatsappSessionDir}`);
    } else {
      // Check for and remove any old session directories to prevent duplicates
      try {
        const parentDir = path.dirname(whatsappSessionDir);
        if (fs.existsSync(parentDir)) {
          const entries = fs.readdirSync(parentDir);
          const oldSessionDirs = entries.filter(entry => 
            entry.startsWith('whatsapp-session.old-') && 
            fs.statSync(path.join(parentDir, entry)).isDirectory()
          );
          
          if (oldSessionDirs.length > 0) {
            console.log(`Found ${oldSessionDirs.length} old WhatsApp session directories to clean up`);
            
            // Delete old session directories
            for (const dirName of oldSessionDirs) {
              const dirPath = path.join(parentDir, dirName);
              try {
                // Try to remove the directory and its contents
                fs.rmdirSync(dirPath, { recursive: true });
                console.log(`Removed old session directory: ${dirPath}`);
              } catch (e) {
                console.error(`Failed to remove old session directory ${dirPath}:`, e);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error cleaning up old WhatsApp session directories:', err);
      }
    }
    
    return folder;
  } catch (error) {
    console.error('Error creating database folder:', error);
    const fallbackFolder = path.join(app ? app.getPath('userData') : __dirname, 'db');
    if (!fs.existsSync(fallbackFolder)) {
      fs.mkdirSync(fallbackFolder, { recursive: true });
    }
    return fallbackFolder;
  }
}

const dbFolder = createDbFolder();
console.log(`Using database folder at: ${dbFolder}`);

let dbInitialized = false;
let initializationInProgress = false;
let initializationPromise = null;

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(dbFolder, 'database.sqlite'),
  logging: false,
  dialectOptions: {
    timeout: 60000,
    busyTimeout: 60000
  },
  define: {
    underscored: false,
    freezeTableName: true,
    timestamps: true
  },
  retry: {
    max: 3,
    match: [/SQLITE_BUSY/],
  }
});

// Import model definitions
const ContactModel = require('../models/Contact');
const TemplateModel = require('../models/Template');
const MessageModel = require('../models/Message');
const ScheduleSettingsModel = require('../models/ScheduleSettings');
    
// Initialize models with the single sequelize instance
const Contact = ContactModel(sequelize);
const Template = TemplateModel(sequelize);
const Message = MessageModel(sequelize);
const ScheduleSettings = ScheduleSettingsModel(sequelize);
    
const models = {
  Contact,
  Template,
  Message,
  ScheduleSettings
};

// Define associations between models
function setupAssociations() {
  Message.belongsTo(Contact);
  Contact.hasMany(Message);
  Message.belongsTo(Template);
  Template.hasMany(Message);
}

setupAssociations();

async function ensureTablesExist() {
  try {
    console.log('Checking database tables...');
    
    // First check if tables exist by querying them
    let tablesExist = false;
    try {
      await sequelize.query('SELECT 1 FROM Contacts LIMIT 1');
      await sequelize.query('SELECT 1 FROM Templates LIMIT 1');
      await sequelize.query('SELECT 1 FROM Messages LIMIT 1');
      await sequelize.query('SELECT 1 FROM ScheduleSettings LIMIT 1');
      tablesExist = true;
    } catch (err) {
      console.log('Tables do not exist, need to create them');
      tablesExist = false;
    }
    
    // Only sync if tables don't exist
    if (!tablesExist) {
      console.log('Creating database tables...');
      await sequelize.sync({ force: false });
      console.log('All tables created successfully');
      
      // Create default schedule settings if none exist
      const existingSettings = await ScheduleSettings.findOne();
      if (!existingSettings) {
        await ScheduleSettings.create({
          activeDays: [1, 2, 3, 4, 5],
          startTime: 540,
          endTime: 1020,
          messageInterval: 45,
          isActive: false
        });
        console.log('Default schedule settings created');
      }
    } else {
      console.log('All required tables already exist');
    }
    
    return true;
  } catch (error) {
    console.error('Error creating/checking tables:', error);
    return false;
  }
}

async function initDatabase() {
  if (initializationInProgress && initializationPromise) {
    console.log('Database initialization already in progress, waiting...');
    return initializationPromise;
  }
  
  initializationInProgress = true;
  initializationPromise = _initDatabaseInternal();
  
  try {
    const result = await initializationPromise;
    return result;
  } finally {
    initializationInProgress = false;
    initializationPromise = null;
  }
}

async function _initDatabaseInternal() {
  console.log('Initializing database...');
  
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully');
    
    const tablesCreated = await ensureTablesExist();
    if (!tablesCreated) {
      throw new Error('Failed to create required database tables');
    }
    
    // Verify tables exist but handle possible missing columns
    try {
      // Try to access tables with a more robust approach
      await Contact.findOne();
      await Template.findOne();
      
      // For Message, use a simpler query to avoid issues with missing columns
      try {
        await Message.findOne();
      } catch (error) {
        if (error.name === 'SequelizeDatabaseError' && error.parent && 
            (error.parent.code === 'SQLITE_ERROR') && 
            (error.message.includes('no such column'))) {
          
          console.warn('Database schema mismatch detected. Some columns may be missing.');
          console.warn('Please run the migration script with: npm run migrate');
          
          // Use a raw query that only selects the columns we know exist
          await sequelize.query('SELECT id, status, scheduledTime, sentTime FROM Messages LIMIT 1');
          console.log('Basic Message table verification passed with limited columns');
        } else {
          throw error;
        }
      }
      
      await ScheduleSettings.findOne();
    } catch (error) {
      console.error('Error verifying database tables:', error);
      throw error;
    }
    
    dbInitialized = true;
    console.log('Database initialized successfully');
    return true;
  } catch (error) {
    console.error('Error in database initialization:', error);
    dbInitialized = false;
    throw error;
  }
}

function isDatabaseInitialized() {
  return dbInitialized;
}

function getDatabaseFolder() {
  return dbFolder;
}

async function resetDatabase(backupFirst = true) {
  console.log('Resetting database...');
  
  try {
    try {
      await sequelize.close();
      console.log('Closed existing database connections');
    } catch (closeError) {
      console.error('Error closing database connection:', closeError);
    }
    
    const dbFile = sequelize.options.storage;
    
    if (backupFirst && fs.existsSync(dbFile)) {
      const backupFile = `${dbFile}.backup-${Date.now()}.sqlite`;
      try {
        fs.copyFileSync(dbFile, backupFile);
        console.log(`Created database backup: ${backupFile}`);
      } catch (backupError) {
        console.error('Error creating database backup:', backupError);
      }
    }
    
    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile);
      console.log(`Deleted database file: ${dbFile}`);
    }
    
    await sequelize.authenticate();
    console.log('Reconnected to database after reset');
    
    setupAssociations();
    await sequelize.sync({ force: true });
    console.log('Database tables recreated after reset');
    
    return true;
  } catch (error) {
    console.error('Failed to reset database:', error);
    throw error;
  }
}

async function waitForDatabaseReady(timeout = 30000, interval = 500) {
  if (dbInitialized) {
    console.log('Database already initialized');
    return true;
  }

  console.log(`Waiting for database to be ready (timeout: ${timeout}ms)...`);
  
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const checkInitialized = async () => {
      try {
        if (dbInitialized) {
          console.log('Database initialized, continuing...');
          return resolve(true);
        }
        
        if (initializationInProgress && initializationPromise) {
          console.log('Database initialization in progress, waiting...');
          try {
            await initializationPromise;
            console.log('Initialization completed while waiting');
            return resolve(true);
          } catch (error) {
            console.error('Error while waiting for initialization:', error);
          }
        }
        
        if (Date.now() - startTime > timeout) {
          console.error('Timeout waiting for database initialization');
          return reject(new Error('Timeout waiting for database initialization'));
        }
        
        setTimeout(checkInitialized, interval);
      } catch (error) {
        console.error('Error checking database initialization status:', error);
        reject(error);
      }
    };
    
    checkInitialized();
  });
}

module.exports = {
  sequelize,
  models,
  initDatabase,
  getDatabaseFolder,
  isDatabaseInitialized,
  resetDatabase,
  ensureTablesExist,
  waitForDatabaseReady
}; 