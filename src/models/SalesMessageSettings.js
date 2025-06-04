const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesMessageSettings = sequelize.define('SalesMessageSettings', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // First message delay in milliseconds
    firstMessageDelay: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 7200000, // 2 hours in milliseconds
      comment: 'Delay for first message in milliseconds'
    },
    // Second message delay in milliseconds (from first message)
    secondMessageDelay: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 15552000000, // 6 months in milliseconds
      comment: 'Delay for second message in milliseconds (from first message)'
    },
    // Whether auto-scheduling is enabled
    isAutoSchedulingEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    // Whether auto-sending is enabled
    isAutoSendingEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    // Track when the settings were created and last updated
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
    tableName: 'SalesMessageSettings',
    // Don't pluralize table names
    freezeTableName: true,
    timestamps: true
  });
  
  return SalesMessageSettings;
}; 