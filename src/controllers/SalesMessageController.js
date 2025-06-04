const { sequelize, models, isDatabaseInitialized } = require('../database/db');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const whatsAppService = require('../services/WhatsAppService');

const SalesContact = models.SalesContact;
const SalesMessageSettings = models.SalesMessageSettings;
const SalesMessageTemplate = models.SalesMessageTemplate;
const SalesScheduledMessage = models.SalesScheduledMessage;

/**
 * SalesMessageController handles all sales message related operations
 */
class SalesMessageController {
  constructor() {
    this.isProcessingMessages = false;
    this.schedulerInterval = null;
  }

  /**
   * Check if database is initialized
   * @private
   * @throws {Error} - If database is not initialized
   */
  _checkDatabaseInitialized() {
    if (!isDatabaseInitialized()) {
      throw new Error('Database is not initialized. Please wait for database initialization to complete.');
    }
  }

  /**
   * Get sales message settings
   * @returns {Promise<Object>} - Sales message settings
   */
  async getSettings() {
    try {
      this._checkDatabaseInitialized();
      
      // Get the first settings record or create default
      let settings = await SalesMessageSettings.findOne();
      
      if (!settings) {
        console.log('No sales message settings found, creating default settings');
        settings = await SalesMessageSettings.create({
          firstMessageDelay: 7200000, // 2 hours
          secondMessageDelay: 15552000000, // 6 months
          isAutoSchedulingEnabled: false,
          isAutoSendingEnabled: false
        });
      }
      
      // Ensure the boolean properties are properly cast
      const settingsData = settings.dataValues || settings;
      
      // Create a clean object with explicit boolean conversion
      const cleanSettings = {
        id: settingsData.id,
        firstMessageDelay: settingsData.firstMessageDelay || 7200000, // default 2 hours
        secondMessageDelay: settingsData.secondMessageDelay || 15552000000, // default 6 months
        isAutoSchedulingEnabled: Boolean(settingsData.isAutoSchedulingEnabled),
        isAutoSendingEnabled: Boolean(settingsData.isAutoSendingEnabled),
        createdAt: settingsData.createdAt,
        updatedAt: settingsData.updatedAt
      };
      
      console.log('Retrieved sales message settings:', JSON.stringify(cleanSettings));
      
      return cleanSettings;
    } catch (error) {
      console.error('Error getting sales message settings:', error);
      
      // Return default settings in case of error
      return {
        firstMessageDelay: 7200000,
        secondMessageDelay: 15552000000,
        isAutoSchedulingEnabled: false,
        isAutoSendingEnabled: false
      };
    }
  }

  /**
   * Update sales message settings
   * @param {Object} settingsData - New settings data
   * @returns {Promise<Object>} - Updated settings
   */
  async updateSettings(settingsData) {
    try {
      this._checkDatabaseInitialized();
      
      // Validate settings
      if (settingsData.firstMessageDelay !== undefined && 
          (settingsData.firstMessageDelay < 0)) {
        throw new Error('First message delay must be a positive number');
      }
      
      if (settingsData.secondMessageDelay !== undefined && 
          (settingsData.secondMessageDelay < 0)) {
        throw new Error('Second message delay must be a positive number');
      }
      
      // Ensure boolean values are properly parsed
      const isAutoSchedulingEnabled = 
        settingsData.isAutoSchedulingEnabled !== undefined ? 
        Boolean(settingsData.isAutoSchedulingEnabled) : 
        false;
      
      const isAutoSendingEnabled = 
        settingsData.isAutoSendingEnabled !== undefined ? 
        Boolean(settingsData.isAutoSendingEnabled) : 
        false;
      
      console.log('Processed boolean values:', {
        isAutoSchedulingEnabled,
        isAutoSendingEnabled
      });
      
      // Get existing settings
      let settings = await SalesMessageSettings.findOne();
      
      if (!settings) {
        // Create new settings if none exist
        settings = await SalesMessageSettings.create({
          firstMessageDelay: settingsData.firstMessageDelay || 7200000,
          secondMessageDelay: settingsData.secondMessageDelay || 15552000000,
          isAutoSchedulingEnabled: isAutoSchedulingEnabled,
          isAutoSendingEnabled: isAutoSendingEnabled
        });
      } else {
        // Update existing settings
        await settings.update({
          firstMessageDelay: settingsData.firstMessageDelay !== undefined ? settingsData.firstMessageDelay : settings.firstMessageDelay,
          secondMessageDelay: settingsData.secondMessageDelay !== undefined ? settingsData.secondMessageDelay : settings.secondMessageDelay,
          isAutoSchedulingEnabled: settingsData.isAutoSchedulingEnabled !== undefined ? isAutoSchedulingEnabled : settings.isAutoSchedulingEnabled,
          isAutoSendingEnabled: settingsData.isAutoSendingEnabled !== undefined ? isAutoSendingEnabled : settings.isAutoSendingEnabled
        });
      }
      
      // Reload the settings to ensure we have the latest values
      settings = await SalesMessageSettings.findOne();
      
      return settings;
    } catch (error) {
      console.error('Error updating sales message settings:', error);
      throw error;
    }
  }

