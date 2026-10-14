import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, where, doc, updateDoc, orderBy, getDocs, writeBatch, deleteField, serverTimestamp, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType, auth } from '../firebase';
import { InsuranceRequest, UserProfile, Client, CustomRole, CommissionInvoice } from '../types';
import { useSearchParams } from 'react-router-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { useCompany } from '../App';
import { 
  DollarSign, 
  CheckCircle, 
  Clock, 
  Search, 
  Filter, 
  ArrowUpRight, 
  X, 
  Calendar, 
  CreditCard, 
  Upload, 
  FileText,
  Eye,
  Receipt,
  User,
  Mail,
  Info,
  Briefcase,
  Percent,
  CheckSquare,
  Square,
  Printer,
  Trash2,
  RotateCcw,
  Download,
  ShieldAlert,
  FileCheck,
  Check
} from 'lucide-react';
import TransactionModal from './TransactionModal';
import InsuranceDetailModal from './InsuranceDetailModal';
import CreateCommissionInvoiceModal from './CreateCommissionInvoiceModal';
import CommissionInvoiceDetailModal from './CommissionInvoiceDetailModal';
import { generateCommissionInvoicePDF, formatUSD, formatMXP } from '../utils/commissionInvoiceUtils';
import { usePermissions } from '../hooks/usePermissions';

