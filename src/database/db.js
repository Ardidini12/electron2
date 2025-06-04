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

// Import the models
const Contact = require('../models/Contact')(sequelize);
const Template = require('../models/Template')(sequelize);
const Message = require('../models/Message')(sequelize);
const ScheduleSettings = require('../models/ScheduleSettings')(sequelize);
const SalesContact = require('../models/SalesContact')(sequelize);
// Add new models
const SalesMessageSettings = require('../models/SalesMessageSettings')(sequelize);
const SalesMessageTemplate = require('../models/SalesMessageTemplate')(sequelize);
const SalesScheduledMessage = require('../models/SalesScheduledMessage')(sequelize);

// Export the models
const models = {
  Contact,
  Template,
  Message,
  ScheduleSettings,
  SalesContact,
  // Add new models
  SalesMessageSettings,
  SalesMessageTemplate,
  SalesScheduledMessage
};

/**
 * Set up associations between models
 */
function setupAssociations() {
  // Existing associations
  Contact.hasMany(Message);
  Message.belongsTo(Contact);

  Template.hasMany(Message);
  Message.belongsTo(Template);

  // New associations for sales messages
  SalesContact.hasMany(SalesScheduledMessage);
  SalesScheduledMessage.belongsTo(SalesContact);

  SalesMessageTemplate.hasMany(SalesScheduledMessage);
  SalesScheduledMessage.belongsTo(SalesMessageTemplate);
}

setupAssociations();

/**
 * Ensure all required tables exist
 * @returns {Promise<boolean>} True if tables exist or were created
 */
async function ensureTablesExist() {
  try {
    console.log('Checking database tables...');
    
    // Check if tables exist by attempting to query
    try {
      await sequelize.query('SELECT 1 FROM Contacts LIMIT 1');
      await sequelize.query('SELECT 1 FROM Templates LIMIT 1');
      await sequelize.query('SELECT 1 FROM Messages LIMIT 1');
      await sequelize.query('SELECT 1 FROM ScheduleSettings LIMIT 1');
      
      console.log('All required tables already exist');
      return true;
    } catch (error) {
      console.log('Some tables are missing, creating them...');
      
      // Set up associations between models
      setupAssociations();
      
      // Create tables if they don't exist
      await Contact.sync({ force: false });
      await Template.sync({ force: false });
      await Message.sync({ force: false });
      await ScheduleSettings.sync({ force: false });
      await SalesContact.sync({ force: false });
      // Add new tables
      await SalesMessageSettings.sync({ force: false });
      await SalesMessageTemplate.sync({ force: false });
      await SalesScheduledMessage.sync({ force: false });
      
      console.log('Tables created successfully');
      
      // Create default settings if they don't exist
      try {
        const settingsCount = await ScheduleSettings.count();
        if (settingsCount === 0) {
          await ScheduleSettings.create({
            activeDays: [1, 2, 3, 4, 5],
            startTime: 540,
            endTime: 1020,
            messageInterval: 45,
            isActive: false
          });
          console.log('Default schedule settings created');
        }
        
        // Create default sales message settings if they don't exist
        const salesSettingsCount = await SalesMessageSettings.count();
        if (salesSettingsCount === 0) {
          await SalesMessageSettings.create({
            firstMessageDelay: 7200000, // 2 hours
            secondMessageDelay: 15552000000, // 6 months
            isAutoSchedulingEnabled: false,
            isAutoSendingEnabled: false
          });
          console.log('Default sales message settings created');
        }
        
        // Create default sales message templates if they don't exist
        const salesTemplatesCount = await SalesMessageTemplate.count();
        if (salesTemplatesCount === 0) {
          await SalesMessageTemplate.create({
            content: 'Hello {name}, thank you for your purchase! How was your experience?',
            messageType: 'FIRST'
          });
          
          await SalesMessageTemplate.create({
            content: 'Hello {name}, it\'s been a while since your last purchase. We miss you! Check out our latest products.',
            messageType: 'SECOND'
          });
          
          console.log('Default sales message templates created');
        }
      } catch (err) {
        console.error('Error creating default settings:', err);
      }
    }
    
    // Check for SalesContacts table
    try {
      await sequelize.query('SELECT 1 FROM SalesContacts LIMIT 1');
    } catch (err) {
      console.log('Creating SalesContacts table...');
      await SalesContact.sync({ force: false });
      console.log('SalesContacts table created successfully');
    }
    
    // Check for new sales message tables
    try {
      await sequelize.query('SELECT 1 FROM SalesMessageSettings LIMIT 1');
    } catch (err) {
      console.log('Creating SalesMessageSettings table...');
      await SalesMessageSettings.sync({ force: false });
      console.log('SalesMessageSettings table created successfully');
      
      // Create default settings
      await SalesMessageSettings.create({
        firstMessageDelay: 7200000, // 2 hours
        secondMessageDelay: 15552000000, // 6 months
        isAutoSchedulingEnabled: false,
        isAutoSendingEnabled: false
      });
    }
    
    try {
      await sequelize.query('SELECT 1 FROM SalesMessageTemplates LIMIT 1');
    } catch (err) {
      console.log('Creating SalesMessageTemplates table...');
      await SalesMessageTemplate.sync({ force: false });
      console.log('SalesMessageTemplates table created successfully');
      
      // Create default templates
      await SalesMessageTemplate.create({
        content: 'Hello {name}, thank you for your purchase! How was your experience?',
        messageType: 'FIRST'
      });
      
      await SalesMessageTemplate.create({
        content: 'Hello {name}, it\'s been a while since your last purchase. We miss you! Check out our latest products.',
        messageType: 'SECOND'
      });
    }
    
    try {
      await sequelize.query('SELECT 1 FROM SalesScheduledMessages LIMIT 1');
    } catch (err) {
      console.log('Creating SalesScheduledMessages table...');
      await SalesScheduledMessage.sync({ force: false });
      console.log('SalesScheduledMessages table created successfully');
    }
    
    console.log('All required tables exist');
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