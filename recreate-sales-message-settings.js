const path = require('path');
const os = require('os');
const { Sequelize } = require('sequelize');

const dbPath = path.join(os.homedir(), 'Desktop', 'bss-sender-db', 'database.sqlite');
console.log(`Checking database at: ${dbPath}`);

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: true
});

async function recreateTable() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database successfully');

    // Start a transaction
    const transaction = await sequelize.transaction();

    try {
      // Check if there are any settings to backup
      const [settings] = await sequelize.query('SELECT * FROM SalesMessageSettings', { transaction });
      console.log(`Found ${settings.length} settings to backup`);

      // Backup existing settings
      const backupData = settings.length > 0 ? {
        id: settings[0].id,
        firstMessageDelay: settings[0].firstMessageDelay || 7200000,
        secondMessageDelay: settings[0].secondMessageDelay || 15552000000,
        isAutoSchedulingEnabled: false, // Default to false for safety
        isAutoSendingEnabled: false, // Default to false for safety
        createdAt: settings[0].createdAt,
        updatedAt: settings[0].updatedAt
      } : null;

      // Drop the existing table
      console.log('Dropping existing SalesMessageSettings table...');
      await sequelize.query('DROP TABLE IF EXISTS SalesMessageSettings', { transaction });
      console.log('Table dropped successfully');

      // Create a new table with the correct schema
      console.log('Creating new SalesMessageSettings table...');
      await sequelize.query(`
        CREATE TABLE SalesMessageSettings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          firstMessageDelay BIGINT NOT NULL DEFAULT 7200000,
          secondMessageDelay BIGINT NOT NULL DEFAULT 15552000000,
          isAutoSchedulingEnabled BOOLEAN DEFAULT 0,
          isAutoSendingEnabled BOOLEAN DEFAULT 0,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `, { transaction });
      console.log('Table created successfully');

      // Insert backup data if we had any
      if (backupData) {
        console.log('Restoring backed up settings...');
        await sequelize.query(`
          INSERT INTO SalesMessageSettings (id, firstMessageDelay, secondMessageDelay, isAutoSchedulingEnabled, isAutoSendingEnabled, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, {
          replacements: [
            backupData.id,
            backupData.firstMessageDelay,
            backupData.secondMessageDelay,
            backupData.isAutoSchedulingEnabled ? 1 : 0,
            backupData.isAutoSendingEnabled ? 1 : 0,
            backupData.createdAt || new Date(),
            backupData.updatedAt || new Date()
          ],
          transaction
        });
        console.log('Settings restored successfully');
      } else {
        // Insert default settings
        console.log('Creating default settings...');
        await sequelize.query(`
          INSERT INTO SalesMessageSettings (firstMessageDelay, secondMessageDelay, isAutoSchedulingEnabled, isAutoSendingEnabled)
          VALUES (7200000, 15552000000, 0, 0)
        `, { transaction });
        console.log('Default settings created successfully');
      }

      // Commit the transaction
      await transaction.commit();
      console.log('Transaction committed successfully');
      
      // Verify the new table structure
      const [columns] = await sequelize.query('PRAGMA table_info(SalesMessageSettings)');
      console.log('New SalesMessageSettings columns:');
      columns.forEach(column => {
        console.log(`- ${column.name} (${column.type})`);
      });
      
      // Verify the data
      const [newSettings] = await sequelize.query('SELECT * FROM SalesMessageSettings');
      console.log('\nSettings in the database:');
      console.log(`- ID: ${newSettings[0].id}`);
      console.log(`- First Message Delay: ${newSettings[0].firstMessageDelay} ms (${newSettings[0].firstMessageDelay / 3600000} hours)`);
      console.log(`- Second Message Delay: ${newSettings[0].secondMessageDelay} ms (${newSettings[0].secondMessageDelay / 86400000} days)`);
      console.log(`- Auto-Scheduling Enabled: ${newSettings[0].isAutoSchedulingEnabled ? 'Yes' : 'No'}`);
      console.log(`- Auto-Sending Enabled: ${newSettings[0].isAutoSendingEnabled ? 'Yes' : 'No'}`);
      
      console.log('\nTable recreation completed successfully');
    } catch (error) {
      // Rollback the transaction if there was an error
      await transaction.rollback();
      console.error('Error during table recreation, transaction rolled back:', error);
      throw error;
    }

    await sequelize.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

recreateTable(); 