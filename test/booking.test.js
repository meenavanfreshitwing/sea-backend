import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDate } from '../services/bookingService.js';
import { istNow, addDays, diffDays, isValidDateString, istDayRange } from '../utils/istDate.js';

const baseConfig = {
  bookingEnabled: true,
  cutoffTime: '17:00',
  maxAdvanceDays: 30,
  closedMessage: 'Closed',
  timeSlotsEnabled: false,
  slots: [
    { slotId: 'am', label: 'Morning', startTime: '06:00', endTime: '09:00', isActive: true },
    { slotId: 'pm', label: 'Late morning', startTime: '09:00', endTime: '12:00', isActive: true }
  ]
};

// 10 Oct 2026, given IST wall-clock time
const at = (time) => istNow(new Date(`2026-10-10T${time}:00+05:30`));
const check = (date, time, { config = baseConfig, override } = {}) =>
  evaluateDate(date, { config, override, now: at(time) });

test('istNow uses IST regardless of server timezone', () => {
  assert.deepEqual(istNow(new Date('2026-10-10T20:00:00Z')), { date: '2026-10-11', minutes: 90, time: '01:30' });
});

test('date helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(diffDays('2026-10-10', '2026-10-14'), 4);
  assert.ok(isValidDateString('2026-02-28'));
  assert.ok(!isValidDateString('2026-02-30'));
  assert.ok(!isValidDateString('11-10-2026'));
  assert.equal(istDayRange('2026-10-10').start.toISOString(), '2026-10-09T18:30:00.000Z');
});

test('same-day orders are never allowed', () => {
  const r = check('2026-10-10', '06:00');
  assert.equal(r.available, false);
  assert.equal(r.reason, 'same_day');
  assert.match(r.message, /Same-day orders are not available/);
});

test('past dates are not bookable', () => {
  assert.equal(check('2026-10-09', '10:00').reason, 'past');
});

test('tomorrow is open before the cutoff (order on the 10th before 5 PM for the 11th)', () => {
  assert.equal(check('2026-10-11', '16:59').available, true);
});

test('tomorrow locks at the cutoff time', () => {
  const r = check('2026-10-11', '17:00');
  assert.equal(r.available, false);
  assert.equal(r.reason, 'cutoff_passed');
  assert.equal(check('2026-10-11', '21:30').reason, 'cutoff_passed');
});

test('dates after tomorrow stay open after the cutoff', () => {
  assert.equal(check('2026-10-12', '21:30').available, true);
  assert.equal(check('2026-10-14', '23:59').available, true);
});

test('per-date cutoff override', () => {
  const override = { cutoffTime: '12:00' };
  assert.equal(check('2026-10-11', '13:00', { override }).reason, 'cutoff_passed');
  const later = { cutoffTime: '20:00' };
  assert.equal(check('2026-10-11', '19:00', { override: later }).available, true);
});

test('admin-blocked date is unavailable with the admin message', () => {
  const override = { isBlocked: true, reason: 'cyclone', message: 'Due to cyclone conditions…' };
  const r = check('2026-10-13', '09:00', { override });
  assert.equal(r.available, false);
  assert.equal(r.reason, 'blocked');
  assert.equal(r.blockReason, 'cyclone');
  assert.equal(r.message, 'Due to cyclone conditions…');
});

test('booking window limit', () => {
  assert.equal(check(addDays('2026-10-10', 30), '09:00').available, true);
  assert.equal(check(addDays('2026-10-10', 31), '09:00').reason, 'beyond_window');
});

test('master switch closes every date', () => {
  const config = { ...baseConfig, bookingEnabled: false };
  assert.equal(check('2026-10-15', '09:00', { config }).reason, 'booking_closed');
});

test('time slots: blocked slots are marked, all blocked closes the date', () => {
  const config = { ...baseConfig, timeSlotsEnabled: true };
  const partial = check('2026-10-13', '09:00', { config, override: { blockedSlots: ['am'] } });
  assert.equal(partial.available, true);
  assert.deepEqual(partial.slots.map(s => [s.slotId, s.available]), [['am', false], ['pm', true]]);

  const full = check('2026-10-13', '09:00', { config, override: { blockedSlots: ['am', 'pm'] } });
  assert.equal(full.available, false);
  assert.equal(full.reason, 'no_slots');
});
