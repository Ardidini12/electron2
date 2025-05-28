// templates.js - Template management functionality
import { api } from '../utils/api.js';
import { showToast, showConfirmDialog } from '../ui/notifications.js';

// DOM Elements cache
let elements = {};

// Templates cache
let templates = [];
let currentPage = 1;
const templatesPerPage = 12;

/**
 * Initialize the templates module
 */
export async function initTemplates() {
  // Cache DOM elements
  cacheElements();
  
  // Set up event listeners
  setupEventListeners();
  
  // Load templates
  await loadTemplates();
  
  // Initialize template variables dropdown
  initializeVariablesDropdown();
  
  console.log('Templates module initialized');
}

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
  elements = {
    addTemplateBtn: document.getElementById('add-template'),
    templatesGrid: document.getElementById('templates-grid'),
    templateModal: document.getElementById('template-modal'),
    templateForm: document.getElementById('template-form'),
    templateId: document.getElementById('template-id'),
    templateName: document.getElementById('template-name'),
    templateContent: document.getElementById('template-content'),
    templateImagePath: document.getElementById('template-image-path'),
    templateImageBtn: document.getElementById('browse-image'),
    templateImagePreview: document.getElementById('template-image-preview'),
    saveTemplateBtn: document.getElementById('save-template'),
    cancelTemplateBtn: document.getElementById('cancel-template'),
    footerRemoveImageBtn: document.getElementById('footer-remove-image'),
    templateSearch: document.getElementById('template-search'),
    templateSearchBtn: document.getElementById('template-search-btn'),
    totalTemplates: document.getElementById('total-templates'),
    imagePreviewContainer: document.getElementById('image-preview-container')
  };
}

/**
 * Set up event listeners for template management
 */
function setupEventListeners() {
  // Add new template button
  elements.addTemplateBtn.addEventListener('click', () => {
    showTemplateModal();
  });
  
  // Save template button
  elements.saveTemplateBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    await saveTemplate();
  });
  
  // Cancel template button
  if (elements.cancelTemplateBtn) {
    elements.cancelTemplateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeTemplateModal();
    });
  }
  
  // Close modal on overlay click
  elements.templateModal.addEventListener('click', (e) => {
    if (e.target === elements.templateModal) {
      closeTemplateModal();
    }
  });
  
  // Close button in modal header
  const closeButtons = document.querySelectorAll('.close-modal');
  closeButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      closeTemplateModal();
    });
  });
  
  // Image selection button
  elements.templateImageBtn.addEventListener('click', async (e) => {
    e.preventDefault(); // Prevent default to avoid navigation
    await selectTemplateImage();
  });
  
  // Image removal button in preview container
  const removeImageBtn = document.getElementById('remove-image');
  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent default to avoid navigation
      removeTemplateImage();
    });
  }
  
  // Footer remove image button
  if (elements.footerRemoveImageBtn) {
    elements.footerRemoveImageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      removeTemplateImage();
    });
  }
  
  // Template search
  elements.templateSearch.addEventListener('input', () => {
    filterTemplates(elements.templateSearch.value);
  });
  
  elements.templateSearchBtn.addEventListener('click', () => {
    filterTemplates(elements.templateSearch.value);
  });
  
  // Template variables help toggle
  const variablesToggle = document.querySelector('.variables-toggle');
  if (variablesToggle) {
    variablesToggle.addEventListener('click', () => {
      const content = document.querySelector('.variables-content');
      if (!content) return;
      
      // Get computed style to check actual display value
      const computedStyle = window.getComputedStyle(content);
      const isVisible = computedStyle.display !== 'none';
      
      // Toggle visibility
      content.style.display = isVisible ? 'none' : 'block';
      
      // Toggle arrow direction
      variablesToggle.classList.toggle('open', !isVisible);
      
      // Log for debugging
      console.log(`Variables content is now ${!isVisible ? 'visible' : 'hidden'}`);
    });
  }
  
  // Make variable items clickable to add them to the template
  const variableItems = document.querySelectorAll('.variable-item');
  
  // Use a single global debounce flag instead of individual ones
  let globalInsertionInProgress = false;
  let lastInsertionTime = 0;
  
  variableItems.forEach(item => {
    // Use a proper click handler with debounce mechanism
    item.addEventListener('click', (e) => {
      // Prevent event bubbling
      e.stopPropagation();
      e.preventDefault();
      
      // Check if we've inserted very recently (prevents double insertion)
      const now = Date.now();
      if (now - lastInsertionTime < 800) {
        console.log('Recent insertion detected, preventing duplicate');
        return;
      }
      
      // If another insertion is in progress, ignore this click entirely
      if (globalInsertionInProgress) {
        console.log('Global insertion in progress, ignoring click');
        return;
      }
      
      // Set the global flag to prevent any other insertions
      globalInsertionInProgress = true;
      lastInsertionTime = now;
      
      try {
        // Get the variable code from the clicked element
        const codeElement = item.querySelector('code');
        if (!codeElement) {
          console.error('No code element found in variable item');
          return;
        }
        
        const variableCode = codeElement.textContent;
        console.log('Inserting variable:', variableCode);
        
        // Insert the variable
        insertVariableToTemplate(variableCode);
      } catch (error) {
        console.error('Error inserting variable:', error);
      } finally {
        // Reset the flag after a delay to prevent multiple inserts
        setTimeout(() => {
          globalInsertionInProgress = false;
          console.log('Variable insertion lock released');
        }, 800); // Longer timeout for extra safety
      }
    }, { capture: true }); // Use capture phase to handle event before bubbling
  });
  
  // Prevent any click on the variables content from triggering multiple inserts
  const variablesContent = document.querySelector('.variables-content');
  if (variablesContent) {
    variablesContent.addEventListener('click', (e) => {
      // Only stop propagation for clicks directly on the variables content
      // or any non-variable item children
      if (e.target === variablesContent || !e.target.closest('.variable-item')) {
        e.stopPropagation();
      }
    });
  }
}

