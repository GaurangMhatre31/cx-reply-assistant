import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import * as api from '../lib/api';

export const keys = {
  brands: ['brands'] as const,
  memberships: ['memberships'] as const,
  conversations: (brandId: string | null) => ['conversations', brandId] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  draft: (id: string) => ['draft', id] as const,
  kb: (brandId: string) => ['kb', brandId] as const,
  orders: ['orders'] as const,
  generations: (brandId: string | null, status: string | null) => ['generations', brandId, status] as const,
};

export function useBrands() {
  return useQuery({ queryKey: keys.brands, queryFn: api.fetchBrands, staleTime: 5 * 60_000 });
}

export function useBrandMap() {
  const { data } = useBrands();
  return new Map((data ?? []).map((b) => [b.id, b]));
}

export function useMemberships() {
  return useQuery({ queryKey: keys.memberships, queryFn: api.fetchMemberships, staleTime: 5 * 60_000 });
}

/**
 * Streams database changes into the React Query cache. Realtime applies the
 * same RLS policies as normal reads, so an agent only receives events for
 * their own brands.
 */
export function useRealtimeInvalidation(channelName: string, subscriptions: Array<{ table: string; filter?: string; key: readonly unknown[] }>) {
  const queryClient = useQueryClient();
  const signature = JSON.stringify(subscriptions);

  useEffect(() => {
    const subs = JSON.parse(signature) as typeof subscriptions;
    let channel = supabase.channel(`${channelName}:${crypto.randomUUID()}`);
    for (const sub of subs) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: sub.table, ...(sub.filter ? { filter: sub.filter } : {}) },
        () => queryClient.invalidateQueries({ queryKey: sub.key }),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, signature, queryClient]);
}
