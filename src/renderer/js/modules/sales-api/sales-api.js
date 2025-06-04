/**
 * Sales API Module
 * Handles integration with the sales API to fetch and manage sales contacts
 */
import { showNotification } from '../../utils/notifications.js';
import { formatDate, formatDateTime } from '../../utils/date-formatter.js';
import * as salesMessages from './sales-messages.js';

// Create a singleton instance to ensure timer persistence across navigation
let salesApiInstance = null;

export default class SalesApiModule {
  constructor() {
    // If an instance already exists, return it
    if (salesApiInstance) {
      console.log('Returning existing Sales API module instance');
      return salesApiInstance;
    }

    console.log('Creating new Sales API module instance');
    this.contacts = [];
    this.pagination = {
      total: 0,
      page: 1,
      limit: 20,
      pages: 0
    };
    this.filters = {
      city: '',
      search: '',
      startDate: '',
      endDate: '',
      sortBy: 'documentDate',  // Default sort by document date
      sortOrder: 'DESC'
    };
    this.selectedContacts = new Set();
    this.contactDetails = null;
    this.syncTimer = null;
    this.countdownInterval = null;
    this.refreshInterval = 10; // seconds
    this.countdown = this.refreshInterval;
    this.cities = [];
    this.isRefreshing = false;
    this.initialized = false;
    
    // Add pagination styles
    this.addPaginationStyles();
    
    // Store the instance
    salesApiInstance = this;
  }
  
  /**
   * Initialize the module
   */
  async init() {
    console.log('Initializing Sales API module');
    
    // Skip initialization if already initialized
    if (this.initialized) {
      console.log('Sales API module already initialized, refreshing data');
      // Just update the countdown display without resetting timer
      this.updateCountdownDisplay();
      await this.loadSalesContacts();
      return true;
    }
    
    try {
      // Load available cities
      await this.loadCities();
      
      // Get initial data
      await this.loadSalesContacts();
      
      // Setup auto-refresh
      this.setupAutoRefresh();
      
      // Start sync status polling
      this.startSyncStatusCheck();
      
      // Attach event listeners
      this.attachEventListeners();
      
      // Setup table event listeners
      this.attachTableEventListeners();
      
      // Initialize sales messages UI
      await salesMessages.initSalesMessages();
      
      // Check if delete modal elements exist
      const deleteModal = document.getElementById('delete-sales-modal');
      const confirmBtn = document.getElementById('confirm-delete-sales');
      if (!deleteModal || !confirmBtn) {
        console.error('Delete modal or confirm button not found in the DOM');
      } else {
        console.log('Delete modal elements found and ready');
      }
      
      // Force an initial sync status check to update UI
      await this.updateSyncStatus();
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing Sales API module:', error);
      this.showNotification('Failed to initialize Sales API module: ' + error.message, 'error');
      return false;
    }
  }
  
  /**
   * Attach event listeners to DOM elements
   */
  attachEventListeners() {
    // Filter event listeners
    const cityFilter = document.getElementById('sales-city-filter');
    if (cityFilter) {
      cityFilter.addEventListener('change', () => {
        this.filters.city = cityFilter.value;
        this.pagination.page = 1;
        this.loadSalesContacts();
      });
      
      // Set the city filter value from filters (for persistence)
      cityFilter.value = this.filters.city;
    }

    const dateFrom = document.getElementById('sales-date-from');
    if (dateFrom) {
      dateFrom.addEventListener('change', () => {
        this.filters.startDate = dateFrom.value;
        this.pagination.page = 1;
        this.loadSalesContacts();
      });
      
      // Set the date filter value from filters (for persistence)
      dateFrom.value = this.filters.startDate;
    }

    const dateTo = document.getElementById('sales-date-to');
    if (dateTo) {
      dateTo.addEventListener('change', () => {
        this.filters.endDate = dateTo.value;
        this.pagination.page = 1;
        this.loadSalesContacts();
      });
      
      // Set the date filter value from filters (for persistence)
      dateTo.value = this.filters.endDate;
    }

    const searchInput = document.getElementById('sales-search');
    const searchBtn = document.getElementById('sales-search-btn');
    if (searchInput) {
      searchInput.value = this.filters.search;
      
      // Add input event for dynamic searching (as user types)
      searchInput.addEventListener('input', () => {
        // Use debounce technique to avoid too many requests
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.filters.search = searchInput.value.trim();
          this.pagination.page = 1;
          this.loadSalesContacts();
        }, 300); // 300ms debounce delay
      });
      
