const config = require("./config");
const { UserType } = require("./enumerator");

const hasPermission = (permission) => {
  return (req, res, next) => {
    const user = req.user;
    if (user.type === UserType.SUPERUSER || user.hasPermission(permission)) {
      return next();
    }
    return res.status(403).json({ message: "Not authorized" });
  };
};

const isUserType = (type) => (req, res, next) => {
  if (req.user.type === type) {
    return next();
  }
  return res.status(403).json({ message: "Not authorized" });
};

const isStaff = isUserType(UserType.STAFF);
const isStudent = isUserType(UserType.STUDENT);
const isTeacher = isUserType(UserType.TEACHER);
const isSuperuser = isUserType(UserType.SUPERUSER);

const refreshToken = (req, res, next) => {
  if (req.user) {
    res.setHeader(config.jwt.refresh_header, req.user.getJwtToken());
  }
  next();
};

module.exports = {
  hasPermission,
  isStaff,
  isStudent,
  isTeacher,
  isSuperuser,
  refreshToken,
};
