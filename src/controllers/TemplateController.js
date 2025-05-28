const { sequelize, models, isDatabaseInitialized } = require('../database/db');
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
   * Check if database is initialized
   * @private
   * @throws {Error} - If database is not initialized
   */
  _checkDatabaseInitialized() {
    if (!isDatabaseInitialized()) {
      console.error('Attempted to access template database before initialization');
      return false;
    }
    return true;
  }

  /**
   * Get all templates
   * @returns {Promise<Array>} - Array of templates
   */
  async getAllTemplates() {
    try {
      // Check if database is initialized
      if (!this._checkDatabaseInitialized()) {
        return [];
      }
      
      const templates = await Template.findAll({
        order: [['createdAt', 'DESC']]
      });
      
      // Validate templates before returning
      const validTemplates = templates.map(t => {
        // Ensure all templates have valid properties
        const template = t.get({ plain: true });
        return {
          id: template.id,
          name: template.name || 'Unnamed Template',
          content: template.content || '',
          imagePath: template.imagePath,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt
        };
      });
      
      console.log(`Retrieved ${validTemplates.length} templates from database`);
      return validTemplates;
    } catch (error) {
      console.error('Error getting templates:', error);
      return [];
    }
  }

  /**
   * Get a template by ID
   * @param {number} id - Template ID
   * @returns {Promise<Object>} - Template object
   */
  async getTemplateById(id) {
    try {
      // Check if database is initialized
      if (!this._checkDatabaseInitialized()) {
        return { success: false, error: 'Database not initialized' };
      }
      
      const template = await Template.findByPk(id);
      if (!template) {
        return { success: false, error: 'Template not found' };
      }
      return { success: true, template };
    } catch (error) {
      console.error('Error getting template:', error);
      return { success: false, error: error.message };
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
      // Check if database is initialized
      if (!this._checkDatabaseInitialized()) {
        return {
          success: false,
          error: 'Database not initialized'
        };
      }
      
      // Validate and sanitize input data
      const name = templateData.name ? templateData.name.trim() : null;
      const content = templateData.content || '';
      
      console.log('Creating template with data:', { 
        name, 
        contentLength: content ? content.length : 0,
        hasImage: !!templateData.imagePath 
      });
      
      // Validate required fields
      if (!name) {
        return {
          success: false,
          error: 'Template name is required'
        };
      }
      
      if (!content) {
        return {
          success: false,
          error: 'Template content is required'
        };
      }

      // Use a simpler transaction approach that works with all Sequelize versions
      const result = await sequelize.transaction(async (transaction) => {
        // Check if a template with this name already exists using findOne
        const existingTemplate = await Template.findOne({
          where: { name: name },
          transaction: transaction
        });
        
        if (existingTemplate) {
          console.log(`Duplicate template name detected: "${name}"`);
          throw new Error(`A template with the name "${name}" already exists. Please use a different name.`);
        }
        
        console.log(`No duplicate found for template name "${name}", creating new template`);
        
        // Handle image if provided
        let imagePath = null;
        if (imageData) {
          imagePath = await this.saveImage(name, imageData);
        } else if (templateData.imagePath) {
          imagePath = templateData.imagePath;
        }

        // Create template in database within the transaction
        try {
          const template = await Template.create({
            name: name,
            content: content,
            imagePath: imagePath
          }, { transaction });

          console.log(`Template created successfully with ID: ${template.id}`);
          return template;
        } catch (createError) {
          console.error(`Error creating template in transaction:`, createError);
          throw createError;
        }
      });

      return {
        success: true,
        template: result
      };
    } catch (error) {
      console.error('Error creating template:', error);
      
      // Check for specific error types
      if (error.name === 'SequelizeUniqueConstraintError' || 
          (error.message && error.message.includes('already exists'))) {
        return {
          success: false,
          error: `A template with the name "${templateData.name}" already exists. Please use a different name.`
        };
      } else if (error.name === 'SequelizeTimeoutError' || 
                (error.message && error.message.includes('database is locked'))) {
        // Check if the template was actually created despite the lock error
        try {
          const existingTemplate = await Template.findOne({
            where: { name: templateData.name }
          });
          
          if (existingTemplate) {
            console.log(`Template was actually created despite lock error: ${existingTemplate.id}`);
            return {
              success: true,
              template: existingTemplate,
              warning: 'Template was created, but there was a database lock issue.'
            };
          }
        } catch (checkError) {
          console.error('Error checking if template was created after lock error:', checkError);
        }
        
        return {
          success: false,
          error: 'Database is currently busy. Please try again in a moment.'
        };
      }
      
      // Other errors
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update an existing template
   * @param {number} id - Template ID
   * @param {Object} templateData - Updated template data
   * @returns {Promise<Object>} - Updated template
   */
  async updateTemplate(id, templateData) {
    try {
      // Check if database is initialized
      if (!this._checkDatabaseInitialized()) {
        return {
          success: false,
          error: 'Database not initialized'
        };
      }
      
      console.log(`Updating template ${id} with data:`, templateData);
      
      // Use a transaction to ensure atomic operations
      const result = await sequelize.transaction(async (transaction) => {
        // First find the template within the transaction
        const template = await Template.findByPk(id, { transaction });
        if (!template) {
          console.error(`Template with ID ${id} not found`);
          throw new Error('Template not found');
        }

        // Validate and sanitize input data
        const name = templateData.name ? templateData.name.trim() : null;
        const content = templateData.content || '';
        
        if (!name) {
          throw new Error('Template name is required');
        }
        
        if (!content) {
          throw new Error('Template content is required');
        }
        
        // Check for duplicate name only if the name is changed
        if (name !== template.name) {
          const existingTemplate = await Template.findOne({
            where: { 
              name: name,
              id: { [sequelize.Op.ne]: id } // Not equal to current template
            },
            transaction
          });
          
          if (existingTemplate) {
            console.log(`Duplicate template name detected: "${name}" when updating template ${id}`);
            throw new Error(`A template with the name "${name}" already exists. Please use a different name.`);
          }
        }
        
        // Determine image path
        let imagePath = template.imagePath;
        
        // Check if we need to remove the image
        if (templateData.removeImage === true) {
          console.log(`Removing image reference for template ${id}`);
          // We only remove the reference to the image, not the file itself
          imagePath = null;
        } else if (templateData.newImagePath) {
          imagePath = templateData.newImagePath;
        }

        // Update template
        await template.update({
          name: name,
          content: content,
          imagePath: imagePath
        }, { transaction });

        console.log(`Template ${id} updated successfully`);
        return template;
      });

      return {
        success: true,
        template: result
      };
    } catch (error) {
      console.error('Error updating template:', error);
      
      // Check for unique constraint violation
      if (error.name === 'SequelizeUniqueConstraintError') {
        return {
          success: false,
          error: `A template with the name "${templateData.name}" already exists. Please use a different name.`
        };
      } else if (error.name === 'SequelizeTimeoutError' || 
                (error.message && error.message.includes('database is locked'))) {
        return {
          success: false,
          error: 'Database is currently busy. Please try again in a moment.'
        };
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete a template
   * @param {number} id - Template ID
   * @returns {Promise<boolean>} - True if deleted successfully
   */
  async deleteTemplate(id) {
    try {
      // Check if database is initialized
      if (!this._checkDatabaseInitialized()) {
        return false;
      }
      
      const template = await Template.findByPk(id);
      if (!template) {
        console.error(`Template with ID ${id} not found`);
        return false;
      }

      // Delete associated image if exists
      if (template.imagePath) {
        try {
          if (fs.existsSync(template.imagePath)) {
            await fs.promises.unlink(template.imagePath);
            console.log(`Deleted template image: ${template.imagePath}`);
          }
        } catch (error) {
          console.error('Error deleting template image:', error);
          // Continue with template deletion even if image deletion fails
        }
      }

      await template.destroy();
      console.log(`Template with ID ${id} deleted successfully`);
      return true;
    } catch (error) {
      console.error('Error deleting template:', error);
      return false;
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
      const fileName = `${Date.now()}-${templateName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
      const imagePath = path.join(this.templatesDir, fileName);
      
      await fs.promises.writeFile(imagePath, imageData);
      return imagePath;
    } catch (error) {
      console.error('Error saving template image:', error);
      throw error;
    }
  }
}

module.exports = new TemplateController(); 