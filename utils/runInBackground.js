// Run slow side work (emails, SMS) after the response has been sent, so the
// customer / delivery boy does not wait for Gmail or the SMS gateway.
// Failures are logged only: the order itself is already saved.
export const runInBackground = (label, task) => {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((err) => console.error(`❌ Background task failed (${label}):`, err?.message || err));
  });
};
