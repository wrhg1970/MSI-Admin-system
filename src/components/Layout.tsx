import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { UserProfile, CustomRole } from '../types';
import { 
  Home as HomeIcon,
  LayoutDashboard, 
  FilePlus, 
  FileText,
  Settings, 
  LogOut, 
  Shield,
  Menu,
  X,
  Users,
  Building2,
  ShieldAlert,
  ShieldCheck,
  BookOpen,
  Sliders,
  ChevronDown,
  ChevronRight,
  Share2,
  Globe,
  BarChart3,
  DollarSign,
  Database,
  Upload,
  TrendingUp,
  AlertCircle,
  Bell,
  Compass,
  FileSpreadsheet
} from 'lucide-react';
import { useState } from 'react';
import { APP_LOGO, LOGO_LINK } from '../constants';

interface LayoutProps {
  children: ReactNode;
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
  companySettings: any;
}

export default function Layout({ children, profile, rolePermissions, companySettings }: LayoutProps) {
  const sidebarTheme = companySettings?.sidebarTheme || 'light';
  const isDarkSidebar = sidebarTheme === 'dark';
  const isGlassSidebar = sidebarTheme === 'glass';
  const logoUrl = (isDarkSidebar || isGlassSidebar) 
    ? (companySettings?.logoUrlDark || companySettings?.logoUrl || APP_LOGO) 
    : (companySettings?.logoUrl || APP_LOGO);
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCatalogsOpen, setIsCatalogsOpen] = useState(location.pathname.includes('insurance-plans') || location.pathname.includes('sales-channels') || location.pathname.includes('catalogs'));
  const [isAdminOpen, setIsAdminOpen] = useState(location.pathname.includes('admin'));
  const [isPoliciesOpen, setIsPoliciesOpen] = useState(location.pathname.includes('policies'));
  const [isRequestOpen, setIsRequestOpen] = useState(location.pathname.includes('request') || location.pathname.includes('quote'));

  const isPathActive = (p: string) => {
    if (p.includes('?')) {
      const parts = p.split('?');
      const pathPart = parts[0];
      const queryPart = parts[1];
      return location.pathname === pathPart && location.search.includes(queryPart);
    }
    if (p === '/policies') {
      return location.pathname === '/policies' && (location.search === '' || location.search.includes('tab=list'));
    }
    return location.pathname === p;
  };

  const isSuperAdmin = profile?.role === 'super_admin';

  const hasPermission = (menuId: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view') => {
    if (isSuperAdmin) return true;
    
    // Default system roles permissions if no custom role found
    if (!rolePermissions) {
      if (profile?.role === 'admin' || profile?.role === 'director') return true;
      if (profile?.role === 'seguros') return ['dashboard', 'request', 'clients', 'policies', 'catalogs', 'insurance-plans', 'providers', 'claims', 'historico'].includes(menuId);
      if (profile?.role === 'administracion') return ['dashboard', 'reports', 'commissions', 'providers', 'historico'].includes(menuId);
      if (profile?.role === 'agent') {
        if (['dashboard', 'request', 'clients', 'policies', 'historico'].includes(menuId)) return action === 'view' || action === 'create' || action === 'edit';
        return false;
      }
      if (profile?.role === 'client') {
        if (['dashboard', 'request', 'policies', 'historico'].includes(menuId)) return action === 'view';
        return false;
      }
      return false;
    }

    return rolePermissions.menuPermissions?.[menuId]?.[action] || false;
  };

  const navItems = [
    { name: 'Inicio', path: '/', icon: HomeIcon, color: 'text-cyan-600', bg: 'bg-cyan-50', activeBg: 'bg-cyan-600', activeText: 'text-white', show: true },
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, color: 'text-blue-600', bg: 'bg-blue-50', activeBg: 'bg-blue-600', activeText: 'text-white', show: hasPermission('dashboard') },
    { 
      name: 'Solicitar Seguro', 
      icon: FilePlus, 
      color: 'text-emerald-600', 
      bg: 'bg-emerald-50', 
      activeBg: 'bg-emerald-600', 
      activeText: 'text-white',
      isCollapsible: true,
      isOpen: isRequestOpen,
      setOpen: setIsRequestOpen,
      show: hasPermission('request'),
      children: [
        { name: 'Solicitar Seguro', path: '/request', icon: FilePlus, show: true },
        { name: 'Cotizar Seguro', path: '/quote', icon: FileText, show: true },
      ]
    },
    { name: 'Clientes', path: '/clients', icon: Users, color: 'text-violet-600', bg: 'bg-violet-50', activeBg: 'bg-violet-600', activeText: 'text-white', show: hasPermission('clients') },
    { name: 'Proveedores', path: '/providers', icon: Building2, color: 'text-cyan-600', bg: 'bg-cyan-50', activeBg: 'bg-cyan-600', activeText: 'text-white', show: hasPermission('providers') },
    { 
      name: 'Polizas', 
      icon: ShieldCheck, 
      color: 'text-amber-600', 
      bg: 'bg-amber-50', 
      activeBg: 'bg-[#b45309]', 
      activeText: 'text-white',
      isCollapsible: true,
      isOpen: isPoliciesOpen,
      setOpen: setIsPoliciesOpen,
      show: hasPermission('policies'),
      children: [
        { name: 'Gestión de Pólizas', path: '/policies', icon: ShieldCheck, show: true },
        { name: 'Exportación Caremed', path: '/policies?tab=caremed', icon: Upload, show: true },
        { name: 'Invoices CareMed', path: '/policies?tab=invoices', icon: FileSpreadsheet, show: true },
      ]
    },
    { name: 'Histórico', path: '/historico', icon: Compass, color: 'text-indigo-600', bg: 'bg-indigo-50', activeBg: 'bg-indigo-600', activeText: 'text-white', show: hasPermission('historico') },
    { name: 'Reportes', path: '/reports', icon: BarChart3, color: 'text-emerald-600', bg: 'bg-emerald-50', activeBg: 'bg-emerald-600', activeText: 'text-white', show: hasPermission('reports') },
    { 
      name: 'Administración', 
      icon: Settings, 
      color: 'text-rose-600', 
      bg: 'bg-rose-50', 
      activeBg: 'bg-rose-600', 
      activeText: 'text-white',
      isCollapsible: true,
      isOpen: isAdminOpen,
      setOpen: setIsAdminOpen, 
      show: hasPermission('admin'),
      children: [
        { name: 'Resumen', path: '/admin?tab=dashboard', icon: BarChart3, show: true },
        { name: 'Ingresos', path: '/admin?tab=incomes', icon: TrendingUp, show: true },
        { name: 'Gastos', path: '/admin?tab=expenses', icon: TrendingUp, show: true },
        { name: 'Comisiones', path: '/admin?tab=commissions', icon: DollarSign, show: true },
        { name: 'Cuentas por Pagar', path: '/admin?tab=accounts_payable', icon: Database, show: true },
        { name: 'Comparación', path: '/admin?tab=comparison', icon: TrendingUp, show: true },
      ]
    },
    { name: 'Siniestros', path: '/claims', icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-50', activeBg: 'bg-rose-600', activeText: 'text-white', show: hasPermission('claims') },
    { name: 'Comisiones', path: '/commissions', icon: ShieldAlert, color: 'text-indigo-600', bg: 'bg-indigo-50', activeBg: 'bg-indigo-600', activeText: 'text-white', show: hasPermission('commissions') },
    { 
      name: 'Catálogos', 
      icon: BookOpen, 
      color: 'text-blue-600', 
      bg: 'bg-blue-50', 
      activeBg: 'bg-blue-600', 
      activeText: 'text-white',
      isCollapsible: true,
      isOpen: isCatalogsOpen,
      setOpen: setIsCatalogsOpen,
      show: hasPermission('catalogs') || hasPermission('insurance-plans'),
      children: [
        { name: 'Planes de Seguro', path: '/insurance-plans', icon: BookOpen, show: hasPermission('insurance-plans') },
        { name: 'Tipo de Cambio / Países', path: '/catalogs', icon: Globe, show: hasPermission('catalogs') },
      ]
    },
    { name: 'Notificaciones', path: '/notifications', icon: Bell, color: 'text-amber-600', bg: 'bg-amber-50', activeBg: 'bg-amber-600', activeText: 'text-white', show: hasPermission('notifications') },
    { name: 'Configuración', path: '/config', icon: Sliders, color: 'text-slate-600', bg: 'bg-slate-50', activeBg: 'bg-slate-600', activeText: 'text-white', show: hasPermission('config') },
  ].filter(item => item.show);

  const handleLogout = async () => {
    try {
      console.log("Logging out...");
      localStorage.removeItem('verified_email');
      await signOut(auth);
      console.log("Logged out successfully");
      // Force reload to clear all states and redirect to auth
      window.location.href = '/';
    } catch (error) {
      console.error("Logout error:", error);
      // Fallback
      localStorage.clear();
      window.location.href = '/';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar - Desktop */}
      <aside className={`hidden md:flex flex-col w-72 border-r z-20 transition-all duration-500 shadow-2xl ${
        isDarkSidebar 
          ? 'bg-[#1A2138] border-white/5 text-white shadow-blue-900/20' 
          : isGlassSidebar
            ? 'bg-white/80 backdrop-blur-xl border-white/20 shadow-blue-100/50'
            : 'bg-white border-gray-100 shadow-gray-200/50'
      }`}>
        <div className="p-6">
          <a href={LOGO_LINK} target="_blank" rel="noopener noreferrer" className="block">
            <img 
              src={logoUrl} 
              alt="Mi Seguro Internacional" 
              className="max-h-20 w-auto object-contain transition-all duration-300 transform hover:scale-105"
              referrerPolicy="no-referrer"
            />
          </a>
        </div>
        
        <nav className="flex-1 px-6 space-y-1.5 py-2">
          {navItems.map((item) => {
            if ('isCollapsible' in item && item.isCollapsible) {
              const hasActiveChild = item.children?.some(child => isPathActive(child.path));
              return (
                <div key={item.name} className="space-y-1">
                  <button
                    onClick={() => item.setOpen?.(!item.isOpen)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group relative overflow-hidden ${
                      hasActiveChild
                        ? isDarkSidebar 
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20'
                          : `${item.bg} ${item.color} border border-blue-100`
                        : isDarkSidebar
                          ? 'text-gray-400 hover:bg-white/5 hover:text-white'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <item.icon className={`w-5 h-5 transition-all duration-300 ${
                      hasActiveChild ? 'scale-110' : `${item.color} group-hover:scale-110`
                    }`} />
                    <span className="font-bold text-sm tracking-tight">
                      {item.name}
                    </span>
                    <div className="ml-auto">
                      {item.isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </button>
                  
                  {item.isOpen && (
                    <div className="pl-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
                      {item.children?.filter(child => child.show !== false).map((child) => {
                        const isChildActive = isPathActive(child.path);
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group ${
                              isChildActive
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-100'
                                : isDarkSidebar
                                  ? 'text-gray-400 hover:bg-white/5 hover:text-white'
                                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                          >
                            <child.icon className={`w-4 h-4 ${isChildActive ? 'text-white' : isDarkSidebar ? 'text-gray-500 group-hover:text-white' : 'text-gray-400 group-hover:text-blue-600'}`} />
                            <span className="font-bold text-xs">
                              {child.name}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = isPathActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group relative overflow-hidden ${
                  isActive
                    ? `${item.activeBg} ${item.activeText} shadow-lg shadow-${item.activeBg.split('-')[1]}-200 scale-[1.02]`
                    : isDarkSidebar
                      ? 'text-gray-400 hover:bg-white/5 hover:text-white'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-50" />
                )}
                <item.icon className={`w-5 h-5 transition-all duration-300 ${
                  isActive ? 'scale-110' : `${item.color} group-hover:scale-110`
                }`} />
                <span className={`font-bold text-sm tracking-tight ${isActive ? 'translate-x-1' : 'group-hover:translate-x-1'} transition-transform duration-300`}>
                  {item.name}
                </span>
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-6 mt-auto">
          <div className={`${isDarkSidebar ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-100'} rounded-3xl p-4 border`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-md">
                  {profile?.displayName?.charAt(0) || profile?.email?.charAt(0)}
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full shadow-sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-gray-900 truncate leading-tight">{profile?.displayName}</p>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter opacity-70 truncate">{profile?.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 hover:bg-red-100 rounded-2xl transition-all duration-300 font-bold text-xs group"
            >
              <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 z-50 shadow-sm">
        <div className="flex items-center gap-2">
          <a href={LOGO_LINK} target="_blank" rel="noopener noreferrer">
            <img 
              src={logoUrl} 
              alt="Mi Seguro Internacional" 
              className="max-h-12 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
          </a>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
        >
          {isMobileMenuOpen ? <X className="w-6 h-6 text-gray-900" /> : <Menu className="w-6 h-6 text-gray-900" />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="absolute top-20 left-4 right-4 bg-white rounded-3xl p-4 shadow-2xl border border-gray-100 space-y-1 animate-in slide-in-from-top-4 duration-300 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {navItems.map((item) => {
              if ('isCollapsible' in item && item.isCollapsible) {
                const hasActiveChild = item.children?.some(child => isPathActive(child.path));
                return (
                  <div key={item.name} className="space-y-1">
                    <button
                      onClick={() => item.setOpen?.(!item.isOpen)}
                      className={`w-full flex items-center gap-3 px-4 py-4 rounded-2xl transition-all duration-200 ${
                        hasActiveChild ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <item.icon className={`w-5 h-5 ${hasActiveChild ? 'text-blue-600' : item.color}`} />
                      <span className="font-bold text-sm">{item.name}</span>
                      <div className="ml-auto">
                        {item.isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                    </button>
                    {item.isOpen && (
                      <div className="pl-4 space-y-1">
                        {item.children?.filter(child => child.show !== false).map((child) => {
                          const isChildActive = isPathActive(child.path);
                          return (
                            <Link
                              key={child.path}
                              to={child.path}
                              onClick={() => setIsMobileMenuOpen(false)}
                              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                                isChildActive ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              <child.icon className={`w-4 h-4 ${isChildActive ? 'text-white' : 'text-gray-400'}`} />
                              <span className="font-bold text-xs">{child.name}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              const isActive = isPathActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-4 rounded-2xl transition-all duration-200 ${
                    isActive 
                      ? `${item.activeBg} ${item.activeText} shadow-lg shadow-${item.activeBg.split('-')[1]}-100` 
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <item.icon className={`w-5 h-5 ${isActive ? 'text-white' : item.color}`} />
                  <span className="font-bold text-sm">{item.name}</span>
                  {isActive && <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full" />}
                </Link>
              );
            })}
            <div className="pt-4 mt-4 border-t border-gray-100">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-4 text-red-600 bg-red-50 rounded-2xl font-bold text-sm"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar Sesión</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 pt-16 md:pt-0 overflow-auto">
        <div className={`${
          location.pathname.includes('policies') || 
          location.pathname.includes('reports') || 
          location.pathname.includes('clients') ||
          location.pathname.includes('admin') ||
          location.pathname.includes('historico') 
            ? 'max-w-full lg:max-w-[96%] xl:max-w-[98%]' 
            : 'max-w-7xl'
        } mx-auto p-4 md:p-8 w-full`}>
          {children}
        </div>
      </main>
    </div>
  );
}
