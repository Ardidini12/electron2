/**
 * Sales API Module
 * Handles integration with the sales API to fetch and manage sales contacts
 */
import { showNotification } from '../../utils/notifications.js';
import { formatDate, formatDateTime } from '../../utils/date-formatter.js';

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
      sortBy: 'createdAt',
      sortOrder: 'DESC'
    };
    this.selectedContacts = new Set();
    this.contactDetails = null;
    this.syncTimer = null;
    this.countdownInterval = null;
    this.refreshInterval = 120; // seconds
    this.countdown = this.refreshInterval;
    this.cities = [];
    this.isRefreshing = false;
    this.initialized = false;
    
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
   * Load sales contacts from API
   */
  async loadSalesContacts(forceRefresh = false) {
    try {
      this.showTableLoading();
      
      if (forceRefresh) {
        this.resetCountdown();
      }
      
      const options = {
        page: this.pagination.page,
        limit: this.pagination.limit,
        city: this.filters.city,
        search: this.filters.search,
        sortBy: this.filters.sortBy,
        sortOrder: this.filters.sortOrder,
        startDate: this.filters.startDate,
        endDate: this.filters.endDate
      };
      
      console.log('Loading sales contacts with options:', options);
      const result = await window.api.getSalesContacts(options);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      console.log('Loaded sales contacts:', result);
      this.contacts = result.data;
      this.pagination = result.pagination;
      
      if (this.contacts.length === 0) {
        this.renderEmptyState();
      } else {
        this.renderSalesContacts(this.contacts);
      }
      
      this.updatePagination();
      this.updateSelectAllCheckbox();
      this.updateDeleteSelectedButton();
    } catch (error) {
      console.error('Error loading sales contacts:', error);
      this.renderEmptyState('Error loading sales contacts: ' + error.message);
    }
  }
  
  /**
   * Show loading state in table
   */
  showTableLoading() {
    const tbody = document.getElementById('sales-contacts-tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="loading-row">
            <div class="loading-spinner">
              <i class="fas fa-sync-alt fa-spin"></i>
              <span>Loading contacts...</span>
            </div>
          </td>
        </tr>
      `;
    }
  }
  
  /**
   * Render empty state message
   * @param {string} message - Message to display
   */
  renderEmptyState(message = 'No sales contacts found.') {
    const tbody = document.getElementById('sales-contacts-tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">
            <i class="fas fa-info-circle"></i>
            <p>${message}</p>
          </td>
        </tr>
      `;
    }
  }
  
  /**
   * Render sales contacts in table
   * @param {Array} contacts - Sales contacts to render
   */
  renderSalesContacts(contacts) {
    const tbody = document.getElementById('sales-contacts-tbody');
    if (!tbody) return;
    
    console.log(`Rendering ${contacts.length} sales contacts`);
    
    tbody.innerHTML = '';
    
    contacts.forEach(contact => {
      const tr = document.createElement('tr');
      tr.dataset.id = contact.id;
      
      // Format dates for display
      const documentDate = contact.documentDate ? formatDate(contact.documentDate) : '';
      const createdAt = contact.createdAt ? formatDate(contact.createdAt) : '';
      
      // Check if this contact is in the selected set
      const isSelected = this.selectedContacts.has(contact.id);
      
      tr.innerHTML = `
        <td><input type="checkbox" class="select-contact" ${isSelected ? 'checked' : ''} data-id="${contact.id}"></td>
        <td>${contact.name || ''}</td>
        <td>${contact.phoneNumber || ''}</td>
        <td>${contact.code || ''}</td>
        <td>${contact.city || ''}</td>
        <td>${contact.documentNumber || ''}</td>
        <td>${documentDate}</td>
        <td>${createdAt}</td>
        <td class="actions">
          <button class="action-btn view-btn" data-id="${contact.id}" title="View Details">
            <i class="fas fa-eye"></i>
          </button>
        </td>
      `;
      
      tbody.appendChild(tr);
    });
    
    // Update the select all checkbox state after rendering
    this.updateSelectAllCheckbox();
    // Update delete button state
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
          
          if (e.target.checked) {
            this.selectedContacts.add(id);
            console.log(`Added contact ${id} to selection. Total: ${this.selectedContacts.size}`);
          } else {
            this.selectedContacts.delete(id);
            console.log(`Removed contact ${id} from selection. Total: ${this.selectedContacts.size}`);
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
    
    if (this.pagination.pages <= 1) {
      paginationContainer.innerHTML = '';
      return;
    }
    
    let paginationHTML = '<div class="pagination">';
    
    // Previous button
    paginationHTML += `
      <button ${this.pagination.page === 1 ? 'disabled' : ''} data-page="${this.pagination.page - 1}">
        <i class="fas fa-chevron-left"></i>
      </button>
    `;
    
    // Page numbers
    const startPage = Math.max(1, this.pagination.page - 2);
    const endPage = Math.min(this.pagination.pages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
      paginationHTML += `
        <button ${i === this.pagination.page ? 'class="active" disabled' : ''} data-page="${i}">
          ${i}
        </button>
      `;
    }
    
    // Next button
    paginationHTML += `
      <button ${this.pagination.page === this.pagination.pages ? 'disabled' : ''} data-page="${this.pagination.page + 1}">
        <i class="fas fa-chevron-right"></i>
      </button>
    `;
    
    paginationHTML += '</div>';
    
    // Add pagination info
    paginationHTML += `
      <div class="pagination-info">
        <span>Showing ${Math.min((this.pagination.page - 1) * this.pagination.limit + 1, this.pagination.total)} - 
        ${Math.min(this.pagination.page * this.pagination.limit, this.pagination.total)} 
        of ${this.pagination.total} contacts</span>
      </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
    
    // Attach event listeners to pagination buttons
    const paginationButtons = paginationContainer.querySelectorAll('button:not([disabled])');
    paginationButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.pagination.page = parseInt(button.dataset.page);
        this.loadSalesContacts();
      });
    });
  }
  
  /**
   * Handle sorting when a column header is clicked
   * @param {string} column - Column to sort by
   */
  handleSort(column) {
    if (this.filters.sortBy === column) {
      // Toggle sort order
      this.filters.sortOrder = this.filters.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      // New column, default to descending
      this.filters.sortBy = column;
      this.filters.sortOrder = 'DESC';
    }
    
    // Update UI to show sort direction
    this.updateSortUI();
    
    // Reload data with new sort
    this.loadSalesContacts();
  }
  
  /**
   * Update the sort UI to show current sort column and direction
   */
  updateSortUI() {
    // Remove sorting classes from all headers
    const headers = document.querySelectorAll('#sales-contacts-table th[data-sort]');
    headers.forEach(header => {
      header.classList.remove('sorted-asc', 'sorted-desc');
    });
    
    // Add sorting class to active header
    const activeHeader = document.querySelector(`#sales-contacts-table th[data-sort="${this.filters.sortBy}"]`);
    if (activeHeader) {
      const sortClass = this.filters.sortOrder === 'ASC' ? 'sorted-asc' : 'sorted-desc';
      activeHeader.classList.add(sortClass);
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
    }
    
    // Only reset countdown interval if it doesn't exist
    if (!this.countdownInterval) {
      this.countdownInterval = setInterval(() => {
        this.countdown--;
        if (this.countdown <= 0) {
          this.countdown = this.refreshInterval;
          // Trigger a refresh when countdown hits zero
          this.loadSalesContacts(true);
        }
        this.updateCountdownDisplay();
      }, 1000);
    }
    
    // Only set up sync timer if it doesn't exist
    if (!this.syncTimer) {
      // The main timer is just a backup in case the countdown doesn't trigger
      this.syncTimer = setInterval(() => {
        // Only refresh if countdown is at or very near zero
        if (this.countdown <= 2) {
          this.loadSalesContacts(true);
        }
      }, this.refreshInterval * 1000);
    }
    
    // Update display immediately
    this.updateCountdownDisplay();
    
    console.log('Auto-refresh setup complete: refresh every', this.refreshInterval, 'seconds, current countdown:', this.countdown);
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
    
    // Set more frequent checks if sync is running
    const checkInterval = isRunning ? 1000 : 5000; // 1 sec when running, 5 sec when idle
    
    this.syncStatusInterval = setInterval(() => {
      this.updateSyncStatus().then(stillRunning => {
        // If sync status changed, update the interval
        if (stillRunning !== isRunning) {
          this.setStatusCheckInterval(stillRunning);
        }
      });
    }, checkInterval);
  }
  
  /**
   * Update the sync status UI
   */
  async updateSyncStatus() {
    try {
      const status = await window.api.getSalesSyncStatus();
      console.log('Sync status response:', status);
      
      // Update sync status indicator
      const statusIndicator = document.getElementById('sales-sync-status');
      const statusText = document.getElementById('sales-sync-text');
      
      if (statusIndicator && statusText) {
        statusIndicator.className = 'status-indicator';
        
        // Check if isRunning is defined and is a boolean
        const isRunning = typeof status.isRunning === 'boolean' ? status.isRunning : false;
        console.log('Sync isRunning:', isRunning);
        
        if (isRunning) {
          statusIndicator.classList.add('running');
          statusText.textContent = 'Sync Status: Running';
        } else {
          statusIndicator.classList.add('stopped');
          statusText.textContent = 'Sync Status: Idle';
        }
      }
      
      // Track if last sync time has changed to trigger a refresh
      let syncTimeChanged = false;
      
      // Update last sync info
      const lastSyncElement = document.getElementById('last-sync-time');
      const nextSyncElement = document.getElementById('next-sync-time');
      
      if (lastSyncElement) {
        const currentText = lastSyncElement.textContent;
        const newText = status.lastSync ? formatDateTime(status.lastSync) : 'Never';
        
        // If the last sync time has changed, we'll refresh the data
        if (currentText !== newText) {
          syncTimeChanged = true;
        }
        
        lastSyncElement.textContent = newText;
      }
      
      if (nextSyncElement && status.nextSync) {
        nextSyncElement.textContent = formatDateTime(status.nextSync);
      }
      
      // Update sync stats
      this.updateSyncStats(status);
      
      // If sync time changed, refresh the contacts data
      if (syncTimeChanged && !this.isRefreshing) {
        console.log('Detected new sync completion, refreshing contacts data');
        this.isRefreshing = true;
        await this.loadSalesContacts();
        this.isRefreshing = false;
      }
      
      return typeof status.isRunning === 'boolean' ? status.isRunning : false;
    } catch (error) {
      console.error('Error updating sync status:', error);
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
} 