  /**
   * Get all sales message templates
   * @returns {Promise<Array>} - Array of templates
   */
  async getTemplates() {
    try {
      this._checkDatabaseInitialized();
      
      const templates = await SalesMessageTemplate.findAll();
      
      return templates;
    } catch (error) {
      console.error('Error getting sales message templates:', error);
      throw error;
    }
  }

  /**
   * Get a sales message template by ID
   * @param {number} id - Template ID
   * @returns {Promise<Object>} - Template
   */
  async getTemplateById(id) {
    try {
      this._checkDatabaseInitialized();
      
      const template = await SalesMessageTemplate.findByPk(id);
      if (!template) {
        return { success: false, error: `Template with ID ${id} not found` };
      }
      
      return { success: true, template };
    } catch (error) {
      console.error(`Error getting template with ID ${id}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save an image file for a template
   * @param {string} type - First or second message
   * @param {Buffer|string} imageData - Image data or path
   * @returns {Promise<string>} - Path to saved image
   */
  async saveImage(type, imageData) {
    try {
      if (!imageData) return null;
      
      // Create directory if it doesn't exist
      const desktopPath = require('electron').app.getPath('desktop');
      const imageDir = path.join(desktopPath, 'bss-sender-db', 'sales-images');
      
      if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
      }
      
      // Generate unique filename
      const timestamp = Date.now();
      const filename = `sales_${type.toLowerCase()}_${timestamp}.jpg`;
      const imagePath = path.join(imageDir, filename);
      
      // If imageData is a string (path), copy the file
      if (typeof imageData === 'string') {
        fs.copyFileSync(imageData, imagePath);
      } else {
        // Otherwise write the buffer to a file
        fs.writeFileSync(imagePath, imageData);
      }
      
      return imagePath;
    } catch (error) {
      console.error('Error saving image:', error);
      return null;
    }
  }

  /**
   * Update sales message template
   * @param {string} type - FIRST or SECOND
   * @param {Object} templateData - Template data
   * @returns {Promise<Object>} - Result
   */
  async updateTemplate(type, templateData) {
    try {
      this._checkDatabaseInitialized();
      
      if (!type || !['FIRST', 'SECOND'].includes(type)) {
        return { success: false, error: 'Invalid template type' };
      }
      
      if (!templateData.content) {
        return { success: false, error: 'Template content is required' };
      }
      
      // Find existing template
      let template = await SalesMessageTemplate.findOne({
        where: { messageType: type }
      });
      
      let imagePath = null;
      
      // Save image if provided
      if (templateData.imagePath) {
        imagePath = await this.saveImage(type, templateData.imagePath);
      }
      
      if (!template) {
        // Create new template if none exists
        console.log(`Creating new ${type} template:`, templateData.content);
        template = await SalesMessageTemplate.create({
          content: templateData.content,
          imagePath: imagePath || null,
          messageType: type
        });
      } else {
        // Update existing template
        const updateData = {
          content: templateData.content
        };
        
        // Only update image path if a new image was provided
        if (imagePath) {
          // Delete old image if it exists
          if (template.imagePath && fs.existsSync(template.imagePath)) {
            try {
              fs.unlinkSync(template.imagePath);
              console.log(`Deleted old image: ${template.imagePath}`);
            } catch (error) {
              console.error(`Failed to delete old image: ${template.imagePath}`, error);
            }
          }
          
          updateData.imagePath = imagePath;
        } else if (templateData.imagePath === null) {
          // If imagePath is explicitly set to null, remove the image
          if (template.imagePath && fs.existsSync(template.imagePath)) {
            try {
              fs.unlinkSync(template.imagePath);
              console.log(`Deleted old image: ${template.imagePath}`);
            } catch (error) {
              console.error(`Failed to delete old image: ${template.imagePath}`, error);
            }
          }
          
          updateData.imagePath = null;
        }
        
        console.log(`Updating ${type} template to:`, updateData.content);
        await template.update(updateData);
        
        // Reload template to ensure we have the latest data
        template = await SalesMessageTemplate.findOne({
          where: { messageType: type }
        });
      }
      
      // Return the full template object with the fresh content
      const result = {
        success: true,
        template: {
          id: template.id,
          content: template.content,
          imagePath: template.imagePath,
          messageType: template.messageType,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt
        }
      };
      
      console.log(`Template saved and returning:`, result);
      return result;
    } catch (error) {
      console.error('Error updating sales message template:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Schedule a message for a sales contact
   * @param {Object} salesContact - Sales contact to send message to
   * @param {string} messageType - FIRST or SECOND
   * @returns {Promise<Object>} - Result
   */
  async scheduleMessage(salesContact, messageType) {
    try {
      this._checkDatabaseInitialized();
      
      if (!salesContact || !salesContact.id) {
        return { success: false, error: 'Invalid sales contact' };
      }
      
      if (!messageType || !['FIRST', 'SECOND'].includes(messageType)) {
        return { success: false, error: 'Invalid message type' };
      }
      
      // Get template for message type
      const template = await SalesMessageTemplate.findOne({
        where: { messageType }
      });
      
      if (!template) {
        console.log(`[scheduleMessage] No template found for ${messageType} message type`);
        return { 
          success: false, 
          error: `No template found for ${messageType} message type` 
        };
      }
      
      // Get settings
      const settings = await this.getSettings();
      console.log(`[scheduleMessage] Settings loaded: firstDelay=${settings.firstMessageDelay}ms, secondDelay=${settings.secondMessageDelay}ms`);
      
      // Calculate scheduled time based on message type
      const now = new Date();
      let scheduledTime;
      let delay = 0;
      
      if (messageType === 'FIRST') {
        delay = settings.firstMessageDelay || 7200000; // Default to 2 hours if not set
        scheduledTime = new Date(now.getTime() + delay);
        console.log(`[scheduleMessage] First message delay: ${delay}ms, scheduled for: ${scheduledTime}`);
      } else {
        delay = settings.secondMessageDelay || 15552000000; // Default to 6 months if not set
        scheduledTime = new Date(now.getTime() + delay);
        console.log(`[scheduleMessage] Second message delay: ${delay}ms, scheduled for: ${scheduledTime}`);
      }
      
      // Check if a message already exists for this contact and type
      const existingMessage = await SalesScheduledMessage.findOne({
        where: {
          SalesContactId: salesContact.id,
          messageSequence: messageType
        }
      });
      
      if (existingMessage) {
        console.log(`[scheduleMessage] A ${messageType} message is already scheduled for contact ${salesContact.id} (${salesContact.name})`);
        return { 
          success: false, 
          error: `A ${messageType} message is already scheduled for this contact`,
          existingMessage 
        };
      }
      
      // Create the message
      const message = await SalesScheduledMessage.create({
        status: 'SCHEDULED',
        scheduledTime,
        contentSnapshot: template.content,
        imagePathSnapshot: template.imagePath,
        messageSequence: messageType,
        SalesContactId: salesContact.id,
        SalesMessageTemplateId: template.id
      });
      
      console.log(`[scheduleMessage] Created ${messageType} message ${message.id} for ${salesContact.name}, scheduled for ${scheduledTime}`);
      
      return { success: true, message };
    } catch (error) {
      console.error(`[scheduleMessage] Error scheduling ${messageType} message:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle a new sales contact - schedule messages if auto-scheduling is enabled
   * @param {Object} salesContact - Newly arrived sales contact
   * @returns {Promise<Object>} - Result
   */
  async handleNewSalesContact(salesContact) {
    try {
      this._checkDatabaseInitialized();
      
      const settings = await this.getSettings();
      
      console.log(`[SalesMessageController] Handling new contact: ${salesContact.name} (${salesContact.phoneNumber})`);
      console.log(`[SalesMessageController] Auto-scheduling enabled: ${settings.isAutoSchedulingEnabled}`);
      
      // If auto-scheduling is not enabled, do nothing
      if (!settings.isAutoSchedulingEnabled) {
        console.log(`[SalesMessageController] Auto-scheduling is disabled, no messages scheduled`);
        return { 
          success: true, 
          message: 'Auto-scheduling is disabled, no messages scheduled',
          scheduled: false 
        };
      }
      
      // Schedule the first message
      console.log(`[SalesMessageController] Scheduling FIRST message with delay: ${settings.firstMessageDelay}ms`);
      const firstResult = await this.scheduleMessage(salesContact, 'FIRST');
      
      if (firstResult.success) {
        console.log(`[SalesMessageController] FIRST message scheduled successfully for ${new Date(firstResult.message.scheduledTime)}`);
      } else {
        console.log(`[SalesMessageController] Failed to schedule FIRST message: ${firstResult.error}`);
      }
      
      // Schedule the second message
      console.log(`[SalesMessageController] Scheduling SECOND message with delay: ${settings.secondMessageDelay}ms`);
      const secondResult = await this.scheduleMessage(salesContact, 'SECOND');
      
      if (secondResult.success) {
        console.log(`[SalesMessageController] SECOND message scheduled successfully for ${new Date(secondResult.message.scheduledTime)}`);
      } else {
        console.log(`[SalesMessageController] Failed to schedule SECOND message: ${secondResult.error}`);
      }
      
      return {
        success: true,
        firstMessage: firstResult.success ? firstResult.message : null,
        secondMessage: secondResult.success ? secondResult.message : null,
        scheduled: firstResult.success || secondResult.success
      };
    } catch (error) {
      console.error('Error handling new sales contact:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get scheduled messages (paginated)
   * @param {number} page - Page number
   * @param {number} limit - Number of items per page
   * @param {string} status - Status filter (optional)
   * @returns {Promise<Object>} - Paginated messages
   */
  async getScheduledMessages(page = 1, limit = 20, status = null) {
    try {
      this._checkDatabaseInitialized();
      
      console.log(`Getting scheduled sales messages - Page: ${page}, Limit: ${limit}, Status: ${status || 'All'}`);
      
      // Build the query
      const query = {
        include: [
          { 
            model: SalesContact,
            required: true // Use inner join to ensure contacts exist
          },
          { 
            model: SalesMessageTemplate,
            required: false // Use left join as template might be deleted
          }
        ],
        order: [
          ['status', 'ASC'], // SCHEDULED first, then PENDING, then SENT
          ['scheduledTime', 'ASC'] // Earliest scheduled first
        ]
      };
      
      // Add status filter if provided
      if (status) {
        query.where = { status };
      }
      
      // Add pagination
      query.limit = limit;
      query.offset = (page - 1) * limit;
      
      // Get total count with the same filters
      const count = await SalesScheduledMessage.count(
        status ? { where: { status } } : {}
      );
      
      // Get paginated data
      const messages = await SalesScheduledMessage.findAll(query);
      console.log(`Found ${messages.length} scheduled messages (total: ${count})`);
      
      // Return detailed data including pagination
      return {
        messages: messages.map(message => {
          // Get formatted data for the message
          const data = message.toJSON();
          
          // Add additional context for easier frontend display
          if (data.SalesContact) {
            data.contactName = data.SalesContact.name;
            data.contactPhone = data.SalesContact.phoneNumber;
          }
          
          return data;
        }),
        pagination: {
          total: count,
          pages: Math.ceil(count / limit),
          currentPage: page,
          limit
        }
      };
    } catch (error) {
      console.error('Error getting scheduled sales messages:', error);
      throw error;
    }
  }

  /**
   * Delete scheduled messages
   * @param {Array} ids - Array of message IDs to delete
   * @returns {Promise<Object>} - Result
   */
  async deleteMessages(ids) {
    try {
      this._checkDatabaseInitialized();
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return { 
          success: false, 
          error: 'No valid message IDs provided' 
        };
      }
      
      // Delete messages
      const result = await SalesScheduledMessage.destroy({
        where: {
          id: {
            [Op.in]: ids
          }
        }
      });
      
      return {
        success: true,
        deleted: result,
        message: `Successfully deleted ${result} message(s)`
      };
    } catch (error) {
      console.error('Error deleting sales messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process scheduled sales messages
   * @returns {Promise<Object>} - Processing result
   */
  async processPendingMessages() {
    // Simple implementation for now - can be expanded later
    if (this.isProcessingMessages) {
      return { processed: 0, reason: 'Already processing messages' };
    }
    
    this.isProcessingMessages = true;
    
    try {
      this._checkDatabaseInitialized();
      
      // Get settings
      const settings = await this.getSettings();
      console.log('Auto-sending enabled:', settings.isAutoSendingEnabled);
      
      // Check if auto-sending is enabled
      if (!settings.isAutoSendingEnabled) {
        console.log('Auto-sending is disabled in settings, no messages will be sent');
        this.isProcessingMessages = false;
        return { processed: 0, reason: 'Auto-sending is disabled' };
      }
      
      // Check WhatsApp connection
      const whatsAppStatus = whatsAppService.getStatus();
      if (!whatsAppStatus.isConnected) {
        console.error('CRITICAL: WhatsApp is not connected, cannot send messages. Please connect WhatsApp first.');
        this.isProcessingMessages = false;
        return { processed: 0, reason: 'WhatsApp not connected' };
      }
      
      // Update scheduled messages to pending if their time has come
      const updatedCount = await SalesScheduledMessage.update(
        { status: 'PENDING' },
        {
          where: {
            status: 'SCHEDULED',
            scheduledTime: {
              [Op.lte]: new Date()
            }
          }
        }
      );
      
      console.log(`Updated ${updatedCount} scheduled sales messages to PENDING`);
      
      // Get all pending messages to process (limited to 5 at a time)
      const pendingMessages = await SalesScheduledMessage.findAll({
        where: {
          status: 'PENDING'
        },
        include: [
          { model: SalesContact },
          { model: SalesMessageTemplate }
        ],
        order: [['scheduledTime', 'ASC']],
        limit: 5
      });
      
      if (!pendingMessages || pendingMessages.length === 0) {
        console.log('No pending messages found to process');
        this.isProcessingMessages = false;
        return { processed: 0, reason: 'No pending messages' };
      }
      
      console.log(`Processing ${pendingMessages.length} pending messages`);
      
      // Process each message in sequence
      let processedCount = 0;
      let errors = 0;
      
      for (const pendingMessage of pendingMessages) {
        try {
          // Update status to SENDING
          await pendingMessage.update({ status: 'SENDING' });
          
          // Get contact data
          const contact = pendingMessage.SalesContact;
          if (!contact || !contact.phoneNumber) {
            throw new Error('Contact information missing');
          }
          
          // Use snapshot content and personalize it
          // Check for both snapshot and template content
          let content = pendingMessage.contentSnapshot || '';
          
          // If snapshot is empty, try to get content from the linked template
          if (!content && pendingMessage.SalesMessageTemplate) {
            content = pendingMessage.SalesMessageTemplate.content || '';
          }
          
          if (!content) {
            throw new Error('Message content is missing');
          }
          
          // Get image path - check both snapshot and template
          let imagePath = pendingMessage.imagePathSnapshot;
          
          // If snapshot image is not available, try to get from the linked template
          if (!imagePath && pendingMessage.SalesMessageTemplate) {
            imagePath = pendingMessage.SalesMessageTemplate.imagePath;
          }
          
          // Personalize content with contact data
          if (content && contact) {
            content = this.personalizeContent(content, contact);
          }
          
          console.log(`Sending sales message to ${contact.phoneNumber}: ${content.substring(0, 50)}...`);
          
          // Send message
          let result;
          if (imagePath && fs.existsSync(imagePath)) {
            console.log(`Including image: ${imagePath}`);
            result = await whatsAppService.sendImageMessage(contact.phoneNumber, imagePath, content);
          } else {
            result = await whatsAppService.sendTextMessage(contact.phoneNumber, content);
          }
          
          // Update message status
          await pendingMessage.update({
            status: 'SENT',
            externalId: result.id || null,
            sentTime: new Date()
          });
          
          console.log(`Successfully sent sales message ${pendingMessage.id} to ${contact.name} (${contact.phoneNumber})`);
          processedCount++;
          
          // Pause for 2 seconds between messages to avoid flooding
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error) {
          console.error(`Error sending sales message ${pendingMessage.id}:`, error);
          
          // Mark as failed
          await pendingMessage.update({
            status: 'FAILED',
            failureReason: error.message
          });
          
          errors++;
        }
      }
      
      console.log(`Finished processing messages: ${processedCount} sent, ${errors} failed`);
      
      return { 
        processed: processedCount,
        errors: errors,
        total: pendingMessages.length
      };
    } catch (error) {
      console.error('Error processing pending sales messages:', error);
      return { processed: 0, error: error.message };
    } finally {
      this.isProcessingMessages = false;
    }
  }

  /**
   * Resume processing of any pending sales messages after app restart
   * @returns {Promise<number>} - Number of messages resumed
   */
  async resumePendingMessages() {
    try {
      this._checkDatabaseInitialized();
      
      // Find any messages stuck in SENDING state and mark them as PENDING
      const sendingMessages = await SalesScheduledMessage.findAll({
        where: {
          status: 'SENDING'
        },
        include: [
          { model: SalesContact }
        ]
      });
      
      if (sendingMessages.length > 0) {
        console.log(`Found ${sendingMessages.length} sales messages stuck in SENDING state`);
        
        // Process each message individually to update properly
        for (const message of sendingMessages) {
          await message.update({
            status: 'PENDING',
            failureReason: `Application restarted during send process`
          });
          
          const contactInfo = message.SalesContact ? message.SalesContact.phoneNumber : 'Unknown';
          console.log(`Resumed sales message ${message.id} to ${contactInfo} for retry`);
        }
        
        console.log(`Resumed ${sendingMessages.length} sales messages that were interrupted by app shutdown`);
      }
      
      // Also check for any messages that should have been sent already but are still in SCHEDULED state
      const overdueMessages = await SalesScheduledMessage.update(
        {
          status: 'PENDING',
          failureReason: 'Message was overdue but still in SCHEDULED state'
        },
        {
          where: {
            status: 'SCHEDULED',
            scheduledTime: {
              [Op.lt]: new Date()
            }
          }
        }
      );
      
      const overdueCount = overdueMessages[0];
      if (overdueCount > 0) {
        console.log(`Updated ${overdueCount} overdue sales messages to PENDING status`);
      }
      
      return sendingMessages.length + overdueCount;
    } catch (error) {
      console.error('Error resuming pending sales messages:', error);
      return 0;
    }
  }
  
  /**
   * Start the sales message scheduler
   * @returns {Promise<boolean>} - Success status
   */
  async startScheduler() {
    try {
      // Stop any existing scheduler first
      this.stopScheduler();
      
      // First try to resume any pending messages from previous sessions
      await this.resumePendingMessages();
      
      console.log('Sales message scheduler started successfully');
      
      // Run immediately on start
      setTimeout(async () => {
        try {
          console.log('Running initial sales message check...');
          const result = await this.processPendingMessages();
          console.log('Initial sales message check result:', result);
        } catch (error) {
          console.error('Error in initial sales message check:', error);
        }
      }, 3000);
      
      // Set up interval to check for messages every 10 seconds
      this.schedulerInterval = setInterval(async () => {
        try {
          const result = await this.processPendingMessages();
          
          // Only log if something was processed or failed
          if (result.processed > 0 || result.errors > 0) {
            console.log('Scheduled sales message check result:', result);
          }
        } catch (error) {
          console.error('Error in sales message scheduler:', error);
        }
      }, 10000); // Check every 10 seconds (reduced from 30 seconds)
      
      return true;
    } catch (error) {
      console.error('Error starting sales message scheduler:', error);
      return false;
    }
  }
  
  /**
   * Stop the sales message scheduler
   * @returns {boolean} - Success status
   */
  stopScheduler() {
    try {
      if (this.schedulerInterval) {
        clearInterval(this.schedulerInterval);
        this.schedulerInterval = null;
        console.log('Sales message scheduler stopped successfully');
      }
      
      return true;
    } catch (error) {
      console.error('Error stopping sales message scheduler:', error);
      return false;
    }
  }

  /**
   * Personalize message content with contact details
   * @param {string} content - Template content
   * @param {Object} contact - Contact data
   * @returns {string} - Personalized content
   */
  personalizeContent(content, contact) {
    if (!content) return '';
    if (!contact) return content;
    
    try {
      let personalized = content;
      
      // Replace variables with contact fields
      const fields = {
        '{name}': contact.name || '',
        '{phone}': contact.phoneNumber || '',
        '{code}': contact.code || '',
        '{city}': contact.city || '',
        '{documentNumber}': contact.documentNumber || ''
      };
      
      // Perform replacements
      Object.keys(fields).forEach(key => {
        personalized = personalized.replace(new RegExp(key, 'g'), fields[key]);
      });
      
      return personalized;
    } catch (error) {
      console.error('Error personalizing content:', error);
      return content;
    }
  }
}

// Export singleton instance
const salesMessageController = new SalesMessageController();
module.exports = salesMessageController; 