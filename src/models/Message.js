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
      values: ['SCHEDULED', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'],
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
    // Track when the message was created and last updated
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  });
  
  return Message;
}; 