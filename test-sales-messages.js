const { sequelize, models, initDatabase } = require('./src/database/db');
const salesMessageController = require('./src/controllers/SalesMessageController');
const salesApiController = require('./src/controllers/SalesApiController');
const whatsAppService = require('./src/services/WhatsAppService');

async function testSalesMessages() {
  try {
    console.log('Initializing database...');
    await initDatabase();
    
    // Set small delays for testing
    console.log('Setting small message delays for testing...');
    const settings = await salesMessageController.updateSettings({
      firstMessageDelay: 10000, // 10 seconds
      secondMessageDelay: 20000, // 20 seconds
      isAutoSchedulingEnabled: true,
      isAutoSendingEnabled: true
    });
    
    console.log('Updated settings:', settings);
    
    // Get a contact for testing
    const SalesContact = models.SalesContact;
    const contacts = await SalesContact.findAll({ limit: 1 });
    
    if (!contacts || contacts.length === 0) {
      console.error('No sales contacts found. Please add a contact first.');
      process.exit(1);
    }
    
    const contact = contacts[0];
    console.log(`Using test contact: ${contact.name} (${contact.phoneNumber})`);
    
    // Schedule test messages
    console.log('Scheduling test messages...');
    const firstResult = await salesMessageController.scheduleMessage(contact, 'FIRST');
    
    if (firstResult.success) {
      console.log(`First message scheduled for ${new Date(firstResult.message.scheduledTime)}`);
    } else {
      console.error('Failed to schedule first message:', firstResult.error);
    }
    
    const secondResult = await salesMessageController.scheduleMessage(contact, 'SECOND');
    
    if (secondResult.success) {
      console.log(`Second message scheduled for ${new Date(secondResult.message.scheduledTime)}`);
    } else {
      console.error('Failed to schedule second message:', secondResult.error);
    }
    
    // Check WhatsApp connection
    console.log('Checking WhatsApp connection...');
    const whatsAppStatus = whatsAppService.getStatus();
    
    if (!whatsAppStatus.isConnected) {
      console.error('WARNING: WhatsApp is not connected. Messages will not be sent.');
      console.log('Please connect WhatsApp and then run the app normally.');
    } else {
      console.log('WhatsApp is connected. Ready to send messages.');
      console.log('Messages will be automatically processed when their scheduled time arrives.');
    }
    
    console.log('\nTest setup complete! You can now:');
    console.log('1. Start the app normally to see the messages being sent');
    console.log('2. Check the Sales → Messages tab to see your scheduled messages');
    console.log('3. Use the "Process Pending" button to manually process messages');
    
    process.exit(0);
  } catch (error) {
    console.error('Error in test script:', error);
    process.exit(1);
  }
}

testSalesMessages(); 