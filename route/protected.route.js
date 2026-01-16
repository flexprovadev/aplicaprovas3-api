const express = require('express');
const router = express.Router();
const { schoolIdentifier } = require('../middleware');

router.use('/exams', schoolIdentifier, require('./protected/exam.route'));
router.use('/classrooms', schoolIdentifier, require('./protected/classrooms.route'));
router.use('/roles', schoolIdentifier, require('./protected/role.route'));
router.use('/staff', schoolIdentifier, require('./protected/staff.route'));
router.use('/courses', schoolIdentifier, require('./protected/course.route'));
router.use('/account', schoolIdentifier, require('./protected/account.route'));
router.use('/students', schoolIdentifier, require('./protected/student.route'));
router.use('/exam-students', schoolIdentifier, require('./protected/exam.student.route'));
router.use('/import', schoolIdentifier, require('./protected/import.route'));
router.use('/teacher', schoolIdentifier, require('./protected/teacher.route'));
router.use('/document', schoolIdentifier, require('./protected/document.route'));

module.exports = router;
