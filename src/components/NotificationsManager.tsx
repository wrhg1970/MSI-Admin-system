import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, orderBy, doc, setDoc, updateDoc, getDoc, addDoc, serverTimestamp, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Client, UserProfile, CustomRole } from '../types';
import { 
  Bell, 
  Gift, 
  Check, 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Mail, 
  Settings, 
  Clock, 
  Send, 
  FileText, 
  CheckSquare, 
  Square, 
  Users, 
  Save, 
  Search,
  CheckCircle2,
  AlertCircle,
  Shield,
  Server,
  RefreshCw,
  MailCheck,
  ShieldCheck,
  HelpCircle,
  SendHorizontal,
  ExternalLink,
  AlertTriangle,
  Radio
} from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

interface NotificationsManagerProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

interface MonthlyReportConfig {
  sales: boolean;
  incomeStatement: boolean;
  toCollect: boolean;
  toPay: boolean;
  pendingCommissions: boolean;
}

interface NotificationSettings {
  birthdayGreetingEnabled: boolean;
  birthdayTemplate: string;
  monthlyReports: MonthlyReportConfig;
  monthlyReportSubject: string;
  monthlyReportTemplate: string;
  superAdminRecipientsEnabled: boolean;
  directorRecipientsEnabled: boolean;
}

