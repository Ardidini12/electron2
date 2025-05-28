const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // External message ID (from WhatsApp)
    externalId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      values: ['SCHEDULED', 'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED'],
      defaultValue: 'SCHEDULED'
    },
    scheduledTime: {
      type: DataTypes.DATE,
      allowNull: false
    },
    sentTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Add specific timestamps for message status tracking
    deliveredTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    readTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Track retry attempts
    retryCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // Save a copy of the content that was sent (in case template changes)
    contentSnapshot: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // Save a copy of the image path that was sent (in case template changes)
    imagePathSnapshot: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Save a copy of the template name for reference
    templateNameSnapshot: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Track when the message was created and last updated
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
    tableName: 'Messages',
    // Don't pluralize table names
    freezeTableName: true,
    timestamps: true
  });
  
  return Message;
}; 