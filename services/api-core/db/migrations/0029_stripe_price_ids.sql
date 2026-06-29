-- 0027_stripe_price_ids.sql
-- Sets the real Stripe Price IDs for each plan (replaces placeholders from 0026).

UPDATE plans SET stripe_price_id = 'price_1Tnh2SAmJXTSB82TrVjWXp2w' WHERE id = 'starter';
UPDATE plans SET stripe_price_id = 'price_1Tnh54AmJXTSB82TRXiRTBb7' WHERE id = 'pro';
UPDATE plans SET stripe_price_id = 'price_1Tnh5WAmJXTSB82Tdjpc7UAr'  WHERE id = 'enterprise';
