
const User = require('../models/users');
const { verifyJWT } = require('../utils/jwt');

const verifyUser = async (req, res, next) => {
    const authorizationHeader = req.headers['authorization'];

    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
        return res.status(401).send('Unauthorized: Auth token missing');
    }
    const token = authorizationHeader.split(' ')[1];
    try {
        const { id } = verifyJWT(token);
        const result = await User.findByPk(id);
        if (result) {
            res.locals.userAuth = {
                user_id: id,
            }
            next();
        } else {
            return res.status(403).send("User Not authorized");
        }
    } catch (error) {
        console.error(error);
        return res.status(500).send("Internal server error");
    }
};

module.exports = { verifyUser };
