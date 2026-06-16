import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Session } from '@supabase/supabase-js';

interface TenantContextType {
  tenantId: string | null;
  role: string | null;
  account: any | null;
  loading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  tenantId: null,
  role: null,
  account: null,
  loading: true,
});

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [account, setAccount] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTenantContext = async (session: Session | null) => {
    if (!session) {
      setTenantId(null);
      setRole(null);
      setAccount(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('accounts')
        .select(`
          id, 
          tenant_id, 
          role_id, 
          display_name,
          roles(name)
        `)
        .eq('user_id', session.user.id)
        .single();

      if (!error && data) {
        setAccount(data);
        setTenantId(data.tenant_id);
        
        const roleData = data.roles;
        const roleName = Array.isArray(roleData) ? roleData[0]?.name : (roleData as any)?.name;
        setRole(roleName || 'VIEWER');
      } else {
        setTenantId(null);
        setRole(null);
        setAccount(null);
      }
    } catch (e) {
      console.error("Error fetching tenant context:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetchTenantContext(session);
    }).catch(err => {
      console.warn("Could not get session:", err);
      fetchTenantContext(null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      fetchTenantContext(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <TenantContext.Provider value={{ tenantId, role, account, loading }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => useContext(TenantContext);
