const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize(process.env.SEQ_CONNECTION);

const User = sequelize.define('user', {
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
});

module.exports = User;
