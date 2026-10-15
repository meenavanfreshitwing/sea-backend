// Where the Razorpay keys come from.
// 1. Server .env (preferred, keeps the secret out of the database and admin screens):
//      RAZORPAY_KEY_ID=rzp_live_xxx   RAZORPAY_KEY_SECRET=xxx
//    Online payment is then ON automatically (set RAZORPAY_ENABLED=false to switch it off).
// 2. Otherwise the keys and on/off switch saved in Admin → Settings.
export const razorpayConfig = (settings = {}) => {
  const envKeyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const envKeySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const fromEnv = Boolean(envKeyId && envKeySecret);

  if (fromEnv) {
    return {
      fromEnv,
      keyId: envKeyId,
      keySecret: envKeySecret,
      enabled: (process.env.RAZORPAY_ENABLED || '').trim().toLowerCase() !== 'false',
    };
  }

  const keyId = settings?.razorpayKeyId || '';
  const keySecret = settings?.razorpayKeySecret || '';
  return {
    fromEnv,
    keyId,
    keySecret,
    enabled: Boolean(settings?.razorpayEnabled && keyId && keySecret),
  };
};
