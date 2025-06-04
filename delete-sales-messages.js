const { sequelize, models, initDatabase } = require('./src/database/db');

async function deleteAllSalesMessages() {
  try {
    console.log('Initializing database...');
    await initDatabase();
    
    const SalesScheduledMessage = models.SalesScheduledMessage;
    
    console.log('Deleting all sales messages...');
    const result = await SalesScheduledMessage.destroy({ where: {} });
    
    console.log(`Successfully deleted ${result} sales messages`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error deleting sales messages:', error);
    process.exit(1);
  }
}

deleteAllSalesMessages(); 