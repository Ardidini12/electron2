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
      // Check if there are any templates to backup
      const [templates] = await sequelize.query('SELECT * FROM SalesMessageTemplates', { transaction });
      console.log(`Found ${templates.length} templates to backup`);

      // Backup existing templates
      const backupData = templates.map(template => ({
        id: template.id,
        content: template.content,
        imagePath: template.imagePath,
        messageType: template.id === 1 ? 'FIRST' : 'SECOND',
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      }));

      // Drop the existing table
      console.log('Dropping existing SalesMessageTemplates table...');
      await sequelize.query('DROP TABLE IF EXISTS SalesMessageTemplates', { transaction });
      console.log('Table dropped successfully');

      // Create a new table with the correct schema
      console.log('Creating new SalesMessageTemplates table...');
      await sequelize.query(`
        CREATE TABLE SalesMessageTemplates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL DEFAULT 'Hello {name}, thank you for your purchase!',
          imagePath VARCHAR(255),
          messageType VARCHAR(10) NOT NULL DEFAULT 'FIRST',
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `, { transaction });
      console.log('Table created successfully');

      // Insert backup data if we had any
      if (backupData.length > 0) {
        console.log('Restoring backed up templates...');
        for (const template of backupData) {
          await sequelize.query(`
            INSERT INTO SalesMessageTemplates (id, content, imagePath, messageType, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)
          `, {
            replacements: [
              template.id,
              template.content,
              template.imagePath,
              template.messageType,
              template.createdAt || new Date(),
              template.updatedAt || new Date()
            ],
            transaction
          });
        }
        console.log('Templates restored successfully');
      } else {
        // Insert default templates
        console.log('Creating default templates...');
        await sequelize.query(`
          INSERT INTO SalesMessageTemplates (content, messageType)
          VALUES ('Hello {name}, thank you for your purchase! How was your experience?', 'FIRST')
        `, { transaction });
        
        await sequelize.query(`
          INSERT INTO SalesMessageTemplates (content, messageType)
          VALUES ('Hello {name}, it''s been a while since your last purchase. We miss you! Check out our latest products.', 'SECOND')
        `, { transaction });
        console.log('Default templates created successfully');
      }

      // Commit the transaction
      await transaction.commit();
      console.log('Transaction committed successfully');
      
      // Verify the new table structure
      const [columns] = await sequelize.query('PRAGMA table_info(SalesMessageTemplates)');
      console.log('New SalesMessageTemplates columns:');
      columns.forEach(column => {
        console.log(`- ${column.name} (${column.type})`);
      });
      
      // Verify the data
      const [newTemplates] = await sequelize.query('SELECT * FROM SalesMessageTemplates');
      console.log('\nTemplates in the database:');
      newTemplates.forEach(template => {
        console.log(`- ID: ${template.id}, Type: ${template.messageType}, Content: ${template.content.substring(0, 40)}...`);
      });
      
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