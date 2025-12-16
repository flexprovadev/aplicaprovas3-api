const config = require("../config");
const { DateTime } = require("luxon");

const applyTimezone = (date) =>
  DateTime.fromJSDate(date)
    .setZone(config.timezone)
    .toISO({ includeOffset: false });

module.exports = { applyTimezone };