      // Keep the button click for compatibility
      if (searchBtn) {
        searchBtn.addEventListener('click', () => {
          this.filters.search = searchInput.value.trim();
          this.pagination.page = 1;
          this.loadSalesContacts();
        });
      }
    }

    // Delete buttons
    const deleteSelectedBtn = document.getElementById('delete-selected-sales');
    if (deleteSelectedBtn) {
      // Remove existing listeners to prevent duplicates
      deleteSelectedBtn.removeEventListener('click', this.handleDeleteSelected);
      
      // Create a bound method and save it for future cleanup
      this.handleDeleteSelected = () => {
        if (this.selectedContacts.size > 0) {
          this.showDeleteModal('selected');
        }
      };
      
      deleteSelectedBtn.addEventListener('click', this.handleDeleteSelected);
    }

    const deleteAllBtn = document.getElementById('delete-all-sales');
    if (deleteAllBtn) {
      // Remove existing listeners to prevent duplicates
      deleteAllBtn.removeEventListener('click', this.handleDeleteAll);
      
      // Create a bound method and save it for future cleanup
      this.handleDeleteAll = () => {
        this.showDeleteModal('all');
      };
      
      deleteAllBtn.addEventListener('click', this.handleDeleteAll);
    }

    const confirmDeleteBtn = document.getElementById('confirm-delete-sales');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', () => {
        this.handleDelete();
      });
    }

    // Add refresh button
    const refreshBtn = document.getElementById('refresh-sales-data');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadSalesContacts(true);
      });
    }
    
    // Add a force sync button to the sync controls
    const syncStatusContainer = document.querySelector('.sync-status');
    if (syncStatusContainer) {
      // Check if the force sync button already exists
      let forceSyncBtn = document.getElementById('force-sync-btn');
      
      // Only create the button if it doesn't already exist
      if (!forceSyncBtn) {
        forceSyncBtn = document.createElement('button');
        forceSyncBtn.id = 'force-sync-btn';
        forceSyncBtn.className = 'primary-btn small';
        forceSyncBtn.title = 'Force sync with Sales API now';
        forceSyncBtn.innerHTML = '<i class="fas fa-sync"></i> Force Sync';
        forceSyncBtn.style.marginLeft = '10px';
        
        forceSyncBtn.addEventListener('click', () => {
          this.forceSyncNow();
        });
        
        syncStatusContainer.appendChild(forceSyncBtn);
      }
    }
    
    // Add data recovery section
    this.setupRecoveryUI();
  }
  
  /**
   * Set up the data recovery UI
   */
  setupRecoveryUI() {
    // Find the container for the recovery UI (below the sync status)
    const container = document.querySelector('.sales-api-controls');
    if (!container) return;
    
    // Check if the recovery section already exists
    if (document.getElementById('recovery-section')) return;
    
    // Create the recovery section
    const recoverySection = document.createElement('div');
    recoverySection.id = 'recovery-section';
    recoverySection.className = 'recovery-section';
    recoverySection.style.marginTop = '20px';
    recoverySection.style.padding = '15px';
    recoverySection.style.backgroundColor = '#f5f5f5';
    recoverySection.style.borderRadius = '5px';
    recoverySection.style.border = '1px solid #ddd';
    
    // Add heading
    const heading = document.createElement('h3');
    heading.textContent = 'Data Recovery';
    heading.style.marginTop = '0';
    heading.style.marginBottom = '10px';
    recoverySection.appendChild(heading);
    
    // Add description
    const description = document.createElement('p');
    description.textContent = 'Recover sales data from past days when the application was not running.';
    description.style.marginBottom = '15px';
    recoverySection.appendChild(description);
    
    // Create date inputs container
    const dateContainer = document.createElement('div');
    dateContainer.style.display = 'flex';
    dateContainer.style.gap = '10px';
    dateContainer.style.marginBottom = '15px';
    dateContainer.style.alignItems = 'center';
    
    // From date
    const fromDateLabel = document.createElement('label');
    fromDateLabel.textContent = 'From:';
    fromDateLabel.htmlFor = 'recovery-date-from';
    fromDateLabel.style.marginRight = '5px';
    dateContainer.appendChild(fromDateLabel);
    
    const fromDate = document.createElement('input');
    fromDate.type = 'date';
    fromDate.id = 'recovery-date-from';
    fromDate.className = 'form-control';
    
    // Set default from date (30 days ago)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    fromDate.value = this.formatDateForInput(thirtyDaysAgo);
    
    dateContainer.appendChild(fromDate);
    
    // To date
    const toDateLabel = document.createElement('label');
    toDateLabel.textContent = 'To:';
    toDateLabel.htmlFor = 'recovery-date-to';
    toDateLabel.style.marginRight = '5px';
    toDateLabel.style.marginLeft = '10px';
    dateContainer.appendChild(toDateLabel);
    
    const toDate = document.createElement('input');
    toDate.type = 'date';
    toDate.id = 'recovery-date-to';
    toDate.className = 'form-control';
    
    // Set default to date (yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    toDate.value = this.formatDateForInput(yesterday);
    
    dateContainer.appendChild(toDate);
    
    recoverySection.appendChild(dateContainer);
    
    // Add recovery button
    const recoveryButton = document.createElement('button');
    recoveryButton.id = 'start-recovery-btn';
    recoveryButton.className = 'primary-btn';
    recoveryButton.innerHTML = '<i class="fas fa-history"></i> Start Recovery';
    recoveryButton.onclick = () => this.startRecovery();
    
    recoverySection.appendChild(recoveryButton);
    
    // Add recovery status
    const recoveryStatus = document.createElement('div');
    recoveryStatus.id = 'recovery-status';
    recoveryStatus.className = 'recovery-status';
    recoveryStatus.style.marginTop = '10px';
    recoveryStatus.style.display = 'none';
    recoverySection.appendChild(recoveryStatus);
    
    // Append the recovery section to the container
    container.appendChild(recoverySection);
  }
  
  /**
   * Start the recovery process with the selected date range
   */
  async startRecovery() {
    // Get the selected date range
    const fromDateInput = document.getElementById('recovery-date-from');
    const toDateInput = document.getElementById('recovery-date-to');
    
    if (!fromDateInput || !toDateInput) {
      this.showNotification('Recovery date inputs not found', 'error');
      return;
    }
    
    const fromDate = fromDateInput.value;
    const toDate = toDateInput.value;
    
    if (!fromDate || !toDate) {
      this.showNotification('Please select both from and to dates', 'error');
      return;
    }
    
    // Validate date range
    const fromDateObj = new Date(fromDate);
    const toDateObj = new Date(toDate);
    
    // Set to beginning of day for accurate comparison
    fromDateObj.setHours(0, 0, 0, 0);
    toDateObj.setHours(0, 0, 0, 0);
    
    if (fromDateObj > toDateObj) {
      this.showNotification('From date must be before to date', 'error');
      return;
    }
    
    // Update UI to show recovery is in progress
    const recoveryButton = document.getElementById('start-recovery-btn');
    if (recoveryButton) {
      recoveryButton.disabled = true;
      recoveryButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recovery in Progress...';
    }
    
    const recoveryStatus = document.getElementById('recovery-status');
    if (recoveryStatus) {
      recoveryStatus.style.display = 'block';
      recoveryStatus.innerHTML = '<p><i class="fas fa-info-circle"></i> Recovery in progress. This may take a while depending on the date range.</p>';
    }
    
    try {
      // Call the API to start recovery
      const result = await window.api.manualSalesRecovery(fromDate, toDate);
      
      if (result.success) {
        // Update UI with success message
        if (recoveryStatus) {
          let message = `<p><i class="fas fa-check-circle" style="color: green;"></i> Recovery completed successfully.</p>`;
          message += `<p>Processed ${result.results.totalProcessed} contacts, created ${result.results.totalCreated} new contacts.</p>`;
          
          // Add city breakdown if available
          if (result.results.byCity) {
            message += '<ul style="margin-top: 5px; padding-left: 20px;">';
            for (const city in result.results.byCity) {
              const cityResult = result.results.byCity[city];
              message += `<li>${city}: ${cityResult.created} new contacts from ${cityResult.processed} processed</li>`;
            }
            message += '</ul>';
          }
          
          recoveryStatus.innerHTML = message;
        }
        
        // Refresh the data table
        await this.loadSalesContacts(true);
        
        this.showNotification('Recovery completed successfully', 'success');
      } else {
        // Show error message
        if (recoveryStatus) {
          recoveryStatus.innerHTML = `<p><i class="fas fa-exclamation-circle" style="color: red;"></i> Recovery failed: ${result.message || 'Unknown error'}</p>`;
        }
        this.showNotification(`Recovery failed: ${result.message || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('Error during recovery:', error);
      
      // Update UI with error message
      if (recoveryStatus) {
        recoveryStatus.innerHTML = `<p><i class="fas fa-exclamation-circle" style="color: red;"></i> Error during recovery: ${error.message || 'Unknown error'}</p>`;
      }
      
      this.showNotification(`Error during recovery: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      // Re-enable the recovery button
      if (recoveryButton) {
        recoveryButton.disabled = false;
        recoveryButton.innerHTML = '<i class="fas fa-history"></i> Start Recovery';
      }
    }
  }
  
  /**
   * Load cities from API and populate dropdown
   */
  async loadCities() {
    try {
      console.log('Fetching available cities...');
      const cities = await window.api.getAvailableCities();
      
      // Check if cities is an array
      if (!Array.isArray(cities)) {
        console.error('Cities is not an array:', cities);
        if (cities && cities.error) {
          console.error('Error from API:', cities.error);
        }
        this.cities = ['tirane', 'vlore', 'fier']; // Fallback to hardcoded cities
      } else {
        this.cities = cities;
      }
      
      console.log('Available cities:', this.cities);
      
      // Populate city filter dropdown
      const cityFilter = document.getElementById('sales-city-filter');
      if (cityFilter) {
        cityFilter.innerHTML = '<option value="">All Cities</option>';
        
        this.cities.forEach(city => {
          const option = document.createElement('option');
          option.value = city;
          option.textContent = city.charAt(0).toUpperCase() + city.slice(1);
          cityFilter.appendChild(option);
        });
        
        // Restore selected city if any
        if (this.filters.city) {
          cityFilter.value = this.filters.city;
        }
        
        console.log('City filter populated with options:', cityFilter.options.length);
      } else {
        console.error('City filter element not found in the DOM');
      }
    } catch (error) {
      console.error('Error loading cities:', error);
      this.showNotification('Error loading cities: ' + error.message, 'error');
      
      // Fallback to hardcoded cities
      this.cities = ['tirane', 'vlore', 'fier'];
      
      // Try to populate dropdown with fallback values
      const cityFilter = document.getElementById('sales-city-filter');
      if (cityFilter) {
        cityFilter.innerHTML = '<option value="">All Cities</option>';
        
        this.cities.forEach(city => {
          const option = document.createElement('option');
          option.value = city;
          option.textContent = city.charAt(0).toUpperCase() + city.slice(1);
          cityFilter.appendChild(option);
        });
        
        console.log('City filter populated with fallback options');
      }
    }
  }
  
  /**
   * Format date for input fields
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string in YYYY-MM-DD format
   */
  formatDateForInput(date) {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  
  /**
   * Load sales contacts from the API
   * @param {boolean} forceRefresh - Whether to force refresh even if already refreshing
   */
  async loadSalesContacts(forceRefresh = false) {
    if (this.isRefreshing && !forceRefresh) {
      console.log('Already refreshing, skipping...');
      return;
    }
    
    try {
      this.isRefreshing = true;
      
      // Show loading spinner
      this.showTableLoading();
      
      // Set default sort if not set
      if (!this.filters.sortBy) {
        this.filters.sortBy = 'documentDate';
        this.filters.sortOrder = 'DESC';
      }
      
      // Prepare options for API call
      const options = {
        page: this.pagination.page,
        limit: this.pagination.limit,
        city: this.filters.city,
        search: this.filters.search,
        startDate: this.filters.startDate,
        endDate: this.filters.endDate,
        sortBy: this.filters.sortBy,
        sortOrder: this.filters.sortOrder
      };
      
      // Make API call
      const response = await window.api.getSalesContacts(options);
      
      // Check for errors
      if (response.error) {
        throw new Error(response.error);
      }
      
      // Update contacts and pagination
      this.contacts = response.data;
      this.pagination = response.pagination;
      
      // Render contacts
      if (this.contacts.length === 0) {
        this.renderEmptyState();
      } else {
        this.renderSalesContacts(this.contacts);
      }
      
      // Update pagination UI
      this.updatePagination();
      
      // Make sure sort UI is updated
      this.updateSortUI();
      
      // Reset countdown if we had an auto-refresh
      if (!forceRefresh) {
        this.resetCountdown();
      }
      
      // Log success
      console.log(`Loaded ${this.contacts.length} sales contacts`);
      
      return true;
    } catch (error) {
      console.error('Error loading sales contacts:', error);
      this.renderEmptyState(`Error loading contacts: ${error.message}`);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }
  
  /**
   * Show loading indicator in the table
   */
  showTableLoading() {
    const tableBody = document.getElementById('sales-contacts-tbody');
    if (!tableBody) return;
    
    // Clear the table and show loading indicator
    tableBody.innerHTML = `
      <tr class="loading-row">
        <td colspan="9" class="text-center">
            <div class="loading-spinner">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Loading contacts...</p>
            </div>
          </td>
        </tr>
      `;
  }
  
  /**
   * Render empty state message
   * @param {string} message - Message to display
   */
  renderEmptyState(message = 'No sales contacts found.') {
    const tableBody = document.getElementById('sales-contacts-tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9" class="text-center">
          <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <p>${message}</p>
          </div>
          </td>
        </tr>
      `;
  }
  
  /**
   * Render sales contacts in the table
   * @param {Array} contacts - Array of sales contacts to render
   */
  renderSalesContacts(contacts) {
    const tableBody = document.getElementById('sales-contacts-tbody');
    if (!tableBody) return;
    
    // Clear the table
    tableBody.innerHTML = '';
    
    // Add the table header if not present
    const tableHead = document.querySelector('#sales-contacts-table thead');
    if (tableHead && tableHead.innerHTML === '') {
      tableHead.innerHTML = `
        <tr>
          <th width="40">
            <input type="checkbox" id="select-all-sales" title="Select All">
          </th>
          <th data-sort="name">Name <i class="fas fa-sort"></i></th>
          <th data-sort="phoneNumber">Phone <i class="fas fa-sort"></i></th>
          <th data-sort="code">Code <i class="fas fa-sort"></i></th>
          <th data-sort="city">City <i class="fas fa-sort"></i></th>
          <th data-sort="documentNumber">Document # <i class="fas fa-sort"></i></th>
          <th data-sort="documentDate">Document Date <i class="fas fa-sort"></i></th>
          <th data-sort="createdAt">Added On <i class="fas fa-sort"></i></th>
          <th width="100">Actions</th>
        </tr>
      `;
      
      // Add sort event listeners
      const sortHeaders = tableHead.querySelectorAll('th[data-sort]');
      sortHeaders.forEach(header => {
        header.addEventListener('click', () => {
          this.handleSort(header.dataset.sort);
        });
      });
      
      // Add select all checkbox event listener
      const selectAllCheckbox = document.getElementById('select-all-sales');
      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
          this.toggleSelectAll();
        });
      }
    }
    
    // Update the sort UI
    this.updateSortUI();
    
    // Add the contacts to the table
    contacts.forEach(contact => {
      const row = document.createElement('tr');
      
      // Format document date
      let documentDate = 'N/A';
      if (contact.documentDate) {
        documentDate = formatDate(new Date(contact.documentDate));
      }
      
      // Format created date
      let createdDate = 'N/A';
      if (contact.createdAt) {
        createdDate = formatDate(new Date(contact.createdAt));
      }
      
      row.innerHTML = `
        <td>
          <input type="checkbox" class="select-contact" data-id="${contact.id}" title="Select">
        </td>
        <td>${contact.name || 'N/A'}</td>
        <td>${contact.phoneNumber || 'N/A'}</td>
        <td>${contact.code || 'N/A'}</td>
        <td>${contact.city || 'N/A'}</td>
        <td>${contact.documentNumber || 'N/A'}</td>
        <td>${documentDate}</td>
        <td>${createdDate}</td>
        <td>
          <button class="action-btn view-btn" data-id="${contact.id}" title="View Details">
            <i class="fas fa-eye"></i>
          </button>
        </td>
      `;
      
      // Check if contact is selected
      if (this.selectedContacts.has(contact.id)) {
        const checkbox = row.querySelector('.select-contact');
        checkbox.checked = true;
      }
      
      tableBody.appendChild(row);
    });
    
    // Add event listeners to view buttons
    const viewButtons = tableBody.querySelectorAll('.view-btn');
    viewButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.viewContactDetails(button.dataset.id);
      });
    });
    
    // Add event listeners to select checkboxes
    const selectCheckboxes = tableBody.querySelectorAll('.select-contact');
    selectCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedContacts.add(parseInt(checkbox.dataset.id));
        } else {
          this.selectedContacts.delete(parseInt(checkbox.dataset.id));
        }
        this.updateSelectAllCheckbox();
        this.updateDeleteSelectedButton();
      });
    });
    
    // Update the select all checkbox
    this.updateSelectAllCheckbox();
    
    // Update the delete selected button
    this.updateDeleteSelectedButton();
  }
  
  /**
   * Attach event listeners to table elements
   */
  attachTableEventListeners() {
    // Select all checkbox
    const selectAllCheckbox = document.getElementById('select-all-sales-contacts');
    if (selectAllCheckbox) {
      // Remove any existing event listeners to prevent duplicates
      selectAllCheckbox.removeEventListener('change', this.handleSelectAll);
      
      // Add the event listener with a bound function reference
      this.handleSelectAll = this.toggleSelectAll.bind(this);
      selectAllCheckbox.addEventListener('change', this.handleSelectAll);
    }
    
    // Contact selection - use event delegation for better performance
    const tbody = document.getElementById('sales-contacts-tbody');
    if (tbody) {
      // Remove existing event listener if any
      if (this.handleCheckboxChange) {
        tbody.removeEventListener('change', this.handleCheckboxChange);
      }
      
      // Add new event listener
      this.handleCheckboxChange = (e) => {
        if (e.target.classList.contains('select-contact')) {
          const id = parseInt(e.target.dataset.id);
          const isChecked = e.target.checked;
          
          if (isChecked) {
            this.selectedContacts.add(id);
            console.log(`Added contact ${id} to selection. Total: ${this.selectedContacts.size}`);
          } else {
            this.selectedContacts.delete(id);
            console.log(`Removed contact ${id} from selection. Total: ${this.selectedContacts.size}`);
          }
          
          // Update row styling
          const row = e.target.closest('tr');
          if (row) {
            if (isChecked) {
              row.classList.add('selected');
            } else {
              row.classList.remove('selected');
            }
          }
          
          this.updateSelectAllCheckbox();
          this.updateDeleteSelectedButton();
        }
      };
      
      tbody.addEventListener('change', this.handleCheckboxChange);
    }
    
    // View contact details - use event delegation
    const contactsTable = document.getElementById('sales-contacts-table');
    if (contactsTable) {
      // Remove existing listener if any
      if (this.handleViewClick) {
        contactsTable.removeEventListener('click', this.handleViewClick);
      }
      
      // Add new click listener
      this.handleViewClick = (e) => {
        const viewBtn = e.target.closest('.view-btn');
        if (viewBtn) {
          const id = parseInt(viewBtn.dataset.id);
          this.viewContactDetails(id);
        }
      };
      
      contactsTable.addEventListener('click', this.handleViewClick);
    }
    
    // Sorting headers
    const tableHeaders = document.querySelectorAll('#sales-contacts-table th[data-sort]');
    tableHeaders.forEach(header => {
      header.addEventListener('click', () => {
        const column = header.dataset.sort;
        this.handleSort(column);
      });
    });
  }
  
  /**
   * Update the pagination UI
   */
  updatePagination() {
    const paginationContainer = document.getElementById('sales-pagination');
    if (!paginationContainer) return;
    
    // Clear the container
      paginationContainer.innerHTML = '';
    
    const { total, page, limit, pages } = this.pagination;
    
    // If no data or only one page, hide pagination
    if (total === 0 || pages <= 1) {
      paginationContainer.style.display = 'none';
      return;
    }
    
    // Show pagination container
    paginationContainer.style.display = 'flex';
    
    // Create pagination info
    const paginationInfo = document.createElement('div');
    paginationInfo.className = 'pagination-info';
    paginationInfo.innerHTML = `Showing <span>${Math.min((page - 1) * limit + 1, total)}-${Math.min(page * limit, total)}</span> of <span>${total}</span> entries`;
    paginationContainer.appendChild(paginationInfo);
    
    // Create pagination controls
    const paginationControls = document.createElement('div');
    paginationControls.className = 'pagination';
    
    // First page button
    const firstPageBtn = document.createElement('button');
    firstPageBtn.innerHTML = '<i class="fas fa-angle-double-left"></i>';
    firstPageBtn.title = 'First Page';
    firstPageBtn.disabled = page === 1;
    firstPageBtn.addEventListener('click', () => {
      if (page !== 1) {
        this.pagination.page = 1;
        this.loadSalesContacts();
      }
    });
    paginationControls.appendChild(firstPageBtn);
    
    // Previous page button
    const prevPageBtn = document.createElement('button');
    prevPageBtn.innerHTML = '<i class="fas fa-angle-left"></i>';
    prevPageBtn.title = 'Previous Page';
    prevPageBtn.disabled = page === 1;
    prevPageBtn.addEventListener('click', () => {
      if (page > 1) {
        this.pagination.page = page - 1;
        this.loadSalesContacts();
      }
    });
    paginationControls.appendChild(prevPageBtn);
    
    // Page number buttons
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(pages, page + 2);
    
    // Show ellipsis for first pages if needed
    if (startPage > 1) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      
      // Add page 1 button before ellipsis
      const firstBtn = document.createElement('button');
      firstBtn.textContent = '1';
      firstBtn.addEventListener('click', () => {
        this.pagination.page = 1;
        this.loadSalesContacts();
      });
      paginationControls.appendChild(firstBtn);
      
      paginationControls.appendChild(ellipsis);
    }
    
    // Page number buttons
    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.textContent = i;
      pageBtn.className = i === page ? 'active' : '';
      pageBtn.addEventListener('click', () => {
        if (i !== page) {
          this.pagination.page = i;
        this.loadSalesContacts();
        }
      });
      paginationControls.appendChild(pageBtn);
    }
    
    // Show ellipsis for last pages if needed
    if (endPage < pages) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      paginationControls.appendChild(ellipsis);
      
      // Add last page button after ellipsis
      const lastBtn = document.createElement('button');
      lastBtn.textContent = pages;
      lastBtn.addEventListener('click', () => {
        this.pagination.page = pages;
        this.loadSalesContacts();
      });
      paginationControls.appendChild(lastBtn);
    }
    
    // Next page button
    const nextPageBtn = document.createElement('button');
    nextPageBtn.innerHTML = '<i class="fas fa-angle-right"></i>';
    nextPageBtn.title = 'Next Page';
    nextPageBtn.disabled = page === pages;
    nextPageBtn.addEventListener('click', () => {
      if (page < pages) {
        this.pagination.page = page + 1;
        this.loadSalesContacts();
      }
    });
    paginationControls.appendChild(nextPageBtn);
    
    // Last page button
    const lastPageBtn = document.createElement('button');
    lastPageBtn.innerHTML = '<i class="fas fa-angle-double-right"></i>';
    lastPageBtn.title = 'Last Page';
    lastPageBtn.disabled = page === pages;
    lastPageBtn.addEventListener('click', () => {
      if (page !== pages) {
        this.pagination.page = pages;
        this.loadSalesContacts();
      }
    });
    paginationControls.appendChild(lastPageBtn);
    
    // Add page size selector
    const pageSizeSelector = document.createElement('select');
    pageSizeSelector.className = 'page-size-selector';
    pageSizeSelector.title = 'Items per page';
    pageSizeSelector.style.marginLeft = '10px';
    
    [10, 20, 50, 100].forEach(size => {
      const option = document.createElement('option');
      option.value = size;
      option.textContent = `${size} items`;
      option.selected = size === this.pagination.limit;
      pageSizeSelector.appendChild(option);
    });
    
    pageSizeSelector.addEventListener('change', () => {
      this.pagination.limit = parseInt(pageSizeSelector.value);
      this.pagination.page = 1; // Reset to first page
      this.loadSalesContacts();
    });
    
    paginationControls.appendChild(pageSizeSelector);
    
    paginationContainer.appendChild(paginationControls);
  }
  
  /**
   * Handle sorting when a column header is clicked
   * @param {string} column - Column to sort by
   */
  handleSort(column) {
    console.log(`Sorting by ${column}`);
    
    // If clicking the same column, toggle the sort order
    if (this.filters.sortBy === column) {
      this.filters.sortOrder = this.filters.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      // If clicking a different column, set it as the sort column with default DESC order
      this.filters.sortBy = column;
      this.filters.sortOrder = 'DESC'; // Default to descending
    }
    
    // Reset to first page when changing sort
    this.pagination.page = 1;
    
    // Update UI to reflect the new sort
    this.updateSortUI();
    
    // Reload data with new sort
    this.loadSalesContacts();
  }
  
  /**
   * Update the sort UI to indicate the current sort column and direction
   */
  updateSortUI() {
    // Find all sort headers
    const headers = document.querySelectorAll('#sales-contacts-table th[data-sort]');
    
    // Remove all sort classes
    headers.forEach(header => {
      header.classList.remove('sort-asc', 'sort-desc', 'sort-active');
      
      // Reset any modified icons back to fa-sort
      const icon = header.querySelector('i');
      if (icon) {
        icon.className = 'fas fa-sort';
      }
    });
    
    // Add the appropriate class to the current sort column
    const currentSortHeader = document.querySelector(`#sales-contacts-table th[data-sort="${this.filters.sortBy}"]`);
    if (currentSortHeader) {
      currentSortHeader.classList.add(this.filters.sortOrder === 'ASC' ? 'sort-asc' : 'sort-desc');
      currentSortHeader.classList.add('sort-active');
      
      // Update the icon to show sort direction
      const icon = currentSortHeader.querySelector('i');
      if (icon) {
        icon.className = `fas ${this.filters.sortOrder === 'ASC' ? 'fa-sort-up' : 'fa-sort-down'}`;
      }
    }
  }
  
  /**
   * Toggle select all checkboxes
   */
  toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('select-all-sales-contacts');
    if (!selectAllCheckbox) return;
    
    console.log('Toggle select all, checked:', selectAllCheckbox.checked);
    
    const isChecked = selectAllCheckbox.checked;
    
    // Update all checkboxes
    const checkboxes = document.querySelectorAll('.select-contact');
    console.log(`Found ${checkboxes.length} contact checkboxes`);
    
    // Clear the selected contacts if unchecking all
    if (!isChecked) {
      this.selectedContacts.clear();
    }
    
    checkboxes.forEach(checkbox => {
      checkbox.checked = isChecked;
      
      const id = parseInt(checkbox.dataset.id);
      if (isChecked) {
        this.selectedContacts.add(id);
      }
      
      // Update row styling
      const row = checkbox.closest('tr');
      if (row) {
        if (isChecked) {
          row.classList.add('selected');
        } else {
          row.classList.remove('selected');
        }
      }
    });
    
    console.log(`Selected contacts after toggle: ${this.selectedContacts.size}`);
    
    // Update the delete button state
    this.updateDeleteSelectedButton();
  }
  
  /**
   * Update the state of the select all checkbox
   */
  updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('select-all-sales-contacts');
    if (!selectAllCheckbox) return;
    
    const checkboxes = document.querySelectorAll('.select-contact');
    const checkedCount = document.querySelectorAll('.select-contact:checked').length;
    
    if (checkboxes.length === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    }
  }
  
  /**
   * Update the state of the delete selected button
   */
  updateDeleteSelectedButton() {
    const deleteSelectedBtn = document.getElementById('delete-selected-sales');
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = this.selectedContacts.size === 0;
    }
  }
  
  /**
   * Show delete confirmation modal
   * @param {string} type - Type of deletion (selected, all)
   */
  showDeleteModal(type) {
    const modal = document.getElementById('delete-sales-modal');
    const message = document.getElementById('delete-sales-message');
    
    if (modal && message) {
      // Clear any existing event listeners
      const closeButtons = modal.querySelectorAll('.close-modal');
      closeButtons.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
      });
      
      const confirmBtn = document.getElementById('confirm-delete-sales');
      if (confirmBtn) {
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        // Add event listener to the new confirm button
        const newConfirmBtnElement = document.getElementById('confirm-delete-sales');
        if (newConfirmBtnElement) {
          newConfirmBtnElement.addEventListener('click', () => {
            this.handleDelete();
          });
        }
      }
      
      if (type === 'selected') {
        message.textContent = `Are you sure you want to delete ${this.selectedContacts.size} selected contacts?`;
      } else {
        message.textContent = 'Are you sure you want to delete ALL sales contacts? This action cannot be undone.';
      }
      
      // Set the delete type
      modal.dataset.deleteType = type;
      
      // Show the modal
      modal.classList.add('visible');
      
      // Add close event listeners
      const newCloseButtons = modal.querySelectorAll('.close-modal');
      newCloseButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          modal.classList.remove('visible');
        });
      });
    }
  }
  
  /**
   * Handle deletion of contacts
   */
  async handleDelete() {
    const modal = document.getElementById('delete-sales-modal');
    if (!modal) return;
    
    // Disable confirm button to prevent double clicks
    const confirmBtn = document.getElementById('confirm-delete-sales');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
    }
    
    const deleteType = modal.dataset.deleteType;
    let success = false;
    
    try {
      console.log(`Deleting ${deleteType === 'selected' ? 'selected' : 'all'} sales contacts...`);
      
      if (deleteType === 'selected' && this.selectedContacts.size > 0) {
        // Convert Set to Array for the API call
        const selectedIdsArray = Array.from(this.selectedContacts);
        console.log('Deleting selected contacts:', selectedIdsArray);
        
        // Ensure the API receives the array of IDs
        const result = await window.api.deleteSalesContacts(selectedIdsArray);
        
        if (!result) {
          throw new Error('No response from API when deleting contacts');
        }
        
        success = result.success === true;
        console.log('Delete result:', result);
        
        if (success) {
          // Show success notification with count
          const deletedCount = result.deleted || selectedIdsArray.length;
          this.showNotification(`Successfully deleted ${deletedCount} contacts`, 'success');
          
          // Clear selected contacts
          this.selectedContacts.clear();
        } else {
          throw new Error(result.error || 'Unknown error during deletion');
        }
      } else if (deleteType === 'all') {
        console.log('Deleting all sales contacts');
        
        const result = await window.api.deleteAllSalesContacts();
        
        if (!result) {
          throw new Error('No response from API when deleting all contacts');
        }
        
        success = result.success === true;
        console.log('Delete all result:', result);
        
        if (success) {
          this.showNotification(`Successfully deleted all sales contacts`, 'success');
        } else {
          throw new Error(result.error || 'Unknown error during deletion');
        }
      }
      
      if (success) {
        // Reload contacts
        this.pagination.page = 1;
        await this.loadSalesContacts();
        
        // Update UI
        this.updateSelectAllCheckbox();
        this.updateDeleteSelectedButton();
      }
    } catch (error) {
      console.error('Error deleting contacts:', error);
      this.showNotification('Error deleting contacts: ' + error.message, 'error');
    } finally {
      // Re-enable button
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Delete';
      }
      
      // Close modal
      modal.classList.remove('visible');
    }
  }
  
  /**
   * View contact details
   * @param {number} id - Contact ID
   */
  async viewContactDetails(id) {
    try {
      // Find the contact in the current list
      const contact = this.contacts.find(c => c.id === id);
      
      if (!contact) {
        throw new Error('Contact not found');
      }
      
      this.contactDetails = contact;
      
      // Show the modal
      const modal = document.getElementById('sales-contact-details-modal');
      const detailsContainer = document.getElementById('sales-contact-details');
      const sourceDataPre = document.getElementById('source-data');
      
      if (modal && detailsContainer && sourceDataPre) {
        // Format dates for display
        const documentDate = contact.documentDate ? formatDateTime(contact.documentDate) : 'N/A';
        const createdAt = contact.createdAt ? formatDateTime(contact.createdAt) : 'N/A';
        const importedAt = contact.importedAt ? formatDateTime(contact.importedAt) : 'N/A';
        
        // Build the details HTML
        detailsContainer.innerHTML = `
          <div class="details-grid">
            <div class="detail-item" tabindex="0">
              <div class="detail-label">Name</div>
              <div class="detail-value">${contact.name || 'N/A'}</div>
            </div>
            <div class="detail-item" tabindex="0">
              <div class="detail-label">Phone Number</div>
              <div class="detail-value">${contact.phoneNumber || 'N/A'}</div>
            </div>
            <div class="detail-item" tabindex="0">
              <div class="detail-label">Code</div>
              <div class="detail-value">${contact.code || 'N/A'}</div>
            </div>
            <div class="detail-item" tabindex="0">
              <div class="detail-label">City</div>
              <div class="detail-value">${contact.city || 'N/A'}</div>
            </div>
            <div class="detail-item" tabindex="0">
              <div class="detail-label">Document Number</div>
              <div class="detail-value">${contact.documentNumber || 'N/A'}</div>
            </div>
            <div class="detail-item" tabindex="0">
              <div class="detail-label">Document Date</div>
              <div class="detail-value">${documentDate}</div>
            </div>
            <div class="detail-item" tabindex="0">
              <div class="detail-label">Shop ID</div>
              <div class="detail-value">${contact.shopId || 'N/A'}</div>
            </div>
            <div class="detail-item" tabindex="0">
              <div class="detail-label">Created At</div>
              <div class="detail-value">${createdAt}</div>
            </div>
            ${contact.imported ? `
              <div class="detail-item" tabindex="0">
                <div class="detail-label">Imported</div>
                <div class="detail-value">Yes</div>
              </div>
              <div class="detail-item" tabindex="0">
                <div class="detail-label">Imported At</div>
                <div class="detail-value">${importedAt}</div>
              </div>
            ` : ''}
          </div>
        `;
        
        // Format the source data as JSON
        try {
          const sourceData = JSON.parse(contact.sourceData);
          sourceDataPre.textContent = JSON.stringify(sourceData, null, 2);
        } catch (e) {
          sourceDataPre.textContent = contact.sourceData || 'No source data available';
          console.warn('Error parsing source data:', e);
        }
        
        // Clean up existing event listeners by cloning and replacing
        const closeButtons = modal.querySelectorAll('.close-modal');
        closeButtons.forEach(btn => {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
        });
        
        // Show the modal
        modal.classList.add('visible');
        
        // Create a function to close the modal and store it on the instance
        this.closeContactDetailsModal = () => {
          modal.classList.remove('visible');
          // Remove the event listeners
          document.removeEventListener('mousedown', this.handleModalOutsideClick);
          document.removeEventListener('keydown', this.handleModalEscapeKey);
        };
        
        // Create and store event handler functions
        this.handleModalOutsideClick = (event) => {
          if (modal.classList.contains('visible')) {
            // Check if the click is outside the modal content
            const modalContent = modal.querySelector('.modal-content');
            if (modalContent && !modalContent.contains(event.target) && modal === event.target) {
              this.closeContactDetailsModal();
            }
          }
        };
        
        this.handleModalEscapeKey = (event) => {
          if (event.key === 'Escape' && modal.classList.contains('visible')) {
            this.closeContactDetailsModal();
          }
        };
        
        // Add close button event listeners
        const newCloseButtons = modal.querySelectorAll('.close-modal');
        newCloseButtons.forEach(btn => {
          btn.addEventListener('click', this.closeContactDetailsModal);
        });
        
        // Add event listener for clicking outside the modal
        document.addEventListener('mousedown', this.handleModalOutsideClick);
        
        // Add event listener for escape key
        document.addEventListener('keydown', this.handleModalEscapeKey);
        
        // Set focus on the first detail item for keyboard navigation
        const firstDetailItem = detailsContainer.querySelector('.detail-item');
        if (firstDetailItem) {
          setTimeout(() => {
            firstDetailItem.focus();
          }, 100);
        }
        
        // Add arrow key navigation for detail items
        this.handleDetailKeydown = (event) => {
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            return;
          }
          
          const detailItems = Array.from(document.querySelectorAll('.detail-item'));
          const currentIndex = detailItems.indexOf(document.activeElement);
          
          if (currentIndex === -1) return;
          
          let nextIndex;
          const itemsPerRow = Math.floor(detailsContainer.offsetWidth / 250); // Approximate width of each item
          
          switch (event.key) {
            case 'ArrowUp':
              nextIndex = Math.max(0, currentIndex - itemsPerRow);
              break;
            case 'ArrowDown':
              nextIndex = Math.min(detailItems.length - 1, currentIndex + itemsPerRow);
              break;
            case 'ArrowLeft':
              nextIndex = Math.max(0, currentIndex - 1);
              break;
            case 'ArrowRight':
              nextIndex = Math.min(detailItems.length - 1, currentIndex + 1);
              break;
          }
          
          if (nextIndex !== currentIndex && detailItems[nextIndex]) {
            detailItems[nextIndex].focus();
            event.preventDefault();
          }
        };
        
        // Attach keydown event listener for navigation
        detailsContainer.addEventListener('keydown', this.handleDetailKeydown);
        
        // Store this listener so we can remove it when closing the modal
        const originalCloseModalFunction = this.closeContactDetailsModal;
        this.closeContactDetailsModal = () => {
          originalCloseModalFunction();
          // Remove the detail keydown listener
          if (detailsContainer) {
            detailsContainer.removeEventListener('keydown', this.handleDetailKeydown);
          }
        };
      }
    } catch (error) {
      console.error('Error viewing contact details:', error);
      this.showNotification('Error viewing contact details: ' + error.message, 'error');
    }
  }
  
  /**
   * Setup auto-refresh
   */
  setupAutoRefresh() {
    // Clear any existing intervals
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    
    // Reset the countdown
    this.countdown = this.refreshInterval;
    
    // Set up countdown interval
    this.countdownInterval = setInterval(() => {
      this.countdown--;
      if (this.countdown <= 0) {
        this.countdown = this.refreshInterval;
        // Trigger a refresh when countdown hits zero
        if (!this.isRefreshing) {
          this.loadSalesContacts(true);
        }
      }
      this.updateCountdownDisplay();
    }, 1000);
    
    // Update display immediately
    this.updateCountdownDisplay();
    
    console.log('Auto-refresh setup complete: refresh every', this.refreshInterval, 'seconds');
  }
  
  /**
   * Reset the countdown to full interval
   */
  resetCountdown() {
    this.countdown = this.refreshInterval;
    this.updateCountdownDisplay();
    console.log('Countdown reset to', this.countdown);
  }
  
  updateCountdownDisplay() {
    const countdownElement = document.getElementById('refresh-countdown');
    if (countdownElement) {
      countdownElement.textContent = this.countdown;
    }
  }
  
  /**
   * Start checking sync status periodically
   */
  startSyncStatusCheck() {
    // Store the interval IDs for cleanup
    this.syncStatusInterval = null;
    
    // Initial check
    this.updateSyncStatus().then(isRunning => {
      // Set up the appropriate interval based on sync status
      this.setStatusCheckInterval(isRunning);
    });
  }
  
  /**
   * Set the interval for status checks based on current sync status
   */
  setStatusCheckInterval(isRunning) {
    // Clear any existing interval
    if (this.syncStatusInterval) {
      clearInterval(this.syncStatusInterval);
    }
    
    // Set fixed interval of 2 seconds - frequent enough for responsiveness
    // but not too frequent to overload the system
    const checkInterval = 2000; // 2 seconds
    
    this.syncStatusInterval = setInterval(() => {
      this.updateSyncStatus().then(stillRunning => {
        // If sync status changed, update the UI (no need to reset interval)
        if (stillRunning !== isRunning) {
          this.isRunning = stillRunning;
          console.log('Sync status changed:', stillRunning ? 'now running' : 'now idle');
        }
      });
    }, checkInterval);
    
    console.log(`Status check interval set to ${checkInterval}ms`);
  }
  
  /**
   * Update the sync status UI
   */
  async updateSyncStatus() {
    try {
      const status = await window.api.getSalesSyncStatus();
      
      // Update sync status indicator
      const statusIndicator = document.getElementById('sales-sync-status');
      const statusText = document.getElementById('sales-sync-text');
      
      if (statusIndicator && statusText) {
        statusIndicator.className = 'status-indicator';
        
        // Check if isRunning is defined and is a boolean
        const isRunning = typeof status.isRunning === 'boolean' ? status.isRunning : false;
        
        if (isRunning) {
          statusIndicator.classList.add('running');
          statusText.textContent = 'Sync Status: Running';
        } else {
          statusIndicator.classList.add('stopped');
          statusText.textContent = 'Sync Status: Idle';
        }
      }
      
      // Check if last sync time has changed from our stored value
      let shouldRefresh = false;
      
      if (status.lastSync) {
        const newSyncTime = new Date(status.lastSync).getTime();
        
        if (!this.lastSyncTime || newSyncTime > this.lastSyncTime) {
          shouldRefresh = true;
          this.lastSyncTime = newSyncTime;
          console.log('New sync detected, will refresh data');
        }
      }
      
      // Update last sync info
      const lastSyncElement = document.getElementById('last-sync-time');
      if (lastSyncElement) {
        lastSyncElement.textContent = status.lastSync ? formatDateTime(status.lastSync) : 'Never';
      }
      
      // Update next sync info
      const nextSyncElement = document.getElementById('next-sync-time');
      if (nextSyncElement && status.nextSync) {
        nextSyncElement.textContent = formatDateTime(status.nextSync);
      }
      
      // Update sync stats
      this.updateSyncStats(status);
      
      // Refresh the contacts data if needed
      if (shouldRefresh && !this.isRefreshing) {
        this.isRefreshing = true;
        try {
          await this.loadSalesContacts();
        } finally {
          this.isRefreshing = false;
        }
      }
      
      return typeof status.isRunning === 'boolean' ? status.isRunning : false;
    } catch (error) {
      console.error('Error updating sync status:', error);
      
      // Update UI to show error state
      const statusIndicator = document.getElementById('sales-sync-status');
      const statusText = document.getElementById('sales-sync-text');
      
      if (statusIndicator) {
        statusIndicator.className = 'status-indicator stopped';
      }
      
      if (statusText) {
        statusText.textContent = 'Sync Status: Error';
      }
      
      return false;
    }
  }
  
  updateSyncStats(status) {
    const statsContainer = document.getElementById('sync-stats-container');
    if (!statsContainer || !status.summary) return;
    
    let statsHTML = `
      <div class="sync-stats-header">
        <h3>Sync Statistics</h3>
        <div class="stats-total">Total Records: <span>${status.summary.totalRecords}</span></div>
        <div class="stats-today">Today: <span>${status.summary.todayCount}</span></div>
      </div>
      <div class="city-stats-container">
    `;
    
    // Add city-specific stats
    Object.keys(status.summary.cities).forEach(city => {
      const cityData = status.summary.cities[city];
      const lastSync = cityData.lastSync ? formatDateTime(cityData.lastSync) : 'Never';
      
      statsHTML += `
        <div class="city-stat">
          <div class="city-name">${city.charAt(0).toUpperCase() + city.slice(1)}</div>
          <div class="city-count">Records: <span>${cityData.count}</span></div>
          <div class="city-last-sync">Last Sync: <span>${lastSync}</span></div>
        </div>
      `;
    });
    
    statsHTML += '</div>';
    
    statsContainer.innerHTML = statsHTML;
  }
  
  /**
   * Show a notification
   * @param {string} message - Notification message
   * @param {string} type - Notification type (success, error, info)
   */
  showNotification(message, type = 'info') {
    showNotification(message, type);
  }
  
  /**
   * Clean up resources when module is destroyed
   */
  destroy() {
    // Don't actually destroy resources since we want to persist state
    console.log('Sales API module destroy called, but persisting timers');
    
    // Instead of destroying, just clean up UI elements
    const forceSyncBtn = document.getElementById('force-sync-btn');
    if (forceSyncBtn) {
      forceSyncBtn.remove();
    }
    
    // Clean up event listeners
    const deleteSelectedBtn = document.getElementById('delete-selected-sales');
    const deleteAllBtn = document.getElementById('delete-all-sales');
    
    if (deleteSelectedBtn && this.handleDeleteSelected) {
      deleteSelectedBtn.removeEventListener('click', this.handleDeleteSelected);
    }
    
    if (deleteAllBtn && this.handleDeleteAll) {
      deleteAllBtn.removeEventListener('click', this.handleDeleteAll);
    }
    
    // Clean up table event listeners
    const tbody = document.getElementById('sales-contacts-tbody');
    const selectAllCheckbox = document.getElementById('select-all-sales-contacts');
    const contactsTable = document.getElementById('sales-contacts-table');
    
    if (tbody && this.handleCheckboxChange) {
      tbody.removeEventListener('change', this.handleCheckboxChange);
    }
    
    if (selectAllCheckbox && this.handleSelectAll) {
      selectAllCheckbox.removeEventListener('change', this.handleSelectAll);
    }
    
    if (contactsTable && this.handleViewClick) {
      contactsTable.removeEventListener('click', this.handleViewClick);
    }
  }
  
  /**
   * Force a sync now (for testing)
   */
  async forceSyncNow() {
    try {
      // Disable the button during sync
      const forceSyncBtn = document.getElementById('force-sync-btn');
      if (forceSyncBtn) {
        forceSyncBtn.disabled = true;
        forceSyncBtn.innerHTML = '<i class="fas fa-sync fa-spin"></i> Syncing...';
      }
      
      console.log('Forcing manual sync...');
      const result = await window.api.startSalesSync();
      console.log('Manual sync start result:', result);
      
      this.showNotification('Manual sync started', 'info');
      
      // Update status immediately
      await this.updateSyncStatus();
      
      // Check status repeatedly to ensure UI updates
      const checkStatusInterval = setInterval(async () => {
        const isRunning = await this.updateSyncStatus();
        if (!isRunning) {
          // Sync is complete
          clearInterval(checkStatusInterval);
          console.log('Manual sync completed');
          this.showNotification('Manual sync completed', 'success');
          
          // Enable the button again once sync is complete
          if (forceSyncBtn) {
            forceSyncBtn.disabled = false;
            forceSyncBtn.innerHTML = '<i class="fas fa-sync"></i> Force Sync';
          }
          
          // Reload the data
          await this.loadSalesContacts();
        }
      }, 1000);
      
      // Set a timeout to prevent the interval from running forever
      setTimeout(() => {
        clearInterval(checkStatusInterval);
        if (forceSyncBtn && forceSyncBtn.disabled) {
          forceSyncBtn.disabled = false;
          forceSyncBtn.innerHTML = '<i class="fas fa-sync"></i> Force Sync';
        }
      }, 30000); // 30 second max timeout
    } catch (error) {
      console.error('Error forcing sync:', error);
      this.showNotification('Error starting manual sync: ' + error.message, 'error');
      
      // Re-enable the button on error
      const forceSyncBtn = document.getElementById('force-sync-btn');
      if (forceSyncBtn) {
        forceSyncBtn.disabled = false;
        forceSyncBtn.innerHTML = '<i class="fas fa-sync"></i> Force Sync';
      }
    }
  }
  
  /**
   * Add CSS styles for the enhanced pagination and sorting
   */
  addPaginationStyles() {
    // Check if styles already exist
    if (document.getElementById('sales-pagination-styles')) return;
    
    const styleElement = document.createElement('style');
    styleElement.id = 'sales-pagination-styles';
    styleElement.textContent = `
      #sales-pagination {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 20px;
        padding: 10px 0;
      }
      
      .pagination-info {
        font-size: 14px;
        color: #666;
      }
      
      .pagination-info span {
        font-weight: 600;
        color: #333;
      }
      
      .pagination {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      
      .pagination button {
        min-width: 32px;
        height: 32px;
        background-color: #f5f5f5;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .pagination button:hover:not(:disabled) {
        background-color: #e0e0e0;
        border-color: #ccc;
      }
      
      .pagination button.active {
        background-color: #4a90e2;
        border-color: #4a90e2;
        color: white;
        font-weight: 600;
      }
      
      .pagination button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .pagination span {
        color: #666;
        margin: 0 2px;
      }
      
      .page-size-selector {
        height: 32px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background-color: #f5f5f5;
        padding: 0 8px;
        cursor: pointer;
        font-size: 14px;
      }
      
      /* Enhanced styles for sortable table headers */
      #sales-contacts-table th[data-sort] {
        cursor: pointer;
        position: relative;
        padding-right: 25px;
        transition: background-color 0.2s;
      }
      
      #sales-contacts-table th[data-sort]:hover {
        background-color: #f0f0f0;
      }
      
      #sales-contacts-table th[data-sort] i {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        color: #aaa;
        font-size: 12px;
      }
      
      /* Active sort column styling */
      #sales-contacts-table th.sort-active {
        background-color: #f0f7ff;
        border-bottom: 2px solid #4a90e2;
        color: #1a73e8;
        font-weight: 600;
      }
      
      #sales-contacts-table th.sort-active i {
        color: #1a73e8;
        font-size: 14px;
      }
      
      /* Sort direction indicators */
      #sales-contacts-table th.sort-asc i.fa-sort-up,
      #sales-contacts-table th.sort-desc i.fa-sort-down {
        color: #1a73e8;
      }
      
      /* Row hover effect */
      #sales-contacts-table tbody tr:hover {
        background-color: #f5f9ff;
      }
      
      /* Alternating row colors for better readability */
      #sales-contacts-table tbody tr:nth-child(even) {
        background-color: #fafafa;
      }
      
      /* Selection styling */
      #sales-contacts-table tbody tr.selected {
        background-color: #e8f0fe;
      }
    `;
    
    document.head.appendChild(styleElement);
  }
} 