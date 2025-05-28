const { sequelize, models, isDatabaseInitialized } = require('../database/db');
const { Op } = require('sequelize');
const path = require('path');
const cron = require('cron');
const whatsAppService = require('../services/WhatsAppService');
const moment = require('moment');
const fs = require('fs');

const Message = models.Message;
const Contact = models.Contact;
const Template = models.Template;
const ScheduleSettings = models.ScheduleSettings;

/**
 * MessageController handles all message-related operations
 */
class MessageController {
  constructor() {
    this.scheduledJobs = {};
    this.mainCronJob = null;
    this.isProcessingMessages = false;
    this.messageQueue = [];
    this.lastMessageSentTime = null;
    this.consecutiveErrors = 0;
    this.MAX_CONSECUTIVE_ERRORS = 5;
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
   * Schedule messages to be sent
   * @param {Object} config - Configuration for scheduling
   * @param {Array} config.contacts - Contacts to send messages to
   * @param {string} config.templateId - Template ID to use
   * @param {string} config.scheduledTime - ISO string of when to schedule the message
   * @returns {Promise<Object>} - Result of scheduling
   */
  async scheduleMessages(config) {
    try {
      this._checkDatabaseInitialized();
      
      console.log('Scheduling messages with config:', config);
      
      // Validate required config
      if (!config.contacts || !Array.isArray(config.contacts) || config.contacts.length === 0) {
        return {
          success: false,
          error: 'No contacts provided for scheduling'
        };
      }
      
      if (!config.templateId) {
        return {
          success: false,
          error: 'Template ID is required'
        };
      }
      
      // Find the template
      const template = await Template.findByPk(config.templateId);
      if (!template) {
        return {
          success: false,
          error: `Template with ID ${config.templateId} not found`
        };
      }
      
      // Create a complete snapshot of the template at scheduling time
      const templateSnapshot = {
        id: template.id,
        content: template.content,
        imagePath: template.imagePath,
        name: template.name
      };
      
      // Parse scheduled time
      let scheduledTime;
      if (config.scheduledTime) {
        scheduledTime = new Date(config.scheduledTime);
        if (isNaN(scheduledTime.getTime())) {
          return {
            success: false,
            error: 'Invalid scheduled time'
          };
        }
      } else {
        // If no scheduled time is provided, use current time
        scheduledTime = new Date();
      }
      
      // Create a message for each contact
      const scheduled = [];
      const failed = [];
      
      // Use a transaction to ensure all messages are created atomically
      await sequelize.transaction(async (transaction) => {
        for (const contact of config.contacts) {
          try {
            // Find the contact by ID
            const contactRecord = await Contact.findByPk(contact.id, { transaction });
            if (!contactRecord) {
              failed.push({
                contact,
                error: `Contact with ID ${contact.id} not found`
              });
              continue;
            }
            
            // Create the message with complete template snapshot
            const message = await Message.create({
              status: 'SCHEDULED',
              scheduledTime,
              contentSnapshot: templateSnapshot.content,
              imagePathSnapshot: templateSnapshot.imagePath,
              templateNameSnapshot: templateSnapshot.name,
              ContactId: contactRecord.id,
              TemplateId: template.id
            }, { transaction });
            
            scheduled.push({
              id: message.id,
              scheduledTime: message.scheduledTime,
              status: message.status
            });
          } catch (error) {
            console.error(`Error scheduling message for contact ${contact.id}:`, error);
            failed.push({
              contact,
              error: error.message
            });
          }
        }
      });
      
      // Ensure the scheduler is running
      this.startScheduler();
      
      // Return results
      return {
        success: true,
        scheduled,
        failed,
        totalContacts: config.contacts.length,
        scheduledCount: scheduled.length,
        failedCount: failed.length
      };
    } catch (error) {
      console.error('Error scheduling messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all scheduled messages
   * @param {string} status - Optional status filter
   * @returns {Promise<Array>} - Array of messages
   */
  async getScheduledMessages(status = null) {
    try {
      this._checkDatabaseInitialized();
      
      const query = {
        include: [
          { model: Contact },
          { model: Template }
        ],
        order: [['scheduledTime', 'ASC']]
      };
      
      if (status) {
        query.where = { status };
      }
      
      // Get messages with associations
      const messages = await Message.findAll(query);
      
      // Convert to plain objects to avoid cloning issues with Sequelize models
      return messages.map(message => {
        const plainMessage = message.toJSON();
        
        // Ensure contact and template are properly serialized
        if (plainMessage.Contact) {
          plainMessage.Contact = message.Contact.toJSON();
        }
        
        if (plainMessage.Template) {
          plainMessage.Template = message.Template.toJSON();
        }
        
        return plainMessage;
      });
    } catch (error) {
      console.error('Error fetching scheduled messages:', error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled message
   * @param {number} id - Message ID to cancel
   * @returns {Promise<Object>} - Result of cancellation
   */
  async cancelScheduledMessage(id) {
    try {
      this._checkDatabaseInitialized();
      
      const message = await Message.findByPk(id);
      if (!message) {
        return { success: false, error: `Message with ID ${id} not found` };
      }
      
      if (message.status !== 'SCHEDULED' && message.status !== 'PENDING') {
        return { 
          success: false, 
          error: `Message is already in ${message.status} status and cannot be canceled` 
        };
      }
      
      await message.update({ status: 'CANCELED' });
      
      return { success: true, message: `Message ${id} has been canceled` };
    } catch (error) {
      console.error(`Error canceling message ${id}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update a message status by its external ID
   * @param {string} externalId - External message ID from WhatsApp
   * @param {string} status - New status
   * @returns {Promise<boolean>} - Success status
   */
  async updateMessageStatus(externalId, status) {
    try {
      this._checkDatabaseInitialized();
      
      const message = await Message.findOne({
        where: { externalId }
      });
      
      if (!message) {
        console.error(`Message with external ID ${externalId} not found`);
        return false;
      }
      
      await message.update({ 
        status,
        updatedAt: new Date() 
      });
      
      console.log(`Updated message ${externalId} status to ${status}`);
      return true;
    } catch (error) {
      console.error(`Error updating status for message with external ID ${externalId}:`, error);
      return false;
    }
  }

  /**
   * Process pending messages
   * @returns {Promise<Object>} - Processing result
   */
  async processPendingMessages() {
    if (this.isProcessingMessages) {
      console.log('Already processing messages, skipping this run');
      return { processed: 0, reason: 'Already processing messages' };
    }
    
    this.isProcessingMessages = true;
    
    try {
      this._checkDatabaseInitialized();
      
      // Get settings
      const settings = await this.getSettings();
      
      // Check if sending is active
      if (!settings.isActive) {
        return { processed: 0, reason: 'Sending is disabled in settings' };
      }
      
      // Check if current time is within allowed time range
      if (!this.isWithinTimeRange(settings)) {
        console.log('Current time is outside allowed time range');
        return { processed: 0, reason: 'Current time is outside allowed time range' };
      }
      
      // Check if today is an allowed day
      if (!this.isAllowedDay(settings)) {
        console.log('Current day is not allowed for sending');
        return { processed: 0, reason: 'Current day is not allowed for sending' };
      }
      
      // Check WhatsApp connection
      const whatsAppStatus = whatsAppService.getStatus();
      if (!whatsAppStatus.isConnected) {
        console.log('WhatsApp not connected, attempting to initialize...');
        
        // Try to initialize WhatsApp if not connected
        try {
          await whatsAppService.initialize();
          // Wait a moment for connection
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (e) {
          console.error('Failed to initialize WhatsApp during message processing:', e);
          return { processed: 0, reason: 'WhatsApp not connected' };
        }
        
        // Check again if connected
        const updatedStatus = whatsAppService.getStatus();
        if (!updatedStatus.isConnected) {
          console.log('WhatsApp still not connected after initialization attempt');
          return { processed: 0, reason: 'WhatsApp not connected' };
        }
      }
      
      // Update scheduled messages to pending if their time has come
      const updatedCount = await this.updateScheduledToPending();
      if (updatedCount > 0) {
        console.log(`Updated ${updatedCount} scheduled messages to pending status`);
      }
      
      // Check if we need to respect the message interval timing
      if (this.lastMessageSentTime) {
        const now = new Date();
        const elapsedSeconds = (now - this.lastMessageSentTime) / 1000;
        const requiredInterval = settings.messageInterval || 45;
        
        if (elapsedSeconds < requiredInterval) {
          console.log(`Not enough time elapsed since last message (${elapsedSeconds.toFixed(1)}s < ${requiredInterval}s)`);
          return { processed: 0, reason: 'Message interval not reached' };
        }
      }
      
      // Get one pending message
      const pendingMessage = await Message.findOne({
        where: {
          status: 'PENDING',
          scheduledTime: {
            [Op.lte]: new Date()
          }
        },
        include: [
          { model: Contact },
          { model: Template }
        ],
        order: [['scheduledTime', 'ASC']]
      });
      
      if (!pendingMessage) {
        return { processed: 0, reason: 'No pending messages' };
      }
      
      console.log(`Processing message ${pendingMessage.id} to ${pendingMessage.Contact?.phoneNumber || 'Unknown'}`);
      
      try {
        // Mark as sending
        await pendingMessage.update({ status: 'SENDING' });
        
        // Get contact data
        const contact = pendingMessage.Contact || await Contact.findByPk(pendingMessage.ContactId);
        if (!contact || !contact.phoneNumber) {
          throw new Error('Contact information missing');
        }
        
        // Use snapshot content and personalize it
        let content = pendingMessage.contentSnapshot || '';
        const imagePath = pendingMessage.imagePathSnapshot;
        
        if (content && contact) {
          content = this.personalizeContent(content, contact);
        }
        
        // Check if imagePath exists (if specified)
        if (imagePath && !fs.existsSync(imagePath)) {
          console.warn(`Image file not found: ${imagePath}, sending as text-only message`);
        }
        
        // Send message
        let result;
        if (imagePath && fs.existsSync(imagePath)) {
          console.log(`Sending image message to ${contact.phoneNumber}`);
          result = await whatsAppService.sendImageMessage(contact.phoneNumber, imagePath, content);
        } else {
          console.log(`Sending text message to ${contact.phoneNumber}`);
          result = await whatsAppService.sendTextMessage(contact.phoneNumber, content);
        }
        
        // Update message status
        await pendingMessage.update({
          status: 'SENT',
          externalId: result.externalId,
          sentTime: new Date()
        });
        
        // Update last message sent time
        this.lastMessageSentTime = new Date();
        
        // Reset consecutive errors counter on success
        this.consecutiveErrors = 0;
        
        console.log(`Message ${pendingMessage.id} sent successfully`);
        return { processed: 1, messageIds: [pendingMessage.id] };
        
      } catch (error) {
        console.error(`Error sending message ${pendingMessage.id}:`, error);
        
        // Increment consecutive errors counter
        this.consecutiveErrors++;
        
        // Mark as failed or retry based on error
        const shouldRetry = this.shouldRetryMessage(error);
        
        if (shouldRetry && this.consecutiveErrors < this.MAX_CONSECUTIVE_ERRORS) {
          // Put back to PENDING state for retry
          await pendingMessage.update({
            status: 'PENDING',
            failureReason: `Retry attempt: ${error.message}`
          });
          
          console.log(`Message ${pendingMessage.id} marked for retry`);
          return { processed: 0, retrying: 1 };
        } else {
          // Mark as permanently failed
        await pendingMessage.update({
          status: 'FAILED',
          failureReason: error.message
        });
        
          console.log(`Message ${pendingMessage.id} marked as failed`);
        return { processed: 0, failed: 1, errors: [error.message] };
        }
      }
      
    } catch (error) {
      console.error('Error processing pending messages:', error);
      return { processed: 0, error: error.message };
    } finally {
      this.isProcessingMessages = false;
    }
  }

  /**
   * Determine if a message should be retried based on the error type
   * @param {Error} error - The error that occurred
   * @returns {boolean} - Whether to retry
   */
  shouldRetryMessage(error) {
    const errorMessage = error.message?.toLowerCase() || '';
    
    // Don't retry if the problem is with the phone number
    if (errorMessage.includes('not registered') || 
        errorMessage.includes('invalid phone')) {
      return false;
    }
    
    // Don't retry if it's a content problem
    if (errorMessage.includes('invalid message') || 
        errorMessage.includes('image file not found')) {
      return false;
    }
    
    // Retry for connection, auth, and other transient errors
    return errorMessage.includes('not connected') || 
           errorMessage.includes('failed to connect') ||
           errorMessage.includes('network') ||
           errorMessage.includes('timeout') ||
           errorMessage.includes('disconnected') ||
           errorMessage.includes('authentication');
  }

  /**
   * Update scheduled messages to pending status
   * @returns {Promise<number>} - Number of messages updated
   */
  async updateScheduledToPending() {
    try {
      this._checkDatabaseInitialized();
      
      const result = await Message.update(
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
      
      return result[0]; // Number of rows affected
    } catch (error) {
      console.error('Error updating scheduled messages to pending:', error);
      throw error;
    }
  }

  /**
   * Start the message scheduler
   * @returns {Promise<void>}
   */
  async startScheduler() {
    try {
      // If main cron job is already running, stop it first
      if (this.mainCronJob) {
        console.log('Stopping existing scheduler before restarting');
        this.stopScheduler();
      }
      
      // Get settings - always fetch fresh settings from the database
      const settings = await this.getSettings();
      
      // Create main cron job that runs every X seconds
      const interval = settings.messageInterval || 45; // Default to 45 seconds
      
      console.log(`Starting scheduler with interval of ${interval} seconds and active status: ${settings.isActive}`);
      console.log(`Active days: ${JSON.stringify(settings.activeDays)}, Time range: ${settings.startTime}-${settings.endTime}`);
      
      this.mainCronJob = new cron.CronJob(
        `*/${interval} * * * * *`, // Run every X seconds
        async () => {
          try {
            console.log(`Scheduler running at ${new Date().toISOString()} with interval ${interval}s`);
            const result = await this.processPendingMessages();
            if (result.processed > 0) {
              console.log(`Successfully processed ${result.processed} message(s)`);
            } else if (result.reason) {
              console.log(`No messages processed: ${result.reason}`);
            }
          } catch (error) {
            console.error('Error in scheduler job:', error);
          }
        },
        null, // onComplete
        true, // start
        'UTC' // timezone
      );
      
      console.log(`Message scheduler started with ${interval} second interval`);
      return { success: true, interval };
    } catch (error) {
      console.error('Error starting scheduler:', error);
      throw error;
    }
  }

  /**
   * Stop the message scheduler
   * @returns {void}
   */
  stopScheduler() {
    if (this.mainCronJob) {
      this.mainCronJob.stop();
      this.mainCronJob = null;
      console.log('Message scheduler stopped');
    }
  }

  /**
   * Get the schedule settings
   * @returns {Promise<Object>} - Schedule settings
   */
  async getSettings() {
    try {
      this._checkDatabaseInitialized();
      
      // Get the first settings record or create default
      let settings = await ScheduleSettings.findOne();
      
      if (!settings) {
        console.log('No schedule settings found, creating default settings');
        settings = await ScheduleSettings.create({
          activeDays: [1, 2, 3, 4, 5], // Mon-Fri
          startTime: 540, // 9:00 AM (in minutes)
          endTime: 1020, // 5:00 PM (in minutes)
          messageInterval: 45, // seconds
          isActive: false
        });
      }
      
      // Ensure the activeDays is properly parsed (sometimes stored as string)
      if (typeof settings.activeDays === 'string') {
        try {
          settings.activeDays = JSON.parse(settings.activeDays);
        } catch (e) {
          console.error('Error parsing activeDays setting:', e);
          settings.activeDays = [1, 2, 3, 4, 5]; // Default to Mon-Fri
        }
      }
      
      // Ensure activeDays is an array
      if (!Array.isArray(settings.activeDays)) {
        console.warn('activeDays setting is not an array, fixing it');
        settings.activeDays = [1, 2, 3, 4, 5]; // Default to Mon-Fri
      }
      
      return settings;
    } catch (error) {
      console.error('Error getting schedule settings:', error);
      
      // Return default settings in case of error
      return {
        activeDays: [1, 2, 3, 4, 5],
        startTime: 540,
        endTime: 1020,
        messageInterval: 45,
        isActive: false
      };
    }
  }

  /**
   * Update schedule settings
   * @param {Object} settingsData - New settings data
   * @returns {Promise<Object>} - Updated settings
   */
  async updateSettings(settingsData) {
    try {
      this._checkDatabaseInitialized();
      
      // Validate settings
      if (settingsData.messageInterval !== undefined && 
          (settingsData.messageInterval < 1 || settingsData.messageInterval > 3600)) {
        throw new Error('Message interval must be between 1 and 3600 seconds');
      }
      
      if (settingsData.startTime !== undefined && 
          (settingsData.startTime < 0 || settingsData.startTime > 1439)) {
        throw new Error('Start time must be between 0 and 1439 minutes');
      }
      
      if (settingsData.endTime !== undefined && 
          (settingsData.endTime < 0 || settingsData.endTime > 1439)) {
        throw new Error('End time must be between 0 and 1439 minutes');
      }
      
      if (settingsData.activeDays !== undefined && !Array.isArray(settingsData.activeDays)) {
        throw new Error('Active days must be an array');
      }
      
      // Get existing settings
      let settings = await ScheduleSettings.findOne();
      
      if (!settings) {
        // Create new settings if none exist
        settings = await ScheduleSettings.create({
          activeDays: settingsData.activeDays || [1, 2, 3, 4, 5],
          startTime: settingsData.startTime || 540,
          endTime: settingsData.endTime || 1020,
          messageInterval: settingsData.messageInterval || 45,
          isActive: settingsData.isActive !== undefined ? settingsData.isActive : false
        });
      } else {
        // Update existing settings with forced persistence
        console.log('Updating settings with:', settingsData);
        
        // First, update all fields directly
        settings.activeDays = settingsData.activeDays !== undefined ? settingsData.activeDays : settings.activeDays;
        settings.startTime = settingsData.startTime !== undefined ? settingsData.startTime : settings.startTime;
        settings.endTime = settingsData.endTime !== undefined ? settingsData.endTime : settings.endTime;
        settings.messageInterval = settingsData.messageInterval !== undefined ? settingsData.messageInterval : settings.messageInterval;
        settings.isActive = settingsData.isActive !== undefined ? settingsData.isActive : settings.isActive;
        
        // Force save to ensure persistence
        await settings.save();
        
        // Reload to verify we have the latest data
        await settings.reload();
        console.log('Settings after save:', settings.toJSON());
      }
      
      // Restart scheduler with new settings
      await this.startScheduler();
      
      return settings;
    } catch (error) {
      console.error('Error updating schedule settings:', error);
      throw error;
    }
  }

  /**
   * Check if current time is within allowed time range
   * @param {Object} settings - Schedule settings
   * @returns {boolean} - Whether current time is allowed
   */
  isWithinTimeRange(settings) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    // If settings aren't valid, default to false
    if (!settings || typeof settings.startTime !== 'number' || typeof settings.endTime !== 'number') {
      return false;
    }
    
    return currentMinutes >= settings.startTime && currentMinutes <= settings.endTime;
  }

  /**
   * Check if today is an allowed day
   * @param {Object} settings - Schedule settings
   * @returns {boolean} - Whether today is allowed
   */
  isAllowedDay(settings) {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // If settings aren't valid, default to false
    if (!settings || !Array.isArray(settings.activeDays)) {
      return false;
    }
    
    return settings.activeDays.includes(dayOfWeek);
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
        '{firstName}': contact.firstName || '',
        '{lastName}': contact.lastName || '',
        '{name}': this.getFullName(contact) || '',
        '{phone}': contact.phoneNumber || '',
        '{email}': contact.email || '',
        '{company}': contact.company || ''
      };
      
      // Custom fields if they exist
      if (contact.customFields) {
        let customFields;
        
        // Parse custom fields if they're stored as a string
        if (typeof contact.customFields === 'string') {
          try {
            customFields = JSON.parse(contact.customFields);
          } catch (e) {
            console.error('Error parsing custom fields:', e);
            customFields = {};
          }
        } else {
          customFields = contact.customFields;
        }
        
        // Add custom fields to replacement
        if (customFields && typeof customFields === 'object') {
          Object.keys(customFields).forEach(key => {
            fields[`{${key}}`] = customFields[key] || '';
          });
        }
      }
      
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

  /**
   * Get full name from contact
   * @param {Object} contact - Contact data
   * @returns {string} - Full name
   */
  getFullName(contact) {
    const firstName = contact.firstName || '';
    const lastName = contact.lastName || '';
    
    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    } else if (firstName) {
      return firstName;
    } else if (lastName) {
      return lastName;
    } else {
      return '';
    }
  }
  
  /**
   * Retry a failed message
   * @param {number} id - Message ID to retry
   * @returns {Promise<Object>} - Result of retry
   */
  async retryMessage(id) {
    try {
      this._checkDatabaseInitialized();
      
      const message = await Message.findByPk(id, {
        include: [{ model: Contact }, { model: Template }]
      });
      
      if (!message) {
        return { success: false, error: `Message with ID ${id} not found` };
      }
      
      if (message.status !== 'FAILED') {
        return { 
          success: false, 
          error: `Message with ID ${id} is not in FAILED status (current: ${message.status})` 
        };
      }
      
      // Check if we have contact info
      if (!message.Contact && !message.ContactId) {
        return { success: false, error: 'Message has no associated contact' };
      }
      
      // Update status to PENDING to allow scheduler to pick it up
      await message.update({ 
        status: 'PENDING',
        failureReason: `Retry initiated at ${new Date().toISOString()}`
      });
      
      // Make sure scheduler is running
      this.startScheduler();
      
      return { 
        success: true, 
        message: `Message ${id} has been queued for retry` 
      };
    } catch (error) {
      console.error(`Error retrying message ${id}:`, error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
const messageController = new MessageController();
module.exports = messageController; 