export default function CommissionsManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const canDeleteCommissions = profile?.role !== 'agent' || hasPermission('commissions');
  const isAdminUser = profile?.role === 'super_admin' || 
    profile?.role === 'director' || 
    profile?.role === 'administracion' || 
    profile?.role === 'admin' || 
    hasPermission('admin');
  const { settings: companySettings } = useCompany();
  const [searchParams] = useSearchParams();

  // Navigation tab: 'commissions' (Pólizas y Comisiones) | 'invoices' (Invoices y Liquidaciones)
  const [activeMainTab, setActiveMainTab] = useState<'commissions' | 'invoices'>(
    searchParams.get('tab') === 'invoices' ? 'invoices' : 'commissions'
  );

  const [commissions, setCommissions] = useState<InsuranceRequest[]>([]);
  const [invoices, setInvoices] = useState<CommissionInvoice[]>([]);
  const [selectedInvoiceForDetail, setSelectedInvoiceForDetail] = useState<CommissionInvoice | null>(null);
  const [showCreateInvoiceModal, setShowCreateInvoiceModal] = useState(false);
  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'all' | 'requested' | 'approved' | 'paid' | 'rejected'>('all');

  const [clients, setClients] = useState<Record<string, Client>>({});
  const [agents, setAgents] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'invoiced' | 'paid'>('all');
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [selectedCommission, setSelectedCommission] = useState<InsuranceRequest | null>(null);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('Transferencia');
  const [paymentCurrency, setPaymentCurrency] = useState<'USD' | 'MXP'>('USD');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentExchangeRate, setPaymentExchangeRate] = useState<number>(20.00);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [selectedInsuranceForTransactions, setSelectedInsuranceForTransactions] = useState<string | null>(null);
  const [selectedInsuranceForDetail, setSelectedInsuranceForDetail] = useState<InsuranceRequest | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [saving, setSaving] = useState(false);

  // Filter state variables
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');

  // Bulk features state variables
  const [selectedCommissionIds, setSelectedCommissionIds] = useState<string[]>([]);
  const [showBulkPaymentModal, setShowBulkPaymentModal] = useState(false);
  const [bulkPaymentDate, setBulkPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkPaymentMethod, setBulkPaymentMethod] = useState('Transferencia');
  const [bulkPaymentCurrency, setBulkPaymentCurrency] = useState<'USD' | 'MXP'>('USD');
  const [bulkPaymentExchangeRate, setBulkPaymentExchangeRate] = useState<number>(20.00);
  const [bulkReceiptUrl, setBulkReceiptUrl] = useState('');
  const [uploadingBulkReceipt, setUploadingBulkReceipt] = useState(false);
  const [isPayingBulk, setIsPayingBulk] = useState(false);

  // Delete / Revert paid commissions state
  const [commissionToDelete, setCommissionToDelete] = useState<InsuranceRequest | null>(null);
  const [isBulkDelete, setIsBulkDelete] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!profile || !hasPermission('commissions')) return;

    // Fetch latest exchange rate
    const fetchLatestRate = async () => {
      try {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const qRate = query(collection(db, 'exchangeRates'), where('date', '==', todayStr), limit(1));
        const rateSnap = await getDocs(qRate);
        if (!rateSnap.empty && rateSnap.docs[0].data()?.rate) {
          const r = Number(rateSnap.docs[0].data().rate);
          setPaymentExchangeRate(r);
          setBulkPaymentExchangeRate(r);
        } else {
          const qRecent = query(collection(db, 'exchangeRates'), orderBy('date', 'desc'), limit(1));
          const recentSnap = await getDocs(qRecent);
          if (!recentSnap.empty && recentSnap.docs[0].data()?.rate) {
            const r = Number(recentSnap.docs[0].data().rate);
            setPaymentExchangeRate(r);
            setBulkPaymentExchangeRate(r);
          }
        }
      } catch (err) {
        console.warn("Could not load exchange rate in commissions:", err);
      }
    };
    fetchLatestRate();

    // Fetch clients for lookup
    const fetchClients = async () => {
      try {
        const snap = await getDocs(collection(db, 'clients'));
        const clientMap: Record<string, Client> = {};
        snap.docs.forEach(doc => {
          clientMap[doc.id] = { id: doc.id, ...doc.data() } as Client;
        });
        setClients(clientMap);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'clients');
      }
    };

    fetchClients();

    const fetchAgents = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'agent')));
        const agentMap: Record<string, UserProfile> = {};
        snap.docs.forEach(doc => {
          agentMap[doc.id] = { uid: doc.id, ...doc.data() } as UserProfile;
        });
        setAgents(agentMap);
      } catch (error) {
        console.error('Error fetching agents:', error);
      }
    };

    fetchAgents();

    const q = query(
      collection(db, 'insurances'),
      where('commissionStatus', 'in', ['confirmed', 'invoiced', 'paid']),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setCommissions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insurances (commissions)');
      setLoading(false);
    });

    // Subscribe to commissionInvoices collection
    const qInvoices = query(
      collection(db, 'commissionInvoices'),
      orderBy('createdAt', 'desc')
    );

    const unsubInvoices = onSnapshot(qInvoices, (snap) => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() } as CommissionInvoice)));
    }, (err) => {
      console.warn('Error fetching commissionInvoices:', err);
    });

    return () => {
      unsubscribe();
      unsubInvoices();
    };
  }, []);

  useEffect(() => {
    if (selectedCommission) {
      setPaymentAmount(selectedCommission.agentCommission || 0);
      setPaymentCurrency(selectedCommission.commissionPaymentCurrency || 'USD');
      setPaymentDate(selectedCommission.commissionPaymentDate || new Date().toISOString().split('T')[0]);
      setPaymentMethod(selectedCommission.commissionPaymentMethod || 'Transferencia');
      setPaymentExchangeRate(selectedCommission.commissionPaymentExchangeRate || 1);
      setReceiptUrl(selectedCommission.commissionPaymentReceipt || '');
    }
  }, [selectedCommission]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingReceipt(true);
    try {
      const storageRef = ref(storage, `receipts/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      setReceiptUrl(url);
    } catch (error) {
      console.error('Error uploading receipt:', error);
      alert('Error al subir el comprobante');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!selectedCommission || !selectedCommission.id) return;
    
    setSaving(true);
    try {
      const todayDate = new Date();
      const todayStr = format(todayDate, 'yyyy-MM-dd');
      const amountUSD = Number(selectedCommission.agentCommission || paymentAmount || 0);
      const isMXP = paymentCurrency === 'MXP';
      const rate = isMXP ? (Number(paymentExchangeRate) || 1) : 1;
      const amountMXP = isMXP ? Number((amountUSD * rate).toFixed(2)) : undefined;

      const batch = writeBatch(db);

      // 1. Update insurance document
      const insRef = doc(db, 'insurances', selectedCommission.id);
      batch.update(insRef, {
        commissionStatus: 'paid',
        commissionPaymentDate: paymentDate || todayStr,
        commissionPaymentMethod: paymentMethod,
        commissionPaymentReceipt: receiptUrl || '',
        commissionPaymentCurrency: paymentCurrency,
        commissionPaymentAmount: isMXP ? amountMXP : amountUSD,
        commissionPaymentExchangeRate: rate
      });

      // 2. Generate or update payment document in payments collection with today's date
      const paymentsSnap = await getDocs(
        query(
          collection(db, 'payments'),
          where('insuranceId', '==', selectedCommission.id),
          where('type', '==', 'agent_commission')
        )
      );

      const paymentData: any = {
        insuranceId: selectedCommission.id,
        type: 'agent_commission',
        status: 'completed',
        date: todayDate,
        amount: amountUSD,
        currency: paymentCurrency,
        paymentMethod: paymentMethod,
        receiptUrl: receiptUrl || '',
        exchangeRate: rate,
        notes: isMXP 
          ? `Pago de comisión de agente liquidado en MXP: $${amountUSD.toFixed(2)} USD = $${amountMXP?.toFixed(2)} MXP (T.C. ${rate.toFixed(2)})`
          : `Pago de comisión de agente liquidado en USD: $${amountUSD.toFixed(2)} USD`,
        createdBy: auth.currentUser?.email || profile?.email || 'Sistema'
      };
      if (isMXP && amountMXP !== undefined) {
        paymentData.amountMXP = amountMXP;
      }

      if (!paymentsSnap.empty) {
        const existingDoc = paymentsSnap.docs[0];
        batch.update(existingDoc.ref, {
          ...paymentData,
          updatedAt: serverTimestamp()
        });
      } else {
        const newPayRef = doc(collection(db, 'payments'));
        batch.set(newPayRef, {
          ...paymentData,
          createdAt: serverTimestamp()
        });
      }

      // 3. Activity log
      const logRef = doc(collection(db, 'insuranceActivities'));
      batch.set(logRef, {
        insuranceId: selectedCommission.id,
        type: 'automatic',
        description: isMXP
          ? `Se pagó comisión de agente por $${amountUSD.toFixed(2)} USD (desglosado en $${amountMXP?.toFixed(2)} MXP al T.C. ${rate.toFixed(2)}) mediante ${paymentMethod}.`
          : `Se pagó comisión de agente por $${amountUSD.toFixed(2)} USD mediante ${paymentMethod}.`,
        date: todayDate,
        createdBy: auth.currentUser?.email || profile?.email || 'Sistema'
      });

      await batch.commit();

      alert(isMXP
        ? `Pago de comisión registrado exitosamente con la fecha de hoy (${todayStr}).\n• Comisión USD: $${amountUSD.toFixed(2)} USD\n• Desglose MXP: $${amountMXP?.toFixed(2)} MXP\n• Tipo de Cambio: ${rate.toFixed(2)}`
        : `Pago de comisión registrado exitosamente con la fecha de hoy (${todayStr}) por $${amountUSD.toFixed(2)} USD.`
      );

      setSelectedCommission(null);
      setReceiptUrl('');
    } catch (error) {
      console.error('Error pagando comisión:', error);
      handleFirestoreError(error, OperationType.UPDATE, `insurances/${selectedCommission?.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSelectCommission = (id: string) => {
    setSelectedCommissionIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllCommissions = (isChecked: boolean) => {
    if (isChecked) {
      const allIds = filteredCommissions
        .filter(c => c.id)
        .map(c => c.id as string);
      setSelectedCommissionIds(allIds);
    } else {
      setSelectedCommissionIds([]);
    }
  };

  const handleExecuteDeleteCommission = async (mode: 'revert_to_pending' | 'remove_commission') => {
    setIsDeleting(true);
    try {
      const targets: InsuranceRequest[] = isBulkDelete
        ? commissions.filter(c => c.id && selectedCommissionIds.includes(c.id) && c.commissionStatus === 'paid')
        : (commissionToDelete ? [commissionToDelete] : []);

      if (targets.length === 0) return;

      const batch = writeBatch(db);

      for (const ins of targets) {
        if (!ins.id) continue;
        const insRef = doc(db, 'insurances', ins.id);

        if (mode === 'revert_to_pending') {
          // Revert to 'confirmed' (Por Pagar) and clear payment details
          batch.update(insRef, {
            commissionStatus: 'confirmed',
            commissionPaymentDate: deleteField(),
            commissionPaymentMethod: deleteField(),
            commissionPaymentReceipt: deleteField(),
            commissionPaymentCurrency: deleteField(),
            commissionPaymentAmount: deleteField(),
            commissionPaymentExchangeRate: deleteField(),
          });
        } else {
          // Completely remove / unconfirm commission from module
          batch.update(insRef, {
            commissionStatus: 'pending',
            commissionPaymentDate: deleteField(),
            commissionPaymentMethod: deleteField(),
            commissionPaymentReceipt: deleteField(),
            commissionPaymentCurrency: deleteField(),
            commissionPaymentAmount: deleteField(),
            commissionPaymentExchangeRate: deleteField(),
          });
        }

        // Query and remove any matching agent_commission records from payments collection
        try {
          const paymentsSnap = await getDocs(
            query(
              collection(db, 'payments'),
              where('insuranceId', '==', ins.id),
              where('type', '==', 'agent_commission')
            )
          );
          paymentsSnap.forEach(pDoc => {
            batch.delete(pDoc.ref);
          });
        } catch (pErr) {
          console.error("Error querying payments for commission deletion:", pErr);
        }

        // Log the activity
        try {
          const logRef = doc(collection(db, 'insuranceActivities'));
          batch.set(logRef, {
            insuranceId: ins.id,
            type: 'manual',
            description: mode === 'revert_to_pending'
              ? `Se borró el pago de la comisión de $${(ins.agentCommission || 0).toFixed(2)} USD. La comisión fue revertida a estado 'Por Pagar'.`
              : `Se borró la comisión pagada de $${(ins.agentCommission || 0).toFixed(2)} USD y se desvinculó del módulo de comisiones.`,
            date: new Date(),
            createdBy: auth.currentUser?.email || profile?.email || 'Sistema'
          });
        } catch (lErr) {
          console.error("Error creating activity log:", lErr);
        }
      }

      await batch.commit();

      if (isBulkDelete) {
        const deletedIds = targets.map(t => t.id!);
        setSelectedCommissionIds(prev => prev.filter(id => !deletedIds.includes(id)));
        alert(`Se han procesado ${targets.length} comisión(es) pagada(s) exitosamente.`);
      } else {
        alert(mode === 'revert_to_pending' 
          ? "El pago de la comisión ha sido revertido exitosamente a 'Por Pagar'."
          : "La comisión ha sido eliminada exitosamente del módulo."
        );
        if (selectedCommission?.id === commissionToDelete?.id) {
          setSelectedCommission(null);
        }
      }

      setShowDeleteModal(false);
      setCommissionToDelete(null);
      setIsBulkDelete(false);
    } catch (error) {
      console.error("Error al borrar comisión pagada:", error);
      alert("Hubo un error al borrar la comisión pagada.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleGenerateReport = () => {
    if (selectedCommissionIds.length === 0) return;

    const selectedCommissions = commissions.filter(c => c.id && selectedCommissionIds.includes(c.id));
    if (selectedCommissions.length === 0) return;

    // Get Agent Name(s)
    const agentNamesSet = new Set(selectedCommissions.map(c => getAgentName(c)).filter(Boolean));
    const agentNamesList = Array.from(agentNamesSet);
    const agentTitle = agentNamesList.length === 1 
      ? agentNamesList[0] 
      : agentNamesList.length > 1 
      ? agentNamesList.join(', ') 
      : 'General';

    // Horizontal / Landscape A4
    const doc = new jsPDF('l', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();

    // Draw header background bar
    doc.setFillColor(26, 33, 56); // #1A2138
    doc.rect(0, 0, pageWidth, 26, 'F');

    // Header Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text('REPORTE DE COMISIONES', 14, 17);

    // Add company logo if available
    if (companySettings?.logoUrl) {
      try {
        doc.addImage(companySettings.logoUrl, 'PNG', pageWidth - 45, 3, 32, 20);
      } catch (e) {
        console.error('Error adding logo to PDF:', e);
      }
    }

    // Subtitle / Agent info
    doc.setTextColor(26, 33, 56);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Agente: ${agentTitle}`, 14, 34);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    const todayStr = format(new Date(), 'dd/MM/yyyy HH:mm');
    doc.text(`Fecha de emisión: ${todayStr}  |  Comisiones seleccionadas: ${selectedCommissions.length}`, 14, 39);

    const formatDateStr = (dStr?: string) => {
      if (!dStr) return '';
      const parts = dStr.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return dStr;
    };

    // Calculate totals and format rows
    let sumDias = 0;
    let sumPrecioUSD = 0;
    let sumComisionUSD = 0;
    let sumPrecioMXP = 0;
    let sumComisionMXP = 0;

    const fmtUSD = (val: number) => `$${val.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtMXP = (val: number) => `$${val.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const tableRows = selectedCommissions.map(c => {
      const reqDateStr = getRequestDateStr(c);
      const fechaSolicitud = formatDateStr(reqDateStr);
      const tipoAccion = c.actionType || 'Emisión';
      const asegurado = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Sin Nombre';
      const codigoOrigen = c.originCountry || '';
      const codigoDestino = c.destinationCountry || '';
      const fechaSalida = formatDateStr(c.startDate);
      const fechaRegreso = formatDateStr(c.endDate);
      const dias = c.days || 0;

      const precioUSD = Number(c.totalPrice !== undefined && c.totalPrice !== null ? c.totalPrice : (c.totalFinal || 0));
      const comisionUSD = Number(c.agentCommission || c.comision || 0);
      const tc = Number(c.exchangeRate || 17.55);

      const precioMXP = precioUSD * tc;
      const comisionMXP = comisionUSD * tc;

      sumDias += dias;
      sumPrecioUSD += precioUSD;
      sumComisionUSD += comisionUSD;
      sumPrecioMXP += precioMXP;
      sumComisionMXP += comisionMXP;

      return [
        fechaSolicitud,
        tipoAccion,
        asegurado,
        codigoOrigen,
        codigoDestino,
        fechaSalida,
        fechaRegreso,
        dias.toString(),
        fmtUSD(precioUSD),
        fmtUSD(comisionUSD),
        tc.toFixed(2),
        fmtMXP(precioMXP),
        fmtMXP(comisionMXP)
      ];
    });

    // Append Summary / Total row
    tableRows.push([
      'TOTALES',
      '',
      '',
      '',
      '',
      '',
      '',
      sumDias.toString(),
      fmtUSD(sumPrecioUSD),
      fmtUSD(sumComisionUSD),
      '',
      fmtMXP(sumPrecioMXP),
      fmtMXP(sumComisionMXP)
    ]);

    autoTable(doc, {
      startY: 44,
      head: [[
        'Fecha Solicitud',
        'Tipo Acción',
        'Asegurado',
        'Código Origen',
        'Código Destino',
        'Fecha Salida',
        'Fecha Regreso',
        'Días',
        'Precio del Seguro',
        'Comisión',
        'TC',
        'Precio del Seguro MXP',
        'Comisión MXP'
      ]],
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [26, 33, 56],
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'center'
      },
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [50, 50, 50]
      },
      columnStyles: {
        0: { halign: 'center' }, // Fecha Solicitud
        1: { halign: 'center' }, // Tipo Accion
        2: { halign: 'left' },   // Asegurado
        3: { halign: 'center' }, // Codigo Origen
        4: { halign: 'center' }, // Codigo Destino
        5: { halign: 'center' }, // Fecha Salida
        6: { halign: 'center' }, // Fecha Regreso
        7: { halign: 'center' }, // Dias
        8: { halign: 'right' },  // Precio del Seguro
        9: { halign: 'right' },  // Comision
        10: { halign: 'center' }, // TC
        11: { halign: 'right' }, // Precio del Seguro MXP
        12: { halign: 'right' }  // Comision MXP
      },
      didParseCell: (data) => {
        // Highlight total row
        if (data.row.index === tableRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [243, 244, 246];
          data.cell.styles.textColor = [26, 33, 56];
        }
      }
    });

    const sanitizedAgent = agentTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Reporte_Comisiones_${sanitizedAgent}_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const handleBulkFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingBulkReceipt(true);
    try {
      const storageRef = ref(storage, `receipts/bulk_${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      setBulkReceiptUrl(url);
    } catch (error) {
      console.error('Error uploading receipt:', error);
      alert('Error al subir el comprobante');
    } finally {
      setUploadingBulkReceipt(false);
    }
  };

  const handleBulkMarkAsPaid = async () => {
    if (selectedCommissionIds.length === 0) return;
    setIsPayingBulk(true);
    try {
      const batch = writeBatch(db);
      const todayDate = new Date();
      const todayStr = format(todayDate, 'yyyy-MM-dd');
      const isMXP = bulkPaymentCurrency === 'MXP';
      const rate = isMXP ? (Number(bulkPaymentExchangeRate) || 1) : 1;
      
      for (const id of selectedCommissionIds) {
        const commissionObj = commissions.find(c => c.id === id);
        if (!commissionObj) continue;
        
        const commRef = doc(db, 'insurances', id);
        const amountUSD = Number(commissionObj.agentCommission || 0);
        const amountMXP = isMXP ? Number((amountUSD * rate).toFixed(2)) : undefined;
        
        batch.update(commRef, {
          commissionStatus: 'paid',
          commissionPaymentDate: bulkPaymentDate || todayStr,
          commissionPaymentMethod: bulkPaymentMethod,
          commissionPaymentReceipt: bulkReceiptUrl || '',
          commissionPaymentCurrency: bulkPaymentCurrency,
          commissionPaymentAmount: isMXP ? amountMXP : amountUSD,
          commissionPaymentExchangeRate: rate
        });

        // Query existing agent commission payments for this policy
        const paymentsSnap = await getDocs(
          query(
            collection(db, 'payments'),
            where('insuranceId', '==', id),
            where('type', '==', 'agent_commission')
          )
        );

        const paymentData: any = {
          insuranceId: id,
          type: 'agent_commission',
          status: 'completed',
          date: todayDate,
          amount: amountUSD,
          currency: bulkPaymentCurrency,
          paymentMethod: bulkPaymentMethod,
          receiptUrl: bulkReceiptUrl || '',
          exchangeRate: rate,
          notes: isMXP 
            ? `Pago de comisión de agente en lote: $${amountUSD.toFixed(2)} USD equivalente a $${amountMXP?.toFixed(2)} MXP (T.C. ${rate.toFixed(2)})`
            : `Pago de comisión de agente en lote liquidado en USD: $${amountUSD.toFixed(2)} USD`,
          createdBy: auth.currentUser?.email || profile?.email || 'Sistema'
        };
        if (isMXP && amountMXP !== undefined) {
          paymentData.amountMXP = amountMXP;
        }

        if (!paymentsSnap.empty) {
          const existingDoc = paymentsSnap.docs[0];
          batch.update(existingDoc.ref, {
            ...paymentData,
            updatedAt: serverTimestamp()
          });
        } else {
          const newPayRef = doc(collection(db, 'payments'));
          batch.set(newPayRef, {
            ...paymentData,
            createdAt: serverTimestamp()
          });
        }

        const logRef = doc(collection(db, 'insuranceActivities'));
        batch.set(logRef, {
          insuranceId: id,
          type: 'automatic',
          description: isMXP
            ? `Se pagó comisión por $${amountUSD.toFixed(2)} USD (desglosado en $${amountMXP?.toFixed(2)} MXP al T.C. ${rate.toFixed(2)}) en lote (${bulkPaymentMethod}).`
            : `Se pagó comisión por $${amountUSD.toFixed(2)} USD de forma masiva en lote (${bulkPaymentMethod}).`,
          date: todayDate,
          createdBy: auth.currentUser?.email || profile?.email || 'Sistema'
        });
      }
      
      await batch.commit();
      alert(`Se han liquidado y generado pagos para ${selectedCommissionIds.length} póliza(s) con la fecha de hoy (${todayStr}).`);
      setSelectedCommissionIds([]);
      setShowBulkPaymentModal(false);
      setBulkReceiptUrl('');
    } catch (error) {
      console.error('Error pagando comisiones masivas:', error);
      alert('Hubo un error al procesar el pago masivo.');
    } finally {
      setIsPayingBulk(false);
    }
  };

  const getAgentName = (c: InsuranceRequest) => {
    if (c.clientId && clients[c.clientId]) {
      const client = clients[c.clientId];
      if (client.type === 'Agent') {
        return client.commercialName || client.legalName || c.linkedAgentId || 'Agente';
      }
      if (c.linkedAgentId) {
        const agent = client.linkedAgents?.find(a => a.email === c.linkedAgentId);
        if (agent) return agent.name;
      }
    }
    
    if (c.agentId && agents[c.agentId]) {
      return agents[c.agentId].displayName;
    }

    return c.linkedAgentId || 'Directo';
  };

  const uniqueAgentNames = Array.from(
    new Set(commissions.map((c) => getAgentName(c)).filter(Boolean))
  ).sort();

  const getRequestDateStr = (c: InsuranceRequest): string => {
    if (c.requestDate) return c.requestDate;
    if (c.createdAt?.toDate) {
      return c.createdAt.toDate().toISOString().split('T')[0];
    }
    if (c.createdAt) {
      const d = new Date(c.createdAt);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
    return '';
  };

  const filteredCommissions = commissions.filter(c => {
    if (profile?.role === 'agent') {
      const isOwnerByUid = c.agentId === profile.uid;
      const isOwnerByEmail = c.linkedAgentId?.toLowerCase() === profile.email?.toLowerCase();
      const isOwnerByEmailInAgentId = c.agentId?.toLowerCase() === profile.email?.toLowerCase();
      const isOwnerByUserId = c.userId === profile.uid;
      if (!isOwnerByUid && !isOwnerByEmail && !isOwnerByEmailInAgentId && !isOwnerByUserId) return false;
    }

    const matchesFilter = filter === 'all' || c.commissionStatus === filter;
    const agentName = getAgentName(c);
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    const searchTarget = `${fullName} ${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${agentName}`.toLowerCase();
    const searchTokens = searchTerm.toLowerCase().trim().split(/\s+/);
    const matchesSearch = !searchTerm.trim() || searchTokens.every(token => searchTarget.includes(token));
    
    const matchesAgent = filterAgent === 'all' || agentName === filterAgent;
    const matchesPaymentMethod = filterPaymentMethod === 'all' || c.commissionPaymentMethod === filterPaymentMethod;
    
    const reqDate = getRequestDateStr(c);
    const matchesStartDate = !filterStartDate || (reqDate && reqDate >= filterStartDate);
    const matchesEndDate = !filterEndDate || (reqDate && reqDate <= filterEndDate);
    const matchesDate = matchesStartDate && matchesEndDate;

    return matchesFilter && matchesSearch && matchesAgent && matchesPaymentMethod && matchesDate;
  });

  const totalConfirmed = filteredCommissions
    .filter(c => c.commissionStatus === 'confirmed')
    .reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);

  const totalPaid = filteredCommissions
    .filter(c => c.commissionStatus === 'paid')
    .reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);

  // New KPIs summary requested: "comisiones pagadas, monto en USD, monto en MXP"
  const paidCommissionsCount = filteredCommissions.filter(c => c.commissionStatus === 'paid').length;

  const totalPaidUSD = filteredCommissions
    .filter(c => c.commissionStatus === 'paid' && (c.commissionPaymentCurrency === 'USD' || !c.commissionPaymentCurrency))
    .reduce((acc, curr) => acc + (curr.commissionPaymentAmount || curr.agentCommission || 0), 0);

  const totalPaidMXP = filteredCommissions
    .filter(c => c.commissionStatus === 'paid' && c.commissionPaymentCurrency === 'MXP')
    .reduce((acc, curr) => acc + (curr.commissionPaymentAmount || 0), 0);

  // Filtered invoices calculation
  const filteredInvoices = invoices.filter(inv => {
    if (profile?.role === 'agent') {
      const isOwnerByUid = inv.agentId === profile.uid;
      const isOwnerByEmail = inv.agentEmail?.toLowerCase() === profile.email?.toLowerCase();
      if (!isOwnerByUid && !isOwnerByEmail) return false;
    }

    const matchesStatus = invoiceStatusFilter === 'all' || inv.status === invoiceStatusFilter;
    const searchTarget = `${inv.folio || ''} ${inv.agentName || ''} ${inv.agentEmail || ''} ${inv.agentInvoiceFolio || ''}`.toLowerCase();
    const searchTokens = invoiceSearchTerm.toLowerCase().trim().split(/\s+/);
    const matchesSearch = !invoiceSearchTerm.trim() || searchTokens.every(token => searchTarget.includes(token));

    return matchesStatus && matchesSearch;
  });

  const totalInvoicesRequested = filteredInvoices.filter(i => i.status === 'requested').length;
  const totalInvoicesApproved = filteredInvoices.filter(i => i.status === 'approved').length;
  const totalInvoicesPaidCount = filteredInvoices.filter(i => i.status === 'paid').length;
  const totalInvoicesPaidUSD = filteredInvoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + (i.totalCommissionUSD || 0), 0);
  const totalInvoicesPaidMXP = filteredInvoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + (i.totalCommissionMXP || (i.totalCommissionUSD * (i.exchangeRate || 1))), 0);

  return (
    <div className="space-y-8">
      {/* Encabezado Principal */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Comisiones e Invoices</h1>
          <p className="text-gray-500">Control de liquidaciones, facturas fiscales y pagos a agentes</p>
        </div>
        <div className="flex items-center gap-2">
          {profile?.role === 'agent' && (
            <button
              type="button"
              onClick={() => {
                const confirmedIds = filteredCommissions.filter(c => c.commissionStatus === 'confirmed').map(c => c.id!);
                if (confirmedIds.length > 0) {
                  setSelectedCommissionIds(confirmedIds);
                  setShowCreateInvoiceModal(true);
                } else {
                  alert('No tienes comisiones pendientes por cobrar en este momento.');
                }
              }}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Receipt className="w-4 h-4" />
              Solicitar Cobro de Comisiones
            </button>
          )}
        </div>
      </header>

      {/* Banner Especial para Agentes */}
      {profile?.role === 'agent' && (
        <div className="bg-gradient-to-r from-[#1A2138] via-[#222c4a] to-[#10b981]/20 text-white p-6 rounded-3xl shadow-xl border border-indigo-950/40">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1.5">
                <Check className="w-3 h-3 text-emerald-400" />
                Portal de Liquidación para Agentes
              </span>
              <h2 className="text-xl font-black pt-1">Bienvenido, {profile.displayName || profile.email}</h2>
              <p className="text-xs text-gray-300 max-w-2xl leading-relaxed">
                Selecciona tus comisiones confirmadas para emitir tu <strong>Liquidación Oficial de Comisiones (PDF)</strong> o adjuntar tu <strong>Factura Fiscal (CFDI PDF y XML)</strong> para recibir tu pago por transferencia bancaria.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/10 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/10 text-right">
                <span className="text-[10px] text-gray-300 font-bold uppercase block">Por Cobrar</span>
                <span className="text-lg font-black text-emerald-400">{formatUSD(totalConfirmed)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pestañas Principales: Pólizas y Comisiones vs Invoices y Liquidaciones */}
      <div className="flex border-b border-gray-200 gap-6">
        <button
          type="button"
          onClick={() => setActiveMainTab('commissions')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeMainTab === 'commissions'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-400 hover:text-gray-700'
          }`}
        >
          <ShieldAlert className="w-4.5 h-4.5" />
          <span>Pólizas y Comisiones ({filteredCommissions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainTab('invoices')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeMainTab === 'invoices'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-gray-400 hover:text-gray-700'
          }`}
        >
          <FileText className="w-4.5 h-4.5" />
          <span>Invoices y Liquidaciones de Agentes ({filteredInvoices.length})</span>
          {totalInvoicesRequested > 0 && (
            <span className="px-2 py-0.5 text-[10px] bg-amber-500 text-white rounded-full font-black">
              {totalInvoicesRequested} por revisar
            </span>
          )}
        </button>
      </div>

      {/* Vista: Pólizas y Comisiones */}
      {activeMainTab === 'commissions' && (
        <>
          {/* Dynamic KPI summary cards based on filtered results */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Total por Pagar</span>
            </div>
            <p className="text-2xl font-black text-gray-900">${totalConfirmed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            {filteredCommissions.filter(c => c.commissionStatus === 'confirmed').length} registros pendientes
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-green-50 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Comisiones Pagadas</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{paidCommissionsCount} registros</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            De un total de {filteredCommissions.length} filtrados
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <DollarSign className="w-5 h-5 text-indigo-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Monto Pagado USD</span>
            </div>
            <p className="text-2xl font-black text-indigo-900">${totalPaidUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            Liquidadas en USD
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-amber-50 rounded-lg">
                <Percent className="w-5 h-5 text-amber-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Monto Pagado MXN</span>
            </div>
            <p className="text-2xl font-black text-amber-900">${totalPaidMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            Liquidadas en Pesos Mexicanos
          </p>
        </div>
      </div>

      {/* Advanced search and dynamic filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
            <input 
              type="text"
              placeholder="Buscar por cliente, asegurado o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none text-sm font-medium"
            />
          </div>
          
          <div className="flex self-start lg:self-auto bg-gray-100 p-1 rounded-xl border border-gray-200">
            {(['all', 'confirmed', 'invoiced', 'paid'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filter === f ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'all' ? 'Todas' : f === 'confirmed' ? 'Por Cobrar' : f === 'invoiced' ? 'En Trámite' : 'Pagadas'}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-indigo-600" />
            <span className="text-xs font-black text-gray-500 uppercase tracking-wider">Filtros Avanzados</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fecha Solicitud (Desde)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input 
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fecha Solicitud (Hasta)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input 
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Agente</label>
              <select
                value={filterAgent}
                onChange={(e) => setFilterAgent(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer appearance-none"
              >
                <option value="all">Todos los agentes</option>
                {uniqueAgentNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Forma de Pago</label>
              <div className="flex gap-2">
                <select
                  value={filterPaymentMethod}
                  onChange={(e) => setFilterPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer appearance-none flex-1"
                >
                  <option value="all">Todas las formas</option>
                  <option value="Transferencia">Transferencia</option>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Descuento comision">Descuento comisión</option>
                  <option value="Otro">Otro</option>
                </select>

                {(filterStartDate || filterEndDate || filterAgent !== 'all' || filterPaymentMethod !== 'all' || searchTerm) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStartDate('');
                      setFilterEndDate('');
                      setFilterAgent('all');
                      setFilterPaymentMethod('all');
                      setSearchTerm('');
                    }}
                    className="px-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-red-600 transition-all cursor-pointer flex items-center justify-center shrink-0"
                    title="Limpiar filtros"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk operation controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {filteredCommissions.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const isAllSelected = selectedCommissionIds.length === filteredCommissions.length;
                handleSelectAllCommissions(!isAllSelected);
              }}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 rounded-xl cursor-pointer"
            >
              {selectedCommissionIds.length === filteredCommissions.length && filteredCommissions.length > 0 ? (
                <>
                  <CheckSquare className="w-4 h-4" />
                  Deseleccionar Todas ({selectedCommissionIds.length})
                </>
              ) : (
                <>
                  <Square className="w-4 h-4" />
                  Seleccionar Todas ({filteredCommissions.length})
                </>
              )}
            </button>
          </div>
        )}
        <div className="text-xs font-medium text-[#1A2138] uppercase tracking-wider font-bold">
          {filteredCommissions.length} Comisione(s) Encontrada(s)
        </div>
      </div>

      {selectedCommissionIds.length > 0 && (
        <div className="bg-[#1A2138] border border-gray-800 p-5 rounded-[2rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in slide-in-from-top duration-300 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
              <CheckSquare className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-black text-white uppercase tracking-wider">Comisiones Seleccionadas</p>
              <p className="text-xs text-gray-400">Hay <span className="font-bold text-indigo-400 text-sm">{selectedCommissionIds.length}</span> comisión(es) seleccionada(s).</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateReport}
              className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-emerald-700/20 uppercase tracking-widest flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              Generar Reporte
            </button>
            {selectedCommissionIds.some(id => commissions.find(c => c.id === id)?.commissionStatus === 'confirmed') && (
              <>
                <button
                  type="button"
                  onClick={() => setShowCreateInvoiceModal(true)}
                  className="px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-emerald-500/20 uppercase tracking-widest flex items-center gap-2 cursor-pointer"
                  title="Generar Invoice y Liquidación Oficial para Cobro"
                >
                  <Receipt className="w-4 h-4" />
                  Generar Invoice / Cobrar ({selectedCommissionIds.filter(id => commissions.find(c => c.id === id)?.commissionStatus === 'confirmed').length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowBulkPaymentModal(true)}
                  className="px-5 py-3 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-indigo-500/20 uppercase tracking-widest flex items-center gap-2 cursor-pointer"
                >
                  Pagar Seleccionadas
                  <ArrowUpRight className="w-4.5 h-4.5" />
                </button>
              </>
            )}
            {selectedCommissionIds.some(id => commissions.find(c => c.id === id)?.commissionStatus === 'paid') && canDeleteCommissions && (
              <button
                type="button"
                onClick={() => {
                  setIsBulkDelete(true);
                  setShowDeleteModal(true);
                }}
                className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-red-600/20 uppercase tracking-widest flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4.5 h-4.5" />
                Borrar Pagadas ({selectedCommissionIds.filter(id => commissions.find(c => c.id === id)?.commissionStatus === 'paid').length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedCommissionIds([])}
              className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white transition-all cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
            Cargando comisiones...
          </div>
        ) : filteredCommissions.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
            No se encontraron comisiones.
          </div>
        ) : (
          filteredCommissions.map((c) => (
            <div 
              key={c.id} 
              className={`bg-white rounded-2xl border transition-all p-6 hover:shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6 ${
                selectedCommissionIds.includes(c.id || '') ? 'border-indigo-400 bg-indigo-50/15' : 'border-gray-100'
              }`}
            >
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Agent & Client */}
                <div className="flex items-start gap-3">
                  {c.id && (
                    <button
                      type="button"
                      onClick={() => handleToggleSelectCommission(c.id!)}
                      className="mt-2.5 mr-1 text-gray-400 hover:text-indigo-600 transition-colors focus:outline-none cursor-pointer shrink-0"
                      title={selectedCommissionIds.includes(c.id) ? "Deseleccionar" : "Seleccionar"}
                    >
                      {selectedCommissionIds.includes(c.id) ? (
                        <CheckSquare className="w-5.5 h-5.5 text-indigo-600 fill-indigo-50" />
                      ) : (
                        <Square className="w-5.5 h-5.5 text-gray-300 hover:border-indigo-400" />
                      )}
                    </button>
                  )}
                  
                  <div className="p-3 bg-purple-50 rounded-xl shrink-0">
                    <Briefcase className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase border ${
                        c.clientType === 'Agent' ? 'bg-purple-50 text-purple-700 border-purple-100' : 
                        c.clientType === 'Corporate' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 
                        'bg-gray-50 text-gray-700 border-gray-100'
                      }`}>
                        {c.clientType === 'Agent' ? 'Agencia' : c.clientType === 'Corporate' ? 'Empresa' : 'Individual'}
                      </span>
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {c.clientId && clients[c.clientId] ? (clients[c.clientId].commercialName || clients[c.clientId].legalName || 'S/N') : 'Directo'}
                      </p>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                        <User className="w-3 h-3 text-gray-400" />
                        <span className="font-medium">Agente: <span className="text-gray-900 font-bold">{getAgentName(c)}</span></span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                        <FileText className="w-3 h-3 text-gray-400" />
                        <span>Asegurado: <span className="font-medium text-gray-700">{c.firstName} {c.lastName}</span></span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Amount & Status */}
                <div className="flex flex-col justify-center">
                  <div className="mb-3">
                    <p className="text-[10px] text-gray-400 font-bold uppercase mb-0.5">Precio del Seguro</p>
                    <p className="text-sm font-bold text-gray-900">${Number(c.totalPrice !== undefined && c.totalPrice !== null ? c.totalPrice : (c.totalFinal || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase mb-0.5">Monto Comisión</p>
                    <p className="text-lg font-black text-blue-600">${(c.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                  <div className="mt-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                      c.commissionStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-100' :
                      c.commissionStatus === 'invoiced' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                      'bg-blue-50 text-blue-700 border-blue-100'
                    }`}>
                      {c.commissionStatus === 'paid' ? 'Pagada' : c.commissionStatus === 'invoiced' ? 'En Trámite' : 'Por Cobrar'}
                    </span>
                    {c.commissionInvoiceId && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetInv = invoices.find(i => i.id === c.commissionInvoiceId);
                          if (targetInv) {
                            setSelectedInvoiceForDetail(targetInv);
                          } else {
                            setActiveMainTab('invoices');
                          }
                        }}
                        className="block mt-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 transition-colors"
                      >
                        Ver Invoice →
                      </button>
                    )}
                  </div>
                </div>

                {/* Payment Info (if paid) */}
                <div className="flex flex-col justify-center">
                  {c.commissionStatus === 'paid' ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-400 font-bold uppercase">Pagado el {c.commissionPaymentDate}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-600 font-medium bg-gray-100 px-2 py-0.5 rounded">{c.commissionPaymentMethod}</span>
                        {c.commissionPaymentReceipt && (
                          <a 
                            href={c.commissionPaymentReceipt} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Ver Comprobante"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      {c.commissionPaymentCurrency === 'MXP' ? (
                        <div className="mt-1 pt-1 border-t border-gray-100">
                          <p className="text-[10px] text-amber-700 font-bold">
                            ${Number(c.commissionPaymentAmount || ((c.agentCommission || 0) * (c.commissionPaymentExchangeRate || 1))).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP
                          </p>
                          <p className="text-[9px] text-gray-400">
                            Equivalente de ${(c.agentCommission || 0).toFixed(2)} USD (T.C. {Number(c.commissionPaymentExchangeRate || 1).toFixed(2)})
                          </p>
                        </div>
                      ) : (
                        <p className="text-[10px] text-blue-700 font-bold">
                          ${(c.commissionPaymentAmount || c.agentCommission || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-600">
                      <Clock className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase">Pendiente de Pago</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6">
                <button 
                  onClick={() => setSelectedInsuranceForDetail(c)}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                  title="Ver información del seguro"
                >
                  <Info className="w-5 h-5" />
                </button>
                
                <button 
                  onClick={() => setSelectedInsuranceForTransactions(c.id || null)}
                  className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-xl transition-all"
                  title="Ver todas las transacciones"
                >
                  <Receipt className="w-5 h-5" />
                </button>
                
                {c.commissionStatus === 'confirmed' ? (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setSelectedCommissionIds([c.id!]);
                        setShowCreateInvoiceModal(true);
                      }}
                      className="px-3.5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-sm shadow-emerald-200 cursor-pointer"
                      title="Generar invoice y solicitar pago"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      Cobrar / Invoice
                    </button>
                    {isAdminUser && (
                      <button 
                        onClick={() => setSelectedCommission(c)}
                        className="px-3 py-2 bg-green-700 text-white rounded-xl text-xs font-bold hover:bg-green-800 transition-all flex items-center gap-1.5 shadow-sm shadow-green-100 cursor-pointer"
                        title="Registrar pago directo"
                      >
                        Pagar
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ) : c.commissionStatus === 'invoiced' ? (
                  <button 
                    onClick={() => {
                      const targetInv = invoices.find(i => i.id === c.commissionInvoiceId);
                      if (targetInv) {
                        setSelectedInvoiceForDetail(targetInv);
                      } else {
                        setActiveMainTab('invoices');
                      }
                    }}
                    className="px-3.5 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition-all flex items-center gap-1.5 shadow-sm shadow-amber-100 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Ver Invoice
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setSelectedCommission(c)}
                      className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all flex items-center gap-2 cursor-pointer"
                    >
                      Ver Detalle
                      <Eye className="w-4 h-4" />
                    </button>
                    {canDeleteCommissions && (
                      <button
                        type="button"
                        onClick={() => {
                          setCommissionToDelete(c);
                          setIsBulkDelete(false);
                          setShowDeleteModal(true);
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                        title="Borrar comisión pagada"
                      >
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
        </>
      )}

      {/* Vista: Invoices y Liquidaciones de Agentes */}
      {activeMainTab === 'invoices' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* KPI Summary Cards para Invoices */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Invoices Totales</span>
                </div>
                <p className="text-2xl font-black text-gray-900">{filteredInvoices.length}</p>
              </div>
              <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
                {invoices.length} en el sistema
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <div className="p-2 bg-amber-50 rounded-lg">
                    <Clock className="w-5 h-5 text-amber-600" />
                  </div>
                  <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Por Revisar</span>
                </div>
                <p className="text-2xl font-black text-amber-600">{totalInvoicesRequested}</p>
              </div>
              <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
                {totalInvoicesApproved} aprobados para dispersión
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <div className="p-2 bg-emerald-50 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                  </div>
                  <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Invoices Pagados</span>
                </div>
                <p className="text-2xl font-black text-emerald-600">{totalInvoicesPaidCount}</p>
              </div>
              <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
                Liquidados con comprobante bancario
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <div className="p-2 bg-indigo-50 rounded-lg">
                    <DollarSign className="w-5 h-5 text-indigo-600" />
                  </div>
                  <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Total Liquidado USD</span>
                </div>
                <p className="text-2xl font-black text-indigo-900">{formatUSD(totalInvoicesPaidUSD)}</p>
              </div>
              <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
                ≈ {formatMXP(totalInvoicesPaidMXP)}
              </p>
            </div>
          </div>

          {/* Barra de Filtros y Búsqueda de Invoices */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por folio, agente, email o factura..."
                value={invoiceSearchTerm}
                onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm font-medium"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'requested', 'approved', 'paid', 'rejected'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setInvoiceStatusFilter(st)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    invoiceStatusFilter === st
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {st === 'all' ? 'Todos' :
                   st === 'requested' ? 'Solicitados' :
                   st === 'approved' ? 'Aprobados' :
                   st === 'paid' ? 'Pagados' : 'Rechazados'}
                </button>
              ))}
            </div>
          </div>

          {/* Listado de Invoices */}
          <div className="space-y-4">
            {filteredInvoices.length === 0 ? (
              <div className="bg-white p-12 rounded-3xl border border-gray-100 text-center space-y-4">
                <FileText className="w-12 h-12 text-gray-300 mx-auto" />
                <div>
                  <h3 className="text-base font-bold text-gray-800">No se encontraron invoices de comisiones</h3>
                  <p className="text-xs text-gray-400 max-w-md mx-auto mt-1">
                    {profile?.role === 'agent'
                      ? 'Aún no has generado invoices para tus comisiones. Ve a la pestaña "Pólizas y Comisiones", selecciona las comisiones que desees y haz clic en "Generar Invoice / Solicitar Cobro".'
                      : 'No hay solicitudes de invoice o liquidaciones que coincidan con los filtros seleccionados.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveMainTab('commissions')}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-all shadow-md cursor-pointer"
                >
                  Ir a Comisiones por Póliza
                </button>
              </div>
            ) : (
              filteredInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="bg-white rounded-3xl border border-gray-200/80 p-6 hover:shadow-lg transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-6"
                >
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Folio y Agente */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black bg-[#1A2138] text-white px-2.5 py-1 rounded-lg">
                          {inv.folio}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          inv.status === 'paid' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                          inv.status === 'approved' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                          inv.status === 'rejected' ? 'bg-red-100 text-red-800 border border-red-200' :
                          'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}>
                          {inv.status === 'paid' ? 'Pagado' :
                           inv.status === 'approved' ? 'Aprobado para Pago' :
                           inv.status === 'rejected' ? 'Rechazado' : 'Solicitado'}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-gray-900">{inv.agentName}</h4>
                        <p className="text-xs text-gray-500">{inv.agentEmail}</p>
                        {inv.agentTaxId && (
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5">RFC: {inv.agentTaxId}</p>
                        )}
                      </div>

                      <p className="text-[10px] text-gray-400">
                        Fecha: {inv.createdAt?.toDate ? format(inv.createdAt.toDate(), 'dd/MM/yyyy HH:mm') : 'Reciente'}
                      </p>
                    </div>

                    {/* Importes y Pólizas */}
                    <div className="flex flex-col justify-center space-y-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        Total Comisión ({inv.policiesSummary?.length || 0} pólizas)
                      </span>
                      <p className="text-xl font-black text-indigo-900">
                        {formatUSD(inv.totalCommissionUSD)}
                      </p>
                      <p className="text-xs font-bold text-emerald-600">
                        ≈ {formatMXP(inv.totalCommissionMXP || (inv.totalCommissionUSD * (inv.exchangeRate || 1)))}
                        <span className="text-[10px] text-gray-400 ml-1 font-normal">(T.C. ${(inv.exchangeRate || 1).toFixed(2)})</span>
                      </p>
                      {inv.bankInfo?.bankName && (
                        <p className="text-[10px] text-gray-500">
                          Dispersión: {inv.bankInfo.bankName} {inv.bankInfo.clabe ? `(CLABE: ...${inv.bankInfo.clabe.slice(-4)})` : ''}
                        </p>
                      )}
                    </div>

                    {/* Documentos del Invoice (Soporta Ambos: Liquidación Oficial y Factura Fiscal del Agente) */}
                    <div className="flex flex-col justify-center space-y-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Documentos</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 1. Liquidación Oficial PDF emitida por la plataforma */}
                        <button
                          type="button"
                          onClick={() => generateCommissionInvoicePDF(inv, companySettings)}
                          className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-blue-200 transition-colors cursor-pointer"
                          title="Descargar Liquidación Oficial PDF con membrete institucional"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Liquidación PDF
                        </button>

                        {/* 2. Factura Fiscal Agente PDF */}
                        {inv.agentInvoicePdfUrl && (
                          <a
                            href={inv.agentInvoicePdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-emerald-200 transition-colors"
                            title="Ver Factura Fiscal del Agente"
                          >
                            <FileCheck className="w-3.5 h-3.5" />
                            Factura PDF
                          </a>
                        )}

                        {/* 3. CFDI XML */}
                        {inv.agentInvoiceXmlUrl && (
                          <a
                            href={inv.agentInvoiceXmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-purple-200 transition-colors"
                            title="Descargar CFDI XML del Agente"
                          >
                            <Download className="w-3.5 h-3.5" />
                            CFDI XML
                          </a>
                        )}

                        {/* 4. Comprobante Bancario de Pago */}
                        {inv.paymentReceiptUrl && (
                          <a
                            href={inv.paymentReceiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-gray-300 transition-colors"
                            title="Ver Comprobante de Pago Bancario"
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            Comprobante
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-3 pt-3 lg:pt-0 lg:border-l lg:border-gray-100 lg:pl-6 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoiceForDetail(inv)}
                      className="px-4 py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                      <span>Ver Detalle y Gestión</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <TransactionModal 
        isOpen={!!selectedInsuranceForTransactions}
        onClose={() => setSelectedInsuranceForTransactions(null)}
        insuranceId={selectedInsuranceForTransactions || undefined}
        title="Transacciones de la Póliza"
      />

      <InsuranceDetailModal 
        isOpen={!!selectedInsuranceForDetail}
        onClose={() => setSelectedInsuranceForDetail(null)}
        insurance={selectedInsuranceForDetail}
      />

      {/* Modal de Detalle de Pago */}
      {selectedCommission && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {selectedCommission.commissionStatus === 'paid' ? 'Detalle de Pago de Comisión' : 'Pagar comisión'}
                </h3>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500">Comisión para {selectedCommission.firstName} {selectedCommission.lastName}</p>
                    <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-mono">ID: {selectedCommission.id}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-medium mt-0.5">{selectedCommission.email}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedCommission(null)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-blue-50 p-4 rounded-2xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter opacity-70">Agente</span>
                  <span className="text-sm font-bold text-blue-900">{getAgentName(selectedCommission)}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter opacity-70">Precio del Seguro</span>
                  <span className="text-sm font-bold text-blue-900">${Number(selectedCommission.totalPrice !== undefined && selectedCommission.totalPrice !== null ? selectedCommission.totalPrice : (selectedCommission.totalFinal || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter opacity-70">Monto Comisión (Base)</span>
                  <span className="text-xl font-black text-blue-700">${(selectedCommission.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                </div>
              </div>

              {selectedCommission.commissionStatus === 'paid' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Fecha de Pago</p>
                      <p className="text-sm font-bold text-gray-900">{selectedCommission.commissionPaymentDate}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Forma de Pago</p>
                      <p className="text-sm font-bold text-gray-900">{selectedCommission.commissionPaymentMethod}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Monto Pagado</p>
                      <p className="text-sm font-bold text-gray-900">
                        {selectedCommission.commissionPaymentAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selectedCommission.commissionPaymentCurrency}
                      </p>
                      {selectedCommission.commissionPaymentCurrency === 'MXP' && (
                        <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                          Equiv. ${(selectedCommission.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                        </p>
                      )}
                    </div>
                    {selectedCommission.commissionPaymentCurrency === 'MXP' && (
                      <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Tipo de Cambio</p>
                        <p className="text-sm font-bold text-gray-900">{selectedCommission.commissionPaymentExchangeRate?.toFixed(2)}</p>
                      </div>
                    )}
                  </div>
                  
                  {selectedCommission.commissionPaymentReceipt && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-3">Comprobante de Pago</p>
                      <a 
                        href={selectedCommission.commissionPaymentReceipt} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                      >
                        <div className="p-2 bg-blue-50 group-hover:bg-blue-100 rounded-lg transition-colors">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-bold text-gray-900">Ver Comprobante</p>
                          <p className="text-[10px] text-gray-400">PDF / Imagen</p>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-blue-600" />
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Fecha de Pago</label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input 
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Moneda</label>
                      <div className="flex bg-gray-100 p-1 rounded-xl">
                        {(['USD', 'MXP'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setPaymentCurrency(m)}
                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                              paymentCurrency === m ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Monto a Pagar (USD)</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input 
                          type="number"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(Number(e.target.value))}
                          className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                      </div>
                    </div>

                    {paymentCurrency === 'MXP' && (
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Tipo de Cambio</label>
                        <input 
                          type="number"
                          step="0.01"
                          value={paymentExchangeRate}
                          onChange={(e) => setPaymentExchangeRate(Number(e.target.value))}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                      </div>
                    )}
                  </div>

                  {paymentCurrency === 'MXP' && (
                    <div className="bg-amber-50/90 p-4 rounded-2xl border border-amber-200/80 space-y-2 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs text-amber-900 font-medium">
                        <span>Comisión Base (USD):</span>
                        <span className="font-bold">${(selectedCommission.agentCommission || paymentAmount).toFixed(2)} USD</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-amber-900 font-medium">
                        <span>Tipo de Cambio:</span>
                        <span className="font-bold">{paymentExchangeRate.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm font-black text-amber-950 pt-2 border-t border-amber-200/70">
                        <span>Total Desglosado en MXP:</span>
                        <span className="text-base text-amber-700 font-extrabold">
                          ${((selectedCommission.agentCommission || paymentAmount) * paymentExchangeRate).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP
                        </span>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Forma de Pago</label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
                      >
                        <option value="Transferencia">Transferencia</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Cheque">Cheque</option>
                        <option value="Descuento comision">Descuento comisión</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Comprobante de Pago</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="file"
                        id="receipt-upload"
                        className="hidden"
                        onChange={handleFileUpload}
                        disabled={uploadingReceipt}
                      />
                      <label 
                        htmlFor="receipt-upload"
                        className={`flex-1 flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
                          receiptUrl ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-500'
                        }`}
                      >
                        {uploadingReceipt ? (
                          <div className="w-4 h-4 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
                        ) : receiptUrl ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        <span className="text-xs font-bold">
                          {uploadingReceipt ? 'Subiendo...' : receiptUrl ? 'Comprobante Cargado' : 'Subir Comprobante'}
                        </span>
                      </label>
                      {receiptUrl && (
                        <button 
                          onClick={() => setReceiptUrl('')}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button 
                onClick={() => setSelectedCommission(null)}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-200 transition-all cursor-pointer"
              >
                {selectedCommission.commissionStatus === 'paid' ? 'Cerrar' : 'Cancelar'}
              </button>
              {selectedCommission.commissionStatus === 'paid' && canDeleteCommissions && (
                <button
                  type="button"
                  onClick={() => {
                    setCommissionToDelete(selectedCommission);
                    setIsBulkDelete(false);
                    setShowDeleteModal(true);
                  }}
                  className="flex-1 py-3 px-4 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  Borrar Comisión Pagada
                </button>
              )}
              {selectedCommission.commissionStatus !== 'paid' && canDeleteCommissions && (
                <button 
                  onClick={handleMarkAsPaid}
                  disabled={saving || uploadingReceipt}
                  className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Confirmar Pago
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Pago Masivo */}
      {showBulkPaymentModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-[#1A2138] text-base uppercase tracking-wider">Pago Masivo de Comisiones</h3>
              <button 
                type="button"
                onClick={() => setShowBulkPaymentModal(false)}
                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Resumen del Lote */}
              <div className="bg-indigo-50 p-4 rounded-2xl flex items-center justify-between border border-indigo-100">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Comisiones a liquidar</span>
                  <span className="text-sm font-extrabold text-indigo-900">{selectedCommissionIds.length} registros</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Monto Total Estimado</span>
                  <span className="text-xl font-black text-indigo-700">
                    ${selectedCommissionIds.reduce((sum, id) => sum + (commissions.find(c => c.id === id)?.agentCommission || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Fecha de Pago</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      <input 
                        type="date"
                        value={bulkPaymentDate}
                        onChange={(e) => setBulkPaymentDate(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Moneda</label>
                    <div className="flex bg-gray-100 p-1 rounded-xl">
                      {(['USD', 'MXP'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setBulkPaymentCurrency(m)}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                            bulkPaymentCurrency === m ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {bulkPaymentCurrency === 'MXP' && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Tipo de Cambio</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={bulkPaymentExchangeRate}
                      onChange={(e) => setBulkPaymentExchangeRate(Number(e.target.value))}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                    />
                  </div>
                )}

                {bulkPaymentCurrency === 'MXP' && (
                  <div className="bg-amber-50/90 p-4 rounded-2xl border border-amber-200/80 space-y-2 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-xs text-amber-900 font-medium">
                      <span>Total Comisiones (USD):</span>
                      <span className="font-bold">
                        ${selectedCommissionIds.reduce((sum, id) => sum + (commissions.find(c => c.id === id)?.agentCommission || 0), 0).toFixed(2)} USD
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-amber-900 font-medium">
                      <span>Tipo de Cambio:</span>
                      <span className="font-bold">{bulkPaymentExchangeRate.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm font-black text-amber-950 pt-2 border-t border-amber-200/70">
                      <span>Total Desglosado en MXP:</span>
                      <span className="text-base text-amber-700 font-extrabold">
                        ${(selectedCommissionIds.reduce((sum, id) => sum + (commissions.find(c => c.id === id)?.agentCommission || 0), 0) * bulkPaymentExchangeRate).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP
                      </span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Forma de Pago</label>
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <select
                      value={bulkPaymentMethod}
                      onChange={(e) => setBulkPaymentMethod(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium appearance-none cursor-pointer"
                    >
                      <option value="Transferencia">Transferencia</option>
                      <option value="Efectivo">Efectivo</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Descuento comision">Descuento comisión</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Comprobante de Pago Masivo</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="file"
                      id="bulk-receipt-upload"
                      className="hidden"
                      onChange={handleBulkFileUpload}
                      disabled={uploadingBulkReceipt}
                    />
                    <label 
                      htmlFor="bulk-receipt-upload"
                      className={`flex-1 flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
                        bulkReceiptUrl ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-500'
                      }`}
                    >
                      {uploadingBulkReceipt ? (
                        <div className="w-4 h-4 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
                      ) : bulkReceiptUrl ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      <span className="text-xs font-bold">
                        {uploadingBulkReceipt ? 'Subiendo...' : bulkReceiptUrl ? 'Comprobante Cargado' : 'Subir Comprobante Lote'}
                      </span>
                    </label>
                    {bulkReceiptUrl && (
                      <button 
                        type="button"
                        onClick={() => setBulkReceiptUrl('')}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button 
                type="button"
                onClick={() => setShowBulkPaymentModal(false)}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-200 transition-all cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button 
                type="button"
                onClick={handleBulkMarkAsPaid}
                disabled={isPayingBulk || uploadingBulkReceipt}
                className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isPayingBulk && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Confirmar Pago Masivo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación para Borrar Comisiones Pagadas */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-red-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 text-red-600 rounded-xl">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {isBulkDelete ? 'Borrar Comisiones Pagadas' : 'Borrar Comisión Pagada'}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {isBulkDelete
                      ? `${selectedCommissionIds.filter(id => commissions.find(c => c.id === id)?.commissionStatus === 'paid').length} comisión(es) pagada(s) seleccionada(s)`
                      : `Asegurado: ${commissionToDelete?.firstName} ${commissionToDelete?.lastName}`
                    }
                  </p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowDeleteModal(false);
                  setCommissionToDelete(null);
                  setIsBulkDelete(false);
                }}
                disabled={isDeleting}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {!isBulkDelete && commissionToDelete && (
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-medium">Agente:</span>
                    <span className="font-bold text-gray-800">{getAgentName(commissionToDelete)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-medium">Póliza / Plan:</span>
                    <span className="font-bold text-gray-800">{commissionToDelete.policyName || commissionToDelete.policyId || 'S/N'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-medium">Monto Comisión:</span>
                    <span className="font-black text-blue-600">${(commissionToDelete.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200/60 pt-2 mt-2">
                    <span className="text-gray-400 font-medium">Pago registrado:</span>
                    <span className="font-bold text-emerald-700">
                      {commissionToDelete.commissionPaymentDate} ({commissionToDelete.commissionPaymentMethod})
                    </span>
                  </div>
                  {commissionToDelete.commissionPaymentReceipt && (
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-gray-400 font-medium">Comprobante:</span>
                      <a 
                        href={commissionToDelete.commissionPaymentReceipt} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                      >
                        <Eye className="w-3.5 h-3.5" /> Ver comprobante
                      </a>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-600 leading-relaxed">
                Selecciona la acción que deseas realizar con {isBulkDelete ? 'las comisiones pagadas seleccionadas' : 'esta comisión pagada'}:
              </p>

              {/* Action Option 1: Revert payment */}
              <div className="p-4 rounded-2xl border-2 border-amber-100 bg-amber-50/40 hover:bg-amber-50/80 transition-all space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-black text-amber-900 uppercase">Opción 1: Revertir Pago a 'Por Pagar'</span>
                  </div>
                </div>
                <p className="text-[11px] text-amber-800/80 leading-normal">
                  Elimina el registro de pago, comprobante y datos de liquidación. La comisión volverá al estado <strong>"Por Pagar"</strong> para que pueda liquidarse nuevamente.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleExecuteDeleteCommission('revert_to_pending')}
                    disabled={isDeleting}
                    className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isDeleting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    Revertir a 'Por Pagar'
                  </button>
                </div>
              </div>

              {/* Action Option 2: Completely remove */}
              <div className="p-4 rounded-2xl border-2 border-red-100 bg-red-50/40 hover:bg-red-50/80 transition-all space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-600" />
                    <span className="text-xs font-black text-red-900 uppercase">Opción 2: Eliminar Comisión por Completo</span>
                  </div>
                </div>
                <p className="text-[11px] text-red-800/80 leading-normal">
                  Elimina el pago y desvincula la comisión de este módulo (establece el estado en no confirmado).
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleExecuteDeleteCommission('remove_commission')}
                    disabled={isDeleting}
                    className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isDeleting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Eliminar Comisión Definitivamente
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setCommissionToDelete(null);
                  setIsBulkDelete(false);
                }}
                disabled={isDeleting}
                className="py-2 px-5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-200 transition-all cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Crear Invoice de Comisiones */}
      {showCreateInvoiceModal && (
        <CreateCommissionInvoiceModal
          selectedCommissions={commissions.filter(c => c.id && selectedCommissionIds.includes(c.id))}
          currentUserProfile={profile}
          exchangeRate={paymentExchangeRate || 20}
          companySettings={companySettings}
          onClose={() => setShowCreateInvoiceModal(false)}
          onSuccess={(newInvoice) => {
            setShowCreateInvoiceModal(false);
            setSelectedCommissionIds([]);
            setSelectedInvoiceForDetail(newInvoice);
            setActiveMainTab('invoices');
          }}
        />
      )}

      {/* Modal: Detalle de Invoice / Liquidación */}
      {selectedInvoiceForDetail && (
        <CommissionInvoiceDetailModal
          invoice={selectedInvoiceForDetail}
          currentUserProfile={profile}
          companySettings={companySettings}
          isAdminUser={isAdminUser}
          onClose={() => setSelectedInvoiceForDetail(null)}
          onInvoiceUpdated={(updated) => {
            setSelectedInvoiceForDetail(updated);
            setInvoices(prev => prev.map(inv => inv.id === updated.id ? updated : inv));
          }}
        />
      )}
    </div>
  );
}
