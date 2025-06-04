const path = require('path');
const os = require('os');
const { Sequelize } = require('sequelize');

const dbPath = path.join(os.homedir(), 'Desktop', 'bss-sender-db', 'database.sqlite');
console.log(`Checking database at: ${dbPath}`);

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});

async function checkDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database successfully');

    // Check SalesMessageTemplates table structure
    const [templateColumns] = await sequelize.query('PRAGMA table_info(SalesMessageTemplates)');
    console.log('SalesMessageTemplates columns:');
    templateColumns.forEach(column => {
      console.log(`- ${column.name} (${column.type})`);
    });

    // Check if the messageType column exists
    const hasMessageType = templateColumns.some(col => col.name === 'messageType');
    console.log(`\nDoes messageType column exist? ${hasMessageType ? 'YES' : 'NO'}`);

    // If the column doesn't exist, add it
    if (!hasMessageType) {
      console.log('\nAdding messageType column to SalesMessageTemplates table...');
      await sequelize.query(`
        ALTER TABLE SalesMessageTemplates 
        ADD COLUMN messageType VARCHAR(10) NOT NULL CHECK (messageType IN ('FIRST', 'SECOND')) DEFAULT 'FIRST'
      `);
      console.log('messageType column added successfully!');
      
      // Update existing records to have proper message types
      console.log('Setting messageType for existing records...');
      await sequelize.query(`
        UPDATE SalesMessageTemplates SET messageType = 'FIRST' WHERE id = 1;
        UPDATE SalesMessageTemplates SET messageType = 'SECOND' WHERE id = 2;
      `);
      console.log('Existing records updated with proper message types');
    }

    // Check the updated structure if we made changes
    if (!hasMessageType) {
      const [updatedColumns] = await sequelize.query('PRAGMA table_info(SalesMessageTemplates)');
      console.log('\nUpdated SalesMessageTemplates columns:');
      updatedColumns.forEach(column => {
        console.log(`- ${column.name} (${column.type})`);
      });
    }

    await sequelize.close();
    console.log('\nDatabase check completed successfully');
  } catch (error) {
    console.error('Error checking database:', error);
  }
}

checkDatabase(); 