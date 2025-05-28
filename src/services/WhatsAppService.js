const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const EventEmitter = require('events');
const { getDatabaseFolder } = require('../database/db');
const os = require('os');

/**
 * WhatsAppService manages WhatsApp connection and messaging
 */
class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    
    // Get database folder from main process
    this.sessionPath = path.join(getDatabaseFolder(), 'whatsapp-session');
    
    this.client = null;
    this.status = {
      isConnected: false,
      status: 'disconnected',
      lastError: null
    };
    
    // Ensure session directory exists
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
      console.log(`Created WhatsApp session directory at: ${this.sessionPath}`);
    }

    this.reconnecting = false;
    this.initInProgress = false;
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT_ATTEMPTS = 5;
    this.connectionCheckInterval = null;
  }
  
  /**
   * Initialize WhatsApp client
   * - If session folder exists, always auto-connect using those files
   * - If not, create session folder and wait for QR scan
   * - No backup/old folders, no extra logic
   */
  async initialize(forceNewQR = false) {
    if (this.initInProgress) {
      console.log('WhatsApp initialization already in progress');
      return { success: false, error: 'Initialization already in progress' };
    }
    this.initInProgress = true;
    try {
      await this.cleanupBrowserSession();
      const sessionExists = this.hasExistingSession();
      if (forceNewQR && sessionExists) {
        console.log('Force new QR requested, deleting existing session');
        await this.deleteSessionData();
      }
      // Ensure session folder exists
      if (!fs.existsSync(this.sessionPath)) {
        fs.mkdirSync(this.sessionPath, { recursive: true });
        console.log(`Created WhatsApp session directory at: ${this.sessionPath}`);
      }
      // Use a temp directory for Puppeteer userDataDir (not sessionPath)
      const puppeteerUserDataDir = path.join(os.tmpdir(), 'bss-sender-puppeteer');
      if (!fs.existsSync(puppeteerUserDataDir)) {
        fs.mkdirSync(puppeteerUserDataDir, { recursive: true });
      }
      // Puppeteer options (headless, no userDataDir)
      const puppeteerOpts = {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=site-per-process',
          '--disable-web-security',
          '--ignore-certificate-errors',
          '--allow-running-insecure-content',
          '--disable-popup-blocking',
          '--disable-component-update',
          '--window-size=1280,900'
        ],
        headless: true,
        timeout: 120000,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        ignoreHTTPSErrors: true,
        defaultViewport: { width: 1280, height: 900 }
      };
      // Windows: try to use system Chrome/Edge if available
      if (process.platform === 'win32') {
        const possiblePaths = [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ];
        for (const browserPath of possiblePaths) {
          if (fs.existsSync(browserPath)) {
            puppeteerOpts.executablePath = browserPath;
            break;
          }
        }
      }
      const LATEST_WEB_VERSION = '2.2414.2';
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: this.sessionPath,
          clientId: 'bss-sender'
        }),
        puppeteer: puppeteerOpts,
        authTimeoutMs: 120000,
        qrTimeoutMs: 0, // QR never times out
        webVersion: LATEST_WEB_VERSION,
        webVersionCache: { type: 'local', path: this.sessionPath },
        qrMaxRetries: 0, // 0 = unlimited
        takeoverOnConflict: true,
        restartOnAuthFail: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      });
      // Add detailed event logging
      this.client.on('qr', (qr) => {
        console.log('[WA EVENT] QR code received');
        this.status.status = 'qr';
        this.emit('qr', qr);
      });
      this.client.on('authenticated', () => {
        console.log('[WA EVENT] Authenticated');
        this.status.status = 'authenticated';
        this.emit('authenticated');
      });
      this.client.on('ready', async () => {
        console.log('[WA EVENT] Ready');
        this.status.isConnected = true;
        this.status.status = 'ready';
        this.emit('ready');
        try {
          const phoneInfo = await this.getConnectedPhoneInfo();
          if (phoneInfo && phoneInfo.connected) {
            this.emit('whatsapp-info', phoneInfo);
          }
        } catch (err) {
          console.error('[WA EVENT] Error getting phone info:', err);
        }
      });
      this.client.on('disconnected', (reason) => {
        console.log('[WA EVENT] Disconnected:', reason);
        this.status.isConnected = false;
        this.status.status = 'disconnected';
        this.emit('disconnected', reason);
      });
      this.client.on('auth_failure', (error) => {
        console.error('[WA EVENT] Auth failure:', error);
        this.status.isConnected = false;
        this.status.status = 'auth_failure';
        this.emit('auth_failure', error);
      });
      this.client.on('loading_screen', (percent, message) => {
        console.log(`[WA EVENT] Loading: ${percent}% - ${message}`);
        this.status.status = 'loading';
        this.emit('loading', { percent, message });
      });
      this.client.on('change_state', (state) => {
        console.log('[WA EVENT] State changed:', state);
        this.emit('state_change', state);
      });
      this.startConnectionMonitoring();
      const initPromise = this.client.initialize();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Initialization timed out after 3 minutes')), 180000);
      });
      await Promise.race([initPromise, timeoutPromise]);
      return { success: true };
    } catch (error) {
      this.status.isConnected = false;
      this.status.status = 'disconnected';
      console.error('[WA ERROR] Error initializing WhatsApp:', error);
      return { success: false, error: error.message };
    } finally {
      this.initInProgress = false;
    }
  }
  
  /**
   * Start monitoring WhatsApp connection status
   */
  startConnectionMonitoring() {
    // Clear any existing interval
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }
    
    // Check connection every 30 seconds
    this.connectionCheckInterval = setInterval(async () => {
      try {
        if (this.client && this.status.isConnected) {
          // Check if client is actually connected
          const state = await this.client.getState();
          console.log(`WhatsApp connection check - Current state: ${state}`);
          
          if (state !== 'CONNECTED') {
            console.log('WhatsApp connection appears to be broken, reconnecting...');
            this.status.isConnected = false;
            this.reconnectClient();
          }
        } else if (this.hasExistingSession() && !this.status.isConnected && !this.reconnecting && !this.initInProgress) {
          // Auto-reconnect if session exists but not connected
          console.log('Session exists but not connected, attempting auto-reconnect');
          this.reconnectClient();
        }
      } catch (error) {
        console.error('Error checking WhatsApp connection:', error);
        // If error occurs during connection check, the connection is likely broken
        if (this.status.isConnected) {
          this.status.isConnected = false;
          this.reconnectClient();
        }
      }
    }, 30000);
  }
  
  /**
   * Attempt to reconnect the WhatsApp client
   */
  async reconnectClient() {
    if (this.reconnecting) {
      console.log('Reconnection already in progress');
      return;
    }
    
    this.reconnecting = true;
    this.reconnectAttempts++;
    
    try {
      console.log(`Attempting to reconnect WhatsApp (Attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
      
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (e) {
          console.log('Error destroying client during reconnect:', e.message);
        }
        this.client = null;
      }
      
      // Wait before attempting to reconnect
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Clean up any lock files
      await this.cleanupBrowserSession();
      
      // Initialize client again
      await this.initialize();
      
      if (this.status.isConnected) {
        this.reconnectAttempts = 0;
        console.log('Successfully reconnected to WhatsApp');
      } else if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        // Schedule another reconnect attempt
        setTimeout(() => {
          this.reconnecting = false;
          this.reconnectClient();
        }, 10000 * this.reconnectAttempts); // Increase wait time with each attempt
      } else {
        console.log('Max reconnect attempts reached, giving up');
        this.reconnectAttempts = 0;
        this.status.status = 'disconnected';
        this.emit('disconnected', 'MAX_RECONNECT_ATTEMPTS');
      }
    } catch (error) {
      console.error('Error during reconnect:', error);
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Check if internet connection is available
   * @returns {Promise<void>}
   */
  async checkInternetConnection() {
    return new Promise((resolve, reject) => {
      // Try multiple domains to increase reliability
      const domains = [
        'www.google.com',
        'www.cloudflare.com',
        'www.microsoft.com'
      ];
      
      let successCount = 0;
      let failCount = 0;
      const totalAttempts = domains.length;
      
      // Try each domain
      domains.forEach(domain => {
        const req = require('https').get(`https://${domain}`, (res) => {
          // Count 2xx and 3xx status codes as success
          if (res.statusCode >= 200 && res.statusCode < 400) {
            successCount++;
            
            if (successCount === 1) {
              // Resolve on first success
          resolve();
            }
        } else {
            failCount++;
            checkFailures();
        }
          
          // Ensure we clean up
        res.resume();
      });
      
        req.on('error', () => {
          failCount++;
          checkFailures();
        });
        
        req.setTimeout(5000, () => {
          req.destroy();
          failCount++;
          checkFailures();
      });
    });
      
      function checkFailures() {
        // Only reject if all attempts have failed
        if (failCount === totalAttempts) {
          reject(new Error('No internet connection available'));
        }
      }
    }).catch(error => {
      console.error('Internet connection check failed:', error.message);
      
      // As a fallback, check if DNS resolution works, which may indicate partial connectivity
      return new Promise((resolve, reject) => {
        require('dns').lookup('whatsapp.com', (err) => {
          if (!err) {
            console.log('DNS resolution succeeded, assuming internet is available');
            resolve();
          } else {
            console.error('DNS resolution also failed, internet is likely unavailable');
            reject(new Error('No internet connection available'));
          }
        });
      });
    });
  }

  /**
   * Set up WhatsApp client event listeners
   */
  setupEventListeners() {
    if (!this.client) return;
    this.client.removeAllListeners();

    // Track QR code attempts to handle reconnections properly
    let qrAttempts = 0;
    const maxQrAttempts = 5;

    this.client.on('qr', (qr) => {
      console.log('QR code received');
      qrAttempts++;
      
      // Track when QR was first shown for timeout purposes
      if (qrAttempts === 1) {
        this.qrStartTime = Date.now();
      }
      
      if (qrAttempts > maxQrAttempts) {
        console.log(`QR code shown ${qrAttempts} times without success, cleaning up session...`);
        // Reset the session if we've shown too many QR codes without success
        this.status.status = 'disconnected';
        this.emit('qr', null); // Signal to hide QR code
        
        // Schedule a session cleanup and retry
        setTimeout(async () => {
          try {
            await this.cleanupBrowserSession();
            qrAttempts = 0;
            this.qrStartTime = null;
            this.emit('disconnected', 'QR_TIMEOUT');
          } catch (e) {
            console.error('Error during QR timeout cleanup:', e);
          }
        }, 1000);
        return;
      }
      
      // Check if QR has been showing too long (2 minutes) without being scanned
      const qrTimeout = 2 * 60 * 1000; // 2 minutes
      if (this.qrStartTime && (Date.now() - this.qrStartTime > qrTimeout)) {
        console.log('QR code showing for too long without being scanned, resetting...');
        this.status.status = 'disconnected';
        this.emit('qr', null); // Signal to hide QR code
        
        // Reset QR tracking
        qrAttempts = 0;
        this.qrStartTime = null;
        this.emit('disconnected', 'QR_TIMEOUT');
        return;
      }
      
      this.status.status = 'qr';
      this.emit('qr', qr);
    });

    this.client.on('ready', async () => {
      console.log('WhatsApp client ready');
      this.status.isConnected = true;
      this.status.status = 'ready';
      this.status.lastError = null;
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      
      // Reset QR tracking
      qrAttempts = 0;
      this.qrStartTime = null;
      
      this.emit('ready');
      
      // Get phone info
      try {
        const phoneInfo = await this.getConnectedPhoneInfo();
        if (phoneInfo && phoneInfo.connected) {
          this.emit('whatsapp-info', phoneInfo);
        }
      } catch (err) {
        console.error('Error getting phone info:', err);
      }
    });

    this.client.on('authenticated', () => {
      console.log('WhatsApp authenticated');
      this.status.status = 'authenticated';
      this.emit('authenticated');
      
      // Reset QR tracking
      qrAttempts = 0;
      this.qrStartTime = null;
      
      // Save the fact that we're authenticated to help with reconnection
      try {
        // Touch a file to mark successful authentication
        const authMarkerFile = path.join(this.sessionPath, '.authenticated');
        fs.writeFileSync(authMarkerFile, new Date().toString());
        console.log('Authentication marker created at:', authMarkerFile);
      } catch (e) {
        console.error('Failed to create authentication marker:', e);
      }
    });

    this.client.on('auth_failure', async (error) => {
      console.error('WhatsApp auth failure:', error);
      this.status.isConnected = false;
      this.status.status = 'auth_failure';
      this.status.lastError = error.message;
      this.emit('auth_failure', error);
      
      // Reset QR tracking
      qrAttempts = 0;
      this.qrStartTime = null;
      
      // Clear session data on auth failure to prevent future failures
      try {
        await this.deleteSessionData();
        console.log('Session data cleared after auth failure');
      } catch (e) {
        console.error('Failed to clear session data after auth failure:', e);
      }
    });

    this.client.on('disconnected', (reason) => {
      console.log('WhatsApp disconnected:', reason);
      this.status.isConnected = false;
      this.status.status = 'disconnected';
      this.emit('disconnected', reason);
      
      // Reset QR tracking
      qrAttempts = 0;
      this.qrStartTime = null;
      
      // Auto-reconnect only for unexpected disconnections
      if (reason !== 'LOGOUT' && !this.reconnecting) {
        this.reconnecting = true;
        setTimeout(() => {
          this.reconnectClient();
        }, 5000);
      }
    });

    // Handle message ACK updates
    this.client.on('message_ack', (message, ack) => {
      if (message.fromMe) {
        console.log(`Message ACK update - ID: ${message.id._serialized}, ACK: ${ack}`);
        let status = 'SENT';
        if (ack === 2) status = 'DELIVERED';
        else if (ack === 3) status = 'READ';
        
        this.emit('message_status_change', {
          externalId: message.id._serialized,
          status: status,
          timestamp: new Date()
        });
      }
    });
    
    // Add state change listener
    this.client.on('change_state', state => {
      console.log('WhatsApp state changed:', state);
      this.emit('state_change', state);
      
      if (state === 'CONNECTED') {
        this.status.isConnected = true;
        this.status.status = 'ready';
        
        // Reset QR tracking
        qrAttempts = 0;
        this.qrStartTime = null;
      } else if (state === 'DISCONNECTED') {
        this.status.isConnected = false;
        this.status.status = 'disconnected';
      }
    });
    
    // Add QR scan success listener
    this.client.on('loading_screen', (percent, message) => {
      console.log(`WhatsApp loading: ${percent}% - ${message}`);
      this.status.status = 'loading';
      this.emit('loading', { percent, message });
      
      // Reset QR tracking since loading screen means QR was scanned
      qrAttempts = 0;
      this.qrStartTime = null;
    });
  }

  /**
   * Check if a session exists
   */
  hasExistingSession() {
    try {
      const sessionDir = this.sessionPath;
      if (!fs.existsSync(sessionDir)) {
        return false;
      }
      
      // Do a more thorough check of session files
      const files = fs.readdirSync(sessionDir);
      
      // Check for the authentication marker first
      if (files.includes('.authenticated')) {
        console.log('Found authentication marker file - session exists');
        return true;
      }
      
      // Look for specific files that indicate a valid session
      const validSessionIndicators = [
        '.data.json',
        'session-',
        'session.',
        'Default/Local Storage',
        'Default/IndexedDB',
        'wawc_'
      ];
      
      // Check default directory
      const defaultDir = path.join(sessionDir, 'Default');
      if (fs.existsSync(defaultDir)) {
        const defaultFiles = fs.readdirSync(defaultDir);
        if (defaultFiles.length > 0) {
          console.log('Session exists: Default directory contains files');
          return true;
        }
      }
      
      // Check for key session files
      for (const file of files) {
        for (const indicator of validSessionIndicators) {
          if (file.includes(indicator)) {
            console.log(`Session exists: Found key file ${file}`);
            return true;
          }
        }
      }
      
      // Also look for auth folder with files
      const authDir = path.join(sessionDir, 'session', 'Default', 'wawc_auth_store');
      if (fs.existsSync(authDir)) {
        const authFiles = fs.readdirSync(authDir);
        if (authFiles.length > 0) {
          console.log('Session exists: Auth directory contains files');
          return true;
        }
      }
      
      console.log('No valid session found after thorough check');
      return false;
    } catch (error) {
      console.error('Error checking for existing session:', error);
      return false;
    }
  }

  /**
   * Disconnect WhatsApp client
   * @param {boolean} deleteSession - Whether to delete session data
   * @returns {Promise<void>}
   */
  async disconnect(deleteSession = false) {
    try {
      console.log(`Disconnecting WhatsApp${deleteSession ? ' and deleting session' : ''}`);
      
      // Stop connection monitoring
      if (this.connectionCheckInterval) {
        clearInterval(this.connectionCheckInterval);
        this.connectionCheckInterval = null;
      }
      
      if (this.client) {
        if (deleteSession) {
          try {
          await this.client.logout();
            console.log('WhatsApp logout successful');
          } catch (logoutError) {
            console.error('Error during WhatsApp logout:', logoutError);
            // Still continue with session deletion
          }
        } else {
          await this.client.destroy();
        }
        this.client = null;
      }
      
      this.status.isConnected = false;
      this.status.status = 'disconnected';
      
      if (deleteSession) {
        await this.deleteSessionData();
      }
      
      console.log('WhatsApp disconnected successfully');
    } catch (error) {
      console.error('Error during disconnect:', error);
      throw error;
    }
  }
  
  /**
   * Delete session data (logout): deletes all files in the session folder, but keeps the folder itself
   */
  async deleteSessionData() {
    try {
      console.log('Deleting WhatsApp session data (logout)');
      // Properly close client if running
      if (this.client) {
        try {
          if (this.client.destroy) {
            await this.client.destroy();
          }
          this.client = null;
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
          console.error('Error destroying client during session cleanup:', e);
        }
      }
      // Delete all files and subfolders in the session folder, but not the folder itself
      if (fs.existsSync(this.sessionPath)) {
        const entries = fs.readdirSync(this.sessionPath);
        for (const entry of entries) {
          const entryPath = path.join(this.sessionPath, entry);
          try {
            const stat = fs.lstatSync(entryPath);
            if (stat.isDirectory()) {
              await this.safeDeleteDirectory(entryPath);
              fs.rmdirSync(entryPath);
            } else {
              fs.unlinkSync(entryPath);
            }
          } catch (e) {
            console.error(`Could not remove ${entryPath}:`, e.message);
          }
        }
      }
      console.log('Session data deleted successfully');
    } catch (error) {
      console.error('Error deleting session data:', error);
      throw error;
    }
  }

  /**
   * Safely delete directory contents
   */
  async safeDeleteDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    
    try {
      const entries = fs.readdirSync(dirPath);
      
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        try {
          const stat = fs.lstatSync(entryPath);
          
          if (stat.isDirectory()) {
            await this.safeDeleteDirectory(entryPath);
            try {
              fs.rmdirSync(entryPath);
            } catch (e) {
              console.log(`Could not remove directory ${entryPath}: ${e.message}`);
            }
        } else {
            try {
              fs.unlinkSync(entryPath);
            } catch (e) {
              console.log(`Could not delete file ${entryPath}: ${e.message}`);
            }
          }
        } catch (e) {
          console.error(`Error accessing ${entryPath}:`, e);
        }
      }
    } catch (error) {
      console.error(`Error deleting directory ${dirPath}:`, error);
    }
  }

  /**
   * Get information about the connected phone
   * @returns {Promise<Object>} - Phone information
   */
  async getConnectedPhoneInfo() {
    try {
      if (!this.client || !this.status.isConnected) {
        return { phoneNumber: 'Unknown', name: 'Unknown', connected: false };
      }

      const info = await this.client.info;
      if (!info) {
        return { phoneNumber: 'Unknown', name: 'Unknown', connected: false };
      }

      // Try to get profile picture URL
      let profilePictureUrl = null;
      try {
        if (info.wid && info.wid.user) {
          const profilePic = await this.client.getProfilePicUrl(`${info.wid.user}@c.us`);
          if (profilePic) {
            profilePictureUrl = profilePic;
          }
        }
      } catch (picError) {
        console.log('Could not get profile picture:', picError.message);
      }

      return {
        phoneNumber: info.wid.user || 'Unknown',
        name: info.pushname || 'Unknown',
        connected: true,
        profilePictureUrl
      };
    } catch (error) {
      console.error('Error getting phone info:', error);
      return { phoneNumber: 'Unknown', name: 'Unknown', connected: false };
    }
  }

  /**
   * Get current connection status
   * @returns {Object} - Status object
   */
  getStatus() {
    return {
      ...this.status,
      hasExistingSession: this.hasExistingSession()
    };
  }

  /**
   * Send a text message to a phone number
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} message - Message content
   * @returns {Promise<Object>} - Sent message info
   */
  async sendTextMessage(phoneNumber, message) {
    if (!this.client) {
      throw new Error('WhatsApp client not initialized');
    }
    
    if (!this.status.isConnected) {
      // Try to reconnect if not connected
      try {
        console.log('WhatsApp not connected, attempting to connect before sending message');
        await this.initialize();
        
        // Wait for connection to be established
        let connectionAttempts = 0;
        while (!this.status.isConnected && connectionAttempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          connectionAttempts++;
        }
        
        if (!this.status.isConnected) {
          throw new Error('Failed to connect to WhatsApp');
        }
      } catch (error) {
        console.error('Failed to reconnect WhatsApp before sending message:', error);
        throw new Error(`WhatsApp connection failed: ${error.message}`);
      }
    }

    try {
      // Format phone number
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Send message
      console.log(`Sending text message to ${formattedNumber}`);
      const result = await this.client.sendMessage(`${formattedNumber}@c.us`, message);
      
      // Return message details
      return {
        success: true,
        externalId: result.id._serialized,
        to: formattedNumber
      };
    } catch (error) {
      console.error('Error sending text message:', error);
      throw error;
    }
  }

  /**
   * Send an image message to a phone number
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} imagePath - Path to image file
   * @param {string} caption - Optional caption
   * @returns {Promise<Object>} - Sent message info
   */
  async sendImageMessage(phoneNumber, imagePath, caption = '') {
    if (!this.client) {
      throw new Error('WhatsApp client not initialized');
    }
    
    if (!this.status.isConnected) {
      // Try to reconnect if not connected
      try {
        console.log('WhatsApp not connected, attempting to connect before sending image');
        await this.initialize();
        
        // Wait for connection to be established
        let connectionAttempts = 0;
        while (!this.status.isConnected && connectionAttempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          connectionAttempts++;
        }
        
        if (!this.status.isConnected) {
          throw new Error('Failed to connect to WhatsApp');
        }
      } catch (error) {
        console.error('Failed to reconnect WhatsApp before sending image:', error);
        throw new Error(`WhatsApp connection failed: ${error.message}`);
      }
    }

    try {
      // Validate image path
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
      }
      
      // Format phone number
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Send message
      console.log(`Sending image message to ${formattedNumber} with image: ${imagePath}`);
      
      // Read image as base64
      const imageData = fs.readFileSync(imagePath, { encoding: 'base64' });
      const media = new (require('whatsapp-web.js').MessageMedia)(
        'image/jpeg',
        imageData,
        path.basename(imagePath)
      );
      
      const result = await this.client.sendMessage(
        `${formattedNumber}@c.us`,
        media,
        { caption }
      );
      
      // Return message details
      return {
        success: true,
        externalId: result.id._serialized,
        to: formattedNumber
      };
    } catch (error) {
      console.error('Error sending image message:', error);
      throw error;
    }
  }

  /**
   * Format phone number for WhatsApp
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any non-digit characters
    let formatted = phoneNumber.replace(/\D/g, '');
    
    // Ensure number has country code
    if (!formatted.startsWith('1') && !formatted.startsWith('44') && !formatted.startsWith('91')) {
      // Default to US country code if not specified
      formatted = '1' + formatted;
    }
    
    return formatted;
  }

  /**
   * Clean up browser session files that might be locking the session
   */
  async cleanupBrowserSession() {
    if (!fs.existsSync(this.sessionPath)) {
      return;
    }
    
    try {
      // Look for lock files in the session directory
      const lockFiles = [
        'SingletonLock',
        'SingletonCookie',
        'SingletonSocket',
        '.lock',
        'lockfile'
      ];
      
      // Check in main session directory
      for (const lockFile of lockFiles) {
        const lockPath = path.join(this.sessionPath, lockFile);
        if (fs.existsSync(lockPath)) {
          try {
            fs.unlinkSync(lockPath);
            console.log(`Removed lock file: ${lockPath}`);
        } catch (e) {
            console.error(`Failed to remove lock file ${lockPath}:`, e);
          }
        }
      }
      
      // Check in Default directory if it exists
      const defaultDir = path.join(this.sessionPath, 'Default');
      if (fs.existsSync(defaultDir)) {
        for (const lockFile of lockFiles) {
          const lockPath = path.join(defaultDir, lockFile);
          if (fs.existsSync(lockPath)) {
            try {
              fs.unlinkSync(lockPath);
              console.log(`Removed lock file: ${lockPath}`);
              } catch (e) {
              console.error(`Failed to remove lock file ${lockPath}:`, e);
            }
          }
        }
      }
      
      // Delete any WebSocket tmp files
      const wsRegex = /\.websocket$/;
      const safeDeleteFile = (filePath) => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
                  }
                } catch (e) {
          console.error(`Failed to delete file ${filePath}:`, e);
        }
      };
      
      const checkAndCleanDir = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          fs.readdirSync(dirPath).forEach(file => {
            if (wsRegex.test(file)) {
              safeDeleteFile(path.join(dirPath, file));
            }
          });
        }
      };
      
      // Check main session directory for websocket files
      checkAndCleanDir(this.sessionPath);
      
      // Check Default directory for websocket files
      checkAndCleanDir(defaultDir);
      
      // Check Default/Network directory for websocket files
      const networkDir = path.join(defaultDir, 'Network');
      checkAndCleanDir(networkDir);
      
      console.log('Browser session cleanup complete');
    } catch (error) {
      console.error('Error during browser session cleanup:', error);
    }
  }

  /**
   * Kill any old Chrome/Puppeteer processes that might be hanging
   */
  killOldBrowserProcesses() {
    try {
      // This is a no-op on Electron renderer process, but can be implemented in main process
      console.log('Cleaning up old browser processes if needed');
      
      // Signal to main process to clean up browser processes
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('kill-browser-processes');
      }
    } catch (error) {
      console.error('Error killing old browser processes:', error);
    }
  }

  /**
   * Clear session caches that might be corrupt
   */
  clearSessionCaches() {
    try {
      const cachePaths = [
        path.join(this.sessionPath, 'Default', 'Cache'),
        path.join(this.sessionPath, 'Default', 'Code Cache'),
        path.join(this.sessionPath, 'Default', 'Service Worker', 'CacheStorage')
      ];
      
      for (const cachePath of cachePaths) {
        if (fs.existsSync(cachePath)) {
          console.log(`Clearing cache directory: ${cachePath}`);
          // Use rename strategy to avoid locked files
          const backupPath = `${cachePath}.old-${Date.now()}`;
          try {
            fs.renameSync(cachePath, backupPath);
            // Create empty directory to replace it
            fs.mkdirSync(cachePath, { recursive: true });
            
            // Schedule deletion of old directory
            setTimeout(() => {
              this.safeDeleteDirectory(backupPath);
            }, 5000);
    } catch (e) {
            console.log(`Could not clear cache directory ${cachePath}: ${e.message}`);
          }
        }
      }
    } catch (error) {
      console.error('Error clearing session caches:', error);
    }
  }
}

// Export singleton instance
const whatsAppService = new WhatsAppService();
module.exports = whatsAppService; 