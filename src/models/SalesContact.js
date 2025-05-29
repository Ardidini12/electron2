const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesContact = sequelize.define('SalesContact', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    contactId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Original contact ID from the API'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        is: /^\+?[1-9]\d{1,14}$/
      }
    },
    code: {
      type: DataTypes.STRING,
      allowNull: true
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true
    },
    documentNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    documentDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    shopId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    sourceData: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Original JSON data from the API'
    },
    imported: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    importedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Track when the contact was created and last updated
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'SalesContacts',
    freezeTableName: true,
    timestamps: true,
    indexes: [
      {
        name: 'sales_contact_phone_idx',
        fields: ['phoneNumber']
      },
      {
        name: 'sales_contact_city_idx',
        fields: ['city']
      },
      {
        name: 'sales_contact_date_idx',
        fields: ['documentDate']
      }
    ]
  });

  return SalesContact;
}; 