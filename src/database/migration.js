const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Path to the database file
const dbPath = path.join(os.homedir(), 'Desktop', 'bss-sender-db', 'database.sqlite');

console.log(`Running migration for database at: ${dbPath}`);

// Create a new Sequelize instance
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: console.log
});

async function runMigration() {
  try {
    // Test the connection
    await sequelize.authenticate();
    console.log('Connected to the database successfully.');

    // Run migrations in a transaction
    await sequelize.transaction(async (transaction) => {
      // Check if deliveredTime column exists
      let needsDeliveredTime = false;
      try {
        await sequelize.query('SELECT deliveredTime FROM Messages LIMIT 1', { transaction });
        console.log('deliveredTime column already exists');
      } catch (error) {
        needsDeliveredTime = true;
        console.log('Need to add deliveredTime column');
      }

      // Check if readTime column exists
      let needsReadTime = false;
      try {
        await sequelize.query('SELECT readTime FROM Messages LIMIT 1', { transaction });
        console.log('readTime column already exists');
      } catch (error) {
        needsReadTime = true;
        console.log('Need to add readTime column');
      }

      // Check if retryCount column exists
      let needsRetryCount = false;
      try {
        await sequelize.query('SELECT retryCount FROM Messages LIMIT 1', { transaction });
        console.log('retryCount column already exists');
      } catch (error) {
        needsRetryCount = true;
        console.log('Need to add retryCount column');
      }

      // Add deliveredTime column if needed
      if (needsDeliveredTime) {
        await sequelize.query(
          'ALTER TABLE Messages ADD COLUMN deliveredTime DATETIME',
          { transaction }
        );
        console.log('Added deliveredTime column');
      }

      // Add readTime column if needed
      if (needsReadTime) {
        await sequelize.query(
          'ALTER TABLE Messages ADD COLUMN readTime DATETIME',
          { transaction }
        );
        console.log('Added readTime column');
      }

      // Add retryCount column if needed
      if (needsRetryCount) {
        await sequelize.query(
          'ALTER TABLE Messages ADD COLUMN retryCount INTEGER DEFAULT 0',
          { transaction }
        );
        console.log('Added retryCount column');
      }

      // Check if SENDING is in the status ENUM
      // For SQLite, this is more complex as we need to recreate the table to modify an ENUM
      // Instead, let's just check if any existing records have 'SENDING' status
      const [results] = await sequelize.query(
        "SELECT COUNT(*) as count FROM Messages WHERE status = 'SENDING'",
        { transaction }
      );
      const sendingCount = results[0].count;

      if (sendingCount === 0) {
        console.log("No records with 'SENDING' status found. The app will handle this going forward.");
      } else {
        console.log(`Found ${sendingCount} records with 'SENDING' status.`);
      }

      // Check if SalesContacts table exists
      let needsSalesContactsTable = false;
      try {
        await sequelize.query('SELECT 1 FROM SalesContacts LIMIT 1', { transaction });
        console.log('SalesContacts table already exists');
      } catch (error) {
        needsSalesContactsTable = true;
        console.log('Need to create SalesContacts table');
      }

      // Create SalesContacts table if needed
      if (needsSalesContactsTable) {
        console.log('Creating SalesContacts table...');
        
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS SalesContacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contactId INTEGER,
            name VARCHAR(255) NOT NULL,
            phoneNumber VARCHAR(255) NOT NULL,
            code VARCHAR(255),
            city VARCHAR(255),
            documentNumber VARCHAR(255),
            documentDate DATETIME,
            shopId VARCHAR(255),
            sourceData TEXT,
            imported BOOLEAN DEFAULT 0,
            importedAt DATETIME,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `, { transaction });
        
        // Create indexes
        await sequelize.query(
          'CREATE INDEX IF NOT EXISTS sales_contact_phone_idx ON SalesContacts (phoneNumber)',
          { transaction }
        );
        
        await sequelize.query(
          'CREATE INDEX IF NOT EXISTS sales_contact_city_idx ON SalesContacts (city)',
          { transaction }
        );
        
        await sequelize.query(
          'CREATE INDEX IF NOT EXISTS sales_contact_date_idx ON SalesContacts (documentDate)',
          { transaction }
        );
        
        console.log('Created SalesContacts table and indexes');
      }

      // Check if SalesMessageSettings table exists
      let needsSalesMessageSettingsTable = false;
      try {
        await sequelize.query('SELECT 1 FROM SalesMessageSettings LIMIT 1', { transaction });
        console.log('SalesMessageSettings table already exists');
      } catch (error) {
        needsSalesMessageSettingsTable = true;
        console.log('Need to create SalesMessageSettings table');
      }

      // Create SalesMessageSettings table if needed
      if (needsSalesMessageSettingsTable) {
        console.log('Creating SalesMessageSettings table...');
        
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS SalesMessageSettings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            firstMessageDelay BIGINT NOT NULL DEFAULT 7200000,
            secondMessageDelay BIGINT NOT NULL DEFAULT 15552000000,
            isAutoSchedulingEnabled BOOLEAN DEFAULT 0,
            isAutoSendingEnabled BOOLEAN DEFAULT 0,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `, { transaction });
        
        console.log('Created SalesMessageSettings table');
        
        // Insert default settings
        await sequelize.query(`
          INSERT INTO SalesMessageSettings (
            firstMessageDelay, 
            secondMessageDelay, 
            isAutoSchedulingEnabled, 
            isAutoSendingEnabled
          ) VALUES (
            7200000,
            15552000000,
            0,
            0
          )
        `, { transaction });
        
        console.log('Inserted default SalesMessageSettings');
      }
      
      // Check if SalesMessageTemplates table exists
      let needsSalesMessageTemplatesTable = false;
      try {
        await sequelize.query('SELECT 1 FROM SalesMessageTemplates LIMIT 1', { transaction });
        console.log('SalesMessageTemplates table already exists');
        
        // If the table exists, check if messageType column exists
        try {
          await sequelize.query('SELECT messageType FROM SalesMessageTemplates LIMIT 1', { transaction });
          console.log('messageType column already exists in SalesMessageTemplates');
        } catch (error) {
          console.log('messageType column does not exist in SalesMessageTemplates, adding it...');
          
          // Add messageType column to the table
          await sequelize.query(`
            ALTER TABLE SalesMessageTemplates 
            ADD COLUMN messageType VARCHAR(10) NOT NULL CHECK (messageType IN ('FIRST', 'SECOND')) DEFAULT 'FIRST'
          `, { transaction });
          
          console.log('Added messageType column to SalesMessageTemplates');
          
          // Update existing records to have proper message types
          console.log('Setting messageType for existing records...');
          await sequelize.query(`
            UPDATE SalesMessageTemplates SET messageType = 'FIRST' WHERE id = 1;
            UPDATE SalesMessageTemplates SET messageType = 'SECOND' WHERE id = 2;
          `, { transaction });
          
          console.log('Updated existing SalesMessageTemplates records with proper messageType values');
        }
      } catch (error) {
        needsSalesMessageTemplatesTable = true;
        console.log('Need to create SalesMessageTemplates table');
      }
      
      // Create SalesMessageTemplates table if needed
      if (needsSalesMessageTemplatesTable) {
        console.log('Creating SalesMessageTemplates table...');
        
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS SalesMessageTemplates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL DEFAULT 'Hello {name}, thank you for your purchase!',
            imagePath VARCHAR(255),
            messageType VARCHAR(10) NOT NULL CHECK (messageType IN ('FIRST', 'SECOND')) DEFAULT 'FIRST',
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `, { transaction });
        
        console.log('Created SalesMessageTemplates table');
        
        // Insert default templates
        await sequelize.query(`
          INSERT INTO SalesMessageTemplates (
            content, 
            messageType
          ) VALUES (
            'Hello {name}, thank you for your purchase! How was your experience?',
            'FIRST'
          )
        `, { transaction });
        
        await sequelize.query(`
          INSERT INTO SalesMessageTemplates (
            content, 
            messageType
          ) VALUES (
            'Hello {name}, it''s been a while since your last purchase. We miss you! Check out our latest products.',
            'SECOND'
          )
        `, { transaction });
        
        console.log('Inserted default SalesMessageTemplates');
      }
      
      // Check if SalesScheduledMessages table exists
      let needsSalesScheduledMessagesTable = false;
      try {
        await sequelize.query('SELECT 1 FROM SalesScheduledMessages LIMIT 1', { transaction });
        console.log('SalesScheduledMessages table already exists');
      } catch (error) {
        needsSalesScheduledMessagesTable = true;
        console.log('Need to create SalesScheduledMessages table');
      }
      
      // Create SalesScheduledMessages table if needed
      if (needsSalesScheduledMessagesTable) {
        console.log('Creating SalesScheduledMessages table...');
        
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS SalesScheduledMessages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            externalId VARCHAR(255),
            status VARCHAR(20) NOT NULL CHECK (status IN ('SCHEDULED', 'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED')) DEFAULT 'SCHEDULED',
            scheduledTime DATETIME NOT NULL,
            sentTime DATETIME,
            deliveredTime DATETIME,
            readTime DATETIME,
            messageSequence VARCHAR(10) NOT NULL CHECK (messageSequence IN ('FIRST', 'SECOND')) DEFAULT 'FIRST',
            retryCount INTEGER DEFAULT 0,
            failureReason TEXT,
            contentSnapshot TEXT,
            imagePathSnapshot VARCHAR(255),
            SalesContactId INTEGER NOT NULL,
            SalesMessageTemplateId INTEGER NOT NULL,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (SalesContactId) REFERENCES SalesContacts(id) ON DELETE CASCADE,
            FOREIGN KEY (SalesMessageTemplateId) REFERENCES SalesMessageTemplates(id) ON DELETE CASCADE
          )
        `, { transaction });
        
        // Create indexes
        await sequelize.query(
          'CREATE INDEX IF NOT EXISTS sales_scheduled_message_status_idx ON SalesScheduledMessages (status)',
          { transaction }
        );
        
        await sequelize.query(
          'CREATE INDEX IF NOT EXISTS sales_scheduled_message_contact_idx ON SalesScheduledMessages (SalesContactId)',
          { transaction }
        );
        
        await sequelize.query(
          'CREATE INDEX IF NOT EXISTS sales_scheduled_message_scheduled_time_idx ON SalesScheduledMessages (scheduledTime)',
          { transaction }
        );
        
        console.log('Created SalesScheduledMessages table and indexes');
      }

      console.log('Migration completed successfully!');
    });

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sequelize.close();
  }
}

// Run the migration
runMigration().then(() => {
  console.log('Migration script execution completed.');
}).catch(err => {
  console.error('Error running migration:', err);
}); 