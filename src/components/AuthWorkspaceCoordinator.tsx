import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTournamentStore } from '../store';
import { resolvePostLoginDestination } from '../lib/auth/workspaceAccessService';

let bootstrapPromise: Promise<void> | null = null;
let bootstrapFinished = false;
let routingVersion = 0;
let resolvingAccountId: string | null = null;
let handledAccountId: string | null = null;

function ensureAuthBootstrap(initSupabase: () => Promise<void>) {
  if (bootstrapFinished) return Promise.resolve();
  if (!bootstrapPromise) {
    bootstrapPromise = initSupabase().finally(() => {
      bootstrapFinished = true;
    });
  }
  return bootstrapPromise;
}

function isWorkspaceDetailPath(pathname: string) {
  return /^\/admin\/workspace\/[^/]+\/?$/.test(pathname);
}

function isCommercialFlowPath(pathname: string) {
  return pathname === '/unlock' || pathname === '/subscription';
}

function isPublicTournamentPath(pathname: string) {
  return /^\/tournament\/[^/]+\/?$/.test(pathname);
}

function resetRoutingState() {
  routingVersion += 1;
  resolvingAccountId = null;
  handledAccountId = null;
}

export default function AuthWorkspaceCoordinator() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSupabase = useTournamentStore((state) => state.initSupabase);
  const authBootstrapComplete = useTournamentStore((state) => state.authBootstrapComplete);
  const setAuthBootstrapComplete = useTournamentStore((state) => state.setAuthBootstrapComplete);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const postLoginResolutionRequest = useTournamentStore((state) => state.postLoginResolutionRequest);
  const setAuthAccessState = useTournamentStore((state) => state.setAuthAccessState);
  const setWorkspaceDirectoryState = useTournamentStore((state) => state.setWorkspaceDirectoryState);
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);

  React.useEffect(() => {
    let active = true;
    if (!bootstrapFinished) setAuthBootstrapComplete(false);

    void ensureAuthBootstrap(initSupabase).finally(() => {
      if (active) setAuthBootstrapComplete(true);
    });

    return () => {
      active = false;
    };
  }, [initSupabase, setAuthBootstrapComplete]);

  const accountId = currentEnterpriseUser?.id || null;
  const commercialLocked = currentEnterpriseUser?.tenant_type === 'self_service_customer'
    && currentEnterpriseUser?.business_access_active === false;

  React.useEffect(() => {
    if (!authBootstrapComplete) return;

    if (!accountId) {
      resetRoutingState();
      if (location.pathname.startsWith('/admin/') || isCommercialFlowPath(location.pathname)) {
        setAuthAccessState('UNAUTHENTICATED');
        navigate('/', { replace: true });
      }
      return;
    }

    if (commercialLocked) {
      routingVersion += 1;
      resolvingAccountId = null;
      handledAccountId = accountId;
      setWorkspaceDirectoryState(null);
      setSelectedTab('unlock');
      setAuthAccessState('WORKSPACE_SELECT_REQUIRED');
      if (location.pathname !== '/unlock') navigate('/unlock', { replace: true });
      return;
    }

    if (isWorkspaceDetailPath(location.pathname) || isCommercialFlowPath(location.pathname)) {
      routingVersion += 1;
      resolvingAccountId = null;
      handledAccountId = accountId;
      return;
    }

    if (isPublicTournamentPath(location.pathname) && postLoginResolutionRequest === 0) {
      routingVersion += 1;
      resolvingAccountId = null;
      handledAccountId = accountId;
      return;
    }

    if (handledAccountId === accountId || resolvingAccountId === accountId) return;

    const version = ++routingVersion;
    resolvingAccountId = accountId;
    setAuthAccessState('ACCESS_LOADING');

    void resolvePostLoginDestination()
      .then((destination) => {
        if (version !== routingVersion || useTournamentStore.getState().currentEnterpriseUser?.id !== accountId) {
          return;
        }

        const currentPath = window.location.pathname
          .replace((import.meta.env.BASE_URL || '/').replace(/\/$/, ''), '') || '/';
        if (isWorkspaceDetailPath(currentPath) || isCommercialFlowPath(currentPath)) {
          handledAccountId = accountId;
          resolvingAccountId = null;
          return;
        }

        handledAccountId = accountId;
        resolvingAccountId = null;

        if (destination.kind === 'COMMERCIAL_REQUIRED') {
          setWorkspaceDirectoryState(null);
          setSelectedTab('unlock');
          setAuthAccessState('WORKSPACE_SELECT_REQUIRED');
          navigate('/unlock', { replace: true });
          return;
        }

        if (destination.kind === 'AUTO_ENTER') {
          setWorkspaceDirectoryState(null);
          setAuthAccessState('ACCESS_LOADING');
          navigate(`/admin/workspace/${encodeURIComponent(destination.workspace.slug)}`, { replace: true });
          return;
        }

        if (destination.kind === 'DIRECTORY') {
          setWorkspaceDirectoryState({
            kind: 'DIRECTORY',
            initialFilter: destination.initial_filter,
          });
        } else {
          setWorkspaceDirectoryState({
            kind: 'EMPTY',
            reason: destination.reason,
            canCreateTournament: destination.can_create_tournament,
          });
        }
        navigate('/admin/workspaces', { replace: true });
      })
      .catch(() => {
        if (version !== routingVersion || useTournamentStore.getState().currentEnterpriseUser?.id !== accountId) {
          return;
        }
        handledAccountId = accountId;
        resolvingAccountId = null;
        setWorkspaceDirectoryState({
          kind: 'EMPTY',
          reason: 'RESOLUTION_ERROR',
          canCreateTournament: false,
        });
        setAuthAccessState('WORKSPACE_SELECT_REQUIRED');
        navigate('/admin/workspaces', { replace: true });
      });
  }, [
    accountId,
    authBootstrapComplete,
    commercialLocked,
    location.pathname,
    navigate,
    postLoginResolutionRequest,
    setAuthAccessState,
    setSelectedTab,
    setWorkspaceDirectoryState,
  ]);

  return null;
}
