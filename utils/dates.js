// The business runs on India time; "today" must not shift to yesterday/tomorrow around midnight UTC.
const TZ = 'Asia/Kolkata';

/** Today's date in India as YYYY-MM-DD. */
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

module.exports = { today, TZ };
