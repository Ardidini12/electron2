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
      // Check if there are any messages to backup
      const [messages] = await sequelize.query('SELECT * FROM SalesScheduledMessages', { transaction });
      console.log(`Found ${messages.length} scheduled messages to backup`);

      // Backup existing messages
      const backupData = messages.map(message => ({
        id: message.id,
        externalId: message.externalId,
        status: message.status,
        scheduledTime: message.scheduledTime,
        sentTime: message.sentTime,
        deliveredTime: message.deliveredTime,
        readTime: message.readTime,
        messageSequence: message.messageSequence || 'FIRST',
        retryCount: message.retryCount || 0,
        failureReason: message.failureReason,
        contentSnapshot: message.contentSnapshot,
        imagePathSnapshot: message.imagePathSnapshot,
        SalesContactId: message.SalesContactId,
        SalesMessageTemplateId: message.SalesMessageTemplateId,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      }));

      // Drop the existing table
      console.log('Dropping existing SalesScheduledMessages table...');
      await sequelize.query('DROP TABLE IF EXISTS SalesScheduledMessages', { transaction });
      console.log('Table dropped successfully');

      // Create a new table with the correct schema
      console.log('Creating new SalesScheduledMessages table...');
      await sequelize.query(`
        CREATE TABLE SalesScheduledMessages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          externalId VARCHAR(255),
          status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED')),
          scheduledTime DATETIME NOT NULL,
          sentTime DATETIME,
          deliveredTime DATETIME,
          readTime DATETIME,
          messageSequence VARCHAR(10) NOT NULL DEFAULT 'FIRST' CHECK (messageSequence IN ('FIRST', 'SECOND')),
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
      console.log('Table created successfully');

      // Insert backup data if we had any
      if (backupData.length > 0) {
        console.log('Restoring backed up messages...');
        for (const message of backupData) {
          try {
            console.log(`Restoring message ID ${message.id}, status ${message.status}`);
            await sequelize.query(`
              INSERT INTO SalesScheduledMessages (
                id, externalId, status, scheduledTime, sentTime, deliveredTime, readTime, 
                messageSequence, retryCount, failureReason, contentSnapshot, imagePathSnapshot,
                SalesContactId, SalesMessageTemplateId, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, {
              replacements: [
                message.id || null,
                message.externalId || null,
                message.status || 'SCHEDULED',
                message.scheduledTime || new Date(),
                message.sentTime || null,
                message.deliveredTime || null,
                message.readTime || null,
                message.messageSequence || 'FIRST',
                message.retryCount || 0,
                message.failureReason || null,
                message.contentSnapshot || '',
                message.imagePathSnapshot || null,
                message.SalesContactId || 1, // Default to ID 1 if missing
                message.SalesMessageTemplateId || 1, // Default to ID 1 if missing
                message.createdAt || new Date(),
                message.updatedAt || new Date()
              ],
              transaction
            });
          } catch (innerError) {
            console.error(`Error restoring message ID ${message.id}:`, innerError);
            console.log('Will continue with next message');
          }
        }
        console.log('Messages restored successfully');
      }

      // Create indexes for better performance
      console.log('Creating indexes...');
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS sales_scheduled_message_status_idx ON SalesScheduledMessages (status)
      `, { transaction });
      
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS sales_scheduled_message_contact_idx ON SalesScheduledMessages (SalesContactId)
      `, { transaction });
      
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS sales_scheduled_message_scheduled_time_idx ON SalesScheduledMessages (scheduledTime)
      `, { transaction });
      
      console.log('Indexes created successfully');

      // Commit the transaction
      await transaction.commit();
      console.log('Transaction committed successfully');
      
      // Verify the new table structure
      const [columns] = await sequelize.query('PRAGMA table_info(SalesScheduledMessages)');
      console.log('New SalesScheduledMessages columns:');
      columns.forEach(column => {
        console.log(`- ${column.name} (${column.type})`);
      });
      
      // Check if there are any messages in the database
      const [newMessages] = await sequelize.query('SELECT COUNT(*) as count FROM SalesScheduledMessages');
      console.log(`\nThere are ${newMessages[0].count} messages in the database`);
      
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