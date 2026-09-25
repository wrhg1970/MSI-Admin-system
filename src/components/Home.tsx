import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile, CustomRole, Task, InsuranceRequest, Client, ExchangeRate } from '../types';
import { 
  FilePlus, 
  Users, 
  DollarSign, 
  Calendar, 
  ArrowRight, 
  ShieldCheck, 
  TrendingUp, 
  Clock,
  LayoutDashboard,
  Settings,
  Database,
  Search,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Filter,
  CalendarDays,
  CheckCircle2 as CheckedIcon,
  CalendarRange,
  FileSpreadsheet,
  Receipt,
  CreditCard,
  AlertCircle,
  FileText,
  X
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { format, isToday, isFuture, parseISO, isSameDay, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  setDoc,
  doc, 
  serverTimestamp, 
  orderBy, 
  deleteDoc,
  Timestamp,
  or,
  and,
  limit,
  getDocs
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import TaskModal from './TaskModal';
import ConfirmModal from './ConfirmModal';

import { useCompany } from '../App';
import { useFirestoreData } from '../context/FirestoreDataContext';
import { isInsuranceDeudor } from '../utils/paymentUtils';

interface HomeProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

export default function Home({ profile, rolePermissions }: HomeProps) {
  const navigate = useNavigate();
  const { settings: companySettings } = useCompany();
  const {
    insurances: allInsurances,
    clients: allClients,
    exchangeRates: contextExchangeRates,
    users: contextUsers,
    tasks: contextTasks,
    loading: contextLoading,
    limitToCurrentMonth,
    setLimitToCurrentMonth
  } = useFirestoreData();

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  // Calendar States
  const [isCalendarView, setIsCalendarView] = useState(false);
  const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Multi-Filter States
  const [filterCreatedBy, setFilterCreatedBy] = useState('');
  const [filterAssignedTo, setFilterAssignedTo] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'completed'>('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Exchange Rate States for Header
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [cardFeeInput, setCardFeeInput] = useState('');
  const [submittingRate, setSubmittingRate] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // Derive Memoized states from FirestoreDataContext
  const insurances = useMemo(() => {
    if (!profile) return [];
    const isAdmin = ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile.role || '');
    if (isAdmin) {
      return allInsurances;
    } else if (profile.role === 'agent') {
      return allInsurances.filter(ins => ins.agentId === profile.uid);
    } else {
      return allInsurances.filter(ins => ins.email === profile.email);
    }
  }, [allInsurances, profile]);

  const clients = useMemo(() => {
    if (!profile) return [];
    const isAdmin = ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile.role || '');
    if (isAdmin || profile.role === 'agent') {
      return allClients;
    }
    return [];
  }, [allClients, profile]);

  const exchangeRates = useMemo(() => {
    return contextExchangeRates;
  }, [contextExchangeRates]);

  const users = useMemo(() => {
    return contextUsers;
  }, [contextUsers]);

  const tasks = useMemo(() => {
    if (!profile) return [];
    const isAdmin = ['super_admin', 'director', 'admin'].includes(profile.role || '');
    let filteredTasks = contextTasks;
    if (!isAdmin) {
      filteredTasks = contextTasks.filter(t => 
        t.assignedTo === profile.uid || 
        t.assignedTo === profile.email || 
        t.createdBy === profile.uid
      );
    }
    return [...filteredTasks].sort((a, b) => {
      const timeA = a.createdAt?.toDate 
        ? a.createdAt.toDate().getTime() 
        : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.createdAt?.toDate 
        ? b.createdAt.toDate().getTime() 
        : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeB - timeA;
    });
  }, [contextTasks, profile]);

  const [openClaimsCount, setOpenClaimsCount] = useState<number>(0);
  const [loadingClaims, setLoadingClaims] = useState<boolean>(true);
  const [caremedInvoices, setCaremedInvoices] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState<boolean>(true);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'claims'),
      (snapshot) => {
        const count = snapshot.docs.filter(doc => !doc.data().isClosed).length;
        setOpenClaimsCount(count);
        setLoadingClaims(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'claims');
        setLoadingClaims(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'caremedInvoices'),
      (snapshot) => {
        setCaremedInvoices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoadingInvoices(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'caremedInvoices');
        setLoadingInvoices(false);
      }
    );
    return () => unsub();
  }, []);

  const loadingKPIs = useMemo(() => {
    return contextLoading.insurances || loadingClaims || loadingInvoices;
  }, [contextLoading, loadingClaims, loadingInvoices]);

  // KPI Calculations
  const kpiStats = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    // 1. Total Active Policies (Operational status "Activo": not cancelled and endDate >= today)
    const activePolicies = insurances.filter(ins => {
      const statusStr = (ins.status || '') as string;
      const isNotCancelled = ins.actionType?.toUpperCase() !== 'CAN' && ins.actionType !== 'Can' && statusStr !== 'cancelled';
      const hasNotEnded = !ins.endDate || ins.endDate >= todayStr;
      return isNotCancelled && hasNotEnded;
    });

    // 2. Polizas sin Exportar (status not cancelled)
    const unexportedCount = insurances.filter(ins => !ins.Caremed && ins.status !== 'cancelled').length;

    // 3. Polizas sin Invoice (status not cancelled)
    const uninvoicedCount = insurances.filter(ins => !ins.InvoiceCaremed && ins.status !== 'cancelled').length;

    // 4. Invoices sin Factura (Invoices CareMed agrupados que no tienen factura f?sica/digital adjunta)
    const uniqueInvoices = Array.from(new Set(
      insurances
        .filter(ins => ins.InvoiceCaremed && ins.InvoiceCaremed.trim() !== '' && ins.status !== 'cancelled')
        .map(ins => ins.InvoiceCaremed!.trim())
    ));

    const invoicesWithoutFacturaCount = uniqueInvoices.filter(invNum => {
      return !caremedInvoices.some(
        d => (d.invoiceNumber || '').toLowerCase().trim() === invNum.toLowerCase().trim()
      );
    }).length;

    // 5. Polizas por cobrar: mismo criterio que Reporte / Gesti?n (saldo deudor > $0.01)
    const unpaidCount = insurances.filter(isInsuranceDeudor).length;

    return {
      activeCount: activePolicies.length,
      unexportedCount,
      uninvoicedCount,
      invoicesWithoutFacturaCount,
      unpaidCount,
      openClaimsCount
    };
  }, [insurances, openClaimsCount, caremedInvoices]);
  
  const userName = profile?.displayName || profile?.email?.split('@')[0] || 'Usuario';
  const todayDate = new Date();

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todayRate = useMemo(() => {
    return exchangeRates.find(r => r.date === todayStr);
  }, [exchangeRates, todayStr]);

  const currentCardFee = useMemo(() => {
    if (todayRate?.cardFee !== undefined) return todayRate.cardFee;
    if ((todayRate as any)?.cargoTarjeta !== undefined) return (todayRate as any).cargoTarjeta;
    if (companySettings?.cardFee !== undefined) return companySettings.cardFee;
    if (companySettings?.cargoTarjeta !== undefined) return companySettings.cargoTarjeta;
    return 4.5;
  }, [todayRate, companySettings]);

  const handleSaveTodayRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateVal = parseFloat(rateInput);
    if (isNaN(rateVal) || rateVal <= 0) {
      setRateError('Por favor ingrese un tipo de cambio v?lido mayor a cero.');
      return;
    }

    const cardFeeVal = parseFloat(cardFeeInput);
    if (isNaN(cardFeeVal) || cardFeeVal < 0) {
      setRateError('Por favor ingrese un cargo de tarjeta v?lido.');
      return;
    }

    setSubmittingRate(true);
    setRateError(null);

    try {
      const q = query(collection(db, 'exchangeRates'), where('date', '==', todayStr));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const existingDoc = snap.docs[0];
        await updateDoc(doc(db, 'exchangeRates', existingDoc.id), {
          rate: rateVal,
          cardFee: cardFeeVal,
          cargoTarjeta: cardFeeVal,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'exchangeRates'), {
          rate: rateVal,
          cardFee: cardFeeVal,
          cargoTarjeta: cardFeeVal,
          date: todayStr,
          createdAt: serverTimestamp()
        });
      }

      await setDoc(doc(db, 'settings', 'company'), {
        cardFee: cardFeeVal,
        cargoTarjeta: cardFeeVal
      }, { merge: true });

      setIsRateModalOpen(false);
      setRateInput('');
      setCardFeeInput('');
    } catch (error) {
      setRateError('Error al guardar la informaci?n.');
      console.error(error);
    } finally {
      setSubmittingRate(false);
    }
  };



  const handleCreateTask = (defaultDate?: Date) => {
    if (defaultDate) {
      setEditingTask({
        dueDate: Timestamp.fromDate(defaultDate),
        title: '',
        description: '',
        priority: 'medium',
        status: 'pending',
        assignedTo: profile?.uid || profile?.email || '',
        createdBy: profile?.uid || '',
      } as any);
    } else {
      setEditingTask(null);
    }
    setIsTaskModalOpen(true);
  };

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleSaveTask = async (taskData: Partial<Task>) => {
    try {
      // Remove id from data to avoid Firestore validation errors for extra fields
      const { id, ...cleanData } = taskData as any;
      
      if (editingTask?.id) {
        await updateDoc(doc(db, 'tasks', editingTask.id), {
          ...cleanData,
          dueDate: taskData.dueDate ? Timestamp.fromDate(new Date(taskData.dueDate)) : null,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'tasks'), {
          ...cleanData,
          dueDate: taskData.dueDate ? Timestamp.fromDate(new Date(taskData.dueDate)) : null,
          status: 'pending',
          createdBy: profile?.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      setIsTaskModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
    }
  };

  const handleToggleTask = async (task: Task) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id!), {
        status: task.status === 'completed' ? 'pending' : 'completed',
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
    }
  };

  const handleDeleteTask = async (id: string) => {
    setTaskToDelete(id);
    setIsConfirmModalOpen(true);
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskToDelete));
      setTaskToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
    }
  };

  const getUserName = (idOrEmail: string) => {
    if (!idOrEmail) return 'S/A';
    const user = users.find(u => u.uid === idOrEmail || u.email === idOrEmail);
    return user?.displayName || user?.email?.split('@')[0] || idOrEmail;
  };

  // Helper to safely parse task date
  const getTaskDate = (task: Task): Date | null => {
    if (!task.dueDate) return null;
    if (typeof task.dueDate.toDate === 'function') {
      return task.dueDate.toDate();
    }
    return new Date(task.dueDate);
  };

  // 1. Authorized tasks (Only creator or responsible)
  // This satisfies: "Solo quien la creo y quien es el responsable ven las tareas."
  const authorizedTasks = useMemo(() => {
    if (!profile) return [];
    return tasks.filter(task => {
      const isCreator = task.createdBy === profile.uid;
      const isAssignee = task.assignedTo === profile.uid || task.assignedTo === profile.email;
      return isCreator || isAssignee;
    });
  }, [tasks, profile]);

  // 2. Interactive multi-filtered tasks
  const filteredTasks = useMemo(() => {
    return authorizedTasks.filter(task => {
      // Filter by Creator
      if (filterCreatedBy && task.createdBy !== filterCreatedBy) {
        return false;
      }
      // Filter by Responsible
      if (filterAssignedTo && task.assignedTo !== filterAssignedTo) {
        return false;
      }
      // Filter by Status
      if (filterStatus !== 'all' && task.status !== filterStatus) {
        return false;
      }
      
      const taskDate = getTaskDate(task);
      // Filter by Date Start
      if (filterStartDate) {
        if (!taskDate) return false;
        // set start date at 00:00:00
        const start = new Date(filterStartDate + 'T00:00:00');
        if (taskDate < start) return false;
      }
      // Filter by Date End
      if (filterEndDate) {
        if (!taskDate) return false;
        // set end date at 23:59:59
        const end = new Date(filterEndDate + 'T23:59:59');
        if (taskDate > end) return false;
      }
      return true;
    });
  }, [authorizedTasks, filterCreatedBy, filterAssignedTo, filterStatus, filterStartDate, filterEndDate]);

  // Month grid calculations
  const calendarGrid = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const startWeekDay = firstDay.getDay(); // 0 is Sunday, 1 is Monday...
    const padDaysBeforeIndex = startWeekDay === 0 ? 6 : startWeekDay - 1; // Align Mon-Sun
    
    const result: (Date | null)[] = Array(padDaysBeforeIndex).fill(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      result.push(new Date(year, month, d));
    }
    return result;
  }, [calendarDate]);

  // Week days list calculations
  const weekDays = useMemo(() => {
    const current = new Date(calendarDate);
    const day = current.getDay();
    // Align to Monday
    const diff = current.getDate() - (day === 0 ? 6 : day - 1);
    const monday = new Date(current.setDate(diff));
    
    const result: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(monday);
      nextDay.setDate(monday.getDate() + i);
      result.push(nextDay);
    }
    return result;
  }, [calendarDate]);

  // Helper to fetch tasks for a specific calendar date
  const getTasksForDate = (date: Date) => {
    return filteredTasks.filter(task => {
      const taskDate = getTaskDate(task);
      if (!taskDate) return false;
      return isSameDay(taskDate, date);
    });
  };

  // Calendar navigation handlers
  const handlePrev = () => {
    if (calendarViewMode === 'month') {
      setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1));
    } else if (calendarViewMode === 'week') {
      const nextDate = new Date(calendarDate);
      nextDate.setDate(calendarDate.getDate() - 7);
      setCalendarDate(nextDate);
    } else if (calendarViewMode === 'day') {
      const nextDate = new Date(calendarDate);
      nextDate.setDate(calendarDate.getDate() - 1);
      setCalendarDate(nextDate);
    }
  };

  const handleNext = () => {
    if (calendarViewMode === 'month') {
      setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1));
    } else if (calendarViewMode === 'week') {
      const nextDate = new Date(calendarDate);
      nextDate.setDate(calendarDate.getDate() + 7);
      setCalendarDate(nextDate);
    } else if (calendarViewMode === 'day') {
      const nextDate = new Date(calendarDate);
      nextDate.setDate(calendarDate.getDate() + 1);
      setCalendarDate(nextDate);
    }
  };

  const handleToday = () => {
    setCalendarDate(new Date());
  };

  const quickActions = [
    { 
      name: 'Solicitar Seguro', 
      description: 'Emisi?n de p?lizas y cotizaciones', 
      icon: FilePlus, 
      path: '/request', 
      color: 'bg-[#1e40af]', 
      hover: 'hover:bg-[#1e3a8a]' 
    },
    { 
      name: 'Alta de Clientes', 
      description: 'Gesti?n de base de datos de clientes', 
      icon: Users, 
      path: '/clients', 
      color: 'bg-[#06b6d4]', 
      hover: 'hover:bg-[#0891b2]' 
    },
    { 
      name: 'Pagos y Cobros', 
      description: 'Conciliaci?n bancaria y facturaci?n', 
      icon: DollarSign, 
      path: '/admin?tab=reconciliation', 
      color: 'bg-[#0f172a]', 
      hover: 'hover:bg-[#020617]' 
    },
  ];

  const modules = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', description: 'Resumen de ventas y KPIs' },
    { name: 'Proveedores', icon: Settings, path: '/providers', description: 'Gesti?n de partners' },
    { name: 'Cat?logos', icon: Database, path: '/catalogs', description: 'Pa?ses y tipos de cambio' },
    { name: 'Reportes', icon: TrendingUp, path: '/reports', description: 'An?lisis detallado' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Welcome Header */}
      <header className="relative overflow-hidden rounded-[2.5rem] bg-[#1A2138] p-8 md:p-12 text-white shadow-2xl">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-500/20 to-transparent pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-cyan-400/10 rounded-full blur-3xl pointer-events-none" />
        
        {/* Logo Overlay */}
        {(companySettings?.logoUrlDark || companySettings?.logoUrl) && (
          <div className="absolute top-8 right-8 opacity-10 pointer-events-none hidden md:block">
            <img 
              src={companySettings.logoUrlDark || companySettings.logoUrl} 
              alt="Background Logo" 
              className="max-h-32 w-auto object-contain"
            />
          </div>
        )}

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight">
              ?Buen d?a, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">{userName}</span>!
            </h1>
            <p className="text-blue-100/70 text-lg md:text-xl font-medium max-w-xl">
              Bienvenido a tu panel de control de Mi Seguro Internacional. Todo lo que necesitas est? a un click de distancia.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3 text-sm font-bold bg-white/5 backdrop-blur-md border border-white/10 w-fit px-5 py-2.5 rounded-2xl">
                <Calendar className="w-5 h-5 text-cyan-400" />
                <span className="capitalize">{format(todayDate, "EEEE, d 'de' MMMM", { locale: es })}</span>
              </div>

              <div className="flex items-center gap-3 text-sm font-bold bg-white/5 backdrop-blur-md border border-white/10 w-fit px-5 py-2.5 rounded-2xl">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                <button
                  onClick={() => {
                    setRateInput(todayRate ? todayRate.rate.toString() : '');
                    setCardFeeInput(currentCardFee.toString());
                    setRateError(null);
                    setIsRateModalOpen(true);
                  }}
                  className="font-mono hover:text-cyan-300 transition-colors cursor-pointer text-left flex items-center gap-1.5 focus:outline-none"
                >
                  {todayRate ? (
                    <>TC: ${todayRate.rate.toFixed(4)}</>
                  ) : (
                    <>TC: Pendiente <Plus className="w-3.5 h-3.5 text-cyan-400" /></>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3 text-sm font-bold bg-white/5 backdrop-blur-md border border-white/10 w-fit px-5 py-2.5 rounded-2xl">
                <CreditCard className="w-5 h-5 text-indigo-300" />
                <button
                  onClick={() => {
                    setRateInput(todayRate ? todayRate.rate.toString() : '');
                    setCardFeeInput(currentCardFee.toString());
                    setRateError(null);
                    setIsRateModalOpen(true);
                  }}
                  className="font-mono hover:text-cyan-300 transition-colors cursor-pointer text-left flex items-center gap-1.5 focus:outline-none"
                >
                  <span>Cargo Tarjeta: {currentCardFee}%</span>
                </button>
              </div>
            </div>
          </div>
          
          <div className="hidden lg:flex items-center gap-6">
            <div className="text-center p-6 bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl min-w-[140px]">
              <p className="text-3xl font-black text-cyan-400">{authorizedTasks.filter(t => t.status === 'completed').length}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200 mt-1">Tareas Listas</p>
            </div>
            <div className="text-center p-6 bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl min-w-[140px]">
              <p className="text-3xl font-black text-blue-400">{authorizedTasks.filter(t => t.status === 'pending').length}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200 mt-1">Pendientes</p>
            </div>
          </div>
        </div>
      </header>

      {/* Visual Month Limit Indicator Banner */}
      {limitToCurrentMonth && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-indigo-500 p-4 rounded-r-2xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 animate-in fade-in duration-500">
          <div className="flex gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Optimizaci?n de Carga Activa
              </p>
              <p className="text-xs text-slate-500">
                Para reducir el consumo de datos, solo se han cargado las p?lizas y transacciones del mes actual.
              </p>
            </div>
          </div>
          <button
            onClick={() => setLimitToCurrentMonth(false)}
            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all"
          >
            Cargar Todo el Hist?rico
          </button>
        </div>
      )}

      {/* Summary KPI Dashboard */}
      {profile?.role !== 'client' ? (
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 animate-in fade-in duration-500">
          {/* P?lizas Activas */}
          <div 
            onClick={() => navigate('/policies')}
            className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex items-center justify-between cursor-pointer group"
          >
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                P?lizas Activas
              </h3>
              {loadingKPIs ? (
                <div className="h-8 w-16 bg-gray-100 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-black text-[#1A2138] group-hover:text-blue-600 transition-colors">
                  {kpiStats.activeCount}
                </p>
              )}
              <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg w-fit">
                Vigentes actualmente
              </p>
            </div>
            <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>

          {/* P?lizas sin Exportar */}
          <div 
            onClick={() => navigate('/policies?filter=unexported')}
            className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex items-center justify-between cursor-pointer group"
          >
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                Sin Exportar
              </h3>
              {loadingKPIs ? (
                <div className="h-8 w-16 bg-gray-100 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-black text-[#1A2138] group-hover:text-amber-600 transition-colors">
                  {kpiStats.unexportedCount}
                </p>
              )}
              <p className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg w-fit">
                Ir a Gesti?n
              </p>
            </div>
            <div className="p-4 bg-amber-50 text-amber-600 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
          </div>

          {/* P?lizas sin Invoice */}
          <div 
            onClick={() => navigate('/policies?tab=caremed')}
            className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex items-center justify-between cursor-pointer group"
          >
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                Sin Invoice
              </h3>
              {loadingKPIs ? (
                <div className="h-8 w-16 bg-gray-100 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-black text-[#1A2138] group-hover:text-indigo-600 transition-colors">
                  {kpiStats.uninvoicedCount}
                </p>
              )}
              <p className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg w-fit">
                Ir a Exportaci?n
              </p>
            </div>
            <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <Receipt className="w-6 h-6" />
            </div>
          </div>

          {/* Invoices sin Factura */}
          <div 
            onClick={() => navigate('/policies?tab=invoices')}
            className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex items-center justify-between cursor-pointer group"
          >
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                Invoices sin Factura
              </h3>
              {loadingKPIs ? (
                <div className="h-8 w-16 bg-gray-100 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-black text-[#1A2138] group-hover:text-purple-600 transition-colors">
                  {kpiStats.invoicesWithoutFacturaCount}
                </p>
              )}
              <p className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2.5 py-1 rounded-lg w-fit">
                Ir a Invoices
              </p>
            </div>
            <div className="p-4 bg-purple-50 text-purple-600 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <FileText className="w-6 h-6" />
            </div>
          </div>

          {/* P?lizas sin Pagar */}
          <div 
            onClick={() => navigate('/policies?filter=unpaid')}
            className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex items-center justify-between cursor-pointer group"
          >
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                Sin Pagar
              </h3>
              {loadingKPIs ? (
                <div className="h-8 w-16 bg-gray-100 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-black text-[#1A2138] group-hover:text-rose-600 transition-colors">
                  {kpiStats.unpaidCount}
                </p>
              )}
              <p className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg w-fit">
                Ir a Gesti?n
              </p>
            </div>
            <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <CreditCard className="w-6 h-6" />
            </div>
          </div>

          {/* Siniestros Abiertos */}
          <div 
            onClick={() => navigate('/claims')}
            className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex items-center justify-between cursor-pointer group"
          >
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                Siniestros Abiertos
              </h3>
              {loadingKPIs ? (
                <div className="h-8 w-16 bg-gray-100 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-black text-[#1A2138] group-hover:text-red-600 transition-colors">
                  {kpiStats.openClaimsCount}
                </p>
              )}
              <p className="text-[10px] font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-lg w-fit">
                En tr?mite
              </p>
            </div>
            <div className="p-4 bg-red-50 text-red-600 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <AlertCircle className="w-6 h-6" />
            </div>
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-500">
          {/* P?lizas Activas */}
          <div 
            onClick={() => navigate('/policies')}
            className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all flex items-center justify-between cursor-pointer group"
          >
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                P?lizas Activas / Total Active Policies
              </h3>
              {loadingKPIs ? (
                <div className="h-8 w-16 bg-gray-100 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-black text-[#1A2138] group-hover:text-blue-600 transition-colors">
                  {kpiStats.activeCount}
                </p>
              )}
              <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg w-fit">
                Vigentes actualmente
              </p>
            </div>
            <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>

          {/* Soporte */}
          <div className="bg-white rounded-[2rem] p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center justify-between">
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                Soporte / Assistance
              </h3>
              <p className="text-sm font-black text-[#1A2138] leading-tight">
                ?Necesitas ayuda con tus seguros?
              </p>
              <p className="text-[10px] font-bold text-[#1e40af] bg-blue-50 px-2.5 py-1 rounded-lg w-fit">
                Contacto Disponible
              </p>
            </div>
            <div className="p-4 bg-[#1e40af]/10 text-[#1e40af] rounded-2xl">
              <Users className="w-6 h-6" />
            </div>
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {quickActions.map((action) => (
          <button
            key={action.name}
            onClick={() => navigate(action.path)}
            className={`group flex items-center gap-5 p-6 bg-white rounded-[2rem] border border-gray-100 shadow-sm transition-all duration-300 hover:shadow-xl hover:shadow-gray-200/50 hover:-translate-y-1 text-left`}
          >
            <div className={`p-4 ${action.color} text-white rounded-2xl shadow-lg transition-transform group-hover:scale-110 duration-300`}>
              <action.icon className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{action.name}</h3>
              <p className="text-gray-500 font-bold text-xs">{action.description}</p>
            </div>
          </button>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Agenda & Tasks - taking 3 columns on large screens for ample calendar space */}
        <section className="lg:col-span-3 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-2xl font-black text-[#1A2138] uppercase tracking-tight flex items-center gap-2">
              <Clock className="w-6 h-6 text-blue-600" />
              Agenda y Tareas
            </h2>

            {/* Toggle Calendar vs List View */}
            <div className="bg-gray-100 p-1 rounded-2xl border border-gray-200 inline-flex gap-1">
              <button
                onClick={() => setIsCalendarView(false)}
                className={`px-4 py-2 text-xs font-black rounded-xl transition-all cursor-pointer uppercase ${
                  !isCalendarView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Vista Lista
              </button>
              <button
                onClick={() => setIsCalendarView(true)}
                className={`px-4 py-2 text-xs font-black rounded-xl transition-all cursor-pointer uppercase flex items-center gap-1.5 ${
                  isCalendarView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <Calendar className="w-4 h-4 text-blue-600 animate-pulse" />
                Vista Calendario
              </button>
            </div>
          </div>

          <div className="bg-white rounded-[2.5rem] p-6 md:p-8 border border-gray-100 shadow-sm space-y-6">
            
            {/* Advanced Filters Block */}
            <div className="bg-gray-50/70 p-5 rounded-3xl border border-gray-100 space-y-4">
              <div className="flex items-center gap-2 text-gray-900 font-black text-xs uppercase tracking-wider">
                <Filter className="w-4 h-4 text-blue-600" />
                Filtrar Tareas
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                {/* Creator Selector */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Creado Por</label>
                  <select
                    value={filterCreatedBy}
                    onChange={(e) => setFilterCreatedBy(e.target.value)}
                    className="w-full text-xs font-bold p-3 bg-white border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
                  >
                    <option value="">Cualquiera</option>
                    {users.map(u => (
                      <option key={`f-c-${u.uid}`} value={u.uid}>{u.displayName || u.email}</option>
                    ))}
                  </select>
                </div>

                {/* Responsible Selector */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Responsable</label>
                  <select
                    value={filterAssignedTo}
                    onChange={(e) => setFilterAssignedTo(e.target.value)}
                    className="w-full text-xs font-bold p-3 bg-white border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
                  >
                    <option value="">Cualquiera</option>
                    {users.map(u => (
                      <option key={`f-r-${u.uid}`} value={u.uid || u.email}>{u.displayName || u.email}</option>
                    ))}
                  </select>
                </div>

                {/* Status Selector */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Estado</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as any)}
                    className="w-full text-xs font-bold p-3 bg-white border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 transition-all cursor-pointer"
                  >
                    <option value="all">Todas</option>
                    <option value="pending">Por Hacer</option>
                    <option value="completed">Realizadas</option>
                  </select>
                </div>

                {/* Start Date */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Desde Fecha</label>
                  <input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="w-full text-xs font-bold p-3 bg-white border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>

                {/* End Date */}
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Hasta Fecha</label>
                  <input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="w-full text-xs font-bold p-3 bg-white border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              {(filterCreatedBy || filterAssignedTo || filterStatus !== 'all' || filterStartDate || filterEndDate) && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => {
                      setFilterCreatedBy('');
                      setFilterAssignedTo('');
                      setFilterStatus('all');
                      setFilterStartDate('');
                      setFilterEndDate('');
                    }}
                    className="text-[9px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest flex items-center gap-1 transition-all"
                  >
                    Limpiar Filtros Aplicados
                  </button>
                </div>
              )}
            </div>

            {/* Render Calendar View Component */}
            {isCalendarView ? (
              <div className="space-y-6">
                {/* Calendar Navigator Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-50 pb-5">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                      {calendarViewMode === 'month' && format(calendarDate, 'MMMM yyyy', { locale: es })}
                      {calendarViewMode === 'week' && `Semana del ${format(weekDays[0], 'd')} al ${format(weekDays[6], "d 'de' MMMM", { locale: es })}`}
                      {calendarViewMode === 'day' && format(calendarDate, "EEEE, d 'de' MMMM", { locale: es })}
                    </h3>
                    
                    <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-sm shrink-0">
                      <button 
                        onClick={handlePrev}
                        className="p-1.5 hover:bg-white text-gray-500 hover:text-gray-900 rounded-lg transition-all"
                        title="Anterior"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={handleToday}
                        className="px-2.5 py-1 hover:bg-white text-gray-600 font-black text-[9px] rounded-lg transition-all uppercase tracking-wider"
                      >
                        Hoy
                      </button>
                      <button 
                        onClick={handleNext}
                        className="p-1.5 hover:bg-white text-gray-500 hover:text-gray-900 rounded-lg transition-all"
                        title="Siguiente"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Mode Selector */}
                  <div className="bg-gray-100 p-1 rounded-xl border border-gray-200 inline-flex gap-1 shadow-inner shrink-0">
                    {(['month', 'week', 'day'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setCalendarViewMode(mode)}
                        className={`px-3.5 py-1.5 text-[10px] font-black rounded-lg transition-all uppercase tracking-wider ${
                          calendarViewMode === mode 
                            ? 'bg-blue-600 text-white shadow-sm' 
                            : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        {mode === 'month' ? 'Mes' : mode === 'week' ? 'Semana' : 'D?a'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* MONTH VIEW GRID */}
                {calendarViewMode === 'month' && (
                  <div className="space-y-2">
                    {/* Weekday headers */}
                    <div className="grid grid-cols-7 gap-1 text-center bg-gray-50/50 p-1 rounded-xl border border-gray-100">
                      {['Lun', 'Mar', 'Mi?', 'Jue', 'Vie', 'S?b', 'Dom'].map(d => (
                        <span key={d} className="text-[10px] font-black uppercase text-gray-400 tracking-wider py-1.5">{d}</span>
                      ))}
                    </div>
                    {/* Days matrix */}
                    <div className="grid grid-cols-7 gap-2">
                      {calendarGrid.map((day, idx) => {
                        if (!day) return <div key={`empty-${idx}`} className="bg-gray-50/20 rounded-2xl border border-dashed border-gray-100/50 min-h-[90px]" />;
                        
                        const dayTasks = getTasksForDate(day);
                        const isSelected = isSameDay(calendarDate, day);
                        const isCurrentToday = isToday(day);
                        
                        return (
                          <div 
                            key={`day-${idx}`}
                            onClick={() => {
                              setCalendarDate(day);
                              // Keep on month or switch to day view? Switch is very helpful, let's allow them to focus
                            }}
                            className={`min-h-[105px] p-2 bg-white rounded-2xl border transition-all cursor-pointer flex flex-col justify-between group relative ${
                              isCurrentToday 
                                ? 'border-cyan-400 ring-2 ring-cyan-100/80' 
                                : isSelected 
                                ? 'border-blue-400 bg-blue-50/10' 
                                : 'border-gray-100 hover:border-gray-300 hover:shadow-md'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className={`text-xs font-black w-6 h-6 flex items-center justify-center rounded-full ${
                                isCurrentToday 
                                  ? 'bg-cyan-500 text-white shadow-md shadow-cyan-200' 
                                  : isSelected
                                  ? 'bg-blue-600 text-white'
                                  : 'text-gray-900'
                              }`}>
                                {format(day, 'd')}
                              </span>
                              
                              {/* Create task for this day icon */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCreateTask(day);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-blue-600 hover:bg-gray-50 rounded-lg"
                                title={`Nueva tarea el ${format(day, 'd/MM')}`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Stacked Task badges */}
                            <div className="space-y-1 mt-2">
                              {dayTasks.slice(0, 3).map(task => (
                                <div
                                  key={task.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditTask(task);
                                  }}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-lg truncate w-full border ${
                                    task.status === 'completed'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100/80 line-through'
                                      : task.priority === 'high'
                                      ? 'bg-red-50 text-red-700 border-red-100 animate-pulse'
                                      : 'bg-blue-50 text-blue-700 border-blue-100/80'
                                  }`}
                                  title={task.title}
                                >
                                  {task.title}
                                </div>
                              ))}
                              {dayTasks.length > 3 && (
                                <div className="text-[8px] font-black text-gray-400 text-center uppercase tracking-widest">
                                  + {dayTasks.length - 3} m?s
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* WEEK VIEW COLUMNS */}
                {calendarViewMode === 'week' && (
                  <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
                    {weekDays.map((day, idx) => {
                      const dayTasks = getTasksForDate(day);
                      const isCurrentToday = isToday(day);
                      return (
                        <div 
                          key={`week-day-${idx}`}
                          className={`bg-white rounded-2xl border p-4 flex flex-col justify-between min-h-[220px] ${
                            isCurrentToday 
                              ? 'border-cyan-400 ring-2 ring-cyan-100/70 bg-cyan-50/5' 
                              : 'border-gray-100'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between border-b border-gray-50 pb-2 mb-3">
                              <div>
                                <span className="text-[10px] font-black uppercase text-gray-400 block tracking-wider">
                                  {format(day, 'EEEE', { locale: es })}
                                </span>
                                <span className={`text-base font-black ${isCurrentToday ? 'text-cyan-600' : 'text-gray-900'}`}>
                                  {format(day, 'd')}
                                </span>
                              </div>
                              <button 
                                onClick={() => handleCreateTask(day)}
                                className="p-1 hover:bg-gray-100 text-blue-600 rounded-lg transition-colors cursor-pointer"
                                title="Agregar para este d?a"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                              {dayTasks.length === 0 ? (
                                <span className="text-[10px] text-gray-300 font-bold block text-center py-4">Sin tareas</span>
                              ) : (
                                dayTasks.map(task => (
                                  <div 
                                    key={task.id}
                                    onClick={() => handleEditTask(task)}
                                    className={`p-2 rounded-xl text-left border cursor-pointer hover:shadow-sm transition-all relative group ${
                                      task.status === 'completed'
                                        ? 'bg-gray-50 text-gray-400 border-gray-100 line-through'
                                        : task.priority === 'high'
                                        ? 'border-red-100 bg-red-50/50 text-red-900'
                                        : 'border-gray-100 bg-gray-50/30 hover:bg-white text-gray-800'
                                    }`}
                                  >
                                    <div className="text-[10px] font-black truncate">{task.title}</div>
                                    <div className="text-[8px] font-bold text-gray-400 mt-1 flex justify-between items-center">
                                      <span>{task.dueDate ? format(task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate), "HH:mm") : ''}</span>
                                      <span className="text-gray-600">{getUserName(task.assignedTo)}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* DAY VIEW DETAIL */}
                {calendarViewMode === 'day' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50/50 p-5 rounded-3xl border border-gray-100">
                    {/* Pending tasks in Selected Date */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-1.5 text-blue-600 font-black text-xs uppercase tracking-wider ml-1">
                        <Clock className="w-4 h-4" />
                        A?n por Hacer ({getTasksForDate(calendarDate).filter(t => t.status !== 'completed').length})
                      </div>
                      <div className="space-y-3">
                        {getTasksForDate(calendarDate).filter(t => t.status !== 'completed').length === 0 ? (
                          <div className="bg-white rounded-2xl border border-dashed border-gray-100 text-center py-10 font-bold text-xs text-gray-400">
                            No hay tareas pendientes para este d?a.
                          </div>
                        ) : (
                          getTasksForDate(calendarDate).filter(t => t.status !== 'completed').map(task => (
                            <div 
                              key={task.id}
                              className="bg-white rounded-2xl p-4 border border-gray-100 hover:shadow-md transition-all flex items-start gap-4"
                            >
                              <button 
                                onClick={() => handleToggleTask(task)}
                                className="mt-0.5 text-gray-300 hover:text-emerald-500 hover:scale-110 transition-transform shrink-0 cursor-pointer"
                              >
                                <Circle className="w-5 h-5" />
                              </button>
                              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleEditTask(task)}>
                                <h4 className="text-sm font-black text-gray-900 truncate uppercase tracking-tight">{task.title}</h4>
                                <p className="text-xs font-bold text-gray-500 mt-1 truncate">{task.description || 'Sin descripci?n'}</p>
                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[9px] font-black uppercase text-gray-400">
                                  <span>De: {getUserName(task.createdBy)}</span>
                                  <span>Para: {getUserName(task.assignedTo)}</span>
                                  {task.priority === 'high' && <span className="text-red-500 bg-red-50 px-1 rounded">Alta prioridad</span>}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Completed tasks in Selected Date */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-1.5 text-emerald-600 font-black text-xs uppercase tracking-wider ml-1">
                        <CheckCircle2 className="w-4 h-4" />
                        Completadas ({getTasksForDate(calendarDate).filter(t => t.status === 'completed').length})
                      </div>
                      <div className="space-y-3">
                        {getTasksForDate(calendarDate).filter(t => t.status === 'completed').length === 0 ? (
                          <div className="bg-white rounded-2xl border border-dashed border-gray-100 text-center py-10 font-bold text-xs text-gray-400">
                            Ninguna tarea ha sido completada este d?a a?n.
                          </div>
                        ) : (
                          getTasksForDate(calendarDate).filter(t => t.status === 'completed').map(task => (
                            <div 
                              key={task.id}
                              className="bg-white rounded-2xl p-4 border border-gray-50 hover:shadow-md transition-all opacity-70 flex items-start gap-4"
                            >
                              <button 
                                onClick={() => handleToggleTask(task)}
                                className="mt-0.5 text-emerald-500 shrink-0 cursor-pointer"
                              >
                                <CheckCircle2 className="w-5 h-5" />
                              </button>
                              <div className="flex-1 min-w-0 cursor-pointer line-through" onClick={() => handleEditTask(task)}>
                                <h4 className="text-sm font-semibold text-gray-400 truncate uppercase tracking-tight">{task.title}</h4>
                                <p className="text-xs text-gray-300 mt-1 truncate">{task.description}</p>
                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[9px] font-black uppercase text-gray-300">
                                  <span>De: {getUserName(task.createdBy)}</span>
                                  <span>Para: {getUserName(task.assignedTo)}</span>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* LIST VIEW WITH CATEGORIZED SECTIONS */
              <div className="space-y-6">
                {/* TAREAS PENDIENTES */}
                <div className="space-y-3">
                  <div className="text-xs font-black uppercase text-gray-500 tracking-wider flex items-center gap-1.5 ml-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                    Tareas por hacer ({filteredTasks.filter(t => t.status !== 'completed').length})
                  </div>
                  {filteredTasks.filter(t => t.status !== 'completed').length === 0 ? (
                    <div className="text-center py-8 bg-gray-50/50 rounded-2xl">
                      <p className="text-gray-400 font-bold text-xs">No hay tareas pendientes en este filtro.</p>
                    </div>
                  ) : (
                    filteredTasks.filter(t => t.status !== 'completed').map((task) => (
                      <div 
                        key={task.id} 
                        className="flex items-center justify-between p-5 hover:bg-gray-50 bg-white rounded-2xl transition-colors border border-gray-100 group shadow-sm hover:shadow-md"
                      >
                        <div className="flex items-center gap-5 flex-1 min-w-0">
                          <button 
                            onClick={() => handleToggleTask(task)}
                            className="transition-transform duration-300 hover:scale-110 flex-shrink-0 cursor-pointer"
                          >
                            <Circle className="w-6 h-6 text-gray-300 hover:text-emerald-500" />
                          </button>
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleEditTask(task)}>
                            <h4 className="text-sm font-black truncate mb-1 text-gray-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">
                              {task.title}
                            </h4>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Clock className="w-3 h-3 text-blue-500" />
                                <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">
                                  {task.dueDate ? format(getTaskDate(task)!, "dd 'de' MMM, HH:mm 'hrs'") : 'Sin hora'}
                                </p>
                              </div>
                              
                              <div className="flex items-center gap-1.5 text-gray-400">
                                <Plus className="w-3 h-3" />
                                <p className="text-[9px] font-bold truncate max-w-[120px]">
                                  De: <span className="text-gray-600">{getUserName(task.createdBy)}</span>
                                </p>
                              </div>

                              <div className="flex items-center gap-1.5 text-gray-400">
                                <Users className="w-3 h-3" />
                                <p className="text-[9px] font-bold truncate max-w-[120px]">
                                  Para: <span className="text-gray-600">{getUserName(task.assignedTo)}</span>
                                </p>
                              </div>

                              {task.priority === 'high' && (
                                <span className="px-2 py-0.5 bg-red-50 text-red-500 text-[8px] font-black uppercase rounded-full border border-red-100 shadow-sm animate-pulse">Alta Prioridad</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => handleEditTask(task)}
                            className="p-2.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                            title="Editar tarea"
                          >
                            <ArrowRight className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteTask(task.id!)}
                            className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                            title="Eliminar tarea"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* TAREAS DEBIDAMENTE COMPLETADAS */}
                <div className="space-y-3 pt-4">
                  <div className="text-xs font-black uppercase text-emerald-600 tracking-wider flex items-center gap-1.5 ml-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    Tareas realizadas ({filteredTasks.filter(t => t.status === 'completed').length})
                  </div>
                  {filteredTasks.filter(t => t.status === 'completed').length === 0 ? (
                    <div className="text-center py-8 bg-gray-50/50 rounded-2xl">
                      <p className="text-gray-400 font-bold text-xs">Ninguna tarea ha sido completada en este filtro.</p>
                    </div>
                  ) : (
                    filteredTasks.filter(t => t.status === 'completed').map((task) => (
                      <div 
                        key={task.id} 
                        className="flex items-center justify-between p-5 hover:bg-gray-50 bg-gray-50/20 rounded-2xl transition-colors border border-gray-50 last:border-0 group opacity-75"
                      >
                        <div className="flex items-center gap-5 flex-1 min-w-0">
                          <button 
                            onClick={() => handleToggleTask(task)}
                            className="transition-transform duration-300 hover:scale-110 flex-shrink-0 cursor-pointer"
                          >
                            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                          </button>
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleEditTask(task)}>
                            <h4 className="text-sm font-semibold truncate mb-1 text-gray-400 line-through">
                              {task.title}
                            </h4>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <div className="flex items-center gap-1.5 text-gray-400">
                                <Clock className="w-3 h-3 text-gray-300" />
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                  Listo
                                </p>
                              </div>
                              
                              <div className="flex items-center gap-1.5 text-gray-300">
                                <Plus className="w-3 h-3" />
                                <p className="text-[9px] font-bold truncate max-w-[120px]">
                                  De: <span className="text-gray-400">{getUserName(task.createdBy)}</span>
                                </p>
                              </div>

                              <div className="flex items-center gap-1.5 text-gray-300">
                                <Users className="w-3 h-3" />
                                <p className="text-[9px] font-bold truncate max-w-[120px]">
                                  Para: <span className="text-gray-400">{getUserName(task.assignedTo)}</span>
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => handleEditTask(task)}
                            className="p-2.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                            title="Editar"
                          >
                            <ArrowRight className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteTask(task.id!)}
                            className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Add Task Button always present at bottom */}
            <button 
              onClick={() => handleCreateTask()}
              className="w-full mt-4 flex items-center justify-center gap-2 py-4 border-2 border-dashed border-gray-100 hover:border-blue-300 rounded-[1.5rem] bg-slate-50/20 text-gray-500 hover:text-blue-600 transition-all font-black text-xs uppercase tracking-widest cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Agregar Nueva Tarea
            </button>
          </div>
        </section>

        {/* Browser Access / Shortcuts */}
        <section className="space-y-6">
          <h2 className="text-2xl font-black text-[#1A2138] uppercase tracking-tight flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-blue-600" />
            Shortcuts
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {modules.map((module) => (
              <Link
                key={module.name}
                to={module.path}
                className="group flex items-center gap-4 p-5 bg-white rounded-[2rem] border border-gray-100 shadow-sm transition-all duration-300 hover:shadow-xl hover:shadow-gray-200/50 hover:-translate-x-1"
              >
                <div className="p-3 bg-gray-50 text-gray-400 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                  <module.icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-gray-900 uppercase tracking-tighter group-hover:text-blue-600 transition-colors">{module.name}</h4>
                  <p className="text-[10px] font-bold text-gray-400">{module.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        onSave={handleSaveTask}
        editingTask={editingTask}
        users={users}
        currentUser={profile}
      />

      <ConfirmModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={confirmDeleteTask}
        title="Eliminar Tarea"
        message="?Est?s seguro de que deseas eliminar esta tarea de la agenda? Esta acci?n no se puede deshacer."
        confirmText="S?, eliminar"
        cancelText="No, mantener"
      />

      {/* Exchange Rate Modal */}
      {isRateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" 
            onClick={() => setIsRateModalOpen(false)}
          />

          {/* Modal Container */}
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 pb-4 border-b border-gray-50 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-0.5">
                  Cat?logo Tipo de Cambio
                </span>
                <h3 className="text-lg font-black text-gray-900">
                  {todayRate ? 'Actualizar Tipo de Cambio' : 'Registrar Tipo de Cambio'}
                </h3>
              </div>
              <button 
                onClick={() => setIsRateModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content / Form */}
            <form onSubmit={handleSaveTodayRate} className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-gray-100 flex items-center gap-3">
                <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Fecha de Registro</span>
                  <strong className="text-xs text-gray-800">
                    {format(new Date(), "dd 'de' MMMM, yyyy", { locale: es })} ({todayStr})
                  </strong>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wider mb-2">
                    Tasa de cambio (MXN/USD)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <DollarSign className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      step="0.0001"
                      min="0.01"
                      placeholder="Ej: 17.5023"
                      value={rateInput}
                      onChange={(e) => setRateInput(e.target.value)}
                      required
                      disabled={submittingRate}
                      className="w-full text-sm font-bold pl-9 pr-4 py-3.5 bg-[#F8FAFC] border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono text-gray-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-wider mb-2">
                    Cargo Tarjeta (%)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <CreditCard className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      placeholder="Ej: 4.5"
                      value={cardFeeInput}
                      onChange={(e) => setCardFeeInput(e.target.value)}
                      required
                      disabled={submittingRate}
                      className="w-full text-sm font-bold pl-9 pr-4 py-3.5 bg-[#F8FAFC] border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono text-gray-900"
                    />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Ingrese la tasa USD/MXN y el porcentaje de recargo por tarjeta. Estos valores se utilizar?n en las cotizaciones y transacciones del d?a.
              </p>

              {rateError && (
                <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-100 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{rateError}</span>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-4 border-t border-gray-50 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsRateModalOpen(false)}
                  disabled={submittingRate}
                  className="px-5 py-3 text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingRate || !rateInput}
                  className="px-5 py-3 text-xs font-black uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg shadow-blue-500/15 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {submittingRate ? 'Guardando...' : 'Guardar Tasa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
