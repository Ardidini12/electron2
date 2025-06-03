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
      // Check for existing session
      const hasSession = this.hasExistingSession();
      
      if (forceNewQR && hasSession) {
        console.log('Force new QR requested, deleting existing session first');
        await this.deleteSessionData();
      }
      
      // Clean up any existing client connection
      try {
        if (this.client) {
          await this.cleanupBrowserSession();
        }
      } catch (cleanupError) {
        console.error('Error during client cleanup:', cleanupError);
      }
      
      // Try to kill any hanging browser processes
      try {
        this.killOldBrowserProcesses();
      } catch (killError) {
        console.error('Error killing old browser processes:', killError);
      }
      
      console.log('[WA DEBUG] Setting up WhatsApp event listeners');
      
      // Configure WhatsApp Web version
      let LATEST_WEB_VERSION = '2.2401.6';
      
      // Detect available Chrome installation
      const chromePath = await this.findChromePath();
      console.log(`Using Chrome path: ${chromePath || 'System default'}`);
      
      // Configure Puppeteer options with improved browser launch settings
      const puppeteerOpts = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--deterministic-fetch',
          '--disable-features=site-per-process',
          '--disable-extensions',
          '--disable-notifications',
          '--disable-web-security',
          '--ignore-certificate-errors',
          '--allow-running-insecure-content',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ],
        executablePath: chromePath,
        timeout: 120000, // Increase timeout to 2 minutes
        ignoreHTTPSErrors: true
      };
      
      // Create client with updated configuration
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: this.sessionPath,
          clientId: 'bss-sender'
        }),
        puppeteer: puppeteerOpts,
        authTimeoutMs: 180000, // Increased timeout (3 minutes)
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
      
      // Add a custom error handler for better diagnostics
      process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        // Don't exit the app, just log the error
      });
      
      // Set up initialization with proper error handling
      let initPromise;
      
      // Try main initialization
      try {
        console.log('Starting WhatsApp client initialization...');
        initPromise = this.client.initialize();
      } catch (initError) {
        console.error('Initial initialization attempt failed:', initError);
        
        // Try a fallback approach with more relaxed settings if this is a browser launch error
        if (initError.message && initError.message.includes('Failed to launch')) {
          console.log('Browser launch failed, attempting with fallback options...');
          
          // Try a different browser initialization approach
          try {
            // Clean up old client
            if (this.client) {
              try {
                await this.client.destroy();
              } catch (e) {
                console.log('Error destroying client during fallback:', e.message);
              }
            }
            
            // Create new client with more permissive options
            const fallbackOptions = {
              headless: true,
              args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security'
              ],
              // Use system default Chrome
              executablePath: undefined
            };
            
            console.log('Creating new client with fallback options');
            this.client = new Client({
              authStrategy: new LocalAuth({
                dataPath: this.sessionPath,
                clientId: 'bss-sender'
              }),
              puppeteer: fallbackOptions,
              authTimeoutMs: 180000,
              qrTimeoutMs: 0,
              webVersion: LATEST_WEB_VERSION,
              restartOnAuthFail: true
            });
            
            // Set up events again
            this.setupEventListeners();
            
            // Try initialization with fallback options
            console.log('Attempting initialization with fallback options');
            initPromise = this.client.initialize();
          } catch (fallbackError) {
            console.error('Fallback initialization also failed:', fallbackError);
            throw fallbackError;
          }
        } else {
          // Not a browser launch error, rethrow
          throw initError;
        }
      }
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Initialization timed out after 3 minutes')), 180000);
      });
      
      await Promise.race([initPromise, timeoutPromise]);
      this.setupEventListeners();
      return { success: true };
    } catch (error) {
      this.status.isConnected = false;
      this.status.status = 'disconnected';
      this.status.lastError = error.message;
      
      // Enhanced error logging
      console.error('[WA ERROR] Error initializing WhatsApp:', error);
      
      // Diagnostic information
      try {
        const diagnostics = await this.checkSystemRequirements();
        console.log('System diagnostics:', diagnostics);
        
        // If there are issues, log them as warnings
        if (diagnostics.issues.length > 0) {
          console.warn('System issues that may affect WhatsApp connection:');
          diagnostics.issues.forEach((issue, i) => {
            console.warn(`  ${i+1}. ${issue}`);
          });
          
          // Also log suggestions
          if (diagnostics.suggestions.length > 0) {
            console.warn('Suggestions to fix WhatsApp connection issues:');
            diagnostics.suggestions.forEach((suggestion, i) => {
              console.warn(`  ${i+1}. ${suggestion}`);
            });
          }
        }
      } catch (diagError) {
        console.error('Error collecting system diagnostics:', diagError);
      }
      
      return { 
        success: false, 
        error: error.message,
        suggestions: await this.getSuggestionForError(error)
      };
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
    console.log('[WA DEBUG] Setting up WhatsApp event listeners');
    if (!this.client) return;
    this.client.removeAllListeners();

    // Add a generic event logger for all events
    this.client.on('all', (event, ...args) => {
      console.log('[WA ALL EVENT]', event, ...args);
    });

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
        // Log every ACK value for debugging
        console.log(`[WA ACK] Message ${message.id._serialized} ack: ${ack}`);
        
        // Map WhatsApp ack levels to our status values
        let status = null;
        if (ack === 1) {
          status = 'SENT';
        } else if (ack === 2) {
          status = 'DELIVERED';
        } else if (ack === 3) {
          status = 'READ';
        } else if (ack === 4) {
          status = 'READ'; // Treat played as read for now
        }
        
        if (status) {
          this.emit('message_status_change', {
            externalId: message.id._serialized,
            status: status,
            timestamp: new Date()
          });
          console.log(`[WA EMIT] Emitted status ${status} for message ${message.id._serialized}`);
        }
      }
    });
    
    // Add listener for initial status after message is sent
    this.client.on('message_create', (message) => {
      if (message.fromMe) {
        console.log(`[MESSAGE CREATE] New outgoing message created: ${message.id._serialized}`);
        
        // Emit sent status immediately when message is created
        this.emit('message_status_change', {
          externalId: message.id._serialized,
          status: 'SENT',
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
        console.log('Cannot get phone info: WhatsApp client not connected');
        return { phoneNumber: 'Unknown', name: 'Unknown', connected: false };
      }

      // Wait a moment to ensure the client info is fully loaded
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get client info more safely
      let info;
      try {
        info = await this.client.info;
        console.log('Retrieved client info:', JSON.stringify(info || {}, null, 2));
      } catch (infoError) {
        console.error('Error getting client info:', infoError);
        return { phoneNumber: 'Unknown', name: 'Unknown', connected: false };
      }
      
      if (!info || !info.wid) {
        console.log('No valid info or wid found in client info');
        return { phoneNumber: 'Unknown', name: 'Unknown', connected: false };
      }

      // Try to get profile picture URL
      let profilePictureUrl = null;
      try {
        if (info.wid && info.wid._serialized) {
          const profilePic = await this.client.getProfilePicUrl(info.wid._serialized);
          if (profilePic) {
            profilePictureUrl = profilePic;
          }
        } else if (info.wid && info.wid.user) {
          const profilePic = await this.client.getProfilePicUrl(`${info.wid.user}@c.us`);
          if (profilePic) {
            profilePictureUrl = profilePic;
          }
        }
      } catch (picError) {
        console.log('Could not get profile picture:', picError.message);
      }

      // Try to get phone number in multiple ways
      let phoneNumber = 'Unknown';
      if (info.wid && info.wid.user) {
        phoneNumber = info.wid.user;
      } else if (info.wid && info.wid._serialized) {
        // Extract phone number from serialized ID (format: "number@c.us")
        const match = info.wid._serialized.match(/^(\d+)@/);
        if (match && match[1]) {
          phoneNumber = match[1];
        }
      }

      return {
        phoneNumber: phoneNumber,
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
    // Remove any non-digit characters except the leading +
    let formatted = phoneNumber.toString().replace(/[^\d+]/g, '');
    
    // Remove leading + if present (WhatsApp Web API doesn't use + in the chat ID)
    if (formatted.startsWith('+')) {
      formatted = formatted.substring(1);
    }
    
    // If number has no country code (typically less than 10 digits or exactly 10 for some countries)
    // we leave it as is and let the user handle country codes correctly
    if (formatted.length <= 10) {
      console.log(`Warning: Phone number ${formatted} appears to be missing country code`);
    }
    
    // Log the formatted number for debugging
    console.log(`Formatted phone number: ${phoneNumber} → ${formatted}`);
    
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
      // First, attempt to close any existing client properly
      if (this.client) {
        try {
          console.log('Attempting to destroy existing client...');
          await this.client.destroy();
          this.client = null;
          console.log('Successfully destroyed client');
          
          // Give some time for file handles to be released
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (e) {
          console.log('Error destroying client:', e.message);
        }
      }
      
      // Look for lock files in the session directory
      const lockFiles = [
        'SingletonLock',
        'SingletonCookie',
        'SingletonSocket',
        '.lock',
        'lockfile',
        'LOCK',
        'CHROME_CRASHPAD_*',
        '*.tmp',
        'Crashpad',
        'CrashpadMetrics*.pma'
      ];
      
      // More thorough cleanup function that handles wildcards
      const cleanupDirectory = (dirPath) => {
        if (!fs.existsSync(dirPath)) return;
        
        const entries = fs.readdirSync(dirPath);
        
        // Process each lock file pattern
        for (const lockPattern of lockFiles) {
          // If it contains a wildcard
          if (lockPattern.includes('*')) {
            const regex = new RegExp('^' + lockPattern.replace(/\*/g, '.*') + '$');
            
            // Filter files matching the pattern
            const matchingFiles = entries.filter(entry => regex.test(entry));
            
            // Delete matching files
            for (const file of matchingFiles) {
              const filePath = path.join(dirPath, file);
              try {
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                  fs.unlinkSync(filePath);
                  console.log(`Removed lock file: ${filePath}`);
                } else if (stats.isDirectory()) {
                  // Recursively remove directories if needed
                  fs.rmdirSync(filePath, { recursive: true });
                  console.log(`Removed lock directory: ${filePath}`);
                }
              } catch (e) {
                console.error(`Failed to remove ${filePath}:`, e);
              }
            }
          } else {
            // Direct file check without wildcard
            const lockPath = path.join(dirPath, lockPattern);
            if (fs.existsSync(lockPath)) {
              try {
                const stats = fs.statSync(lockPath);
                if (stats.isFile()) {
                  fs.unlinkSync(lockPath);
                  console.log(`Removed lock file: ${lockPath}`);
                } else if (stats.isDirectory()) {
                  fs.rmdirSync(lockPath, { recursive: true });
                  console.log(`Removed lock directory: ${lockPath}`);
                }
              } catch (e) {
                console.error(`Failed to remove ${lockPath}:`, e);
              }
            }
          }
        }
      };
      
      // Clean main session directory
      cleanupDirectory(this.sessionPath);
      
      // Clean Default directory if it exists
      const defaultDir = path.join(this.sessionPath, 'Default');
      cleanupDirectory(defaultDir);
      
      // Clean Default/Network directory if it exists
      const networkDir = path.join(defaultDir, 'Network');
      cleanupDirectory(networkDir);
      
      // Delete any WebSocket tmp files
      const wsRegex = /\.websocket$/;
      const checkAndCleanWebSockets = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          fs.readdirSync(dirPath).forEach(file => {
            if (wsRegex.test(file)) {
              try {
                fs.unlinkSync(path.join(dirPath, file));
                console.log(`Removed WebSocket file: ${path.join(dirPath, file)}`);
              } catch (e) {
                console.error(`Failed to delete WebSocket file:`, e);
              }
            }
          });
        }
      };
      
      // Check multiple directories for WebSocket files
      checkAndCleanWebSockets(this.sessionPath);
      checkAndCleanWebSockets(defaultDir);
      checkAndCleanWebSockets(networkDir);
      
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
      console.log('Cleaning up old browser processes...');
      
      // If we're on Windows, use taskkill to clean up processes
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          
          // Try to kill any orphaned Chrome processes
          // /F = force, /T = terminate child processes too
          console.log('Attempting to kill orphaned Chrome processes...');
          const chromeKillCommands = [
            'taskkill /F /IM chrome.exe /T',
            'taskkill /F /IM msedge.exe /T',
            'taskkill /F /IM chromedriver.exe /T'
          ];
          
          for (const command of chromeKillCommands) {
            try {
              execSync(command, { stdio: 'ignore' });
            } catch (e) {
              // Ignore errors if no processes found
            }
          }
          
          console.log('Chrome processes cleanup completed');
        } catch (execError) {
          console.log('Error executing taskkill:', execError.message);
        }
      } else if (process.platform === 'darwin' || process.platform === 'linux') {
        // On Mac or Linux, use pkill
        try {
          const { execSync } = require('child_process');
          
          // Mac/Linux killing commands
          const killCommands = [
            'pkill -f "Google Chrome"',
            'pkill -f "Chromium"',
            'pkill -f "chrome"'
          ];
          
          for (const command of killCommands) {
            try {
              execSync(command, { stdio: 'ignore' });
            } catch (e) {
              // Ignore errors if no processes found
            }
          }
          
          console.log('Browser processes cleanup completed');
        } catch (execError) {
          console.log('Error executing pkill:', execError.message);
        }
      }
      
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

  /**
   * Check system for potential WhatsApp connection issues
   * @returns {Promise<Object>} - Diagnostic information
   */
  async checkSystemRequirements() {
    try {
      const diagnostics = {
        chromeInstalled: false,
        chromePath: null,
        nodeVersion: process.version,
        platform: process.platform,
        puppeteerVersion: 'Unknown',
        whatsappWebVersion: 'Unknown',
        issues: [],
        suggestions: []
      };

      // Check Chrome installation
      const possibleChromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      ];

      for (const browserPath of possibleChromePaths) {
        if (fs.existsSync(browserPath)) {
          diagnostics.chromeInstalled = true;
          diagnostics.chromePath = browserPath;
          break;
        }
      }

      if (!diagnostics.chromeInstalled) {
        diagnostics.issues.push('Chrome or Edge browser not found');
        diagnostics.suggestions.push('Install Google Chrome or Microsoft Edge');
      }

      // Check Node.js version
      const nodeVersionMatch = process.version.match(/^v(\d+)/);
      if (nodeVersionMatch && parseInt(nodeVersionMatch[1]) < 16) {
        diagnostics.issues.push('Node.js version is outdated');
        diagnostics.suggestions.push('Update Node.js to version 16 or later');
      }

      // Check puppeteer version
      try {
        const puppeteerPkg = require('puppeteer/package.json');
        diagnostics.puppeteerVersion = puppeteerPkg.version;
      } catch (e) {
        diagnostics.issues.push('Could not determine Puppeteer version');
      }

      // Check whatsapp-web.js version
      try {
        const wwjsPkg = require('whatsapp-web.js/package.json');
        diagnostics.whatsappWebVersion = wwjsPkg.version;
      } catch (e) {
        diagnostics.issues.push('Could not determine whatsapp-web.js version');
      }

      // Add general suggestions
      diagnostics.suggestions.push('Make sure Chromium dependencies are installed');
      diagnostics.suggestions.push('Ensure no firewall is blocking Chrome/Puppeteer');
      diagnostics.suggestions.push('Try running the app with admin privileges');
      
      if (process.platform === 'win32') {
        diagnostics.suggestions.push('On Windows, try disabling antivirus temporarily');
      }

      return diagnostics;
    } catch (error) {
      console.error('Error checking system requirements:', error);
      return {
        error: error.message,
        suggestions: [
          'Install Google Chrome or Microsoft Edge',
          'Make sure Chromium dependencies are installed',
          'Try running the app with admin privileges'
        ]
      };
    }
  }

  /**
   * Detect Chrome installation path
   * @returns {string|null} - Path to Chrome executable or null if not found
   */
  detectChromePath() {
    // Possible Chrome paths by platform
    const possiblePaths = {
      win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        // Chrome installed by user
        path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
        // Chrome Beta/Dev/Canary paths
        'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome SxS\\Application\\chrome.exe',
      ],
      darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        // User-specific installations
        path.join(os.homedir(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ],
      linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        // Snap installations
        '/snap/bin/chromium',
      ]
    };
    
    const platformPaths = possiblePaths[process.platform] || [];
    
    for (const browserPath of platformPaths) {
      try {
        if (fs.existsSync(browserPath)) {
          console.log(`Found browser at: ${browserPath}`);
          return browserPath;
        }
      } catch (error) {
        console.error(`Error checking browser path ${browserPath}:`, error);
      }
    }
    
    console.warn('No Chrome/Edge installation found at common paths, will use system default');
    return null;
  }

  /**
   * Get user-friendly suggestions based on error message
   * @param {Error} error - The error object
   * @returns {Promise<string[]>} Array of suggestions
   */
  async getSuggestionForError(error) {
    const suggestions = [];
    const errorMsg = error.message || '';
    
    if (errorMsg.includes('Failed to launch the browser process')) {
      suggestions.push('Chrome browser could not be launched. This could be due to:');
      suggestions.push('- Chrome is not installed or accessible at the expected location');
      suggestions.push('- Another Chrome instance is running with the same user profile');
      suggestions.push('- The system is low on memory or resources');
      suggestions.push('');
      suggestions.push('Try these solutions:');
      suggestions.push('1. Restart the application');
      suggestions.push('2. Close other Chrome browser windows');
      suggestions.push('3. Verify Chrome is properly installed on your system');
      suggestions.push('4. Restart your computer');
      
      // Check if Chrome is actually installed
      const diagnostics = await this.checkSystemRequirements();
      if (!diagnostics.chromeInstalled) {
        suggestions.push('');
        suggestions.push('IMPORTANT: No Chrome installation was detected on your system.');
        suggestions.push('Please install Google Chrome and try again.');
      }
    } 
    else if (errorMsg.includes('Timed out')) {
      suggestions.push('Connection timed out. This could be due to:');
      suggestions.push('- Poor internet connection');
      suggestions.push('- WhatsApp server issues');
      suggestions.push('- Firewall or antivirus blocking the connection');
      suggestions.push('');
      suggestions.push('Try these solutions:');
      suggestions.push('1. Check your internet connection');
      suggestions.push('2. Temporarily disable firewall or antivirus');
      suggestions.push('3. Try again later');
    }
    else if (errorMsg.includes('Protocol error') || errorMsg.includes('Target closed')) {
      suggestions.push('Browser communication error. This could be due to:');
      suggestions.push('- Chrome crashed or was closed externally');
      suggestions.push('- System resources are limited');
      suggestions.push('');
      suggestions.push('Try these solutions:');
      suggestions.push('1. Restart the application');
      suggestions.push('2. Close unnecessary applications to free resources');
      suggestions.push('3. Restart your computer');
    }
    
    return suggestions;
  }

  /**
   * Find installed Chrome or Edge browser path
   * @returns {Promise<string|null>} - Path to Chrome executable or null for bundled browser
   */
  async findChromePath() {
    try {
      // First try the detect function
      const detectedPath = this.detectChromePath();
      if (detectedPath) {
        return detectedPath;
      }
      
      // If not found and on Windows, try registry query (more reliable)
      if (process.platform === 'win32') {
        console.log('Trying to find Chrome/Edge via Windows registry...');
        try {
          const chromePath = await this.getWindowsChromePath();
          if (chromePath) {
            return chromePath;
          }
        } catch (regError) {
          console.error('Error finding Chrome via registry:', regError);
        }
      }
      
      // If we got this far, try to use the installed Puppeteer browser
      console.log('Trying to use bundled Puppeteer browser...');
      try {
        const puppeteer = require('puppeteer');
        const browserFetcher = puppeteer.createBrowserFetcher();
        const revisionInfo = await browserFetcher.download('latest');
        if (revisionInfo && revisionInfo.executablePath) {
          console.log(`Using bundled Puppeteer Chrome at ${revisionInfo.executablePath}`);
          return revisionInfo.executablePath;
        }
      } catch (puppeteerError) {
        console.error('Error trying to use bundled Puppeteer browser:', puppeteerError);
      }
      
      // If all else fails, return null to use system default
      return null;
    } catch (error) {
      console.error('Error in findChromePath:', error);
      return null;
    }
  }
  
  /**
   * Get Chrome path on Windows via registry
   * @returns {Promise<string|null>} - Path to Chrome executable or null
   */
  async getWindowsChromePath() {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      // Try Chrome first
      try {
        const { stdout: chromeKey } = await execAsync(
          'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve'
        );
        
        if (chromeKey && chromeKey.includes('REG_SZ')) {
          const match = chromeKey.match(/REG_SZ\s+([^\n]+)/);
          if (match && match[1]) {
            const path = match[1].trim();
            console.log(`Found Chrome via registry: ${path}`);
            return path;
          }
        }
      } catch (chromeError) {
        console.log('Chrome not found in registry, trying Edge...');
      }
      
      // Try Edge as fallback
      try {
        const { stdout: edgeKey } = await execAsync(
          'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe" /ve'
        );
        
        if (edgeKey && edgeKey.includes('REG_SZ')) {
          const match = edgeKey.match(/REG_SZ\s+([^\n]+)/);
          if (match && match[1]) {
            const path = match[1].trim();
            console.log(`Found Edge via registry: ${path}`);
            return path;
          }
        }
      } catch (edgeError) {
        console.log('Edge not found in registry.');
      }
      
      return null;
    } catch (error) {
      console.error('Error in getWindowsChromePath:', error);
      return null;
    }
  }
}

// Export singleton instance
const whatsAppService = new WhatsAppService();
module.exports = whatsAppService; 