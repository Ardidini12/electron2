const { sequelize, models } = require('../database/db');
const { Op } = require('sequelize');
const path = require('path');
const cron = require('cron');
const whatsAppService = require('../services/WhatsAppService');
const moment = require('moment');

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
  }

  /**
   * Schedule messages for sending
   * @param {Object} config - Schedule configuration
   * @returns {Promise<Object>} - Schedule result
   */
  async scheduleMessages(config) {
    const { contactIds, templateId, scheduleTime, useSettingsSchedule } = config;
    
    try {
      // Get template
      const template = await Template.findByPk(templateId);
      if (!template) {
        throw new Error(`Template with ID ${templateId} not found`);
      }
      
      // Get contacts
      const contacts = await Contact.findAll({
        where: {
          id: {
            [Op.in]: contactIds
          }
        }
      });
      
      if (contacts.length === 0) {
        throw new Error('No valid contacts found');
      }
      
      // Determine schedule time
      let actualScheduleTime;
      
      if (useSettingsSchedule) {
        // Get settings
        const settings = await this.getSettings();
        
        // Set schedule time to current time + message interval (for immediate processing)
        const now = new Date();
        actualScheduleTime = new Date(now.getTime() + (settings.messageInterval * 1000));
      } else {
        // Use provided schedule time
        actualScheduleTime = scheduleTime;
      }
      
      // Create message records
      const messages = [];
      
      for (const contact of contacts) {
        const message = await Message.create({
          status: 'SCHEDULED',
          scheduledTime: actualScheduleTime,
          contentSnapshot: template.content,
          imagePathSnapshot: template.imagePath,
          ContactId: contact.id,
          TemplateId: template.id
        });
        
        messages.push(message);
      }
      
      // Check if scheduler is running, if not, start it
      await this.startScheduler();
      
      return {
        scheduled: messages.length,
        messages: messages.map(m => ({
          id: m.id,
          scheduledTime: m.scheduledTime,
          status: m.status
        }))
      };
    } catch (error) {
      console.error('Error scheduling messages:', error);
      throw error;
    }
  }

  /**
   * Get all scheduled messages
   * @param {string} status - Optional status filter
   * @returns {Promise<Array>} - Array of messages
   */
  async getScheduledMessages(status = null) {
    try {
      const query = {
        include: [
          { model: Contact },
          { model: Template }
        ]
      };
      
      if (status) {
        query.where = { status };
      }
      
      return await Message.findAll(query);
    } catch (error) {
      console.error('Error fetching scheduled messages:', error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled message
   * @param {number} id - Message ID
   * @returns {Promise<boolean>} - True if canceled successfully
   */
  async cancelScheduledMessage(id) {
    try {
      const message = await Message.findByPk(id);
      
      if (!message) {
        throw new Error(`Message with ID ${id} not found`);
      }
      
      if (message.status === 'SCHEDULED' || message.status === 'PENDING') {
        await message.update({ status: 'CANCELED' });
        return true;
      } else {
        throw new Error(`Cannot cancel message with status ${message.status}`);
      }
    } catch (error) {
      console.error(`Error canceling message with ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Update message status
   * @param {string} externalId - External message ID
   * @param {string} status - New status
   * @returns {Promise<boolean>} - True if updated successfully
   */
  async updateMessageStatus(externalId, status) {
    try {
      const message = await Message.findOne({
        where: { externalId }
      });
      
      if (!message) {
        throw new Error(`Message with external ID ${externalId} not found`);
      }
      
      await message.update({ status });
      return true;
    } catch (error) {
      console.error(`Error updating status for message with external ID ${externalId}:`, error);
      throw error;
    }
  }

  /**
   * Process pending messages
   * @returns {Promise<Object>} - Processing result
   */
  async processPendingMessages() {
    try {
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
        return { processed: 0, reason: 'WhatsApp is not connected' };
      }
      
      // Get pending messages
      const pendingMessages = await Message.findAll({
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
        order: [['scheduledTime', 'ASC']],
        limit: 1 // Process one message at a time to respect interval
      });
      
      if (pendingMessages.length === 0) {
        // No pending messages, check if there are scheduled messages to set to pending
        await this.updateScheduledToPending();
        return { processed: 0, reason: 'No pending messages' };
      }
      
      // Process the message
      const message = pendingMessages[0];
      
      try {
        // Send message based on whether it has an image
        let result;
        
        if (message.imagePathSnapshot) {
          result = await whatsAppService.sendImageMessage(
            message.Contact.phoneNumber,
            message.imagePathSnapshot,
            message.contentSnapshot
          );
        } else {
          result = await whatsAppService.sendTextMessage(
            message.Contact.phoneNumber,
            message.contentSnapshot
          );
        }
        
        // Update message with external ID and status
        await message.update({
          status: 'SENT',
          externalId: result.id,
          sentTime: new Date()
        });
        
        return { processed: 1, messageId: message.id };
      } catch (error) {
        // Update message with failure
        await message.update({
          status: 'FAILED',
          failureReason: error.message
        });
        
        return { processed: 0, failed: 1, reason: error.message };
      }
    } catch (error) {
      console.error('Error processing pending messages:', error);
      return { processed: 0, error: error.message };
    }
  }

  /**
   * Update scheduled messages to pending status
   * @returns {Promise<number>} - Number of messages updated
   */
  async updateScheduledToPending() {
    try {
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
          await this.processPendingMessages();
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
   * Get or create schedule settings
   * @returns {Promise<Object>} - Settings object
   */
  async getSettings() {
    try {
      // Get first settings record or create default
      let settings = await ScheduleSettings.findOne();
      
      if (!settings) {
        console.log('No settings found in database, creating default settings');
        settings = await ScheduleSettings.create({
          activeDays: [1, 2, 3, 4, 5], // Monday to Friday
          startTime: 9 * 60, // 9:00 AM
          endTime: 17 * 60, // 5:00 PM
          messageInterval: 45, // 45 seconds
          isActive: false // Disabled by default
        });
        console.log('Default settings created:', settings.toJSON());
      } else {
        console.log('Retrieved existing settings from database');
      }
      
      // Ensure activeDays is properly parsed
      try {
        if (typeof settings.activeDays === 'string') {
          settings.activeDays = JSON.parse(settings.activeDays);
        }
      } catch (parseError) {
        console.error('Error parsing activeDays, using default:', parseError);
        settings.activeDays = [1, 2, 3, 4, 5]; // Use default if parsing fails
      }
      
      return settings;
    } catch (error) {
      console.error('Error getting settings:', error);
      // Return default settings in case of error
      return {
        activeDays: [1, 2, 3, 4, 5],
        startTime: 9 * 60,
        endTime: 17 * 60,
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
      // Get current settings
      let settings = await this.getSettings();
      
      // Make a copy of the original settings to check for changes
      const originalSettings = { ...settings.toJSON() };
      
      // Log the settings we're about to update
      console.log('Updating settings with:', settingsData);
      console.log('Original settings:', originalSettings);
      
      // Ensure activeDays is handled properly
      if (settingsData.activeDays) {
        // Make sure it's an array
        if (!Array.isArray(settingsData.activeDays)) {
          if (typeof settingsData.activeDays === 'string') {
            try {
              settingsData.activeDays = JSON.parse(settingsData.activeDays);
            } catch (e) {
              console.error('Error parsing activeDays from string:', e);
              delete settingsData.activeDays; // Don't update if invalid
            }
          } else {
            delete settingsData.activeDays; // Don't update if invalid
          }
        }
      }
      
      // Update settings
      await settings.update(settingsData);
      
      // Refresh to ensure we have the latest data
      settings = await ScheduleSettings.findOne();
      
      console.log('Updated settings:', settings.toJSON());
      
      // Check if we need to restart the scheduler
      const needsRestart = 
        (settingsData.messageInterval && settingsData.messageInterval !== originalSettings.messageInterval) ||
        (settingsData.isActive !== undefined && settingsData.isActive !== originalSettings.isActive);
      
      if (needsRestart && this.mainCronJob) {
        console.log('Restarting scheduler due to settings changes');
        this.stopScheduler();
        await this.startScheduler();
      }
      
      return settings;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  /**
   * Check if current time is within allowed time range
   * @param {Object} settings - Schedule settings
   * @returns {boolean} - True if within range
   */
  isWithinTimeRange(settings) {
    const now = moment();
    const minutes = now.hours() * 60 + now.minutes();
    
    return minutes >= settings.startTime && minutes <= settings.endTime;
  }

  /**
   * Check if current day is allowed for sending
   * @param {Object} settings - Schedule settings
   * @returns {boolean} - True if allowed
   */
  isAllowedDay(settings) {
    const now = moment();
    const day = now.day() === 0 ? 7 : now.day(); // Convert Sunday from 0 to 7
    
    return settings.activeDays.includes(day);
  }
}

module.exports = new MessageController(); 