export default function NotificationsManager({ profile, rolePermissions }: NotificationsManagerProps) {
  const [activeTab, setActiveTab] = useState<'birthdays' | 'monthly_reports' | 'smtp_diagnostics'>('birthdays');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // SMTP Server Diagnostics State
  const [smtpStatus, setSmtpStatus] = useState<any>(null);
  const [loadingSmtpStatus, setLoadingSmtpStatus] = useState(false);
  const [smtpDirectEmail, setSmtpDirectEmail] = useState(profile?.email || 'ventas@misegurointernacional.com');
  const [sendingSmtpDirect, setSendingSmtpDirect] = useState(false);
  const [smtpDirectResult, setSmtpDirectResult] = useState<{ success: boolean; message: string; details?: any } | null>(null);

  const fetchSmtpStatus = async () => {
    setLoadingSmtpStatus(true);
    try {
      const res = await fetch('/api/smtp-status');
      const data = await res.json();
      setSmtpStatus(data);
    } catch (err: any) {
      setSmtpStatus({
        configured: false,
        verified: false,
        error: err.message || 'No se pudo conectar al endpoint de estado SMTP'
      });
    } finally {
      setLoadingSmtpStatus(false);
    }
  };

  useEffect(() => {
    fetchSmtpStatus();
  }, []);

  const handleSendDirectSmtpTest = async () => {
    if (!smtpDirectEmail || !smtpDirectEmail.includes('@')) {
      setSmtpDirectResult({
        success: false,
        message: 'Por favor ingrese un correo electrónico válido.'
      });
      return;
    }

    setSendingSmtpDirect(true);
    setSmtpDirectResult(null);

    try {
      const res = await fetch('/api/smtp-test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: smtpDirectEmail.trim() })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSmtpDirectResult({
          success: true,
          message: `¡Correo de prueba enviado con éxito a ${smtpDirectEmail.trim()}! El servidor SMTP respondió: ${data.response || '250 OK'}. (ID: ${data.messageId || 'N/A'})`
        });
        // Log to notification audit trail
        try {
          await addDoc(collection(db, 'notificationLogs'), {
            recipient: smtpDirectEmail.trim(),
            subject: '[DIAGNÓSTICO] Prueba de Envío de Correo MSI',
            status: 'success',
            errorMessage: null,
            createdAt: serverTimestamp(),
            triggerType: 'smtp_diagnostic',
            sentBy: profile?.email || 'Sistema-Admin'
          });
        } catch (e) {}
      } else {
        setSmtpDirectResult({
          success: false,
          message: data.error || 'Error al enviar el correo de prueba.',
          details: data.details
        });
      }
    } catch (err: any) {
      setSmtpDirectResult({
        success: false,
        message: 'Error de conexión con el servidor: ' + (err.message || 'Desconocido')
      });
    } finally {
      setSendingSmtpDirect(false);
    }
  };
  const [settings, setSettings] = useState<NotificationSettings>({
    birthdayGreetingEnabled: true,
    birthdayTemplate: '¡Hola {nombre}! 🎉 De parte de todo el equipo de Mi Seguro Internacional, te deseamos un muy feliz cumpleaños. Que pases un excelente día rodeado de tus seres queridos. 🎂✨',
    monthlyReports: {
      sales: true,
      incomeStatement: true,
      toCollect: true,
      toPay: true,
      pendingCommissions: true
    },
    monthlyReportSubject: 'Reportes Financieros y Estados de Cuenta - {mes} {anio}',
    monthlyReportTemplate: 'Estimado/a {nombre},\n\nPresentamos los estados de cuenta actualizados y reportes mensuales solicitados correspondientes a {mes} de {anio}.\n\nResumen de reportes consolidados:\n{reportes_seleccionados}\n\nEste reporte se genera de manera automática para fines de auditoría y conciliación de Super Administradores y directivos.\n\nAtentamente,\nMi Seguro Internacional',
    superAdminRecipientsEnabled: true,
    directorRecipientsEnabled: true
  });

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Notification Logs Audit Trail State
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [logsSearchTerm, setLogsSearchTerm] = useState('');
  const [logsFilterType, setLogsFilterType] = useState<'all' | 'monthly_report' | 'birthday'>('all');

  // Fetch settings & clients
  useEffect(() => {
    // Fetch Settings
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, 'settings', 'notifications');
        const docSnap = await getDoc(docRef);
        
        const defaultSettings = {
          birthdayGreetingEnabled: true,
          birthdayTemplate: '¡Hola {nombre}! 🎉 De parte de todo el equipo de Mi Seguro Internacional, te deseamos un muy feliz cumpleaños. Que pases un excelente día rodeado de tus seres queridos. 🎂✨',
          monthlyReports: {
            sales: true,
            incomeStatement: true,
            toCollect: true,
            toPay: true,
            pendingCommissions: true
          },
          monthlyReportSubject: 'Reportes Financieros y Estados de Cuenta - {mes} {anio}',
          monthlyReportTemplate: 'Estimado/a {nombre},\n\nPresentamos los estados de cuenta actualizados y reportes mensuales solicitados correspondientes a {mes} de {anio}.\n\nResumen de reportes consolidados:\n{reportes_seleccionados}\n\nEste reporte se genera de manera automática para fines de auditoría y conciliación de Super Administradores y directivos.\n\nAtentamente,\nMi Seguro Internacional',
          superAdminRecipientsEnabled: true,
          directorRecipientsEnabled: true
        };

        if (docSnap.exists()) {
          const data = docSnap.data();
          setSettings({
            birthdayGreetingEnabled: data.birthdayGreetingEnabled !== undefined ? data.birthdayGreetingEnabled : defaultSettings.birthdayGreetingEnabled,
            birthdayTemplate: data.birthdayTemplate || defaultSettings.birthdayTemplate,
            monthlyReports: {
              sales: data.monthlyReports?.sales !== undefined ? data.monthlyReports.sales : defaultSettings.monthlyReports.sales,
              incomeStatement: data.monthlyReports?.incomeStatement !== undefined ? data.monthlyReports.incomeStatement : defaultSettings.monthlyReports.incomeStatement,
              toCollect: data.monthlyReports?.toCollect !== undefined ? data.monthlyReports.toCollect : defaultSettings.monthlyReports.toCollect,
              toPay: data.monthlyReports?.toPay !== undefined ? data.monthlyReports.toPay : defaultSettings.monthlyReports.toPay,
              pendingCommissions: data.monthlyReports?.pendingCommissions !== undefined ? data.monthlyReports.pendingCommissions : defaultSettings.monthlyReports.pendingCommissions,
            },
            monthlyReportSubject: data.monthlyReportSubject || defaultSettings.monthlyReportSubject,
            monthlyReportTemplate: data.monthlyReportTemplate || defaultSettings.monthlyReportTemplate,
            superAdminRecipientsEnabled: data.superAdminRecipientsEnabled !== undefined ? data.superAdminRecipientsEnabled : defaultSettings.superAdminRecipientsEnabled,
            directorRecipientsEnabled: data.directorRecipientsEnabled !== undefined ? data.directorRecipientsEnabled : defaultSettings.directorRecipientsEnabled
          });
        } else {
          // Initialize defaults in Firestore
          await setDoc(docRef, defaultSettings);
          setSettings(defaultSettings);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'notificationSettings');
      }
    };

    fetchSettings();

    // Fetch Clients
    const unsubClients = onSnapshot(
      query(collection(db, 'clients'), orderBy('createdAt', 'desc')),
      (snap) => {
        const fetchedClients = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
        setClients(fetchedClients);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'clients for notifications');
        setLoading(false);
      }
    );

    return () => unsubClients();
  }, []);

  // Subscribe to Notification logs for Audit Trail
  useEffect(() => {
    const unsubLogs = onSnapshot(
      query(collection(db, 'notificationLogs'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => {
        const fetchedLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setLogs(fetchedLogs);
        setLoadingLogs(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'notificationLogs');
        setLoadingLogs(false);
      }
    );
    return () => unsubLogs();
  }, []);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSuccessMessage(null);
    try {
      await setDoc(doc(db, 'settings', 'notifications'), settings);
      setSuccessMessage('Configuración guardada correctamente.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (error) {
      console.error('Error saving notification settings:', error);
    } finally {
      setSavingSettings(false);
    }
  };

  const [sendingTest, setSendingTest] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState(profile?.email || 'ventas@misegurointernacional.com');
  const [testSuccess, setTestSuccess] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.email) {
      setTestEmailAddress(profile.email);
    }
  }, [profile]);

  const handleSendTestEmail = async () => {
    if (!testEmailAddress.trim()) {
      setTestError('Por favor ingrese un correo válido.');
      return;
    }
    setSendingTest(true);
    setTestSuccess(null);
    setTestError(null);

    let subject = '';
    let body = '';

    if (activeTab === 'birthdays') {
      subject = '¡Feliz Cumpleaños! - Mi Seguro Internacional';
      const mockClient = { firstName: 'Juan', type: 'Individual' } as Client;
      body = personalizeTemplate(settings.birthdayTemplate, mockClient);
    } else {
      subject = personalizeMonthlyTemplate(settings.monthlyReportSubject);
      body = personalizeMonthlyTemplate(settings.monthlyReportTemplate);
    }

    let fetchError: string | null = null;
    let isSuccess = false;

    try {
      const response = await fetch('/api/send-test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: [testEmailAddress.trim()],
          subject,
          body,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        isSuccess = true;
        if (data.simulated) {
          setTestSuccess(`Prueba completada: ${data.message}`);
        } else {
          setTestSuccess('¡Correo de prueba enviado con éxito! Verifique su bandeja de entrada.');
        }
      } else {
        fetchError = data.error || 'No se pudo enviar el correo de prueba.';
        if (data.details) {
          fetchError += ` (Detalles: ${data.details})`;
        }
        setTestError(fetchError);
      }
    } catch (error: any) {
      console.error('Error sending test notification email:', error);
      fetchError = error.message || 'No se pudo establecer conexión con el servidor.';
      setTestError('No se pudo establecer conexión con el servidor.');
    } finally {
      // Create audit log entry in firestore
      try {
        await addDoc(collection(db, 'notificationLogs'), {
          recipient: testEmailAddress.trim(),
          subject,
          status: isSuccess ? 'success' : 'failed',
          errorMessage: isSuccess ? null : fetchError,
          createdAt: serverTimestamp(),
          triggerType: activeTab === 'monthly_reports' ? 'monthly_report' : 'birthday',
          sentBy: profile?.email || 'Sistema-Admin'
        });
      } catch (logErr) {
        console.error('Error writing to notificationLogs collection:', logErr);
      }
      setSendingTest(false);
    }
  };

  // Toggle client individual birthday greeting preference
  const handleToggleClientGreeting = async (client: Client, currentStatus: boolean) => {
    try {
      // Toggle sendBirthdayGreeting status in Firestore (default is true if undefined)
      const sendGreeting = currentStatus === false ? false : true;
      await updateDoc(doc(db, 'clients', client.id), {
        sendBirthdayGreeting: !sendGreeting
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `client/${client.id}`);
    }
  };

  // Helper: Month & Day Parsing for Birthday Calendar Mapping
  // Handles 'YYYY-MM-DD' formatting from input types
  const getClientBirthdayInfo = (birthDateStr?: string) => {
    if (!birthDateStr) return null;
    try {
      const parts = birthDateStr.split('-');
      if (parts.length === 3) {
        // YYYY-MM-DD
        return {
          month: parseInt(parts[1], 10) - 1, // 0-indexed
          day: parseInt(parts[2], 10),
          year: parseInt(parts[0], 10)
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // Current Month/Year Navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // Helper: Format Dates professionally in Audit Logs
  const formatLogDate = (log: any) => {
    if (!log.createdAt) return 'Pendiente...';
    let date: Date;
    if (typeof log.createdAt.toDate === 'function') {
      date = log.createdAt.toDate();
    } else {
      date = new Date(log.createdAt);
    }
    try {
      return format(date, 'dd/MM/yyyy HH:mm:ss');
    } catch {
      return 'Fecha inválida';
    }
  };

  // Filter & Search Audit Logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Filter by type
      if (logsFilterType !== 'all' && log.triggerType !== logsFilterType) {
        return false;
      }
      // Filter by search term
      if (logsSearchTerm.trim()) {
        const term = logsSearchTerm.toLowerCase();
        const recipient = (log.recipient || '').toLowerCase();
        const subject = (log.subject || '').toLowerCase();
        const sentBy = (log.sentBy || '').toLowerCase();
        return recipient.includes(term) || subject.includes(term) || sentBy.includes(term);
      }
      return true;
    });
  }, [logs, logsFilterType, logsSearchTerm]);

  // Filter Clients celebrating birthday in current month (or by search term)
  const monthlyClientsBirthdays = useMemo(() => {
    const currentMonthIndex = currentDate.getMonth();
    return clients.filter(client => {
      // Must be physically or Individual client details
      if (!client.birthDate) return false;
      const bInfo = getClientBirthdayInfo(client.birthDate);
      if (!bInfo) return false;

      const nameMatched = searchTerm 
        ? `${client.firstName || ''} ${client.lastName || ''} ${client.commercialName || ''} ${client.legalName || ''}`
            .toLowerCase().includes(searchTerm.toLowerCase())
        : true;

      const monthMatched = bInfo.month === currentMonthIndex;
      return monthMatched && nameMatched;
    }).sort((a, b) => {
      const aDay = getClientBirthdayInfo(a.birthDate)?.day || 0;
      const bDay = getClientBirthdayInfo(b.birthDate)?.day || 0;
      return aDay - bDay;
    });
  }, [clients, currentDate, searchTerm]);

  // Calendar calculations (days of current grid month)
  const calendarInterval = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    // Grid alignment
    const startWeekDay = getDay(start); // 0 corresponds to Sunday
    const padDaysBeforeIndex = startWeekDay === 0 ? 6 : startWeekDay - 1; // Align Mon-Sun

    const days = eachDayOfInterval({ start, end });
    
    // Add prefix blank days for offset
    const result: (Date | null)[] = Array(padDaysBeforeIndex).fill(null);
    days.forEach(d => result.push(d));
    return result;
  }, [currentDate]);

  // Find clients whose birthday matches a specific day of the current calendar month
  const getClientsWithBirthdayOnDay = (dayNum: number) => {
    const monthIdx = currentDate.getMonth();
    return clients.filter(client => {
      if (!client.birthDate) return false;
      const bInfo = getClientBirthdayInfo(client.birthDate);
      return bInfo ? (bInfo.month === monthIdx && bInfo.day === dayNum) : false;
    });
  };

  // Human Birthday Display Text builder
  const personalizeTemplate = (template: string, client: Client) => {
    const name = client.type === 'Individual' 
      ? `${client.firstName || ''}` 
      : `${client.commercialName || client.legalName || ''}`;
    return template.replace(/{nombre}/g, name);
  };

  const personalizeMonthlyTemplate = (subjectOrTemplate: string) => {
    const selectedList: string[] = [];
    if (settings.monthlyReports.sales) selectedList.push('📊 Reporte de Ventas Mensuales');
    if (settings.monthlyReports.incomeStatement) selectedList.push('📈 Estado de Resultados (P&L)');
    if (settings.monthlyReports.toCollect) selectedList.push('💰 Seguros Por Cobrar (Estados de Cuenta)');
    if (settings.monthlyReports.toPay) selectedList.push('💸 Seguros por Pagar (Proveedores)');
    if (settings.monthlyReports.pendingCommissions) selectedList.push('🤝 Comisiones de Agentes por Liquidar');

    const reportsText = selectedList.length > 0 
      ? selectedList.map(r => ` - ${r}`).join('\n')
      : ' (Ningún reporte seleccionado)';

    const mesActual = format(new Date(), 'MMMM', { locale: es });
    const anioActual = format(new Date(), 'yyyy');

    return (subjectOrTemplate || '')
      .replace(/{nombre}/g, 'Super Administrador / Director')
      .replace(/{mes}/g, mesActual.charAt(0).toUpperCase() + mesActual.slice(1))
      .replace(/{anio}/g, anioActual)
      .replace(/{reportes_seleccionados}/g, reportsText);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <Bell className="w-8 h-8 text-amber-500 animate-pulse" />
            Notificaciones
          </h1>
          <p className="text-sm text-gray-500 font-medium mt-1">
            Administra los recordatorios automáticos de cumpleaños de clientes y los envíos de reportes mensuales.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white p-2 rounded-2xl border border-gray-100 shadow-sm inline-flex flex-wrap gap-1.5 w-full md:w-auto">
        <button
          onClick={() => setActiveTab('birthdays')}
          className={`flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-all cursor-pointer flex-1 md:flex-initial ${
            activeTab === 'birthdays'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Gift className="w-4 h-4" />
          Cumpleaños de Clientes
        </button>
        <button
          onClick={() => setActiveTab('monthly_reports')}
          className={`flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-all cursor-pointer flex-1 md:flex-initial ${
            activeTab === 'monthly_reports'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <FileText className="w-4 h-4" />
          Reportes Mensuales
        </button>
        <button
          onClick={() => setActiveTab('smtp_diagnostics')}
          className={`flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-all cursor-pointer flex-1 md:flex-initial ${
            activeTab === 'smtp_diagnostics'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Server className="w-4 h-4" />
          Diagnóstico y Servidor SMTP
        </button>
      </div>

      {/* Main Panel content */}
      {loading ? (
        <div className="bg-white p-12 rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-500 font-bold text-sm">Cargando registros...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {activeTab === 'birthdays' ? (
            <>
              {/* Left & Middle Area: Birthday Calendar View */}
              <div className="xl:col-span-2 space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                  {/* Calendar Header */}
                  <div className="flex items-center justify-between border-b border-gray-50 pb-4">
                    <div className="flex items-center gap-4">
                      <h3 className="text-lg font-black text-gray-900 tracking-tight uppercase">
                        {format(currentDate, 'MMMM yyyy', { locale: es })}
                      </h3>
                      <div className="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1 rounded-xl border border-gray-100">
                        <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                        <span className="text-[10px] text-gray-500 uppercase font-black tracking-wide">
                          {monthlyClientsBirthdays.length} Cumpleaños este mes
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={prevMonth}
                        className="p-2 hover:bg-gray-50 text-gray-500 hover:text-gray-900 border border-gray-100 rounded-xl transition-all cursor-pointer"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => setCurrentDate(new Date())}
                        className="px-3 py-1.5 hover:bg-gray-50 text-gray-600 font-bold text-xs border border-gray-100 rounded-xl transition-all cursor-pointer uppercase"
                      >
                        Hoy
                      </button>
                      <button 
                        onClick={nextMonth}
                        className="p-2 hover:bg-gray-50 text-gray-500 hover:text-gray-900 border border-gray-100 rounded-xl transition-all cursor-pointer"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-7 gap-1 text-center font-bold text-[10px] text-gray-400 uppercase tracking-widest py-1 border-b border-gray-50">
                    <div>Lun</div>
                    <div>Mar</div>
                    <div>Mié</div>
                    <div>Jue</div>
                    <div>Vie</div>
                    <div>Sáb</div>
                    <div>Dom</div>
                  </div>

                  <div className="grid grid-cols-7 gap-1.5">
                    {calendarInterval.map((day, idx) => {
                      if (!day) return <div key={`empty-${idx}`} className="bg-gray-50/20 rounded-2xl min-h-[90px] border border-transparent" />;
                      
                      const dayVal = day.getDate();
                      const hasBirthdays = getClientsWithBirthdayOnDay(dayVal);
                      const isToday = isSameDay(day, new Date());

                      return (
                        <div 
                          key={day.toISOString()} 
                          className={`min-h-[90px] p-2.5 rounded-2xl border transition-all flex flex-col justify-between overflow-hidden relative ${
                            isToday 
                              ? 'bg-blue-50/40 border-blue-200 shadow-sm' 
                              : hasBirthdays.length > 0
                                ? 'bg-amber-50/20 border-amber-100'
                                : 'bg-white border-gray-50 hover:border-gray-200'
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <span className={`text-xs font-black ${isToday ? 'text-blue-600 bg-blue-100/60 w-6 h-6 flex items-center justify-center rounded-full' : 'text-gray-400'}`}>
                              {dayVal}
                            </span>
                            {hasBirthdays.length > 0 && (
                              <Gift className="w-3.5 h-3.5 text-amber-500 animate-bounce" />
                            )}
                          </div>

                          <div className="mt-1 flex-1 flex flex-col gap-0.5 overflow-hidden">
                            {hasBirthdays.map(c => {
                              const name = c.type === 'Individual' ? `${c.firstName}` : `${c.commercialName || c.legalName}`;
                              const labelOptedIn = c.sendBirthdayGreeting !== false;
                              return (
                                <div 
                                  key={c.id} 
                                  title={`${c.firstName || ''} ${c.lastName || ''} (Mensaje ${labelOptedIn ? 'Habilitado' : 'Deshabilitado'})`}
                                  className={`text-[8px] font-bold px-1.5 py-0.5 rounded truncate ${
                                    labelOptedIn 
                                      ? 'bg-amber-100 text-amber-800 border border-amber-200/55' 
                                      : 'bg-gray-100 text-gray-500 line-through text-opacity-70'
                                  }`}
                                >
                                  🎂 {name}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Search & Bulk view */}
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="text-base font-black text-gray-900 tracking-tight uppercase">Búsqueda de Cumpleañeros</h4>
                      <p className="text-xs text-gray-400 font-medium">Filtra y decide a quién enviar felicitaciones este mes en base a su perfil.</p>
                    </div>
                    <div className="relative max-w-xs w-full">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Buscar cliente..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-medium"
                      />
                    </div>
                  </div>

                  <div className="border border-gray-100 rounded-2xl overflow-hidden bg-gray-50/10">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50/50">
                          <th className="px-6 py-4">Cliente</th>
                          <th className="px-6 py-4">F. Nacimiento</th>
                          <th className="px-6 py-4">Día de Festejo</th>
                          <th className="px-6 py-4 text-center">Enviar Felicitación</th>
                          <th className="px-6 py-4 text-right">Contacto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyClientsBirthdays.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-gray-400 font-medium text-xs">
                              {searchTerm ? 'No se encontraron clientes para tu búsqueda.' : 'No hay cumpleaños registrados para este mes.'}
                            </td>
                          </tr>
                        ) : (
                          monthlyClientsBirthdays.map((client) => {
                            const bInfo = getClientBirthdayInfo(client.birthDate);
                            const labelOptedIn = client.sendBirthdayGreeting !== false;
                            
                            return (
                              <tr key={client.id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-all">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-xs border border-orange-100">
                                      {client.type === 'Individual' ? `${client.firstName?.charAt(0) || ''}` : `${client.commercialName?.charAt(0) || client.legalName?.charAt(0) || ''}`}
                                    </div>
                                    <div>
                                      <p className="text-xs font-bold text-gray-900">
                                        {client.type === 'Individual' ? `${client.firstName} ${client.lastName}` : client.commercialName || client.legalName}
                                      </p>
                                      <p className="text-[10px] text-gray-400 font-medium uppercase">{client.type}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-xs font-mono text-gray-500">
                                  {client.birthDate}
                                </td>
                                <td className="px-6 py-4 text-xs font-black text-gray-900">
                                  {bInfo ? `${bInfo.day} de ${format(currentDate, 'MMMM', { locale: es })}` : 'N/A'}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center justify-center">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleClientGreeting(client, labelOptedIn)}
                                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer ${
                                        labelOptedIn ? 'bg-green-500' : 'bg-gray-200'
                                      }`}
                                    >
                                      <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                          labelOptedIn ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <span className="text-xs font-bold text-gray-500 truncate block max-w-[150px] ml-auto">
                                    {client.email || 'Sin correo'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right Sidebar Area: Birthday Greeting Settings */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight uppercase flex items-center gap-2">
                      <Settings className="w-5 h-5 text-gray-400" />
                      Configuración de Mensajería
                    </h3>
                    <p className="text-xs text-gray-400 font-medium mt-1">Defina el comportamiento y la plantilla de felicitación.</p>
                  </div>

                  {/* Toggle Overall */}
                  <div className="flex items-center justify-between p-4 bg-amber-50/20 border border-amber-100 rounded-2xl">
                    <div className="flex gap-3">
                      <Clock className="w-5 h-5 text-amber-500 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-gray-900">Automatización Activa</p>
                        <p className="text-[10px] text-gray-400 font-medium">Enviar felicitación en la mañana del cumpleaños.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSettings(prev => ({ ...prev, birthdayGreetingEnabled: !prev.birthdayGreetingEnabled }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 cursor-pointer ${
                        settings.birthdayGreetingEnabled ? 'bg-amber-500' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings.birthdayGreetingEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Template Customizer */}
                  <div className="space-y-2">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-wider">Plantilla del Mensaje</label>
                    <textarea
                      rows={6}
                      value={settings.birthdayTemplate}
                      onChange={(e) => setSettings(prev => ({ ...prev, birthdayTemplate: e.target.value }))}
                      className="w-full p-4 border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded-2xl outline-none text-xs font-medium leading-relaxed bg-gray-50/10"
                      placeholder="Escribe el mensaje de cumpleaños..."
                    />
                    <div className="text-[10px] text-gray-400 font-medium flex gap-1.5 flex-wrap">
                      <span>Etiquetas disponibles:</span>
                      <code className="bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded font-bold cursor-pointer transition-colors" title="Inserta el nombre del cliente">{'{nombre}'}</code>
                    </div>
                  </div>

                  {/* Preview Banner */}
                  <div className="border border-slate-100 bg-slate-50/40 p-4 rounded-2xl space-y-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Vista Previa de Correo</span>
                    <div className="bg-white p-3.5 rounded-xl border border-slate-100 text-xs text-gray-700 leading-relaxed font-medium">
                      {personalizeTemplate(settings.birthdayTemplate, { firstName: 'Juan', type: 'Individual' } as Client)}
                    </div>
                  </div>

                  {/* Save Settings */}
                  <div className="pt-2 border-t border-gray-50 flex items-center justify-end gap-3">
                    {successMessage && (
                      <span className="text-xs font-bold text-green-600 flex items-center gap-1 animate-fadeIn">
                        <CheckCircle2 className="w-4 h-4" />
                        {successMessage}
                      </span>
                    )}
                    <button
                      onClick={handleSaveSettings}
                      disabled={savingSettings}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-5 rounded-2xl text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-md disabled:bg-gray-300"
                    >
                      <Save className="w-4 h-4" />
                      {savingSettings ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                  </div>
                </div>

                {/* Test Send Card */}
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fadeIn">
                  <div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight uppercase flex items-center gap-2">
                      <Send className="w-5 h-5 text-amber-500 shrink-0" />
                      Prueba de Notificación
                    </h3>
                    <p className="text-xs text-gray-400 font-semibold mt-1">
                      Envíe un correo de prueba de felicitación para validar la plantilla y la recepción actual.
                    </p>
                  </div>

                  <div className="space-y-3.5">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Correo Destinatario</label>
                      <input
                        type="email"
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded-xl outline-none text-xs font-semibold bg-gray-50/10 placeholder-gray-400"
                        placeholder="admin@correo.com"
                      />
                    </div>

                    {testSuccess && (
                      <div className="p-3.5 bg-green-50 border border-green-100 text-green-800 text-xs rounded-xl font-bold flex items-start gap-2.5 animate-fadeIn leading-relaxed">
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                        <span>{testSuccess}</span>
                      </div>
                    )}

                    {testError && (
                      <div className="p-3.5 bg-red-50 border border-red-100 text-red-800 text-xs rounded-xl font-medium flex items-start gap-2.5 animate-fadeIn leading-relaxed">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <span>{testError}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleSendTestEmail}
                      disabled={sendingTest}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-5 rounded-2xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:bg-gray-300"
                    >
                      {sendingTest ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                          <span>Enviando...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 text-slate-400" />
                          <span>Enviar Correo de Prueba</span>
                        </>
                      )}
                    </button>
                    
                    <p className="text-[10px] text-gray-400 font-semibold text-center mt-1 leading-relaxed">
                      Se generarán de forma dinámica variables de prueba ficticias para el titular reemplazando {'{nombre}'} por Juan (cliente).
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : activeTab === 'monthly_reports' ? (
            <>
              {/* Tabs: Monthly report configuration panel */}
              <div className="xl:col-span-2 space-y-6 animate-fadeIn">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-lg font-black text-gray-900 tracking-tight uppercase flex items-center gap-2.5">
                      <FileText className="w-5 h-5 text-blue-600" />
                      Distribución de Informes Configurados
                    </h3>
                    <p className="text-sm text-gray-500 font-medium mt-1">
                      Selecciona cuáles reportes se enviarán de forma automatizada al inicio de cada mes.
                    </p>
                  </div>

                  {/* Distribution list */}
                  <div className="space-y-3.5">
                    {/* Ventas Mensuales */}
                    <div className="flex items-start justify-between p-4 bg-white hover:bg-gray-50/20 border border-gray-100 rounded-2.5xl transition-all">
                      <div className="flex gap-3.5">
                        <div className="w-10 h-10 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                          <Send className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-900 uppercase tracking-widest">Ventas Mensuales</p>
                          <p className="text-[11px] text-gray-500 font-medium mt-0.5 leading-relaxed">
                            Resumen detallado de nuevas emisiones de pólizas cursadas en el último período mensual.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          monthlyReports: { ...prev.monthlyReports, sales: !prev.monthlyReports.sales }
                        }))}
                        className={`text-blue-600 hover:text-blue-700 transition-colors p-2 cursor-pointer`}
                      >
                        {settings.monthlyReports.sales ? (
                          <CheckSquare className="w-6 h-6 shrink-0 text-blue-600" />
                        ) : (
                          <Square className="w-6 h-6 shrink-0 text-gray-300" />
                        )}
                      </button>
                    </div>

                    {/* Estado de Resultados */}
                    <div className="flex items-start justify-between p-4 bg-white hover:bg-gray-50/20 border border-gray-100 rounded-2.5xl transition-all">
                      <div className="flex gap-3.5">
                        <div className="w-10 h-10 bg-blue-50 text-blue-600 border border-blue-100 rounded-xl flex items-center justify-center shrink-0">
                          <Send className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-900 uppercase tracking-widest">Estado de Resultados (P&L)</p>
                          <p className="text-[11px] text-gray-500 font-medium mt-0.5 leading-relaxed">
                            Comparativa financiera entre primas cobradas, comisiones vigentes, siniestros e ingresos devengados.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          monthlyReports: { ...prev.monthlyReports, incomeStatement: !prev.monthlyReports.incomeStatement }
                        }))}
                        className={`text-blue-600 hover:text-blue-700 transition-colors p-2 cursor-pointer`}
                      >
                        {settings.monthlyReports.incomeStatement ? (
                          <CheckSquare className="w-6 h-6 shrink-0 text-blue-600" />
                        ) : (
                          <Square className="w-6 h-6 shrink-0 text-gray-300" />
                        )}
                      </button>
                    </div>

                    {/* Seguros por Cobrar */}
                    <div className="flex items-start justify-between p-4 bg-white hover:bg-gray-50/20 border border-gray-100 rounded-2.5xl transition-all">
                      <div className="flex gap-3.5">
                        <div className="w-10 h-10 bg-amber-50 text-amber-600 border border-amber-100 rounded-xl flex items-center justify-center shrink-0">
                          <Send className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-900 uppercase tracking-widest">Seguros Por Cobrar</p>
                          <p className="text-[11px] text-gray-500 font-medium mt-0.5 leading-relaxed">
                            Relación de saldos y cobros pendientes por parte de asegurados y carteras asociadas.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          monthlyReports: { ...prev.monthlyReports, toCollect: !prev.monthlyReports.toCollect }
                        }))}
                        className={`text-blue-600 hover:text-blue-700 transition-colors p-2 cursor-pointer`}
                      >
                        {settings.monthlyReports.toCollect ? (
                          <CheckSquare className="w-6 h-6 shrink-0 text-blue-600" />
                        ) : (
                          <Square className="w-6 h-6 shrink-0 text-gray-300" />
                        )}
                      </button>
                    </div>

                    {/* Seguros por Pagar */}
                    <div className="flex items-start justify-between p-4 bg-white hover:bg-gray-50/20 border border-gray-100 rounded-2.5xl transition-all">
                      <div className="flex gap-3.5">
                        <div className="w-10 h-10 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl flex items-center justify-center shrink-0">
                          <Send className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-900 uppercase tracking-widest">Seguros por Pagar</p>
                          <p className="text-[11px] text-gray-500 font-medium mt-0.5 leading-relaxed">
                            Cargos y cuentas pendientes por liquidar con proveedores de seguros internacionales y reaseguros.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          monthlyReports: { ...prev.monthlyReports, toPay: !prev.monthlyReports.toPay }
                        }))}
                        className={`text-blue-600 hover:text-blue-700 transition-colors p-2 cursor-pointer`}
                      >
                        {settings.monthlyReports.toPay ? (
                          <CheckSquare className="w-6 h-6 shrink-0 text-blue-600" />
                        ) : (
                          <Square className="w-6 h-6 shrink-0 text-gray-300" />
                        )}
                      </button>
                    </div>

                    {/* Comisiones Pendientes */}
                    <div className="flex items-start justify-between p-4 bg-white hover:bg-gray-50/20 border border-gray-100 rounded-2.5xl transition-all">
                      <div className="flex gap-3.5">
                        <div className="w-10 h-10 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                          <Send className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-900 uppercase tracking-widest">Comisiones Pendientes</p>
                          <p className="text-[11px] text-gray-500 font-medium mt-0.5 leading-relaxed">
                            Conciliación de comisiones acumuladas por pagar a agentes de MSI.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          monthlyReports: { ...prev.monthlyReports, pendingCommissions: !prev.monthlyReports.pendingCommissions }
                        }))}
                        className={`text-blue-600 hover:text-blue-700 transition-colors p-2 cursor-pointer`}
                      >
                        {settings.monthlyReports.pendingCommissions ? (
                          <CheckSquare className="w-6 h-6 shrink-0 text-blue-600" />
                        ) : (
                          <Square className="w-6 h-6 shrink-0 text-gray-300" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Email Template customatization box */}
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight uppercase flex items-center gap-2.5">
                      <Mail className="w-5 h-5 text-blue-605" />
                      Plantilla de Correo Electrónico
                    </h3>
                    <p className="text-xs text-gray-400 font-semibold mt-1">
                      Configure el asunto y cuerpo del correo que contendrá los reportes y estados de cuenta mensuales.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Subject field */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Asunto del Correo</label>
                      <input
                        type="text"
                        value={settings.monthlyReportSubject}
                        onChange={(e) => setSettings(prev => ({ ...prev, monthlyReportSubject: e.target.value }))}
                        className="w-full p-4 border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded-2xl outline-none text-xs font-semibold bg-gray-50/10 placeholder-gray-400"
                        placeholder="Escriba el asunto del correo..."
                      />
                    </div>

                    {/* Body Template Editor */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Cuerpo de la Plantilla</label>
                      <textarea
                        rows={7}
                        value={settings.monthlyReportTemplate}
                        onChange={(e) => setSettings(prev => ({ ...prev, monthlyReportTemplate: e.target.value }))}
                        className="w-full p-4 border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded-2xl outline-none text-xs font-semibold leading-relaxed bg-gray-50/10 placeholder-gray-400"
                        placeholder="Escriba el cuerpo del correo de reportes..."
                      />
                      <div className="text-[10px] text-gray-400 font-medium flex gap-1.5 flex-wrap">
                        <span>Etiquetas de reemplazo:</span>
                        <code className="bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-colors" title="Nombre del destinatario">{'{nombre}'}</code>
                        <code className="bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-colors" title="Mes en curso">{'{mes}'}</code>
                        <code className="bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-colors" title="Año en curso">{'{anio}'}</code>
                        <code className="bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer transition-colors" title="Listado de reportes activos">{'{reportes_seleccionados}'}</code>
                      </div>
                    </div>

                    {/* Interactive Live Preview */}
                    <div className="border border-indigo-100 bg-indigo-50/15 p-5 rounded-2xl space-y-3 shadow-inner">
                      <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider block flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                        Vista Previa de Correo Enviado
                      </span>
                      <div className="bg-white p-4.5 rounded-xl border border-indigo-100/50 text-xs space-y-3">
                        <div className="border-b border-gray-100 pb-2">
                          <p className="text-[10px] font-bold text-gray-400">Asunto:</p>
                          <p className="font-extrabold text-gray-800 text-xs translate-y-0.5">
                            {personalizeMonthlyTemplate(settings.monthlyReportSubject)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Cuerpo:</p>
                          <pre className="text-xs text-gray-750 font-sans whitespace-pre-wrap leading-relaxed font-semibold">
                            {personalizeMonthlyTemplate(settings.monthlyReportTemplate)}
                          </pre>
                        </div>
                        <div className="pt-2 border-t border-gray-50 flex items-center gap-1.5 text-[9px] text-gray-400 font-bold">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          <span>Adjuntos y estados de cuenta incluidos de manera dinámica</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Monthly report details description */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
                  <div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight uppercase flex items-center gap-2">
                      <Users className="w-5 h-5 text-gray-400" />
                      Destinatarios de Informes
                    </h3>
                    <p className="text-xs text-gray-400 font-semibold mt-1">Configure quiénes recibirán los reportes automáticos.</p>
                  </div>

                  <div className="space-y-4">
                    <p className="text-xs text-gray-500 leading-relaxed font-medium">
                      Los reportes y estados de cuenta seleccionados se enviarán de forma automatizada por correo electrónico a los siguientes roles habilitados:
                    </p>

                    {/* Super_Admin Toggle */}
                    <div className="flex items-center justify-between p-3.5 bg-red-50/35 border border-red-100 text-red-900 rounded-2xl">
                      <div className="flex gap-2.5 items-center">
                        <Shield className="w-5 h-5 text-red-600 shrink-0" />
                        <div>
                          <p className="text-xs font-black uppercase tracking-wider">Super Administradores</p>
                          <p className="text-[9px] text-red-700/85 font-medium -mt-0.5">Reciben estados de cuenta actualizados</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, superAdminRecipientsEnabled: !prev.superAdminRecipientsEnabled }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 cursor-pointer ${
                          settings.superAdminRecipientsEnabled ? 'bg-red-600' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.superAdminRecipientsEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Director Toggle */}
                    <div className="flex items-center justify-between p-3.5 bg-purple-50/35 border border-purple-100 text-purple-900 rounded-2xl">
                      <div className="flex gap-2.5 items-center">
                        <Users className="w-5 h-5 text-purple-600 shrink-0" />
                        <div>
                          <p className="text-xs font-black uppercase tracking-wider">Directores</p>
                          <p className="text-[9px] text-purple-750/85 font-medium -mt-0.5">Reciben estados consolidados directivos</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, directorRecipientsEnabled: !prev.directorRecipientsEnabled }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 cursor-pointer ${
                          settings.directorRecipientsEnabled ? 'bg-purple-600' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.directorRecipientsEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="border border-dashed border-gray-100 bg-gray-50/30 p-4 rounded-xl flex gap-2.5 items-start">
                      <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 animate-bounce" />
                      <div>
                        <span className="text-[10px] uppercase font-black tracking-wider text-blue-700 block">Periodicidad</span>
                        <span className="text-xs text-blue-900 font-medium">Cron programado a las 00:00 (UTC-6) de cada primero mensual.</span>
                      </div>
                    </div>
                  </div>

                  {/* Save config */}
                  <div className="pt-4 border-t border-gray-50 flex items-center justify-end gap-3">
                    {successMessage && (
                      <span className="text-xs font-bold text-green-600 flex items-center gap-1 animate-fadeIn">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        {successMessage}
                      </span>
                    )}
                    <button
                      onClick={handleSaveSettings}
                      disabled={savingSettings}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-5 rounded-2xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:bg-gray-300"
                    >
                      <Save className="w-4 h-4" />
                      {savingSettings ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                  </div>
                </div>

                {/* Test Send Card */}
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5 animate-fadeIn">
                  <div>
                    <h3 className="text-base font-black text-gray-900 tracking-tight uppercase flex items-center gap-2">
                      <Send className="w-5 h-5 text-amber-500 shrink-0" />
                      Prueba de Notificación
                    </h3>
                    <p className="text-xs text-gray-400 font-semibold mt-1">
                      Envíe un correo de prueba de reportes para validar la plantilla y la recepción actual.
                    </p>
                  </div>

                  <div className="space-y-3.5">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Correo Destinatario</label>
                      <input
                        type="email"
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded-xl outline-none text-xs font-semibold bg-gray-50/10 placeholder-gray-400"
                        placeholder="admin@correo.com"
                      />
                    </div>

                    {testSuccess && (
                      <div className="p-3.5 bg-green-50 border border-green-100 text-green-800 text-xs rounded-xl font-bold flex items-start gap-2.5 animate-fadeIn leading-relaxed">
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                        <span>{testSuccess}</span>
                      </div>
                    )}

                    {testError && (
                      <div className="p-3.5 bg-red-50 border border-red-100 text-red-800 text-xs rounded-xl font-medium flex items-start gap-2.5 animate-fadeIn leading-relaxed">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <span>{testError}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleSendTestEmail}
                      disabled={sendingTest}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-5 rounded-2xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:bg-gray-300"
                    >
                      {sendingTest ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                          <span>Enviando...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 text-slate-400" />
                          <span>Enviar Correo de Prueba</span>
                        </>
                      )}
                    </button>
                    
                    <p className="text-[10px] text-gray-400 font-semibold text-center mt-1 leading-relaxed">
                      Se generarán de forma dinámica variables de prueba ficticias reemplazando {'{nombre}'}, {'{mes}'}, {'{anio}'} y {'{reportes_seleccionados}'}.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Tab: SMTP Server Diagnostics & Live Testing */}
              <div className="xl:col-span-3 space-y-6 animate-fadeIn">
                {/* Status Hero Card */}
                <div className="bg-white p-6 md:p-8 rounded-3xl border border-gray-100 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-100">
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                        smtpStatus?.verified 
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                          : smtpStatus?.configured 
                            ? 'bg-red-50 text-red-600 border border-red-100'
                            : 'bg-amber-50 text-amber-600 border border-amber-100'
                      }`}>
                        <Server className="w-7 h-7" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-xl font-black text-gray-900 tracking-tight">Estado del Servidor de Correo (SMTP)</h2>
                          {smtpStatus?.verified ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-full">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Conectado y Verificado
                            </span>
                          ) : smtpStatus?.configured ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-700 border border-red-200 text-xs font-bold rounded-full">
                              <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                              Error de Autenticación / Conexión
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold rounded-full">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              No Configurado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 font-medium mt-1">
                          Monitorea la conexión en vivo con el servidor de correo electrónico para el despacho de pólizas y notificaciones.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={fetchSmtpStatus}
                      disabled={loadingSmtpStatus}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingSmtpStatus ? 'animate-spin text-blue-600' : ''}`} />
                      {loadingSmtpStatus ? 'Verificando...' : 'Re-comprobar Conexión'}
                    </button>
                  </div>

                  {/* Diagnostic Details Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                    <div className="p-4 bg-gray-50/70 border border-gray-100 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-1">Servidor Host</span>
                      <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-blue-500" />
                        {smtpStatus?.host || 'smtp.gmail.com'}
                      </span>
                    </div>

                    <div className="p-4 bg-gray-50/70 border border-gray-100 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-1">Puerto & Cifrado</span>
                      <span className="text-xs font-bold text-gray-800">
                        Puerto {smtpStatus?.port || 587} {smtpStatus?.secure ? '(SSL/TLS)' : '(STARTTLS)'}
                      </span>
                    </div>

                    <div className="p-4 bg-gray-50/70 border border-gray-100 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-1">Usuario Autenticado</span>
                      <span className="text-xs font-bold text-gray-800 truncate block" title={smtpStatus?.user || 'No configurado'}>
                        {smtpStatus?.user || 'ventas@misegurointernacional.com'}
                      </span>
                    </div>

                    <div className="p-4 bg-gray-50/70 border border-gray-100 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-1">Remitente Oficial (From)</span>
                      <span className="text-xs font-bold text-gray-800 truncate block" title={smtpStatus?.from || 'No configurado'}>
                        {smtpStatus?.from || 'no-reply@misegurointernacional.com'}
                      </span>
                    </div>
                  </div>

                  {smtpStatus?.message && (
                    <div className={`mt-6 p-4 rounded-2xl border text-xs font-medium flex items-start gap-3 ${
                      smtpStatus.verified 
                        ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900' 
                        : 'bg-red-50/60 border-red-200 text-red-900'
                    }`}>
                      {smtpStatus.verified ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="font-bold">{smtpStatus.message}</p>
                        {smtpStatus.advice && <p className="mt-1 text-[11px] opacity-90">{smtpStatus.advice}</p>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Diagnostic Sender & Troubleshooting Cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Card 1: Live Interactive Test */}
                  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                    <div className="flex items-center gap-3 border-b border-gray-50 pb-4">
                      <div className="w-10 h-10 bg-blue-50 text-blue-600 border border-blue-100 rounded-xl flex items-center justify-center shrink-0">
                        <SendHorizontal className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">Prueba de Envío en Tiempo Real</h3>
                        <p className="text-[11px] text-gray-500 font-medium">Envía un correo de verificación en vivo para comprobar la entrega inmediata.</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-[11px] font-bold text-gray-700 block mb-1">
                          Dirección de Correo Destinatario para la Prueba:
                        </label>
                        <input
                          type="email"
                          value={smtpDirectEmail}
                          onChange={(e) => setSmtpDirectEmail(e.target.value)}
                          placeholder="ejemplo@gmail.com o correo de prueba"
                          className="w-full px-4 py-2.5 border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded-xl outline-none text-xs font-semibold bg-gray-50/10 placeholder-gray-400"
                        />
                      </div>

                      {smtpDirectResult && (
                        <div className={`p-4 rounded-xl border text-xs leading-relaxed animate-fadeIn ${
                          smtpDirectResult.success 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                            : 'bg-red-50 border-red-200 text-red-800'
                        }`}>
                          <div className="flex items-start gap-2">
                            {smtpDirectResult.success ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <p className="font-bold">{smtpDirectResult.message}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleSendDirectSmtpTest}
                        disabled={sendingSmtpDirect}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-5 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:bg-gray-300"
                      >
                        {sendingSmtpDirect ? (
                          <>
                            <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                            <span>Verificando y Enviando por SMTP...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            <span>Enviar Correo de Diagnóstico Ahora</span>
                          </>
                        )}
                      </button>

                      <p className="text-[10px] text-gray-400 font-semibold text-center leading-relaxed">
                        Esta prueba realiza una conexión socket directa con el servidor SMTP y registra la confirmación de recepción (Código 250).
                      </p>
                    </div>
                  </div>

                  {/* Card 2: Why clients might not see emails & Solutions */}
                  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                    <div className="flex items-center gap-3 border-b border-gray-50 pb-4">
                      <div className="w-10 h-10 bg-amber-50 text-amber-600 border border-amber-100 rounded-xl flex items-center justify-center shrink-0">
                        <HelpCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">¿Por qué algunos clientes no reciben sus correos?</h3>
                        <p className="text-[11px] text-gray-500 font-medium">Causas frecuentes de recepción y soluciones recomendadas.</p>
                      </div>
                    </div>

                    <div className="space-y-3.5 text-xs text-gray-600">
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 bg-amber-100 text-amber-800 font-black text-[10px] rounded-full flex items-center justify-center shrink-0 mt-0.5">1</span>
                        <div>
                          <strong className="text-gray-900 block">Carpeta de Spam / Correo No Deseado / Promociones</strong>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            Los proveedores como Hotmail, Outlook o dominios empresariales a menudo filtran correos con adjuntos PDF. Indique al cliente buscar "Mi Seguro Internacional" en su bandeja de <strong>Spam</strong> o <strong>No Deseados</strong> y marcarlo como <em>"No es spam"</em>.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 bg-blue-100 text-blue-800 font-black text-[10px] rounded-full flex items-center justify-center shrink-0 mt-0.5">2</span>
                        <div>
                          <strong className="text-gray-900 block">Registro SPF en DNS del Dominio</strong>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            Verifique que el dominio <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px]">misegurointernacional.com</code> tenga configurado en su DNS el registro TXT de SPF: <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px]">v=spf1 include:_spf.google.com ~all</code> para evitar rechazos en buzones corporativos.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 bg-emerald-100 text-emerald-800 font-black text-[10px] rounded-full flex items-center justify-center shrink-0 mt-0.5">3</span>
                        <div>
                          <strong className="text-gray-900 block">Limpieza Automática de Correos y Caracteres</strong>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            El sistema ahora sanitiza y elimina espacios en blanco o comas accidentales en las direcciones de los clientes antes de enviarlas al servidor.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 bg-indigo-100 text-indigo-800 font-black text-[10px] rounded-full flex items-center justify-center shrink-0 mt-0.5">4</span>
                        <div>
                          <strong className="text-gray-900 block">Descarga y Envío Directo por WhatsApp</strong>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            En el panel de pólizas puede descargar el certificado o copiar la liga web de la póliza para compartirla de inmediato al viajero por WhatsApp.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Audit Log / Historial de Auditoría de Notificaciones */}
        <div className="mt-8 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6 animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-50 pb-5">
            <div>
              <h3 className="text-lg font-black text-gray-900 tracking-tight uppercase flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                Historial de Auditoría de Notificaciones
              </h3>
              <p className="text-xs text-gray-400 font-semibold mt-1">
                Registro histórico en tiempo real y estado de entrega de reportes mensuales y avisos para auditoría de Super Administradores.
              </p>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Type filter */}
              <div className="inline-flex rounded-xl border border-gray-100 p-1 bg-gray-50/50">
                <button
                  onClick={() => setLogsFilterType('all')}
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer transition-all ${
                    logsFilterType === 'all'
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setLogsFilterType('monthly_report')}
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer transition-all ${
                    logsFilterType === 'monthly_report'
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                      : 'text-gray-500 hover:text-gray-950'
                  }`}
                >
                  Reportes Mensuales
                </button>
                <button
                  onClick={() => setLogsFilterType('birthday')}
                  className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer transition-all ${
                    logsFilterType === 'birthday'
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                      : 'text-gray-500 hover:text-gray-950'
                  }`}
                >
                  Cumpleaños
                </button>
              </div>

              {/* Search input inside logs block */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar destinatario..."
                  value={logsSearchTerm}
                  onChange={(e) => setLogsSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded-xl outline-none text-xs font-semibold bg-gray-50/10 placeholder-gray-400 w-full sm:w-60"
                />
              </div>
            </div>
          </div>

          {/* Logs List/Table */}
          {loadingLogs ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
              <p className="text-xs text-gray-400 font-bold">Cargando registros de auditoría...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-gray-105 rounded-2xl bg-gray-50/10">
              <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2.5 animate-pulse" />
              <p className="text-xs text-gray-500 font-bold">No hay registros de auditoría en este momento.</p>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">La ejecución de envíos creará registros inmediatos aquí.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm bg-white">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4">Fecha de Envío</th>
                    <th className="px-6 py-4">Tipo</th>
                    <th className="px-6 py-4">Destinatario</th>
                    <th className="px-6 py-4">Asunto</th>
                    <th className="px-6 py-4">Estado</th>
                    <th className="px-6 py-4">Enviado Por</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-all text-xs">
                      <td className="px-6 py-4 text-gray-500 font-bold whitespace-nowrap">
                        {formatLogDate(log)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {log.triggerType === 'monthly_report' ? (
                          <span className="bg-blue-50 text-blue-600 border border-blue-100 px-2.5 py-1 text-[10px] rounded-xl font-bold uppercase tracking-wide">
                            Reporte Mensual
                          </span>
                        ) : (
                          <span className="bg-orange-50 text-orange-600 border border-orange-100 px-2.5 py-1 text-[10px] rounded-xl font-bold uppercase tracking-wide">
                            Cumpleaños
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-800 font-black whitespace-nowrap">
                        {log.recipient}
                      </td>
                      <td className="px-6 py-4 text-gray-600 font-medium max-w-xs truncate">
                        {log.subject}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {log.status === 'success' ? (
                          <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-2.5 py-1 text-[10px] rounded-xl font-bold uppercase tracking-wide flex items-center gap-1 w-fit">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                            Entregado
                          </span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="bg-red-50 text-red-600 border border-red-100 px-2.5 py-1 text-[10px] rounded-xl font-bold uppercase tracking-wide flex items-center gap-1 w-fit">
                              <AlertCircle className="w-3 h-3 text-red-550 shrink-0" />
                              Error
                            </span>
                            {log.errorMessage && (
                              <span className="text-[9px] text-red-500 font-bold mt-0.5 block max-w-[170px] truncate" title={log.errorMessage}>
                                {log.errorMessage}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-medium whitespace-nowrap">
                        {log.sentBy || 'Sistema'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