/**
 * Load templates from the backend
 */
export async function loadTemplates() {
  try {
    elements.templatesGrid.innerHTML = '<div class="loading">Loading templates...</div>';
    const result = await window.api.getTemplates();
    
    console.log('API getTemplates raw result:', result);
    
    if (result && Array.isArray(result)) {
      templates = result;
      updateTemplateCount();
      displayTemplates();
    } else {
      console.error('Invalid response from getTemplates:', result);
      elements.templatesGrid.innerHTML = '<div class="error">Failed to load templates.</div>';
    }
  } catch (error) {
    console.error('Error in loadTemplates:', error);
    elements.templatesGrid.innerHTML = `<div class="error">Error: ${error.message}</div>`;
  }
}

/**
 * Display templates in the grid with pagination
 * @param {Array} filteredTemplates - Optional filtered templates array
 */
function displayTemplates(filteredTemplates) {
  // Filter out templates with missing/invalid id, name, or content
  let templatesToDisplay = filteredTemplates || templates;
  
  // Add additional logging to debug the issue
  console.log('Raw templates before filtering:', JSON.stringify(templatesToDisplay));
  
  templatesToDisplay = templatesToDisplay.filter(t => {
    // More robust validation that handles null/undefined values
    const valid = t && 
                  (typeof t.id === 'number' && t.id > 0) && 
                  t.name !== undefined && 
                  t.name !== null && 
                  t.content !== undefined && 
                  t.content !== null;
    if (!valid) {
      console.error('Invalid template found and skipped:', t);
    }
    return valid;
  });
  
  // Clear the grid
  elements.templatesGrid.innerHTML = '';
  
  console.log('Attempting to display templates, count:', templatesToDisplay.length);
  console.log('Templates data:', JSON.stringify(templatesToDisplay).substring(0, 500) + '...');
  
  if (templatesToDisplay.length === 0) {
    console.warn('No templates to display, showing empty state');
    elements.templatesGrid.innerHTML = '<div class="empty-state">No templates found. Create your first template!</div>';
    return;
  }
  
  // Calculate pagination
  const startIndex = (currentPage - 1) * templatesPerPage;
  const endIndex = startIndex + templatesPerPage;
  const paginatedTemplates = templatesToDisplay.slice(startIndex, endIndex);
  
  console.log(`Displaying ${paginatedTemplates.length} templates (page ${currentPage})`);
  
  // Create template cards
  paginatedTemplates.forEach((template, index) => {
    console.log(`Creating card for template ${index}:`, template.id, template.name);
    const templateCard = createTemplateCard(template);
    elements.templatesGrid.appendChild(templateCard);
  });
  
  // Add pagination controls if needed
  if (templatesToDisplay.length > templatesPerPage) {
    addPaginationControls(templatesToDisplay.length);
  }
}

