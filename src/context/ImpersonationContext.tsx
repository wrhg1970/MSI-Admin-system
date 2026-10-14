import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { UserProfile } from '../types';

export interface ImpersonatedAgent {
  uid?: string;
  email: string;
  displayName: string;
  commission?: number;
  clientId?: string;
  canCreatePolicies?: boolean;
  linkedAgents?: any[];
}

interface ImpersonationContextType {
  impersonatedAgent: ImpersonatedAgent | null;
  setImpersonatedAgent: (agent: ImpersonatedAgent | null) => void;
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  openModal: () => void;
  closeModal: () => void;
  exitImpersonation: () => void;
  isRealSuperAdmin: boolean;
}

const ImpersonationContext = createContext<ImpersonationContextType | null>(null);

interface ImpersonationProviderProps {
  children: ReactNode;
  realProfile: UserProfile | null;
  onImpersonationChange?: (agent: ImpersonatedAgent | null) => void;
}

const SUPER_ADMIN_EMAILS = ['ventas@misegurointernacional.com', 'wrhg1970@gmail.com'];

export function ImpersonationProvider({
  children,
  realProfile,
  onImpersonationChange,
}: ImpersonationProviderProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isRealSuperAdmin = useMemo(() => {
    if (!realProfile) return false;
    const emailLower = (realProfile.email || '').trim().toLowerCase();
    return realProfile.role === 'super_admin' || SUPER_ADMIN_EMAILS.includes(emailLower);
  }, [realProfile]);

  const [impersonatedAgent, setImpersonatedAgentState] = useState<ImpersonatedAgent | null>(() => {
    try {
      if (typeof window === 'undefined') return null;
      const stored = sessionStorage.getItem('impersonated_agent');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // If user is not super admin, clean up any stale impersonation
  useEffect(() => {
    if (realProfile && !isRealSuperAdmin && impersonatedAgent) {
      sessionStorage.removeItem('impersonated_agent');
      setImpersonatedAgentState(null);
      if (onImpersonationChange) onImpersonationChange(null);
    }
  }, [realProfile, isRealSuperAdmin, impersonatedAgent, onImpersonationChange]);

  const setImpersonatedAgent = (agent: ImpersonatedAgent | null) => {
    if (!isRealSuperAdmin && agent) {
      console.warn('Attempted to impersonate without super_admin privileges');
      return;
    }

    if (agent) {
      sessionStorage.setItem('impersonated_agent', JSON.stringify(agent));
    } else {
      sessionStorage.removeItem('impersonated_agent');
    }
    setImpersonatedAgentState(agent);
    if (onImpersonationChange) {
      onImpersonationChange(agent);
    }
  };

  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);
  const exitImpersonation = () => setImpersonatedAgent(null);

  return (
    <ImpersonationContext.Provider
      value={{
        impersonatedAgent: isRealSuperAdmin ? impersonatedAgent : null,
        setImpersonatedAgent,
        isModalOpen,
        setIsModalOpen,
        openModal,
        closeModal,
        exitImpersonation,
        isRealSuperAdmin,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext);
  if (!context) {
    // Return graceful fallback so components don't crash if rendered outside provider
    return {
      impersonatedAgent: null,
      setImpersonatedAgent: () => {},
      isModalOpen: false,
      setIsModalOpen: () => {},
      openModal: () => {},
      closeModal: () => {},
      exitImpersonation: () => {},
      isRealSuperAdmin: false,
    };
  }
  return context;
}
