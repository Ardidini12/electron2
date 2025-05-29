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
    
    // New: Track ongoing messages by their IDs for independent processing
    this.processingMessageIds = new Set();
    
    // New: Store timeouts for interval timing
    this.messageTimeouts = {};
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
   * @param {Date} timestamp - Timestamp of the status change
   * @returns {Promise<boolean>} - Success status
   */
  async updateMessageStatus(externalId, status, timestamp = new Date()) {
    try {
      this._checkDatabaseInitialized();
      
      // Always log status updates for debugging
      console.log(`[STATUS UPDATE] MessageController: Updating message ${externalId} to status ${status} at ${timestamp.toISOString()}`);
      
      const message = await Message.findOne({
        where: { externalId }
      });
      
      if (!message) {
        console.error(`Message with external ID ${externalId} not found`);
        return false;
      }
      
      // Always update status and timestamps, even if the new status is the same or lower
      // This is for debugging and reliability
      const updateData = { 
        status,
        updatedAt: timestamp 
      };
      
      if (status === 'DELIVERED') {
        updateData.deliveredTime = timestamp;
        console.log(`Setting deliveredTime for message ${externalId} to ${timestamp.toISOString()}`);
      } else if (status === 'READ') {
        updateData.readTime = timestamp;
        console.log(`Setting readTime for message ${externalId} to ${timestamp.toISOString()}`);
      } else if (status === 'SENT' && !message.sentTime) {
        updateData.sentTime = timestamp;
        console.log(`Setting sentTime for message ${externalId} to ${timestamp.toISOString()}`);
      }
      
      // Log and update the message
      console.log(`Updating message ${externalId} status to ${status} with data:`, updateData);
      await message.update(updateData);
      
      // Send immediate notification to any connected UI
      try {
        const { app } = require('electron');
        const mainWindow = require('electron').BrowserWindow.getAllWindows()[0];
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('message-status-update', {
            id: message.id,
            externalId: message.externalId,
            status: status,
            timestamp: timestamp,
            deliveredTime: status === 'DELIVERED' ? timestamp : message.deliveredTime,
            readTime: status === 'READ' ? timestamp : message.readTime,
            sentTime: status === 'SENT' ? timestamp : message.sentTime
          });
        }
      } catch (notificationError) {
        console.error('Error sending UI notification:', notificationError);
      }
      
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
        return { processed: 0, reason: 'Current time is outside allowed time range' };
      }
      
      // Check if today is an allowed day
      if (!this.isAllowedDay(settings)) {
        return { processed: 0, reason: 'Current day is not allowed for sending' };
      }
      
      // Check WhatsApp connection
      const whatsAppStatus = whatsAppService.getStatus();
      if (!whatsAppStatus.isConnected) {
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
          return { processed: 0, reason: 'WhatsApp not connected' };
        }
      }
      
      // Update scheduled messages to pending if their time has come
      const updatedCount = await this.updateScheduledToPending();
      if (updatedCount > 0) {
        console.log(`Updated ${updatedCount} scheduled messages to pending status`);
      }
      
      // New: Get pending messages up to a reasonable batch size
      const pendingMessages = await Message.findAll({
        where: {
          status: 'PENDING',
          scheduledTime: {
            [Op.lte]: new Date()
          },
          id: {
            // Exclude messages that are already being processed
            [Op.notIn]: Array.from(this.processingMessageIds)
          }
        },
        include: [
          { model: Contact },
          { model: Template }
        ],
        order: [['scheduledTime', 'ASC']],
        limit: 10 // Process up to 10 messages at a time
      });
      
      if (pendingMessages.length === 0) {
        return { processed: 0, reason: 'No pending messages' };
      }
      
      // Process each message independently with proper interval timing
      const processedIds = [];
      
      // Process the first message immediately
      const firstMessage = pendingMessages[0];
      await this.processMessage(firstMessage);
      processedIds.push(firstMessage.id);
      
      // Schedule the rest with proper intervals
      if (pendingMessages.length > 1) {
        const messageInterval = settings.messageInterval || 45;
        
        // Reduced logging - only log once
        if (pendingMessages.length > 1) {
          console.log(`Scheduling ${pendingMessages.length - 1} messages with ${messageInterval}s intervals`);
        }
        
        for (let i = 1; i < pendingMessages.length; i++) {
          const message = pendingMessages[i];
          const delay = i * messageInterval * 1000;
          
          // Add to processing set to prevent double-processing
          this.processingMessageIds.add(message.id);
          
          // Clear any existing timeout for this message
          if (this.messageTimeouts[message.id]) {
            clearTimeout(this.messageTimeouts[message.id]);
          }
          
          // Schedule with timeout
          this.messageTimeouts[message.id] = setTimeout(async () => {
            try {
              await this.processMessage(message);
              processedIds.push(message.id);
            } catch (error) {
              console.error(`Error processing delayed message ${message.id}:`, error);
            } finally {
              // Remove from processing set when done
              this.processingMessageIds.delete(message.id);
              // Clear the timeout reference
              delete this.messageTimeouts[message.id];
            }
          }, delay);
        }
      }
      
      return { 
        processed: 1, 
        scheduled: pendingMessages.length - 1,
        messageIds: processedIds 
      };
    } catch (error) {
      console.error('Error processing pending messages:', error);
      return { processed: 0, error: error.message };
    } finally {
      this.isProcessingMessages = false;
    }
  }
  
  /**
   * Process a single message
   * @param {Object} message - The message model to process
   * @returns {Promise<boolean>} - Success status
   */
  async processMessage(message) {
    // Add to processing set
    this.processingMessageIds.add(message.id);
    
    try {
      // Less logging - only log essential information
      console.log(`Processing message to ${message.Contact?.phoneNumber || 'Unknown'}`);
      
      // Mark as sending
      await message.update({ status: 'SENDING' });
      
      // Get contact data
      const contact = message.Contact || await Contact.findByPk(message.ContactId);
      if (!contact || !contact.phoneNumber) {
        throw new Error('Contact information missing');
      }
      
      // Use snapshot content and personalize it
      let content = message.contentSnapshot || '';
      const imagePath = message.imagePathSnapshot;
      
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
        result = await whatsAppService.sendImageMessage(contact.phoneNumber, imagePath, content);
      } else {
        result = await whatsAppService.sendTextMessage(contact.phoneNumber, content);
      }
      
      // Update message status
      await message.update({
        status: 'SENT',
        externalId: result.externalId,
        sentTime: new Date()
      });
      
      // Update last message sent time
      this.lastMessageSentTime = new Date();
      
      // Reset consecutive errors counter on success
      this.consecutiveErrors = 0;
      
      // Reduced logging
      return true;
    } catch (error) {
      console.error(`Error sending message ${message.id}:`, error);
      
      // Increment consecutive errors counter
      this.consecutiveErrors++;
      
      // Mark as failed or retry based on error
      const shouldRetry = this.shouldRetryMessage(error);
      
      if (shouldRetry && this.consecutiveErrors < this.MAX_CONSECUTIVE_ERRORS) {
        // Get current retry count and increment it
        const currentRetryCount = message.retryCount || 0;
        const newRetryCount = currentRetryCount + 1;
        
        // Put back to PENDING state for retry
        await message.update({
          status: 'PENDING',
          retryCount: newRetryCount,
          failureReason: `Retry attempt ${newRetryCount}: ${error.message}`
        });
        
        // Only log retry attempts
        console.log(`Message ${message.id} marked for retry (attempt ${newRetryCount})`);
      } else {
        // Mark as permanently failed
        await message.update({
          status: 'FAILED',
          failureReason: error.message
        });
        
        console.log(`Message ${message.id} marked as failed`);
      }
      
      return false;
    } finally {
      // Remove from processing set when done
      this.processingMessageIds.delete(message.id);
    }
  }

  /**
   * Start the message scheduler
   * @returns {Promise<boolean>} - Success status
   */
  async startScheduler() {
    if (this.mainCronJob && this.mainCronJob.running) {
      return true;
    }
    
    try {
      // First try to resume any pending messages from previous sessions
      await this.resumePendingMessages();
      
      // Set up cron job to run every minute
      this.mainCronJob = new cron.CronJob('*/1 * * * *', async () => {
        try {
          // Reduced logging - no need for regular messages
          const result = await this.processPendingMessages();
          
          // Only log if something was processed
          if (result.processed > 0 || result.scheduled > 0) {
            console.log('Scheduled message check result:', result);
          }
        } catch (error) {
          console.error('Error in scheduler cron job:', error);
        }
      });
      
      // Start the job
      this.mainCronJob.start();
      console.log('Message scheduler started successfully');
      
      // Run immediately on start
      setTimeout(async () => {
        try {
          console.log('Running initial message check...');
          const result = await this.processPendingMessages();
          console.log('Initial message check result:', result);
        } catch (error) {
          console.error('Error in initial message check:', error);
        }
      }, 5000);
      
      return true;
    } catch (error) {
      console.error('Error starting scheduler:', error);
      return false;
    }
  }
  
  /**
   * Stop the message scheduler
   * @returns {Promise<boolean>} - Success status
   */
  async stopScheduler() {
    try {
      if (this.mainCronJob) {
        this.mainCronJob.stop();
        console.log('Message scheduler stopped successfully');
      }
      
      // Clear any pending message timeouts
      Object.keys(this.messageTimeouts).forEach(id => {
        clearTimeout(this.messageTimeouts[id]);
        delete this.messageTimeouts[id];
      });
      
      return true;
    } catch (error) {
      console.error('Error stopping scheduler:', error);
      return false;
    }
  }
  
  /**
   * Resume processing of any pending messages after app restart
   * @returns {Promise<number>} - Number of messages resumed
   */
  async resumePendingMessages() {
    try {
      this._checkDatabaseInitialized();
      
      // Find any messages stuck in SENDING state and mark them as PENDING
      const sendingMessages = await Message.findAll({
        where: {
          status: 'SENDING'
        },
        include: [
          { model: Contact }
        ]
      });
      
      if (sendingMessages.length > 0) {
        console.log(`Found ${sendingMessages.length} messages stuck in SENDING state`);
        
        // Process each message individually to update properly
        for (const message of sendingMessages) {
          const currentRetryCount = message.retryCount || 0;
          const newRetryCount = currentRetryCount + 1;
          
          await message.update({
            status: 'PENDING',
            retryCount: newRetryCount,
            failureReason: `Application restarted during send process (attempt ${newRetryCount})`
          });
          
          const contactInfo = message.Contact ? message.Contact.phoneNumber : 'Unknown';
          console.log(`Resumed message ${message.id} to ${contactInfo} for retry`);
        }
        
        console.log(`Resumed ${sendingMessages.length} messages that were interrupted by app shutdown`);
      }
      
      // Also check for any messages that should have been sent already but are still in SCHEDULED state
      const overdueMessages = await Message.update(
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
        console.log(`Updated ${overdueCount} overdue messages to PENDING status`);
      }
      
      return sendingMessages.length + overdueCount;
    } catch (error) {
      console.error('Error resuming pending messages:', error);
      return 0;
    }
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
      
      // Increment retry count
      const currentRetryCount = message.retryCount || 0;
      const newRetryCount = currentRetryCount + 1;
      
      // Update status to PENDING to allow scheduler to pick it up
      await message.update({ 
        status: 'PENDING',
        retryCount: newRetryCount,
        failureReason: `Manual retry initiated at ${new Date().toISOString()} (attempt ${newRetryCount})`
      });
      
      // Make sure scheduler is running
      this.startScheduler();
      
      return { 
        success: true, 
        message: `Message ${id} has been queued for retry (attempt ${newRetryCount})` 
      };
    } catch (error) {
      console.error(`Error retrying message ${id}:`, error);
      return { success: false, error: error.message };
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
   * Delete messages by ID
   * @param {Array} ids - Array of message IDs to delete
   * @returns {Promise<Object>} - Result of deletion
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
      
      // Convert all IDs to numbers
      const numericIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
      
      if (numericIds.length === 0) {
        return { 
          success: false, 
          error: 'No valid message IDs provided' 
        };
      }
      
      // Delete messages
      const result = await Message.destroy({
        where: {
          id: {
            [Op.in]: numericIds
          }
        }
      });
      
      return {
        success: true,
        deleted: result,
        message: `Successfully deleted ${result} message(s)`
      };
    } catch (error) {
      console.error('Error deleting messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
const messageController = new MessageController();
module.exports = messageController; 