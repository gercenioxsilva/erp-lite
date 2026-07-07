import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface Plan {
  id:                string;
  name:              string;
  price_monthly:     number;
  max_users:         number | null;
  max_nfe_per_month: number | null;
  max_clients:       number | null;
  features:          { reports?: boolean; api_access?: boolean };
}

export interface SubscriptionData {
  status:                  string;
  plan:                    string;
  days_left:               number | null;
  subscription_period_end: string | null;
  cancel_at_period_end:    boolean;
  stripe_enabled:          boolean;
  plans:                   Plan[];
}

interface UseSubscriptionResult {
  data:    SubscriptionData | null;
  loading: boolean;
  error:   string | null;
  refetch: () => void;
}

/**
 * Shared `/v1/subscription` fetch. Consolidates the fetch previously
 * duplicated between Layout.tsx (TrialBanner) and BillingPage.tsx.
 */
export function useSubscription(): UseSubscriptionResult {
  const [data, setData]           = useState<SubscriptionData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<SubscriptionData>('/v1/subscription')
      .then(result => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Erro ao carregar dados de assinatura.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refetch = useCallback(() => setReloadToken(t => t + 1), []);

  return { data, loading, error, refetch };
}