/**
 * Create a template card element
 * @param {Object} template - Template data
 * @returns {HTMLElement} Template card element
 */
function createTemplateCard(template) {
  if (!template || typeof template !== 'object') return document.createElement('div');
  const safeTemplate = {
    id: template.id,
    name: template.name || 'Unnamed Template',
    content: template.content || '',
    imagePath: template.imagePath || null
  };
  const card = document.createElement('div');
  card.className = 'template-card';
  card.dataset.id = safeTemplate.id;
  const contentPreview = document.createElement('div');
  contentPreview.className = 'template-content-preview';
  contentPreview.style.maxHeight = '120px';
  contentPreview.style.overflow = 'auto';
  contentPreview.style.position = 'relative';
  if (safeTemplate.content) contentPreview.innerHTML = safeTemplate.content;
  if (safeTemplate.imagePath) {
    const img = document.createElement('img');
    img.src = safeTemplate.imagePath;
    img.className = 'template-image-thumbnail';
    img.alt = 'Template image';
    contentPreview.appendChild(img);
  }
  const header = document.createElement('div');
  header.className = 'template-header';
  header.innerHTML = `<h3>${safeTemplate.name}</h3>`;
  const actions = document.createElement('div');
  actions.className = 'template-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'edit-btn';
  editBtn.innerHTML = '<i class="fas fa-edit"></i>';
  editBtn.title = 'Edit template';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const templateId = Number(safeTemplate.id);
    if (isNaN(templateId)) {
      showToast('Template not found', 'error');
      return;
    }
    editTemplate(templateId);
  });
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
  deleteBtn.title = 'Delete template';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const templateId = Number(safeTemplate.id);
    if (isNaN(templateId)) {
      showToast('Template not found', 'error');
      return;
    }
    deleteTemplate(templateId);
  });
  const viewBtn = document.createElement('button');
  viewBtn.className = 'view-btn';
  viewBtn.innerHTML = '<i class="fas fa-eye"></i>';
  viewBtn.title = 'View full template';
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    viewTemplate(safeTemplate);
  });
  actions.appendChild(viewBtn);
  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  card.appendChild(header);
  card.appendChild(contentPreview);
  card.appendChild(actions);
  return card;
}

/**
 * Add pagination controls to the templates grid
 * @param {number} totalItems - Total number of templates
 */
function addPaginationControls(totalItems) {
  const totalPages = Math.ceil(totalItems / templatesPerPage);
  
  const paginationContainer = document.createElement('div');
  paginationContainer.className = 'pagination';
  
  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.innerHTML = '&laquo; Previous';
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      displayTemplates();
    }
  });
  
  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.innerHTML = 'Next &raquo;';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      displayTemplates();
    }
  });
  
  // Page info
  const pageInfo = document.createElement('span');
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  
  paginationContainer.appendChild(prevBtn);
  paginationContainer.appendChild(pageInfo);
  paginationContainer.appendChild(nextBtn);
  
  elements.templatesGrid.appendChild(paginationContainer);
}

/**
 * Filter templates based on search query
 * @param {string} query - Search query
 */
function filterTemplates(query) {
  if (!query || query.trim() === '') {
    displayTemplates(templates);
    return;
  }
  
  const normalizedQuery = query.toLowerCase().trim();
  const filtered = templates.filter(template => {
    // Add safety checks for undefined values
    return (
      (template.name && template.name.toLowerCase().includes(normalizedQuery)) || 
      (template.content && template.content.toLowerCase().includes(normalizedQuery))
    );
  });
  
  // Reset to first page for search results
  currentPage = 1;
  displayTemplates(filtered);
}

