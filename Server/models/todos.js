// models/user.js

const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize(process.env.SEQ_CONNECTION);

const Todo = sequelize.define('todo', {
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  time: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  text: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  checked: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
  }
});

module.exports = Todo;
