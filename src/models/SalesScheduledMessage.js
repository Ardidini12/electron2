const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesScheduledMessage = sequelize.define('SalesScheduledMessage', {
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
    // Message status
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'SCHEDULED',
      validate: {
        isIn: [['SCHEDULED', 'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED']]
      }
    },
    // When the message is scheduled to be sent
    scheduledTime: {
      type: DataTypes.DATE,
      allowNull: false
    },
    // When the message was actually sent
    sentTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Specific timestamps for message status tracking
    deliveredTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    readTime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Message sequence (first or second)
    messageSequence: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'FIRST',
      validate: {
        isIn: [['FIRST', 'SECOND']]
      }
    },
    // Track retry attempts
    retryCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    // Store failure reason if applicable
    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // Save a copy of the content that was sent
    contentSnapshot: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    // Save a copy of the image path that was sent
    imagePathSnapshot: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Foreign key to SalesContact
    SalesContactId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'SalesContacts',
        key: 'id'
      }
    },
    // Foreign key to SalesMessageTemplate
    SalesMessageTemplateId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'SalesMessageTemplates',
        key: 'id'
      }
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
    tableName: 'SalesScheduledMessages',
    // Don't pluralize table names
    freezeTableName: true,
    timestamps: true,
    indexes: [
      {
        name: 'sales_scheduled_message_status_idx',
        fields: ['status']
      },
      {
        name: 'sales_scheduled_message_contact_idx',
        fields: ['SalesContactId']
      },
      {
        name: 'sales_scheduled_message_scheduled_time_idx',
        fields: ['scheduledTime']
      }
    ]
  });
  
  return SalesScheduledMessage;
}; 