/**
 * Show template modal for creating a new template
 */
function showTemplateModal() {
  // Reset form
  elements.templateForm.reset();
  elements.templateId.value = '';
  elements.templateImagePath.value = '';
  elements.templateImagePreview.src = '';
  elements.templateImagePreview.style.display = 'none';
  
  // Reset remove image flag
  elements.templateForm.removeAttribute('data-remove-image');
  
  // Hide image preview container
  if (elements.imagePreviewContainer) {
    elements.imagePreviewContainer.style.display = 'none';
  }
  
  // Hide footer remove image button
  if (elements.footerRemoveImageBtn) {
    elements.footerRemoveImageBtn.style.display = 'none';
  }
  
  // Set modal title
  document.getElementById('template-modal-title').textContent = 'Create Template';
  
  // Show modal
  elements.templateModal.style.display = 'flex';
}

/**
 * Close the template modal
 */
function closeTemplateModal() {
  console.log('Closing template modal');
  if (elements.templateModal) {
    elements.templateModal.style.display = 'none';
  } else {
    console.error('Template modal element not found');
  }
}

/**
 * Save a template (create or update)
 */
async function saveTemplate() {
  try {
    // Add submission prevention flag
    if (elements.saveTemplateBtn.disabled) {
      console.log('Submission already in progress, preventing double submission');
      return;
    }
    
    // Disable the save button to prevent double submissions
    elements.saveTemplateBtn.disabled = true;
    elements.saveTemplateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    // Safely get values with fallbacks
    const id = elements.templateId.value || '';
    const name = elements.templateName.value ? elements.templateName.value.trim() : '';
    const content = elements.templateContent.value ? elements.templateContent.value : '';
    const imagePath = elements.templateImagePath.value || '';
    
    console.log('Save template form values:', { id, name, content, imagePath });
    
    if (!name || !content) {
      showToast('Please enter template name and content', 'error');
      resetSaveButton();
      return;
    }
    
    // No need to check if template name is unique here
    // We'll let the server handle this check to avoid race conditions
    
    // Validate template ID
    let templateId = null;
    if (id && id.trim() !== '') {
      templateId = Number(id);
      if (isNaN(templateId) || templateId <= 0) {
        showToast('Invalid template ID', 'error');
        resetSaveButton();
        return;
      }
    }
    
    // Prepare template data
    const templateData = {
      name,
      content
    };
    
    // Check if we need to remove image
    const shouldRemoveImage = elements.templateForm.getAttribute('data-remove-image') === 'true';
    if (shouldRemoveImage) {
      templateData.removeImage = true;
    }
    
    // Add image path if selected
    if (imagePath && !shouldRemoveImage) {
      if (templateId) {
        templateData.newImagePath = imagePath;
      } else {
        templateData.imagePath = imagePath;
      }
    }
    
    try {
      let result;
      // Update existing or create new - use window.api directly to bypass potential issues
      if (templateId) {
        console.log('Updating template with ID:', templateId, templateData);
        result = await window.api.updateTemplate(templateId, templateData);
      } else {
        console.log('Creating new template:', templateData);
        result = await window.api.createTemplate(templateData);
      }
      
      console.log('Template save result:', result);
      
      // Check if the operation was successful
      if (result && result.success === false) {
        throw new Error(result.error || 'Unknown error saving template');
      }
      
      // Check for warnings
      if (result && result.warning) {
        console.log('Template saved with warning:', result.warning);
        showToast(`Template saved, but note: ${result.warning}`, 'info');
      } else {
        // Success message
        showToast(`Template ${templateId ? 'updated' : 'created'} successfully!`, 'success');
      }
      
      // Reset remove image flag
      elements.templateForm.removeAttribute('data-remove-image');
      
      // Reload templates to refresh the cache
      await loadTemplates();
      closeTemplateModal();
    } catch (error) {
      console.error('Error saving template:', error);
      
      // Handle specific error types
      if (error.message && error.message.includes('already exists')) {
        showToast(error.message, 'error');
        console.log('Duplicate template name detected:', error.message);
      } else if (error.message && error.message.includes('database is locked')) {
        showToast('Database is busy, please try again in a moment', 'error');
        console.log('Database lock error:', error.message);
        
        // Check if we need to reload templates (the template might have been created despite the error)
        try {
          await loadTemplates();
        } catch (loadError) {
          console.error('Error reloading templates after lock error:', loadError);
        }
      } else {
        showToast(`Error saving template: ${error.message}`, 'error');
      }
      
      // Do not close the modal, let the user correct the error
      return; // Explicit return to prevent further execution
    } finally {
      // Always reset the save button state
      resetSaveButton();
    }
  } catch (error) {
    console.error('Error in saveTemplate function:', error);
    showToast(`Error saving template: ${error.message}`, 'error');
    resetSaveButton();
  }
}

