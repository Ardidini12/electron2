const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const EventEmitter = require('events');
const { getDatabaseFolder } = require('../database/db');

/**
 * WhatsAppService manages WhatsApp connection and messaging
 */
class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    
    this.client = null;
    this.isInitialized = false;
    this.isConnected = false;
    this.status = 'disconnected';
    
    // Create session directory inside database folder
    this.sessionDir = path.join(getDatabaseFolder(), 'whatsapp-session');
    this.ensureSessionDir();
  }
  
  /**
   * Ensure the session directory exists
   */
  ensureSessionDir() {
    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
        console.log(`Created WhatsApp session folder at: ${this.sessionDir}`);
      }
    } catch (error) {
      console.error('Error creating WhatsApp session folder:', error);
      // Fallback to a default location if needed
      this.sessionDir = path.join(app ? app.getPath('userData') : __dirname, 'whatsapp-session');
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
    }
  }

  /**
   * Initialize WhatsApp client
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }
    
    try {
      // Check internet connection first
      await this.checkInternetConnection();
      
      this.status = 'initializing';
      console.log(`Initializing WhatsApp with session directory: ${this.sessionDir}`);
      
      // Create WhatsApp client with local authentication
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: this.sessionDir
        }),
        puppeteer: {
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials'
          ],
          headless: true
        },
        webVersion: '2.2326.10',
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2326.10.html'
        }
      });
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Initialize client
      await this.client.initialize();
      
      this.isInitialized = true;
      this.status = 'initialized';
    } catch (error) {
      this.status = 'error';
      console.error('Error initializing WhatsApp client:', error);
      
      // Provide more helpful error message
      if (error.message.includes('ERR_NAME_NOT_RESOLVED')) {
        throw new Error('Unable to connect to WhatsApp Web. Please check your internet connection and try again.');
      } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        throw new Error('Connection to WhatsApp Web was refused. Please check your firewall settings and try again.');
      } else if (error.message.includes('ERR_INTERNET_DISCONNECTED')) {
        throw new Error('No internet connection. Please connect to the internet and try again.');
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if internet connection is available
   * @returns {Promise<void>}
   */
  async checkInternetConnection() {
    return new Promise((resolve, reject) => {
      const request = require('https').get('https://www.google.com', (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error('Internet connection check failed'));
        }
        res.resume();
      });
      
      request.on('error', () => {
        reject(new Error('No internet connection available. Please connect to the internet and try again.'));
      });
      
      request.setTimeout(5000, () => {
        request.destroy();
        reject(new Error('Internet connection check timed out. Please check your connection and try again.'));
      });
    });
  }

  /**
   * Set up WhatsApp client event listeners
   */
  setupEventListeners() {
    // QR code is received
    this.client.on('qr', (qr) => {
      this.status = 'qr_received';
      this.emit('qr', qr);
      console.log('QR Code received, ready for scanning');
    });
    
    // Client is ready
    this.client.on('ready', () => {
      this.isConnected = true;
      this.status = 'ready';
      this.emit('ready');
      console.log('WhatsApp client is ready');
    });
    
    // Authentication successful
    this.client.on('authenticated', () => {
      this.status = 'authenticated';
      this.emit('authenticated');
      console.log('WhatsApp authentication successful');
    });
    
    // Authentication failure
    this.client.on('auth_failure', (error) => {
      this.isConnected = false;
      this.status = 'auth_failure';
      this.emit('auth_failure', error);
      console.error('WhatsApp authentication failed:', error);
    });
    
    // Disconnected
    this.client.on('disconnected', (reason) => {
      this.isConnected = false;
      this.status = 'disconnected';
      this.emit('disconnected', reason);
      console.log('WhatsApp disconnected. Reason:', reason);
    });
    
    // Message status update
    this.client.on('message_ack', (message, ack) => {
      /*
       * Message ACK values:
       * 0: Message not sent
       * 1: Message sent to server
       * 2: Message received by server
       * 3: Message received by recipient
       * 4: Message read by recipient
       */
      this.emit('message_ack', message.id, ack);
    });
  }

  /**
   * Disconnect WhatsApp client
   * @param {boolean} deleteSession - Whether to delete the session data
   * @returns {Promise<void>}
   */
  async disconnect(deleteSession = false) {
    if (!this.client) {
      return;
    }
    
    try {
      this.status = 'disconnecting';
      await this.client.destroy();
      this.isConnected = false;
      this.isInitialized = false;
      this.client = null;
      this.status = 'disconnected';
      
      // Delete session data if requested
      if (deleteSession) {
        await this.deleteSessionData();
      }
      
      this.emit('disconnected', 'manual_disconnect');
    } catch (error) {
      console.error('Error disconnecting WhatsApp client:', error);
      throw error;
    }
  }
  
  /**
   * Delete all session data
   * @returns {Promise<void>}
   */
  async deleteSessionData() {
    return new Promise((resolve, reject) => {
      if (fs.existsSync(this.sessionDir)) {
        try {
          // Delete all files in the session directory
          const files = fs.readdirSync(this.sessionDir);
          for (const file of files) {
            const filePath = path.join(this.sessionDir, file);
            if (fs.lstatSync(filePath).isDirectory()) {
              // Recursive delete for subdirectories
              this.deleteDirectoryRecursive(filePath);
            } else {
              // Delete file
              fs.unlinkSync(filePath);
            }
          }
          console.log('WhatsApp session data deleted successfully');
          resolve();
        } catch (error) {
          console.error('Error deleting WhatsApp session data:', error);
          reject(error);
        }
      } else {
        resolve(); // No session directory to delete
      }
    });
  }
  
  /**
   * Delete a directory and all its contents recursively
   * @param {string} dirPath - Path to the directory
   */
  deleteDirectoryRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        const curPath = path.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          // Recursive call for directories
          this.deleteDirectoryRecursive(curPath);
        } else {
          // Delete file
          fs.unlinkSync(curPath);
        }
      });
      // Delete empty directory
      fs.rmdirSync(dirPath);
    }
  }

  /**
   * Check if an existing WhatsApp session is available
   * @returns {boolean} - True if a session exists
   */
  hasExistingSession() {
    try {
      if (!fs.existsSync(this.sessionDir)) {
        return false;
      }
      
      // Check if the session directory has actual session files
      const files = fs.readdirSync(this.sessionDir);
      
      // Look for session data folders (like 'Default' folder used by whatsapp-web.js)
      const sessionFolders = files.filter(file => {
        const fullPath = path.join(this.sessionDir, file);
        return fs.statSync(fullPath).isDirectory();
      });
      
      // Check if any of the folders contain actual session data
      for (const folder of sessionFolders) {
        const folderPath = path.join(this.sessionDir, folder);
        const folderContents = fs.readdirSync(folderPath);
        
        // If we find any of these files, it's likely a valid session
        if (folderContents.some(file => 
          file.includes('Default') || 
          file.includes('cookies') || 
          file.includes('storage') || 
          file.includes('Network'))) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking for existing session:', error);
      return false;
    }
  }

  /**
   * Get information about the connected phone
   * @returns {Promise<Object>} - Phone information
   */
  async getConnectedPhoneInfo() {
    if (!this.isConnected || !this.client) {
      throw new Error('WhatsApp client is not connected');
    }
    
    try {
      // Get client information
      const info = await this.client.getState();
      
      // Get the phone number and name safely
      let phoneNumber = null;
      let name = null;
      
      if (this.client.info) {
        name = this.client.info.pushname || null;
        
        // Try multiple ways to get the phone number
        try {
          if (this.client.info.wid && typeof this.client.info.wid === 'string') {
            phoneNumber = this.client.info.wid.replace(/@c\.us$/, '');
          } else if (this.client.info.me && typeof this.client.info.me === 'string') {
            phoneNumber = this.client.info.me.replace(/@c\.us$/, '');
          } else if (this.client.info.phone && typeof this.client.info.phone === 'object') {
            phoneNumber = this.client.info.phone.user || null;
          } else if (this.client.info.user && typeof this.client.info.user === 'string') {
            phoneNumber = this.client.info.user;
          }
          
          // As a last resort, try to get it from the client itself
          if (!phoneNumber && typeof this.client.getWid === 'function') {
            const wid = await this.client.getWid();
            if (wid && typeof wid === 'string') {
              phoneNumber = wid.replace(/@c\.us$/, '');
            }
          }
          
          // Format with + if we have a number
          if (phoneNumber) {
            phoneNumber = '+' + phoneNumber;
          }
        } catch (phoneError) {
          console.error('Error extracting phone number:', phoneError);
        }
      }
      
      // If we still don't have a phone number, try one more method
      if (!phoneNumber) {
        try {
          // Try to get it from the contact list (self contact)
          const contacts = await this.client.getContacts();
          const selfContact = contacts.find(contact => contact.isMe);
          if (selfContact && selfContact.id && typeof selfContact.id.user === 'string') {
            phoneNumber = '+' + selfContact.id.user;
          }
        } catch (contactsError) {
          console.error('Error getting contacts:', contactsError);
        }
      }
      
      console.log('Connected phone info:', { phoneNumber, name, state: info });
      
      return {
        phoneNumber,
        state: info,
        name,
        connected: this.isConnected
      };
    } catch (error) {
      console.error('Error getting connected phone info:', error);
      return {
        phoneNumber: null,
        state: null,
        name: null,
        connected: this.isConnected
      };
    }
  }

  /**
   * Get current connection status
   * @returns {Object} - Status object
   */
  getStatus() {
    return {
      status: this.status,
      isConnected: this.isConnected,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Send a text message to a phone number
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} message - Message content
   * @returns {Promise<Object>} - Sent message info
   */
  async sendTextMessage(phoneNumber, message) {
    if (!this.isConnected) {
      throw new Error('WhatsApp client is not connected');
    }
    
    try {
      // Format phone number for WhatsApp
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Send message
      const response = await this.client.sendMessage(`${formattedNumber}@c.us`, message);
      
      return {
        id: response.id.id,
        timestamp: response.timestamp,
        from: response.from,
        to: response.to,
        status: 'sent'
      };
    } catch (error) {
      console.error(`Error sending message to ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Send an image message to a phone number
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} imagePath - Path to the image file
   * @param {string} caption - Optional image caption
   * @returns {Promise<Object>} - Sent message info
   */
  async sendImageMessage(phoneNumber, imagePath, caption = '') {
    if (!this.isConnected) {
      throw new Error('WhatsApp client is not connected');
    }
    
    try {
      // Format phone number for WhatsApp
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Send image
      const response = await this.client.sendMessage(
        `${formattedNumber}@c.us`,
        {
          body: caption,
          caption: caption,
          media: fs.readFileSync(imagePath)
        }
      );
      
      return {
        id: response.id.id,
        timestamp: response.timestamp,
        from: response.from,
        to: response.to,
        status: 'sent'
      };
    } catch (error) {
      console.error(`Error sending image to ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Format phone number for WhatsApp
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Check if phoneNumber is undefined or null
    if (!phoneNumber) {
      console.warn('Warning: Attempt to format undefined or null phone number in WhatsAppService');
      return '';
    }
    
    // Ensure phoneNumber is a string
    if (typeof phoneNumber !== 'string') {
      phoneNumber = String(phoneNumber);
    }
    
    try {
      // Remove all non-digit characters
      let formatted = phoneNumber.replace(/\D/g, '');
      
      // Remove leading '+' if present
      if (formatted.startsWith('+')) {
        formatted = formatted.substring(1);
      }
      
      return formatted;
    } catch (error) {
      console.error('Error formatting phone number in WhatsAppService:', error);
      // Return a safe fallback
      return phoneNumber;
    }
  }

  /**
   * Remove all listeners for a specific event
   * @param {string} event - Event name
   */
  removeAllListeners(event) {
    super.removeAllListeners(event);
    console.log(`Removed all listeners for event: ${event}`);
  }
}

module.exports = new WhatsAppService(); 