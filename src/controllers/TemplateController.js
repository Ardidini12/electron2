const { sequelize, models } = require('../database/db');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const Template = models.Template;

/**
 * TemplateController handles all template-related operations
 */
class TemplateController {
  constructor() {
    // Create templates directory if it doesn't exist
    this.templatesDir = path.join(app ? app.getPath('userData') : __dirname, 'templates');
    
    if (!fs.existsSync(this.templatesDir)) {
      fs.mkdirSync(this.templatesDir, { recursive: true });
    }
  }

  /**
   * Get all templates
   * @returns {Promise<Array>} - Array of templates
   */
  async getAllTemplates() {
    try {
      return await Template.findAll();
    } catch (error) {
      console.error('Error fetching templates:', error);
      throw error;
    }
  }

  /**
   * Get a template by ID
   * @param {number} id - Template ID
   * @returns {Promise<Object>} - Template object
   */
  async getTemplateById(id) {
    try {
      return await Template.findByPk(id);
    } catch (error) {
      console.error(`Error fetching template with ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Create a new template
   * @param {Object} templateData - Template data
   * @param {Buffer|string} imageData - Optional image data or path
   * @returns {Promise<Object>} - Created template
   */
  async createTemplate(templateData, imageData = null) {
    try {
      // Handle image if provided
      if (imageData) {
        const imagePath = await this.saveImage(templateData.name, imageData);
        templateData.imagePath = imagePath;
      }
      
      return await Template.create(templateData);
    } catch (error) {
      console.error('Error creating template:', error);
      throw error;
    }
  }

  /**
   * Update an existing template
   * @param {number} id - Template ID
   * @param {Object} templateData - Updated template data
   * @param {Buffer|string} imageData - Optional new image data or path
   * @returns {Promise<Object>} - Updated template
   */
  async updateTemplate(id, templateData, imageData = null) {
    try {
      const template = await Template.findByPk(id);
      
      if (!template) {
        throw new Error(`Template with ID ${id} not found`);
      }
      
      // Handle image if provided
      if (imageData) {
        // Delete old image if it exists
        if (template.imagePath && fs.existsSync(template.imagePath)) {
          fs.unlinkSync(template.imagePath);
        }
        
        const imagePath = await this.saveImage(templateData.name || template.name, imageData);
        templateData.imagePath = imagePath;
      }
      
      await template.update(templateData);
      return template;
    } catch (error) {
      console.error(`Error updating template with ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a template
   * @param {number} id - Template ID
   * @returns {Promise<boolean>} - True if deleted successfully
   */
  async deleteTemplate(id) {
    try {
      const template = await Template.findByPk(id);
      
      if (!template) {
        throw new Error(`Template with ID ${id} not found`);
      }
      
      // Delete associated image if it exists
      if (template.imagePath && fs.existsSync(template.imagePath)) {
        fs.unlinkSync(template.imagePath);
      }
      
      await template.destroy();
      return true;
    } catch (error) {
      console.error(`Error deleting template with ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Save an image file for a template
   * @param {string} templateName - Name of the template
   * @param {Buffer|string} imageData - Image data or path
   * @returns {Promise<string>} - Path to the saved image
   */
  async saveImage(templateName, imageData) {
    try {
      // Generate a safe filename from the template name
      const safeFileName = templateName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const timestamp = Date.now();
      const imagePath = path.join(this.templatesDir, `${safeFileName}_${timestamp}.png`);
      
      // If imageData is a string, it's a path to an existing file
      if (typeof imageData === 'string') {
        fs.copyFileSync(imageData, imagePath);
      } else {
        // Otherwise, it's a Buffer with image data
        fs.writeFileSync(imagePath, imageData);
      }
      
      return imagePath;
    } catch (error) {
      console.error('Error saving template image:', error);
      throw error;
    }
  }
}

module.exports = new TemplateController(); 