/**
 * Reset the save button to its original state
 */
function resetSaveButton() {
  if (elements.saveTemplateBtn) {
    elements.saveTemplateBtn.disabled = false;
    elements.saveTemplateBtn.innerHTML = 'Save Template';
  }
}

/**
 * Remove the selected template image
 */
function removeTemplateImage() {
  console.log('Remove image function called');
  
  // If editing an existing template with an image, we need to tell the server to remove it
  const id = elements.templateId.value;
  if (id && id.trim() !== '') {
    // Set a data attribute to indicate we want to remove the image on save
    elements.templateForm.setAttribute('data-remove-image', 'true');
    console.log('Set data-remove-image attribute to true');
  }
  
  // Clear the image preview
  elements.templateImagePath.value = '';
  elements.templateImagePreview.src = '';
  
  // Hide image preview container
  if (elements.imagePreviewContainer) {
    elements.imagePreviewContainer.style.display = 'none';
    console.log('Hidden image preview container');
  } else {
    console.error('Image preview container not found');
  }
  
  // Hide footer remove image button
  if (elements.footerRemoveImageBtn) {
    elements.footerRemoveImageBtn.style.display = 'none';
  }
  
  showToast('Image removed', 'info');
}

/**
 * Edit an existing template
 * @param {number} id - Template ID
 */
