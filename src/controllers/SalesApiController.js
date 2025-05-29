const axios = require('axios');
const { Op } = require('sequelize');
const { models, sequelize } = require('../database/db');
const SalesContact = models.SalesContact;

// Configuration
const AUTH_URL = 'https://crm-api.bss.com.al/authentication/login';
const SALES_API_URL = 'https://crm-api.bss.com.al/11120/Sales';
const CREDENTIALS = {
  userName: 'Admin',
  password: 'T3aWy<[3dq07'
};
const CITIES = ['tirane', 'vlore', 'fier'];
const REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes

class SalesApiController {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiration = null;
    this.timer = null;
    this.isRunning = false;
    this.lastSyncDate = null;
    this.nextSyncDate = null;
    this.syncStatus = {
      tirane: { lastSync: null, count: 0 },
      vlore: { lastSync: null, count: 0 },
      fier: { lastSync: null, count: 0 }
    };
    this.processedIds = {};
    
    console.log('SalesApiController initialized, isRunning:', this.isRunning);
  }

  async authenticate() {
    try {
      console.log('Authenticating with Sales API...');
      const response = await axios.post(AUTH_URL, CREDENTIALS, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;
      this.tokenExpiration = new Date();
      this.tokenExpiration.setHours(this.tokenExpiration.getHours() + 8); // Token valid for 8 hours

      console.log('Authentication successful');
      return true;
    } catch (error) {
      console.error('Authentication failed:', error.message);
      return false;
    }
  }

  isTokenValid() {
    if (!this.accessToken || !this.tokenExpiration) return false;
    const now = new Date();
    return now < this.tokenExpiration;
  }

  async ensureAuthenticated() {
    if (!this.isTokenValid()) {
      return await this.authenticate();
    }
    return true;
  }

  async fetchSalesContacts(city, date) {
    try {
      const isAuthenticated = await this.ensureAuthenticated();
      if (!isAuthenticated) {
        throw new Error('Failed to authenticate');
      }

      const formattedDate = this.formatDate(date);
      const url = `${SALES_API_URL}?Date=${formattedDate}&PageNumber=&PageSize=&HasPhone=true&CustomerGroup=PAKICE&Town=${city}`;
      
      console.log(`Fetching sales contacts for ${city} on ${formattedDate}...`);
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      return {
        data: response.data,
        city,
        date: date
      };
    } catch (error) {
      console.error(`Error fetching sales contacts for ${city}:`, error.message);
      return {
        data: [],
        city,
        date: date
      };
    }
  }

  formatDate(date) {
    const d = new Date(date);
    const month = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  }

  getDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  initializeProcessedIdsForDate(dateKey) {
    if (!this.processedIds[dateKey]) {
      this.processedIds[dateKey] = {
        tirane: new Set(),
        vlore: new Set(),
        fier: new Set()
      };
    }
  }

  async processSalesContacts(cityData) {
    const { data: contacts, city, date } = cityData;
    const dateKey = this.getDateKey(date);
    
    // Initialize the tracking sets for this date if they don't exist
    this.initializeProcessedIdsForDate(dateKey);
    
    const results = {
      total: contacts.length,
      created: 0,
      skipped: 0,
      duplicates: 0,
      errors: 0
    };

    for (const contact of contacts) {
      try {
        // Extract relevant data
        const businessEntity = contact.businessEntity || {};
        const phoneNumber = businessEntity.phone || '';
        const contactId = contact.id;
        
        // Skip records without a valid phone number
        if (!phoneNumber || !phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
          results.skipped++;
          continue;
        }

        // Check if this ID has already been processed for this city and date
        if (this.processedIds[dateKey][city].has(contactId)) {
          results.duplicates++;
          continue;
        }

        // Check if this contact ID already exists in the database
        // We're using toString() to ensure consistent comparison with the database
        const existingContact = await SalesContact.findOne({
          where: { contactId: contactId.toString() }
        });

        if (existingContact) {
          // Add to processed IDs to prevent checking again this session
          this.processedIds[dateKey][city].add(contactId);
          results.duplicates++;
          continue;
        }
        
        // Add to processed IDs
        this.processedIds[dateKey][city].add(contactId);
        
        // Prepare data for database
        const contactData = {
          contactId: contactId.toString(), // Ensure contactId is stored as string
          name: businessEntity.name || 'Unknown',
          phoneNumber: phoneNumber,
          code: businessEntity.code || '',
          city: city,
          documentNumber: contact.documentNumber || '',
          documentDate: contact.documentDate ? new Date(contact.documentDate) : null,
          shopId: businessEntity.shopId ? businessEntity.shopId.toString() : '',
          sourceData: JSON.stringify(contact)
        };

        // Create a new record
        await SalesContact.create(contactData);
        results.created++;
      } catch (error) {
        console.error('Error processing sales contact:', error.message);
        results.errors++;
      }
    }

    // Update sync status for this city
    this.syncStatus[city].lastSync = new Date();
    this.syncStatus[city].count += results.created;

    console.log(`Processed ${results.total} contacts for ${city}: ${results.created} created, ${results.duplicates} duplicates, ${results.skipped} skipped, ${results.errors} errors`);
    return results;
  }

  async startSyncProcess() {
    if (this.isRunning) {
      console.log('Sync process already running');
      return;
    }

    console.log('Starting sync process...');
    this.isRunning = true;
    try {
      // Get today's date
      const today = new Date();
      const dateKey = this.getDateKey(today);
      
      // Initialize the tracking sets for today if they don't exist
      this.initializeProcessedIdsForDate(dateKey);
      
      // Clean up old date keys (keep only the last 7 days)
      this.cleanupOldDateKeys();
      
      // Fetch for all cities in parallel
      const cityPromises = CITIES.map(city => this.fetchSalesContacts(city, today));
      const cityResults = await Promise.all(cityPromises);
      
      // Process results
      for (const cityData of cityResults) {
        await this.processSalesContacts(cityData);
      }
      
      this.lastSyncDate = new Date();
      this.nextSyncDate = new Date(Date.now() + REFRESH_INTERVAL);
      
      console.log('Sync process completed successfully');
    } catch (error) {
      console.error('Error in sync process:', error.message);
    } finally {
      this.isRunning = false;
      console.log('Sync process ended, isRunning set to false');
    }
  }

  cleanupOldDateKeys() {
    const today = new Date();
    const dateKeys = Object.keys(this.processedIds);
    
    // Keep only the last 7 days of data
    dateKeys.forEach(dateKey => {
      const dateParts = dateKey.split('-');
      const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      
      // If older than 7 days, remove
      const diffDays = Math.floor((today - dateObj) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) {
        delete this.processedIds[dateKey];
      }
    });
  }

  startPeriodicSync() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    console.log('Starting periodic sync process...');
    
    // Start immediately
    this.startSyncProcess();
    
    // Set up interval
    this.timer = setInterval(() => {
      console.log('Timer triggered, starting sync process...');
      this.startSyncProcess();
    }, REFRESH_INTERVAL);
    
    this.nextSyncDate = new Date(Date.now() + REFRESH_INTERVAL);
    console.log(`Periodic sync started with interval of ${REFRESH_INTERVAL / 1000} seconds`);
    console.log('Next sync scheduled for:', this.nextSyncDate);
  }

  stopPeriodicSync() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.nextSyncDate = null;
      console.log('Periodic sync stopped');
    }
  }

  async getSalesContacts(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        city = null,
        search = null,
        sortBy = 'createdAt',
        sortOrder = 'DESC',
        startDate = null,
        endDate = null
      } = options;
      
      const offset = (page - 1) * limit;
      
      // Build the where clause based on filters
      const where = {};
      
      if (city) {
        where.city = city;
      }
      
      if (startDate && endDate) {
        where.documentDate = {
          [Op.between]: [new Date(startDate), new Date(endDate)]
        };
      } else if (startDate) {
        where.documentDate = {
          [Op.gte]: new Date(startDate)
        };
      } else if (endDate) {
        where.documentDate = {
          [Op.lte]: new Date(endDate)
        };
      }
      
      // Handle search
      if (search) {
        where[Op.or] = [
          { name: { [Op.like]: `%${search}%` } },
          { phoneNumber: { [Op.like]: `%${search}%` } },
          { code: { [Op.like]: `%${search}%` } },
          { documentNumber: { [Op.like]: `%${search}%` } }
        ];
      }
      
      // Query with pagination
      const { rows, count } = await SalesContact.findAndCountAll({
        where,
        limit,
        offset,
        order: [[sortBy, sortOrder]],
        raw: true
      });
      
      return {
        data: rows,
        pagination: {
          total: count,
          page,
          limit,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      console.error('Error getting sales contacts:', error.message);
      throw error;
    }
  }

  async getSalesSummary() {
    try {
      // Get total counts by city
      const cityCounts = await SalesContact.findAll({
        attributes: [
          'city', 
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastRecord']
        ],
        group: ['city'],
        raw: true
      });
      
      // Get today's count
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayCount = await SalesContact.count({
        where: {
          createdAt: {
            [Op.gte]: today
          }
        }
      });
      
      // Format city data
      const cityData = {};
      CITIES.forEach(city => {
        const cityInfo = cityCounts.find(c => c.city === city) || { count: 0, lastRecord: null };
        cityData[city] = {
          count: parseInt(cityInfo.count || 0),
          lastSync: cityInfo.lastRecord ? new Date(cityInfo.lastRecord) : null
        };
      });
      
      return {
        totalRecords: cityCounts.reduce((sum, city) => sum + parseInt(city.count || 0), 0),
        todayCount,
        cities: cityData
      };
    } catch (error) {
      console.error('Error getting sales summary:', error.message);
      return {
        totalRecords: 0,
        todayCount: 0,
        cities: CITIES.reduce((obj, city) => ({ ...obj, [city]: { count: 0, lastSync: null } }), {})
      };
    }
  }

  async deleteSalesContacts(ids) {
    try {
      const result = await SalesContact.destroy({
        where: {
          id: {
            [Op.in]: ids
          }
        }
      });
      
      return {
        success: true,
        deleted: result
      };
    } catch (error) {
      console.error('Error deleting sales contacts:', error.message);
      throw error;
    }
  }

  async deleteAllSalesContacts() {
    try {
      const result = await SalesContact.destroy({
        where: {},
        truncate: true
      });
      
      // Clear the processed IDs cache
      this.processedIds = {};
      
      return {
        success: true,
        message: 'All sales contacts deleted'
      };
    } catch (error) {
      console.error('Error deleting all sales contacts:', error.message);
      throw error;
    }
  }

  async getSyncStatus() {
    // Get a summary of data from the database
    const summary = await this.getSalesSummary();
    
    const status = {
      isRunning: this.isRunning,
      lastSync: this.lastSyncDate,
      nextSync: this.nextSyncDate,
      syncStatus: this.syncStatus,
      summary,
      isAuthenticated: this.isTokenValid()
    };
    
    console.log('Getting sync status:', status.isRunning);
    return status;
  }

  // Get available cities for filtering
  getAvailableCities() {
    return CITIES;
  }
}

module.exports = new SalesApiController(); 