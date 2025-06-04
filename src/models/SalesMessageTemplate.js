const { DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

module.exports = (sequelize) => {
  const SalesMessageTemplate = sequelize.define('SalesMessageTemplate', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // Message content with variables
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'Hello {name}, thank you for your purchase!'
    },
    // Path to the image (optional)
    imagePath: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Message type (first or second)
    messageType: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'FIRST',
      validate: {
        isIn: [['FIRST', 'SECOND']]
      }
    },
    // Track when the template was created and last updated
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    // Explicitly set the table name to avoid pluralization issues
    tableName: 'SalesMessageTemplates',
    // Don't pluralize table names
    freezeTableName: true,
    timestamps: true,
    // Add hooks for image handling
    hooks: {
      beforeDestroy: async (template) => {
        // Delete associated image file if it exists
        if (template.imagePath && fs.existsSync(template.imagePath)) {
          try {
            fs.unlinkSync(template.imagePath);
            console.log(`Deleted image file: ${template.imagePath}`);
          } catch (error) {
            console.error(`Failed to delete image file: ${template.imagePath}`, error);
          }
        }
      }
    }
  });
  
  return SalesMessageTemplate;
}; 