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