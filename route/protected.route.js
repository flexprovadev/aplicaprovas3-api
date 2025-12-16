const express = require('express');
const router = express.Router();

router.use('/exams', require('./protected/exam.route'));
router.use('/classrooms', require('./protected/classrooms.route'));
router.use('/roles', require('./protected/role.route'));
router.use('/staff', require('./protected/staff.route'));
router.use('/courses', require('./protected/course.route'));
router.use('/account', require('./protected/account.route'));
router.use('/students', require('./protected/student.route'));
router.use('/exam-students', require('./protected/exam.student.route'));
router.use('/import', require('./protected/import.route'));
router.use('/teacher', require('./protected/teacher.route'));
router.use('/document', require('./protected/document.route'));

module.exports = router;
