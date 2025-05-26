const { Sequelize } = require('sequelize');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const os = require('os');

// Define the database folder on the desktop
function getDbPath() {
  try {
    // Get desktop path based on operating system
    const desktopPath = path.join(os.homedir(), 'Desktop');
    
    // Create database folder if it doesn't exist
    const dbFolder = path.join(desktopPath, 'bss-sender-db');
    if (!fs.existsSync(dbFolder)) {
      fs.mkdirSync(dbFolder, { recursive: true });
      console.log(`Created database folder at: ${dbFolder}`);
    }
    
    // Return the path to the database file
    return path.join(dbFolder, 'bss-sender.sqlite');
  } catch (error) {
    console.error('Error creating database folder:', error);
    // Fallback to app data folder if we can't create on desktop
    return path.join(app ? app.getPath('userData') : __dirname, 'bss-sender.sqlite');
  }
}

// Get the database path
const dbPath = getDbPath();
console.log(`Using database at: ${dbPath}`);

// Create Sequelize instance
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
});

// Initialize models
const initModels = () => {
  // Import models
  const Contact = require('../models/Contact')(sequelize);
  const Template = require('../models/Template')(sequelize);
  const Message = require('../models/Message')(sequelize);
  const ScheduleSettings = require('../models/ScheduleSettings')(sequelize);
  
  // Define relationships
  sequelize.models.Message.belongsTo(sequelize.models.Contact);
  sequelize.models.Message.belongsTo(sequelize.models.Template);
  
  return {
    Contact: sequelize.models.Contact,
    Template: sequelize.models.Template,
    Message: sequelize.models.Message,
    ScheduleSettings: sequelize.models.ScheduleSettings
  };
};

// Initialize models immediately
const models = initModels();

// Initialize database and sync models
async function initDatabase() {
  try {
    // Sync models with database
    await sequelize.sync();
    console.log('Database synchronized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Function to get the database folder path
function getDatabaseFolder() {
  return path.dirname(dbPath);
}

module.exports = {
  sequelize,
  initDatabase,
  models,
  getDatabaseFolder
}; 