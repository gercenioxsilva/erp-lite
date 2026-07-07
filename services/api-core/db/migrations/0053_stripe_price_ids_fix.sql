-- Corrige os stripe_price_id dos 3 planos, que estavam desatualizados em
-- relação aos price_ids reais de produção no Stripe (os valores definidos em
-- 0029_stripe_price_ids.sql ficaram stale). Causa raiz de assinaturas
-- terminando em 'incomplete' no Stripe e sendo mascaradas como 'trial' —
-- ver correção de mapStripeStatus() em routes/subscription.ts (regra 50).

UPDATE plans SET stripe_price_id = 'price_1Tnfv1PFn1l7l1L7K79NJHvB' WHERE id = 'starter';
UPDATE plans SET stripe_price_id = 'price_1TnfwcPFn1l7l1L7LqsZvUVo' WHERE id = 'pro';
UPDATE plans SET stripe_price_id = 'price_1TnfxGPFn1l7l1L74kFbJyPS' WHERE id = 'enterprise';