async function editTemplate(id) {
  try {
    // Convert ID to a number
    const templateId = Number(id);
    
    // Check for invalid IDs
    if (isNaN(templateId) || templateId <= 0) {
      showToast('Invalid template ID', 'error');
      return;
    }
    
    // Find template in cache
    let template = templates.find(t => t.id === templateId);
    
    if (!template) {
      try {
        // If not in cache, fetch from API
        const result = await api.getTemplateById(templateId);
        if (!result) {
          showToast('Template not found', 'error');
          return;
        }
        template = result;
      } catch (error) {
        console.error(`Error fetching template ${templateId}:`, error);
        if (error.message && error.message.includes('not found')) {
          showToast('Cannot edit: template not found in database', 'error');
        } else {
          showToast(`Error loading template: ${error.message}`, 'error');
        }
        return;
      }
    }
    
    // Populate form
    elements.templateId.value = template.id;
    elements.templateName.value = template.name;
    elements.templateContent.value = template.content;
    
    // Handle image
    if (template.imagePath) {
      elements.templateImagePath.value = template.imagePath;
      
      // Configure image with size limits
      elements.templateImagePreview.src = template.imagePath;
      elements.templateImagePreview.style.display = 'block';
      elements.templateImagePreview.style.maxHeight = '200px';
      elements.templateImagePreview.style.marginBottom = '20px';
      elements.templateImagePreview.style.objectFit = 'contain';
      
      if (elements.imagePreviewContainer) {
        elements.imagePreviewContainer.style.display = 'block';
        console.log('Image preview container is visible');
      }
      
      // Show footer remove image button
      if (elements.footerRemoveImageBtn) {
        elements.footerRemoveImageBtn.style.display = 'inline-block';
        console.log('Footer remove image button is visible');
      }
      
      // Ensure remove button exists and is visible
      const removeImageBtn = document.getElementById('remove-image');
      if (removeImageBtn) {
        // Force button styles to ensure visibility
        removeImageBtn.style.display = 'block';
        removeImageBtn.style.visibility = 'visible';
        removeImageBtn.style.opacity = '1';
        removeImageBtn.style.position = 'relative';
        removeImageBtn.style.zIndex = '9999';
        removeImageBtn.style.marginTop = '20px';
        removeImageBtn.style.backgroundColor = '#e74c3c';
        removeImageBtn.style.color = 'white';
        removeImageBtn.style.fontWeight = 'bold';
        removeImageBtn.style.width = '100%';
        console.log('Remove image button should be visible now');
        
        // Force a small delay to ensure the button appears after the image loads
        setTimeout(() => {
          removeImageBtn.style.display = 'block';
          removeImageBtn.style.visibility = 'visible';
        }, 100);
      } else {
        console.error('Remove image button not found in the DOM');
        
        // Try to create it if it doesn't exist
        const imagePreview = document.querySelector('.image-preview');
        if (imagePreview) {
          // Add a separator before the button
          const separator = document.createElement('div');
          separator.style.width = '100%';
          separator.style.height = '10px';
          separator.style.borderTop = '1px solid #ddd';
          separator.style.margin = '10px 0';
          imagePreview.appendChild(separator);
          
          // Create the button
          const newRemoveBtn = document.createElement('button');
          newRemoveBtn.id = 'remove-image';
          newRemoveBtn.type = 'button';
          newRemoveBtn.className = 'danger-btn';
          newRemoveBtn.innerHTML = '<i class="fas fa-trash"></i> REMOVE IMAGE';
          newRemoveBtn.style.display = 'block';
          newRemoveBtn.style.visibility = 'visible';
          newRemoveBtn.style.margin = '15px 0 0 0';
          newRemoveBtn.style.padding = '10px 15px';
          newRemoveBtn.style.backgroundColor = '#e74c3c';
          newRemoveBtn.style.color = 'white';
          newRemoveBtn.style.border = '2px solid #c0392b';
          newRemoveBtn.style.borderRadius = '4px';
          newRemoveBtn.style.width = '100%';
          newRemoveBtn.style.zIndex = '9999';
          newRemoveBtn.style.position = 'relative';
          newRemoveBtn.style.fontWeight = 'bold';
          newRemoveBtn.onclick = (e) => {
            e.preventDefault();
            removeTemplateImage();
          };
          
          imagePreview.appendChild(newRemoveBtn);
          console.log('Created new remove image button');
        }
      }
    } else {
      elements.templateImagePath.value = '';
      elements.templateImagePreview.src = '';
      elements.templateImagePreview.style.display = 'none';
      
      if (elements.imagePreviewContainer) {
        elements.imagePreviewContainer.style.display = 'none';
      }
      
      // Hide footer remove image button
      if (elements.footerRemoveImageBtn) {
        elements.footerRemoveImageBtn.style.display = 'none';
      }
    }
    
    // Reset remove image flag
    elements.templateForm.removeAttribute('data-remove-image');
    
    // Set modal title
    document.getElementById('template-modal-title').textContent = 'Edit Template';
    
    // Show modal
    elements.templateModal.style.display = 'flex';
    await loadTemplates();
  } catch (error) {
    console.error('Error editing template:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

/**
 * Delete a template
 * @param {number} id - Template ID
 */
async function deleteTemplate(id) {
  try {
    // Ensure id is a valid number
    const templateId = Number(id);
    
    // Check for invalid IDs
    if (isNaN(templateId) || templateId <= 0) {
      showToast('Invalid template ID', 'error');
      return;
    }
    
    const confirmed = await showConfirmDialog(
      'Delete Template',
      'Are you sure you want to delete this template? This action cannot be undone.'
    );
    
    if (!confirmed) return;
    
    // Find the template in our cache
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      showToast('Template not found', 'error');
      return;
    }
    
    try {
      const result = await api.deleteTemplate(templateId);
      
      if (result) {
        await loadTemplates();
        showToast('Template deleted successfully!', 'success');
      } else {
        showToast('Failed to delete template', 'error');
      }
    } catch (error) {
      console.error(`Error deleting template ${templateId}:`, error);
      // Show a more user-friendly error message
      if (error.message && error.message.includes('not found')) {
        showToast('Cannot delete: template not found in database', 'error');
      } else {
        showToast(`Error deleting template: ${error.message}`, 'error');
      }
    }
  } catch (error) {
    console.error('Error in deleteTemplate function:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

/**
 * View full template in a modal
 * @param {Object} template - Template data
 */
function viewTemplate(template) {
  // Safety check for invalid template objects
  if (!template || typeof template !== 'object') {
    console.error('Invalid template data for view:', template);
    showToast('Cannot view template: Invalid data', 'error');
    return;
  }

  // Ensure template has required properties
  const safeTemplate = {
    id: template.id || 0,
    name: template.name || 'Unnamed Template',
    content: template.content || '',
    imagePath: template.imagePath || null
  };

  // Create modal element
  const modal = document.createElement('div');
  modal.className = 'modal view-template-modal';
  modal.style.display = 'flex';
  
  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.className = 'modal-content';
  
  // Create close button
  const closeBtn = document.createElement('span');
  closeBtn.className = 'close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  // Create template view
  const templateView = document.createElement('div');
  templateView.className = 'template-view';
  
  // Template header
  const header = document.createElement('h2');
  header.textContent = safeTemplate.name;
  
  // Template content with scrollable area
  const content = document.createElement('div');
  content.className = 'template-full-content';
  content.style.maxHeight = '400px';
  content.style.overflow = 'auto';
  content.innerHTML = safeTemplate.content;
  
  // Add image if exists
  if (safeTemplate.imagePath) {
    const img = document.createElement('img');
    img.src = safeTemplate.imagePath;
    img.className = 'template-full-image';
    img.alt = 'Template image';
    content.appendChild(img);
  }
  
  // Assemble the modal
  templateView.appendChild(header);
  templateView.appendChild(content);
  
  modalContent.appendChild(closeBtn);
  modalContent.appendChild(templateView);
  
  modal.appendChild(modalContent);
  
  // Close when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
  
  // Add to body
  document.body.appendChild(modal);
}

/**
 * Select an image for the template
 */
async function selectTemplateImage() {
  try {
    // Prevent default browser action to avoid navigation
    event.preventDefault();
    
    // Prevent double-clicks which can cause multiple dialogs
    if (window.isSelectingImage) {
      console.log('Image selection already in progress, preventing duplicate dialog');
      return;
    }
    
    window.isSelectingImage = true;
    console.log('Starting image selection...');
    
    // Use the direct window.api approach
    const result = await window.api.showFileDialog({
      title: 'Select Template Image',
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif'] }
      ],
      properties: ['openFile']
    });
    
    console.log('File dialog result:', result);
    
    if (result && result.filePaths && result.filePaths.length > 0) {
      const imagePath = result.filePaths[0];
      console.log('Selected image path:', imagePath);
      
      // Set the image path value
      elements.templateImagePath.value = imagePath;
      
      // Configure image preview with size constraints
      elements.templateImagePreview.src = imagePath;
      elements.templateImagePreview.style.display = 'block';
      elements.templateImagePreview.style.maxHeight = '200px';
      elements.templateImagePreview.style.marginBottom = '20px';
      elements.templateImagePreview.style.objectFit = 'contain';
      
      // Ensure the image preview container is visible
      if (elements.imagePreviewContainer) {
        elements.imagePreviewContainer.style.display = 'block';
        
        // Show footer remove image button
        if (elements.footerRemoveImageBtn) {
          elements.footerRemoveImageBtn.style.display = 'inline-block';
        }
        
        // Ensure remove button exists and is visible
        const removeImageBtn = document.getElementById('remove-image');
        if (removeImageBtn) {
          // Force button styles to ensure visibility
          removeImageBtn.style.display = 'block';
          removeImageBtn.style.visibility = 'visible';
          removeImageBtn.style.opacity = '1';
          removeImageBtn.style.position = 'relative';
          removeImageBtn.style.zIndex = '9999';
          removeImageBtn.style.marginTop = '20px';
          removeImageBtn.style.backgroundColor = '#e74c3c';
          removeImageBtn.style.color = 'white';
          removeImageBtn.style.fontWeight = 'bold';
          removeImageBtn.style.width = '100%';
          console.log('Remove image button should be visible now');
          
          // Force a small delay to ensure the button appears after the image loads
          setTimeout(() => {
            removeImageBtn.style.display = 'block';
            removeImageBtn.style.visibility = 'visible';
          }, 100);
        } else {
          console.error('Remove image button not found in the DOM');
          
          // Try to create it if it doesn't exist
          const imagePreview = document.querySelector('.image-preview');
          if (imagePreview) {
            // Add a separator before the button
            const separator = document.createElement('div');
            separator.style.width = '100%';
            separator.style.height = '10px';
            separator.style.borderTop = '1px solid #ddd';
            separator.style.margin = '10px 0';
            imagePreview.appendChild(separator);
            
            // Create the button
            const newRemoveBtn = document.createElement('button');
            newRemoveBtn.id = 'remove-image';
            newRemoveBtn.type = 'button';
            newRemoveBtn.className = 'danger-btn';
            newRemoveBtn.innerHTML = '<i class="fas fa-trash"></i> REMOVE IMAGE';
            newRemoveBtn.style.display = 'block';
            newRemoveBtn.style.visibility = 'visible';
            newRemoveBtn.style.margin = '15px 0 0 0';
            newRemoveBtn.style.padding = '10px 15px';
            newRemoveBtn.style.backgroundColor = '#e74c3c';
            newRemoveBtn.style.color = 'white';
            newRemoveBtn.style.border = '2px solid #c0392b';
            newRemoveBtn.style.borderRadius = '4px';
            newRemoveBtn.style.width = '100%';
            newRemoveBtn.style.zIndex = '9999';
            newRemoveBtn.style.position = 'relative';
            newRemoveBtn.style.fontWeight = 'bold';
            newRemoveBtn.onclick = (e) => {
              e.preventDefault();
              removeTemplateImage();
            };
            
            imagePreview.appendChild(newRemoveBtn);
            console.log('Created new remove image button');
          }
        }
      } else {
        console.error('Image preview container not found in the DOM');
      }
    } else {
      console.log('No image was selected or dialog was cancelled');
    }
  } catch (error) {
    console.error('Error selecting image:', error);
    showToast(`Error selecting image: ${error.message}`, 'error');
  } finally {
    // Reset the selection flag
    window.isSelectingImage = false;
  }
}

/**
 * Update the template count in the dashboard
 */
function updateTemplateCount() {
  if (elements.totalTemplates) {
    elements.totalTemplates.textContent = templates.length;
  }
}

/**
 * Insert a variable at the current cursor position in the template content
 * @param {string} variable - The variable to insert
 */
function insertVariableToTemplate(variable) {
  if (!elements.templateContent) return;
  
  const textarea = elements.templateContent;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  
  // Insert the variable at cursor position
  const newText = text.substring(0, start) + variable + text.substring(end);
  textarea.value = newText;
  
  // Set cursor position after the inserted variable
  const newCursorPos = start + variable.length;
  textarea.focus();
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  
  // Show a small confirmation
  showToast(`Added ${variable} to template`, 'info', 1500);
}

/**
 * Initialize the template variables dropdown
 */
function initializeVariablesDropdown() {
  // Make sure the variables toggle has the correct initial state
  const variablesToggle = document.querySelector('.variables-toggle');
  const variablesContent = document.querySelector('.variables-content');
  
  if (variablesToggle && variablesContent) {
    // Get computed style to check actual display value
    const computedStyle = window.getComputedStyle(variablesContent);
    const isVisible = computedStyle.display !== 'none';
    
    // Set the correct class for the toggle based on visibility
    variablesToggle.classList.toggle('open', isVisible);
    
    console.log(`Variables dropdown initialized with visibility: ${isVisible ? 'visible' : 'hidden'}`);
  }
} 