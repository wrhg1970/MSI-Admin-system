import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, where, getDocs, writeBatch, Timestamp, increment } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { StatementUpload, StatementRecord, Category, Subcategory, UserProfile, Payment, Client, Provider } from '../types';
import { Plus, Trash2, Edit2, Save, X, FileText, Upload, CheckCircle2, AlertCircle, ChevronRight, ChevronDown, Filter, Search, MoreVertical, CheckSquare, Square, ArrowRightLeft, History, DollarSign, Building2, User, ShieldCheck, RefreshCw, Receipt, Download, Tag, Layers } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { format } from 'date-fns';
import { formatDisplayDate } from '../lib/policyUtils';
import Papa from 'papaparse';

export const matchPaymentWithRecord = (
  record: { amount: number; date: string; description: string; receiptNumber?: string },
  paymentsList: Payment[],
  insurancesDict: Map<string, any>,
  targetCurrency: 'USD' | 'MXP',
  usedPaymentIds: Set<string>,
  currentRate: number
): { payment: Payment; receiptNumber: string } | null => {
  const desc = (record.description || '').toUpperCase();
  const recReceipt = (record.receiptNumber || '').trim().toUpperCase();
  const recDate = new Date(record.date.replace(/-/g, '/') + ' 12:00:00');
  const recTime = recDate.getTime();

  let bestMatch: Payment | null = null;
  let bestScore = 0;

  for (const p of paymentsList) {
    if (usedPaymentIds.has(p.id)) continue;

    const pCurr = p.currency || 'USD';
    const pRate = p.exchangeRate || currentRate || 17.55;

    let pAmountInStatementCurr = 0;
    if (targetCurrency === 'USD') {
      pAmountInStatementCurr = pCurr === 'USD' 
        ? (p.amount || 0) 
        : (p.amountMXP ? p.amountMXP / pRate : (p.amount || 0) / pRate);
    } else {
      pAmountInStatementCurr = pCurr === 'MXP'
        ? (p.amountMXP || p.amount || 0)
        : (p.amountMXP || (p.amount || 0) * pRate);
    }

    const amountDiff = Math.abs(pAmountInStatementCurr - record.amount);
    const rawAmountDiff = Math.abs((p.amount || 0) - record.amount);
    const rawMxpDiff = Math.abs((p.amountMXP || 0) - record.amount);
    const isAmountMatch = amountDiff < 0.15 || rawAmountDiff < 0.15 || rawMxpDiff < 0.50;

    const pDate = p.date instanceof Timestamp 
      ? p.date.toDate() 
      : (p.date ? new Date(p.date) : new Date(0));
    const dayDiff = Math.abs(recTime - pDate.getTime()) / (1000 * 60 * 60 * 24);

    const pRec = (p.receiptNumber || '').trim().toUpperCase();
    const ins = p.insuranceId ? insurancesDict.get(p.insuranceId) : null;
    const insRec = (ins?.receiptNumber || '').trim().toUpperCase();
    const polNum = (ins?.policyNumber || ins?.IDseg || '').trim().toUpperCase();
    const clientName = `${ins?.firstName || ''} ${ins?.lastName || ''}`.trim().toUpperCase();
    const pNotes = (p.notes || '').toUpperCase();

    // Direct receipt match from OCR or manual input
    const hasDirectReceiptMatch = recReceipt.length >= 3 && (recReceipt === pRec || recReceipt === insRec);

    // Matching receipt in bank statement description text
    const hasReceiptMatch = (pRec.length >= 3 && desc.includes(pRec)) || 
                            (insRec.length >= 3 && desc.includes(insRec)) ||
                            hasDirectReceiptMatch;

    // Matching policy ID or IDseg in bank statement description text
    const hasPolicyMatch = (polNum.length >= 3 && desc.includes(polNum));

    // Matching client name in bank statement description text
    const hasClientMatch = (clientName.length >= 5 && desc.includes(clientName));

    // Notes matching
    const hasNotesMatch = pNotes.length >= 5 && desc.includes(pNotes);

    // Penalize already reconciled payments so un-reconciled ones take priority
    const penaltyIfAlreadyReconciled = p.reconciledWithStatement ? 400 : 0;

    let score = 0;

    if (hasDirectReceiptMatch && isAmountMatch) {
      score = 6000 - (dayDiff * 2) - penaltyIfAlreadyReconciled;
    } else if (hasReceiptMatch && isAmountMatch) {
      score = 5000 - (dayDiff * 2) - penaltyIfAlreadyReconciled;
    } else if (hasPolicyMatch && isAmountMatch) {
      score = 4000 - (dayDiff * 3) - penaltyIfAlreadyReconciled;
    } else if (hasClientMatch && isAmountMatch) {
      score = 3000 - (dayDiff * 4) - penaltyIfAlreadyReconciled;
    } else if (hasReceiptMatch) {
      score = 2500 - (dayDiff * 10) - penaltyIfAlreadyReconciled;
    } else if (isAmountMatch && dayDiff <= 3) {
      score = 2000 - (dayDiff * 50) - penaltyIfAlreadyReconciled;
    } else if (isAmountMatch && dayDiff <= 8) {
      score = 1500 - (dayDiff * 30) - penaltyIfAlreadyReconciled;
    } else if (isAmountMatch && dayDiff <= 20) {
      score = 1000 - (dayDiff * 20) - penaltyIfAlreadyReconciled;
    } else if (isAmountMatch && dayDiff <= 35) {
      score = 600 - (dayDiff * 10) - penaltyIfAlreadyReconciled;
    }

    if (score > 300 && score > bestScore) {
      bestScore = score;
      bestMatch = p;
    }
  }

  if (bestMatch) {
    const ins = bestMatch.insuranceId ? insurancesDict.get(bestMatch.insuranceId) : null;
    const recNumber = (bestMatch.receiptNumber || '').trim() || 
                      (ins?.receiptNumber || '').trim() || 
                      (bestMatch.notes?.match(/Recibo:\s*([A-Za-z0-9-_#]+)/i)?.[1]?.trim()) ||
                      (ins?.policyNumber ? `POL-${ins.policyNumber}` : '') ||
                      `REC-${bestMatch.id.slice(0, 6).toUpperCase()}`;
    return { payment: bestMatch, receiptNumber: recNumber };
  }

  return null;
};

export default function StatementOCRManager({ profile, onReconcile, exchangeRate = 17.55 }: { profile: UserProfile | null; onReconcile?: (type: 'income' | 'expense') => void; exchangeRate?: number }) {
  const isSuperAdminOrDirector = profile?.role === 'super_admin' || profile?.role === 'director' || profile?.role === 'admin' || profile?.email === 'ventas@misegurointernacional.com' || profile?.email === 'wrhg1970@gmail.com';

  const [uploads, setUploads] = useState<StatementUpload[]>([]);
  const [records, setRecords] = useState<StatementRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'income' | 'expense'>('income');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [editingRecord, setEditingRecord] = useState<StatementRecord | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ record: StatementRecord; existing: Payment[] } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [sidebarCurrencyFilter, setSidebarCurrencyFilter] = useState<'ALL' | 'USD' | 'MXP'>('ALL');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [showQuickAddProvider, setShowQuickAddProvider] = useState(false);
  const [showQuickAddClient, setShowQuickAddClient] = useState(false);
  const [syncNotification, setSyncNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [syncingWithPayments, setSyncingWithPayments] = useState(false);
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [bulkCategoryData, setBulkCategoryData] = useState<{ categoryId: string; subcategoryId: string }>({ categoryId: '', subcategoryId: '' });
  const [quickProvider, setQuickProvider] = useState({
    legalName: '',
    commercialName: '',
    rfc: '',
    email: '',
    categoryId: ''
  });
  const [quickClient, setQuickClient] = useState({
    type: 'Individual' as 'Agent' | 'Corporate' | 'Individual',
    firstName: '',
    lastName: '',
    legalName: '',
    commercialName: '',
    rfc: '',
    email: '',
    phone: ''
  });
  
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'delete_upload' | 'delete_records' | 'reconcile_records';
    id?: string;
  }>({ isOpen: false, type: 'delete_upload' });

  useEffect(() => {
    const unsubUploads = onSnapshot(
      collection(db, 'statementUploads'), 
      (snap) => {
        const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StatementUpload));
        // Sort newest upload first in memory to prevent missing index errors
        items.sort((a, b) => {
          const dateA = a.uploadDate?.toMillis ? a.uploadDate.toMillis() : new Date(a.uploadDate || 0).getTime();
          const dateB = b.uploadDate?.toMillis ? b.uploadDate.toMillis() : new Date(b.uploadDate || 0).getTime();
          return dateB - dateA;
        });
        setUploads(items);
        setLoading(false);
        
        // Auto-select latest upload if none selected or if active upload was deleted
        setActiveUploadId(prev => {
          if (prev && items.some(u => u.id === prev)) return prev;
          return items.length > 0 ? items[0].id! : null;
        });
      },
      (err) => {
        console.error("Error fetching statementUploads:", err);
        setLoading(false);
      }
    );

    const unsubCats = onSnapshot(query(collection(db, 'categories'), orderBy('name', 'asc')), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });

    const unsubSubs = onSnapshot(query(collection(db, 'subcategories'), orderBy('name', 'asc')), (snap) => {
      setSubcategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subcategory)));
    });

    const unsubClients = onSnapshot(query(collection(db, 'clients'), orderBy('type', 'asc')), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });

    const unsubProviders = onSnapshot(query(collection(db, 'providers'), orderBy('commercialName', 'asc')), (snap) => {
      setProviders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Provider)));
    });

    return () => {
      unsubUploads();
      unsubCats();
      unsubSubs();
      unsubClients();
      unsubProviders();
    };
  }, []);

  useEffect(() => {
    if (!activeUploadId) {
      setRecords([]);
      return;
    }

    // Query by uploadId and sort in memory (avoids requiring Firestore composite index)
    const unsubRecords = onSnapshot(
      query(collection(db, 'statementRecords'), where('uploadId', '==', activeUploadId)),
      (snap) => {
        const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StatementRecord));
        items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        setRecords(items);
      },
      (err) => {
        console.error("Error fetching statementRecords:", err);
      }
    );

    return unsubRecords;
  }, [activeUploadId]);

  const filteredUploads = useMemo(() => {
    return uploads.filter(u => {
      const matchCurrency = sidebarCurrencyFilter === 'ALL' || (u.currency || 'USD') === sidebarCurrencyFilter;
      const matchSearch = !sidebarSearch.trim() || (u.fileName || '').toLowerCase().includes(sidebarSearch.toLowerCase());
      return matchCurrency && matchSearch;
    });
  }, [uploads, sidebarCurrencyFilter, sidebarSearch]);

  const stats = useMemo(() => {
    const incomes = records.filter(r => r.type === 'income');
    const expenses = records.filter(r => r.type === 'expense');
    const reconciledIncomes = incomes.filter(r => r.reconciled);
    const reconciledExpenses = expenses.filter(r => r.reconciled);

    return {
      income: { 
        count: incomes.length, 
        total: incomes.reduce((acc, r) => acc + r.amount, 0),
        reconciledCount: reconciledIncomes.length,
        reconciledTotal: reconciledIncomes.reduce((acc, r) => acc + r.amount, 0)
      },
      expense: { 
        count: expenses.length, 
        total: expenses.reduce((acc, r) => acc + r.amount, 0),
        reconciledCount: reconciledExpenses.length,
        reconciledTotal: reconciledExpenses.reduce((acc, r) => acc + r.amount, 0)
      }
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => r.type === subTab);
  }, [records, subTab]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setPendingFile(file);
    setShowCurrencyModal(true);
    // Reset input
    e.target.value = '';
  };

  const processFile = async (currency: 'USD' | 'MXP') => {
    if (!pendingFile || !profile) return;
    const file = pendingFile;
    setPendingFile(null);
    setShowCurrencyModal(false);

    setProcessing(true);
    try {
      // 1. Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });
      const base64Data = await base64Promise;

      // Infer mimeType if empty
      let detectedType = file.type;
      if (!detectedType) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'pdf') detectedType = 'application/pdf';
        else if (ext === 'jpg' || ext === 'jpeg') detectedType = 'image/jpeg';
        else if (ext === 'png') detectedType = 'image/png';
        else if (ext === 'webp') detectedType = 'image/webp';
        else detectedType = 'application/pdf';
      }

      // 2. Call server-side API endpoint for Gemini OCR parsing with automatic client retry on transient failures
      let data: any = null;
      let lastFetchErr: any = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch('/api/statement/parse-statement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileData: base64Data,
              fileName: file.name,
              fileType: detectedType,
              currency
            })
          });

          const resText = await res.text();
          
          if (!resText || resText.trim().startsWith("<") || resText.includes("<!DOCTYPE") || resText.includes("<html")) {
            throw new Error("El servicio de análisis está inicializando o procesando alta demanda. Reintentando...");
          }

          let parsedBody: any = {};
          try {
            parsedBody = JSON.parse(resText);
          } catch {
            if (!res.ok) {
              throw new Error(`Error de comunicación con el servidor (${res.status}).`);
            }
            throw new Error("El servidor devolvió una respuesta no estructurada. Por favor intenta nuevamente.");
          }

          if (!res.ok || parsedBody.error) {
            throw new Error(parsedBody.error || `Error del servidor (${res.status})`);
          }

          data = parsedBody;
          break; // Success
        } catch (err: any) {
          lastFetchErr = err;
          const errMessage = String(err?.message || err);
          // If server reported high demand, proxy refresh, or transient network error, wait briefly and retry once
          if (attempt === 0) {
            console.log("Reintentando procesamiento de estado de cuenta en 2s...", errMessage);
            await new Promise(r => setTimeout(r, 2000));
          } else {
            break;
          }
        }
      }

      if (!data) {
        throw lastFetchErr || new Error("No se pudo procesar el estado de cuenta. Por favor intenta de nuevo en unos instantes.");
      }

      const parsedRecords = data.records || [];

      if (!parsedRecords || parsedRecords.length === 0) {
        alert("No se pudieron detectar movimientos en el estado de cuenta. Por favor verifica que el archivo sea un documento bancario legible.");
        return;
      }
      
      // 3. Calculate totals
      const totalIncomes = parsedRecords.reduce((acc: number, r: any) => r.type === 'income' ? acc + (Number(r.amount) || 0) : acc, 0);
      const totalExpenses = parsedRecords.reduce((acc: number, r: any) => r.type === 'expense' ? acc + (Number(r.amount) || 0) : acc, 0);

      // 4. Fetch existing payments and insurances to auto-reconcile with incomes and extract receipt numbers
      const [paymentsSnap, insurancesSnap] = await Promise.all([
        getDocs(query(collection(db, 'payments'), where('type', '==', 'client_payment'))),
        getDocs(collection(db, 'insurances'))
      ]);

      const existingPayments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
      const insurancesDict = new Map<string, any>();
      insurancesSnap.docs.forEach(d => {
        insurancesDict.set(d.id, { id: d.id, ...d.data() });
      });

      const usedPaymentIds = new Set<string>();
      let autoMatchedIncomesCount = 0;
      let autoMatchedIncomesTotal = 0;

      // 5. Create Upload record in Firestore (Stored permanently)
      const uploadRef = await addDoc(collection(db, 'statementUploads'), {
        fileName: file.name,
        uploadDate: serverTimestamp(),
        totalIncomes,
        totalExpenses,
        reconciledIncomes: 0,
        reconciledExpenses: 0,
        currency,
        status: 'processed',
        userId: profile.uid,
        userName: profile.displayName || profile.email || 'Admin',
        createdAt: serverTimestamp()
      });

      // 6. Create individual records in batch in Firestore and link existing payments without duplicating
      const batch = writeBatch(db);
      parsedRecords.forEach((r: any) => {
        const recordRef = doc(collection(db, 'statementRecords'));
        const isIncome = r.type === 'income';
        const numAmount = Math.abs(Number(r.amount) || 0);

        let isMatched = false;
        let matchedReceiptNumber = (r.receiptNumber || '').trim();
        let matchedPayment: Payment | null = null;
        let matchedInsurance: any = null;

        if (isIncome) {
          const matchResult = matchPaymentWithRecord(
            { amount: numAmount, date: r.date, description: r.description, receiptNumber: matchedReceiptNumber },
            existingPayments,
            insurancesDict,
            currency,
            usedPaymentIds,
            exchangeRate
          );

          if (matchResult) {
            isMatched = true;
            matchedPayment = matchResult.payment;
            matchedReceiptNumber = matchResult.receiptNumber;
            usedPaymentIds.add(matchedPayment.id);
            autoMatchedIncomesCount++;
            autoMatchedIncomesTotal += numAmount;

            if (matchedPayment.insuranceId) {
              matchedInsurance = insurancesDict.get(matchedPayment.insuranceId);
            }

            // Update existing payment: mark as reconciled with statement WITHOUT creating duplicate payment
            const payUpdateData: any = {
              reconciledWithStatement: true,
              statementUploadId: uploadRef.id,
              statementRecordId: recordRef.id
            };
            if (!matchedPayment.receiptNumber && matchedReceiptNumber) {
              payUpdateData.receiptNumber = matchedReceiptNumber;
            }
            batch.update(doc(db, 'payments', matchedPayment.id), payUpdateData);
          }
        }

        const recordData: any = {
          uploadId: uploadRef.id,
          date: r.date || new Date().toISOString().split('T')[0],
          description: r.description || 'Movimiento Bancario',
          amount: numAmount,
          type: isIncome ? 'income' : 'expense',
          currency,
          reconciled: isMatched,
          reconciledAt: isMatched ? serverTimestamp() : null,
          receiptNumber: matchedReceiptNumber || '',
          matchedPaymentId: matchedPayment ? matchedPayment.id : null,
          matchedInsuranceId: matchedPayment?.insuranceId || null,
          reconciledType: isMatched ? 'auto_matched' : null,
          clientId: matchedPayment?.clientId || matchedInsurance?.clientId || null,
          categoryId: matchedPayment?.categoryId || null,
          subcategoryId: matchedPayment?.subcategoryId || null,
          createdAt: serverTimestamp()
        };

        batch.set(recordRef, recordData);
      });

      // Update upload totals with initial auto-reconciled count
      batch.update(uploadRef, {
        reconciledIncomes: autoMatchedIncomesTotal,
        status: (autoMatchedIncomesTotal >= totalIncomes && totalExpenses === 0 && totalIncomes > 0) ? 'reconciled' : 'processed'
      });

      await batch.commit();

      setActiveUploadId(uploadRef.id);

      if (autoMatchedIncomesCount > 0) {
        setSyncNotification({
          type: 'success',
          message: `¡Estado de Cuenta procesado! Se detectaron ${parsedRecords.length} movimientos. Se conciliaron automáticamente ${autoMatchedIncomesCount} ingresos vinculando su número de recibo sin duplicar pagos.`
        });
      } else {
        setSyncNotification({
          type: 'info',
          message: `¡Estado de Cuenta procesado! Se detectaron ${parsedRecords.length} movimientos listos para revisión y conciliación.`
        });
      }
    } catch (error: any) {
      console.error("OCR Error:", error);
      alert(`Error al procesar el estado de cuenta: ${error.message || 'Error inesperado'}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedRecords(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const allFilteredIds = filteredRecords.map(r => r.id!);
    if (selectedRecords.length === allFilteredIds.length && allFilteredIds.length > 0) {
      setSelectedRecords([]);
    } else {
      setSelectedRecords(allFilteredIds);
    }
  };

  const handleExportView = (mode: 'selected' | 'filtered' | 'all' = 'filtered') => {
    let listToExport: StatementRecord[] = [];
    if (mode === 'selected') {
      listToExport = records.filter(r => selectedRecords.includes(r.id!));
    } else if (mode === 'all') {
      listToExport = records;
    } else {
      listToExport = selectedRecords.length > 0 
        ? records.filter(r => selectedRecords.includes(r.id!)) 
        : filteredRecords;
    }

    if (listToExport.length === 0) {
      alert("No hay registros disponibles para exportar con los filtros seleccionados.");
      return;
    }

    const currentUpload = uploads.find(u => u.id === activeUploadId);

    const rows = listToExport.map(r => {
      const cat = categories.find(c => c.id === r.categoryId);
      const sub = subcategories.find(s => s.id === r.subcategoryId);
      const isUSD = (r.currency || currentUpload?.currency || 'USD') === 'USD';
      const tc = r.exchangeRate || exchangeRate || 17.55;
      const amountUSD = isUSD ? r.amount : (r.amount / tc);
      const amountMXP = isUSD ? (r.amount * tc) : r.amount;

      const client = clients.find(c => c.id === r.clientId);
      const provider = providers.find(p => p.id === r.providerId);
      const entityName = client 
        ? (client.type === 'Individual' ? `${client.firstName} ${client.lastName}` : (client.commercialName || client.legalName)) 
        : (provider ? (provider.commercialName || provider.legalName) : '');

      return {
        'Fecha': r.date || '',
        'Tipo': r.type === 'income' ? 'Ingreso' : 'Egreso',
        'Descripción': r.description || '',
        'No. Recibo': r.receiptNumber ? r.receiptNumber : 'Sin Recibo',
        'Categoría': cat ? cat.name : 'Sin categoría',
        'Subcategoría': sub ? sub.name : 'Sin subcategoría',
        'Cliente / Proveedor': entityName || 'N/A',
        'Monto Original': r.amount,
        'Moneda': r.currency || currentUpload?.currency || 'USD',
        'Monto USD': Number(amountUSD.toFixed(2)),
        'Monto MXP': Number(amountMXP.toFixed(2)),
        'Tipo de Cambio': tc,
        'Estado': r.reconciled ? 'Conciliado' : 'Pendiente',
        'Método Conciliación': r.reconciledType === 'auto_matched' 
          ? 'Auto-conciliado con Ingreso' 
          : (r.reconciled ? 'Conciliado Manual' : 'Pendiente'),
        'ID Pago Vinculado': r.matchedPaymentId || 'N/A',
        'Archivo': currentUpload?.fileName || 'Estado_de_Cuenta'
      };
    });

    const csvContent = Papa.unparse(rows);
    // Add UTF-8 BOM so Excel opens Spanish accents (ñ, tildes) correctly
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeFileName = (currentUpload?.fileName || 'estado_cuenta').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    link.href = url;
    const fileSuffix = mode === 'all' 
      ? 'completo_ingresos_y_egresos' 
      : (selectedRecords.length > 0 ? `seleccionados_${listToExport.length}` : subTab);
    link.download = `conciliacion_${safeFileName}_${fileSuffix}_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyBulkCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRecords.length === 0 || !bulkCategoryData.categoryId) return;

    setProcessing(true);
    try {
      // Chunk operations to respect Firestore's 500-op batch limit
      const CHUNK_SIZE = 200;
      for (let i = 0; i < selectedRecords.length; i += CHUNK_SIZE) {
        const chunk = selectedRecords.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        
        for (const id of chunk) {
          const record = records.find(r => r.id === id);
          batch.update(doc(db, 'statementRecords', id), {
            categoryId: bulkCategoryData.categoryId || null,
            subcategoryId: bulkCategoryData.subcategoryId || null
          });

          // Even if already reconciled, synchronize category to the matched payment!
          if (record?.matchedPaymentId) {
            batch.update(doc(db, 'payments', record.matchedPaymentId), {
              categoryId: bulkCategoryData.categoryId || null,
              subcategoryId: bulkCategoryData.subcategoryId || null
            });
          }
        }

        await batch.commit();
      }

      const count = selectedRecords.length;
      setShowBulkCategoryModal(false);
      setSelectedRecords([]);
      setBulkCategoryData({ categoryId: '', subcategoryId: '' });
      setSyncNotification({
        type: 'success',
        message: `¡Se actualizaron la categoría y subcategoría de ${count} movimiento(s) (incluyendo los ya conciliados) con éxito!`
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'statementRecords');
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRecords.length === 0) return;
    
    try {
      const batch = writeBatch(db);
      selectedRecords.forEach(id => {
        batch.delete(doc(db, 'statementRecords', id));
      });
      await batch.commit();
      setSelectedRecords([]);
      setConfirmModal({ isOpen: false, type: 'delete_records' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'statementRecords');
    }
  };

  const handleSyncWithExistingPayments = async () => {
    if (!activeUploadId || processing || syncingWithPayments) return;
    setSyncingWithPayments(true);
    try {
      const unreconciledIncomes = records.filter(r => r.type === 'income' && !r.reconciled);
      if (unreconciledIncomes.length === 0) {
        alert("Todos los ingresos de este estado de cuenta ya se encuentran conciliados.");
        return;
      }

      const [paymentsSnap, insurancesSnap] = await Promise.all([
        getDocs(query(collection(db, 'payments'), where('type', '==', 'client_payment'))),
        getDocs(collection(db, 'insurances'))
      ]);

      const existingPayments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
      const insurancesDict = new Map<string, any>();
      insurancesSnap.docs.forEach(d => {
        insurancesDict.set(d.id, { id: d.id, ...d.data() });
      });

      const currentUpload = uploads.find(u => u.id === activeUploadId);
      const curr = currentUpload?.currency || 'USD';
      const usedPaymentIds = new Set<string>();

      records.forEach(r => {
        if (r.matchedPaymentId) usedPaymentIds.add(r.matchedPaymentId);
      });

      const batch = writeBatch(db);
      let matchedCount = 0;
      let matchedAmount = 0;

      for (const rec of unreconciledIncomes) {
        const match = matchPaymentWithRecord(
          { amount: rec.amount, date: rec.date, description: rec.description, receiptNumber: rec.receiptNumber },
          existingPayments,
          insurancesDict,
          curr,
          usedPaymentIds,
          exchangeRate
        );

        if (match) {
          matchedCount++;
          matchedAmount += rec.amount;
          usedPaymentIds.add(match.payment.id);

          batch.update(doc(db, 'statementRecords', rec.id!), {
            reconciled: true,
            reconciledAt: serverTimestamp(),
            receiptNumber: match.receiptNumber,
            matchedPaymentId: match.payment.id,
            matchedInsuranceId: match.payment.insuranceId || null,
            reconciledType: 'auto_matched'
          });

          batch.update(doc(db, 'payments', match.payment.id), {
            reconciledWithStatement: true,
            statementUploadId: activeUploadId,
            statementRecordId: rec.id!,
            ...(match.payment.receiptNumber ? {} : { receiptNumber: match.receiptNumber })
          });
        }
      }

      if (matchedCount > 0) {
        batch.update(doc(db, 'statementUploads', activeUploadId), {
          reconciledIncomes: increment(matchedAmount)
        });
        await batch.commit();
        setSyncNotification({
          type: 'success',
          message: `¡Se conciliaron ${matchedCount} ingresos vinculando su número de recibo correspondiente sin duplicar!`
        });
      } else {
        alert("No se encontraron ingresos existentes adicionales que coincidan con los registros pendientes.");
      }
    } catch (err: any) {
      console.error("Error sincronizando ingresos:", err);
      alert(`Error al sincronizar ingresos: ${err.message || 'Error inesperado'}`);
    } finally {
      setSyncingWithPayments(false);
    }
  };

  const handleUseExistingPayment = async (record: StatementRecord, existingPayment: Payment) => {
    try {
      const batch = writeBatch(db);
      const insurancesSnap = await getDocs(collection(db, 'insurances'));
      const insurancesDict = new Map<string, any>();
      insurancesSnap.docs.forEach(d => insurancesDict.set(d.id, { id: d.id, ...d.data() }));
      const ins = existingPayment.insuranceId ? insurancesDict.get(existingPayment.insuranceId) : null;

      const recNumber = (existingPayment.receiptNumber || '').trim() ||
                        record.receiptNumber?.trim() ||
                        (ins?.receiptNumber || '').trim() ||
                        (existingPayment.notes?.match(/Recibo:\s*([A-Za-z0-9-_#]+)/i)?.[1]?.trim()) ||
                        `REC-${existingPayment.id.slice(0, 6).toUpperCase()}`;

      // Update statement record with receipt number and matched payment ID
      batch.update(doc(db, 'statementRecords', record.id!), {
        reconciled: true,
        reconciledAt: serverTimestamp(),
        receiptNumber: recNumber,
        matchedPaymentId: existingPayment.id,
        matchedInsuranceId: existingPayment.insuranceId || null,
        reconciledType: 'manual'
      });

      // Update existing payment: mark as reconciled with statement WITHOUT creating duplicate payment
      batch.update(doc(db, 'payments', existingPayment.id), {
        reconciledWithStatement: true,
        statementUploadId: record.uploadId,
        statementRecordId: record.id!,
        ...(existingPayment.receiptNumber ? {} : { receiptNumber: recNumber })
      });

      // Update upload totals
      batch.update(doc(db, 'statementUploads', record.uploadId), {
        reconciledIncomes: increment(record.amount)
      });

      await batch.commit();
      setDuplicateWarning(null);
      setSyncNotification({
        type: 'success',
        message: `Registro conciliado con el ingreso existente (Recibo: ${recNumber}) sin duplicar.`
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'statementRecords');
    }
  };

  const checkDuplicates = async (record: StatementRecord) => {
    const upload = uploads.find(u => u.id === record.uploadId);
    const recCurrency = record.currency || upload?.currency || 'USD';
    const q = query(
      collection(db, 'payments'),
      where('type', '==', record.type === 'income' ? 'client_payment' : 'provider_payment')
    );
    const snap = await getDocs(q);
    const existing = snap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
    
    const recordDate = new Date(record.date.replace(/-/g, '/') + ' 12:00:00');
    const duplicates = existing.filter(p => {
      const pCurrency = p.currency || 'USD';
      const pRate = p.exchangeRate || exchangeRate || 17.55;
      
      let pAmountInRecordCurr = 0;
      if (recCurrency === 'USD') {
        pAmountInRecordCurr = pCurrency === 'USD' ? (p.amount || 0) : (p.amountMXP ? p.amountMXP / pRate : (p.amount || 0) / pRate);
      } else {
        pAmountInRecordCurr = pCurrency === 'MXP' ? (p.amountMXP || p.amount || 0) : ((p.amount || 0) * pRate);
      }

      const isAmountClose = Math.abs(pAmountInRecordCurr - record.amount) < 0.20 || Math.abs((p.amount || 0) - record.amount) < 0.20;
      
      const pRec = (p.receiptNumber || '').trim().toUpperCase();
      const recRec = (record.receiptNumber || '').trim().toUpperCase();
      const hasReceiptMatch = recRec.length >= 3 && pRec === recRec;

      if (hasReceiptMatch) return true;
      if (!isAmountClose) return false;

      const pDate = p.date instanceof Timestamp ? p.date.toDate() : new Date(p.date || 0);
      const diff = Math.abs(pDate.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 15;
    });

    return duplicates;
  };

  const reconcileRecord = async (record: StatementRecord, skipDuplicateCheck = false, batch?: any) => {
    if (!profile) return;
    
    // If it's already reconciled or matched to a payment, do not re-create!
    if (record.reconciled && record.matchedPaymentId) {
      return;
    }

    // If it's a client income or provider expense but no entity is selected, open edit modal
    if ((record.isClientIncome && !record.clientId) || (record.isProviderExpense && !record.providerId)) {
      setEditingRecord(record);
      return;
    }

    if (!skipDuplicateCheck) {
      const duplicates = await checkDuplicates(record);
      if (duplicates.length > 0) {
        setDuplicateWarning({ record, existing: duplicates });
        return;
      }
    }

    try {
      const activeBatch = batch || writeBatch(db);
      const upload = uploads.find(u => u.id === record.uploadId);
      const currency = record.currency || upload?.currency || 'USD';
      
      // Before creating a new payment for incomes, double-check if an unreconciled payment exists to link without duplicating
      if (record.type === 'income') {
        const q = query(
          collection(db, 'payments'),
          where('type', '==', 'client_payment')
        );
        const paymentsSnap = await getDocs(q);
        const allPayments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
        const insurancesSnap = await getDocs(collection(db, 'insurances'));
        const insurancesDict = new Map<string, any>();
        insurancesSnap.docs.forEach(d => insurancesDict.set(d.id, { id: d.id, ...d.data() }));

        const usedPaymentIds = new Set<string>();
        records.forEach(r => {
          if (r.matchedPaymentId && r.id !== record.id) usedPaymentIds.add(r.matchedPaymentId);
        });

        const match = matchPaymentWithRecord(
          { amount: record.amount, date: record.date, description: record.description, receiptNumber: record.receiptNumber },
          allPayments,
          insurancesDict,
          currency,
          usedPaymentIds,
          exchangeRate
        );

        if (match) {
          // Link with existing payment - DO NOT DUPLICATE!
          activeBatch.update(doc(db, 'statementRecords', record.id!), {
            reconciled: true,
            reconciledAt: serverTimestamp(),
            receiptNumber: match.receiptNumber,
            matchedPaymentId: match.payment.id,
            matchedInsuranceId: match.payment.insuranceId || null,
            reconciledType: 'manual'
          });

          activeBatch.update(doc(db, 'payments', match.payment.id), {
            reconciledWithStatement: true,
            statementUploadId: record.uploadId,
            statementRecordId: record.id!,
            ...(match.payment.receiptNumber ? {} : { receiptNumber: match.receiptNumber })
          });

          const uploadDocRef = doc(db, 'statementUploads', record.uploadId);
          activeBatch.update(uploadDocRef, {
            reconciledIncomes: increment(record.amount)
          });

          if (!batch) {
            await activeBatch.commit();
            setSyncNotification({
              type: 'success',
              message: `Registro conciliado con el ingreso existente (Recibo: ${match.receiptNumber}) sin duplicar.`
            });
            if (onReconcile) onReconcile(record.type);
          }
          return;
        }
      }

      // If no matching existing payment found, create a new Payment
      const paymentRef = doc(collection(db, 'payments'));
      const paymentDate = new Date(record.date.replace(/-/g, '/') + ' 12:00:00');
      const generatedReceiptNumber = record.receiptNumber?.trim() || `REC-${Math.floor(1000 + Math.random() * 9000)}`;

      const paymentData: any = {
        currency: currency,
        type: record.isClientIncome ? 'client_payment' : (record.isProviderExpense ? 'provider_payment' : (record.type === 'income' ? 'client_payment' : 'provider_payment')),
        status: 'completed',
        date: Timestamp.fromDate(paymentDate),
        notes: `Conciliado de: ${record.description}`,
        insuranceId: 'conciliacion_bancaria',
        receiptNumber: generatedReceiptNumber,
        reconciledWithStatement: true,
        statementUploadId: record.uploadId,
        statementRecordId: record.id!,
        clientId: (record.isClientIncome && record.clientId) ? record.clientId : null,
        providerId: (record.isProviderExpense && record.providerId) ? record.providerId : null,
        providerName: (record.isProviderExpense && record.providerId) ? (providers.find(p => p.id === record.providerId)?.commercialName || null) : null,
        categoryId: record.categoryId || null,
        subcategoryId: record.subcategoryId || null,
        createdAt: serverTimestamp(),
        exchangeRate: record.exchangeRate || exchangeRate
      };

      if (currency === 'USD') {
        paymentData.amount = record.amount;
        paymentData.amountMXP = record.amount * (record.exchangeRate || exchangeRate);
      } else {
        paymentData.amountMXP = record.amount;
        paymentData.amount = record.amount / (record.exchangeRate || exchangeRate);
      }

      activeBatch.set(paymentRef, paymentData);

      // 2. Mark record as reconciled and save receipt number
      activeBatch.update(doc(db, 'statementRecords', record.id!), {
        reconciled: true,
        reconciledAt: serverTimestamp(),
        receiptNumber: generatedReceiptNumber,
        matchedPaymentId: paymentRef.id,
        reconciledType: 'manual'
      });

      // 3. Update upload totals
      const uploadDocRef = doc(db, 'statementUploads', record.uploadId);
      activeBatch.update(uploadDocRef, {
        reconciledIncomes: increment(record.type === 'income' ? record.amount : 0),
        reconciledExpenses: increment(record.type === 'expense' ? record.amount : 0)
      });

      if (!batch) {
        await activeBatch.commit();
        if (onReconcile) {
          onReconcile(record.type);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payments');
    }
  };

  const handleBulkReconcile = async () => {
    if (selectedRecords.length === 0) return;
    
    try {
      const batch = writeBatch(db);
      const types: ('income' | 'expense')[] = [];

      // Query existing payments and insurances to link rather than duplicate
      const [paymentsSnap, insurancesSnap] = await Promise.all([
        getDocs(query(collection(db, 'payments'), where('type', '==', 'client_payment'))),
        getDocs(collection(db, 'insurances'))
      ]);
      const existingPayments = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
      const insurancesDict = new Map<string, any>();
      insurancesSnap.docs.forEach(d => insurancesDict.set(d.id, { id: d.id, ...d.data() }));

      const currentUpload = uploads.find(u => u.id === activeUploadId);
      const currency = currentUpload?.currency || 'USD';
      const usedPaymentIds = new Set<string>();

      records.forEach(r => {
        if (r.matchedPaymentId && !selectedRecords.includes(r.id!)) {
          usedPaymentIds.add(r.matchedPaymentId);
        }
      });

      let newlyReconciledIncomesTotal = 0;
      let newlyReconciledExpensesTotal = 0;
      
      for (const id of selectedRecords) {
        const record = records.find(r => r.id === id);
        if (!record || record.reconciled) continue;

        if (record.type === 'income') {
          const match = matchPaymentWithRecord(
            { amount: record.amount, date: record.date, description: record.description, receiptNumber: record.receiptNumber },
            existingPayments,
            insurancesDict,
            currency,
            usedPaymentIds,
            exchangeRate
          );

          if (match) {
            // LINK TO EXISTING PAYMENT - DO NOT DUPLICATE!
            usedPaymentIds.add(match.payment.id);
            batch.update(doc(db, 'statementRecords', record.id!), {
              reconciled: true,
              reconciledAt: serverTimestamp(),
              receiptNumber: match.receiptNumber,
              matchedPaymentId: match.payment.id,
              matchedInsuranceId: match.payment.insuranceId || null,
              reconciledType: 'manual'
            });

            batch.update(doc(db, 'payments', match.payment.id), {
              reconciledWithStatement: true,
              statementUploadId: record.uploadId,
              statementRecordId: record.id!,
              ...(match.payment.receiptNumber ? {} : { receiptNumber: match.receiptNumber })
            });

            newlyReconciledIncomesTotal += record.amount;
            types.push('income');
            continue;
          }
        }

        // If no match found or it's an expense, create new payment
        const paymentRef = doc(collection(db, 'payments'));
        const paymentDate = new Date(record.date.replace(/-/g, '/') + ' 12:00:00');
        const generatedRecNumber = record.receiptNumber?.trim() || `REC-${Math.floor(1000 + Math.random() * 9000)}`;

        const paymentData: any = {
          currency: currency,
          type: record.isClientIncome ? 'client_payment' : (record.isProviderExpense ? 'provider_payment' : (record.type === 'income' ? 'client_payment' : 'provider_payment')),
          status: 'completed',
          date: Timestamp.fromDate(paymentDate),
          notes: `Conciliado de: ${record.description}`,
          insuranceId: 'conciliacion_bancaria',
          receiptNumber: generatedRecNumber,
          reconciledWithStatement: true,
          statementUploadId: record.uploadId,
          statementRecordId: record.id!,
          clientId: (record.isClientIncome && record.clientId) ? record.clientId : null,
          providerId: (record.isProviderExpense && record.providerId) ? record.providerId : null,
          providerName: (record.isProviderExpense && record.providerId) ? (providers.find(p => p.id === record.providerId)?.commercialName || null) : null,
          categoryId: record.categoryId || null,
          subcategoryId: record.subcategoryId || null,
          createdAt: serverTimestamp(),
          exchangeRate: record.exchangeRate || exchangeRate
        };

        if (currency === 'USD') {
          paymentData.amount = record.amount;
          paymentData.amountMXP = record.amount * (record.exchangeRate || exchangeRate);
        } else {
          paymentData.amountMXP = record.amount;
          paymentData.amount = record.amount / (record.exchangeRate || exchangeRate);
        }

        batch.set(paymentRef, paymentData);

        batch.update(doc(db, 'statementRecords', record.id!), {
          reconciled: true,
          reconciledAt: serverTimestamp(),
          receiptNumber: generatedRecNumber,
          matchedPaymentId: paymentRef.id,
          reconciledType: 'manual'
        });

        if (record.type === 'income') {
          newlyReconciledIncomesTotal += record.amount;
        } else {
          newlyReconciledExpensesTotal += record.amount;
        }
        types.push(record.type);
      }

      if (newlyReconciledIncomesTotal > 0 || newlyReconciledExpensesTotal > 0) {
        batch.update(doc(db, 'statementUploads', activeUploadId!), {
          reconciledIncomes: increment(newlyReconciledIncomesTotal),
          reconciledExpenses: increment(newlyReconciledExpensesTotal)
        });
      }
      
      await batch.commit();
      
      const uniqueTypes = Array.from(new Set(types));
      
      setSelectedRecords([]);
      setConfirmModal({ isOpen: false, type: 'reconcile_records' });
      setSyncNotification({
        type: 'success',
        message: `¡Se conciliaron ${selectedRecords.length} registros exitosamente sin duplicar ingresos existentes!`
      });

      if (onReconcile && uniqueTypes.length > 0) {
        onReconcile(uniqueTypes[0]);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payments');
    }
  };

  const handleUpdateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;

    try {
      const { id, ...data } = editingRecord;
      const batch = writeBatch(db);
      batch.update(doc(db, 'statementRecords', id!), data);

      // If linked to an existing payment, keep payment category and receipt in sync!
      if (editingRecord.matchedPaymentId) {
        const payUpdate: any = {};
        if (data.categoryId !== undefined) payUpdate.categoryId = data.categoryId || null;
        if (data.subcategoryId !== undefined) payUpdate.subcategoryId = data.subcategoryId || null;
        if (data.receiptNumber !== undefined) payUpdate.receiptNumber = data.receiptNumber || '';
        if (Object.keys(payUpdate).length > 0) {
          batch.update(doc(db, 'payments', editingRecord.matchedPaymentId), payUpdate);
        }
      }

      await batch.commit();
      setEditingRecord(null);
      setSyncNotification({
        type: 'success',
        message: '¡Registro actualizado y sincronizado con éxito!'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'statementRecords');
    }
  };

  const handleQuickAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    try {
      const docRef = await addDoc(collection(db, 'providers'), {
        ...quickProvider,
        address: '',
        city: '',
        state: '',
        zip: '',
        country: 'México',
        mainContact: '',
        phone: '',
        subcategoryId: '',
        createdAt: serverTimestamp()
      });

      if (editingRecord) {
        setEditingRecord({ ...editingRecord, providerId: docRef.id });
      }
      setShowQuickAddProvider(false);
      setQuickProvider({
        legalName: '',
        commercialName: '',
        rfc: '',
        email: '',
        categoryId: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'providers');
    }
  };

  const handleQuickAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    try {
      const docRef = await addDoc(collection(db, 'clients'), {
        ...quickClient,
        address: '',
        city: '',
        state: '',
        zip: '',
        country: 'México',
        createdAt: serverTimestamp()
      });

      if (editingRecord) {
        setEditingRecord({ ...editingRecord, clientId: docRef.id });
      }
      setShowQuickAddClient(false);
      setQuickClient({
        type: 'Individual',
        firstName: '',
        lastName: '',
        legalName: '',
        commercialName: '',
        rfc: '',
        email: '',
        phone: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'clients');
    }
  };

  const handleDeleteUpload = async (id: string) => {
    if (!isSuperAdminOrDirector) {
      alert("Acceso denegado: Solo el Administrador o Director puede eliminar estados de cuenta.");
      return;
    }
    try {
      const batch = writeBatch(db);
      // Delete all records first
      const recordsSnap = await getDocs(query(collection(db, 'statementRecords'), where('uploadId', '==', id)));
      recordsSnap.forEach(d => batch.delete(d.ref));
      // Delete upload
      batch.delete(doc(db, 'statementUploads', id));
      await batch.commit();
      if (activeUploadId === id) setActiveUploadId(null);
      setConfirmModal({ isOpen: false, type: 'delete_upload' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'statementUploads');
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando sistema de conciliación...</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Sidebar: History */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              Historial
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-100">
              {uploads.length} {uploads.length === 1 ? 'archivo' : 'archivos'}
            </span>
          </div>
          
          <label className="block w-full">
            <div className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${processing ? 'bg-gray-50 border-gray-200' : 'border-blue-200 hover:border-blue-400 hover:bg-blue-50'}`}>
              {processing ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-bold text-gray-600">Procesando y guardando OCR con IA...</span>
                  <span className="text-[10px] text-gray-400">Extrayendo todas las transacciones</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-6 h-6 text-blue-600" />
                  <span className="text-xs font-bold text-gray-600">Cargar Estado de Cuenta</span>
                  <span className="text-[10px] text-gray-400">PDF o Imagen (USD / MXP)</span>
                </div>
              )}
              <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={processing} />
            </div>
          </label>

          {/* Filter & Search in Sidebar */}
          <div className="mt-4 space-y-2">
            <div className="flex bg-gray-100 p-0.5 rounded-lg text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setSidebarCurrencyFilter('ALL')}
                className={`flex-1 py-1 rounded-md transition-all ${sidebarCurrencyFilter === 'ALL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
              >
                Todos ({uploads.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarCurrencyFilter('USD')}
                className={`flex-1 py-1 rounded-md transition-all flex items-center justify-center gap-1 ${sidebarCurrencyFilter === 'USD' ? 'bg-emerald-600 text-white shadow-sm' : 'text-emerald-700 hover:bg-emerald-50'}`}
              >
                USD ({uploads.filter(u => (u.currency || 'USD') === 'USD').length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarCurrencyFilter('MXP')}
                className={`flex-1 py-1 rounded-md transition-all flex items-center justify-center gap-1 ${sidebarCurrencyFilter === 'MXP' ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-700 hover:bg-blue-50'}`}
              >
                MXP ({uploads.filter(u => u.currency === 'MXP').length})
              </button>
            </div>

            {uploads.length > 3 && (
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Buscar archivo..."
                className="w-full px-2.5 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
          </div>

          <div className="mt-4 space-y-2 max-h-[480px] overflow-y-auto pr-1 custom-scrollbar">
            {filteredUploads.length === 0 && !processing && (
              <div className="p-4 text-center text-xs text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                {uploads.length === 0 
                  ? 'No hay estados de cuenta cargados aún. Sube un PDF o imagen para comenzar.'
                  : 'No se encontraron estados de cuenta con los filtros actuales.'}
              </div>
            )}
            {filteredUploads.map((upload) => (
              <div
                key={upload.id}
                onClick={() => setActiveUploadId(upload.id!)}
                className={`p-3 rounded-xl border cursor-pointer transition-all group ${activeUploadId === upload.id ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-300 shadow-sm' : 'bg-white border-gray-100 hover:border-blue-200'}`}
              >
                <div className="flex justify-between items-start mb-1 gap-1">
                  <span className="text-xs font-bold text-gray-900 truncate max-w-[130px]" title={upload.fileName}>
                    {upload.fileName}
                  </span>
                  {isSuperAdminOrDirector && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); setConfirmModal({ isOpen: true, type: 'delete_upload', id: upload.id }); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title="Eliminar del historial (Solo Super Admin / Director)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex justify-between items-center text-[10px] text-gray-400">
                  <span>{format(upload.uploadDate instanceof Timestamp ? upload.uploadDate.toDate() : new Date(upload.uploadDate), 'dd/MM/yyyy HH:mm')}</span>
                  <span className={`font-bold px-1.5 py-0.2 rounded ${upload.currency === 'USD' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                    {upload.currency || 'USD'}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase ${upload.status === 'reconciled' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {upload.status === 'reconciled' ? 'Conciliado' : 'Pendiente'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="text-[10px]">
                    <span className="block text-gray-400">Ingresos</span>
                    <div className="flex flex-col">
                      <span className="font-bold text-green-600">${upload.totalIncomes.toLocaleString()} {upload.currency || 'USD'}</span>
                      {upload.reconciledIncomes !== undefined && (
                        <span className="text-[8px] text-green-700">Conciliado: ${upload.reconciledIncomes.toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px]">
                    <span className="block text-gray-400">Egresos</span>
                    <div className="flex flex-col">
                      <span className="font-bold text-red-600">${upload.totalExpenses.toLocaleString()} {upload.currency || 'USD'}</span>
                      {upload.reconciledExpenses !== undefined && (
                        <span className="text-[8px] text-red-700">Conciliado: ${upload.reconciledExpenses.toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-2.5 text-emerald-800">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-tight">
              <strong>Persistencia Garantizada:</strong> Cada estado de cuenta subido queda resguardado indefinidamente en la base de datos de auditoría.
            </p>
          </div>
        </div>
      </div>

      {/* Main Content: Records */}
      <div className="lg:col-span-3 space-y-6">
        {activeUploadId ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className={`bg-white p-6 rounded-2xl shadow-sm border transition-all cursor-pointer ${subTab === 'income' ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-100 hover:border-green-200'}`} onClick={() => setSubTab('income')}>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-50 rounded-xl">
                    <CheckSquare className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ingresos Detectados</p>
                    <div className="flex items-baseline gap-2">
                      <p className="text-2xl font-black text-gray-900">{stats.income.count}</p>
                      <p className="text-sm font-bold text-green-600">${stats.income.total.toLocaleString()} {uploads.find(u => u.id === activeUploadId)?.currency || 'USD'}</p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500 transition-all duration-500" 
                          style={{ width: `${stats.income.count > 0 ? (stats.income.reconciledCount / stats.income.count) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-green-700">
                        Conciliado: ${stats.income.reconciledTotal.toLocaleString()} ({stats.income.reconciledCount})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className={`bg-white p-6 rounded-2xl shadow-sm border transition-all cursor-pointer ${subTab === 'expense' ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-100 hover:border-red-200'}`} onClick={() => setSubTab('expense')}>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-red-50 rounded-xl">
                    <CheckSquare className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Egresos Detectados</p>
                    <div className="flex items-baseline gap-2">
                      <p className="text-2xl font-black text-gray-900">{stats.expense.count}</p>
                      <p className="text-sm font-bold text-red-600">${stats.expense.total.toLocaleString()} {uploads.find(u => u.id === activeUploadId)?.currency || 'USD'}</p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-red-500 transition-all duration-500" 
                          style={{ width: `${stats.expense.count > 0 ? (stats.expense.reconciledCount / stats.expense.count) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-red-700">
                        Conciliado: ${stats.expense.reconciledTotal.toLocaleString()} ({stats.expense.reconciledCount})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
              {/* Notification Banner */}
              {syncNotification && (
                <div className={`mx-6 mt-6 p-4 rounded-xl border flex items-center justify-between text-xs font-bold ${syncNotification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-blue-50 border-blue-200 text-blue-800'} animate-in fade-in duration-300`}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{syncNotification.message}</span>
                  </div>
                  <button onClick={() => setSyncNotification(null)} className="p-1 hover:bg-black/5 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="p-6 border-b border-gray-100 flex flex-wrap justify-between items-center gap-4 bg-gray-50/50">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    {subTab === 'income' ? 'Ingresos' : 'Egresos'} del Estado de Cuenta
                  </h3>
                  <p className="text-xs text-gray-500">
                    {subTab === 'income' 
                      ? 'Los ingresos se concilian automáticamente asociando su número de recibo sin duplicar pagos' 
                      : 'Selecciona los registros para conciliar o eliminar masivamente'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Export buttons */}
                  {selectedRecords.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleExportView('selected')}
                        className="px-3.5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-sm"
                        title="Exportar únicamente los registros seleccionados con número de recibo y categorías a CSV/Excel"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Exportar Seleccionados ({selectedRecords.length})
                      </button>
                      <button
                        onClick={() => handleExportView('filtered')}
                        className="px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all flex items-center gap-1.5 shadow-xs"
                        title="Exportar todos los registros de la vista actual"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Exportar Toda la Vista
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleExportView('filtered')}
                        className="px-3.5 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all flex items-center gap-1.5 shadow-xs"
                        title="Exportar vista actual con números de recibo, categorías y montos a formato CSV/Excel"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Exportar Vista (CSV/Excel)
                      </button>
                      <button
                        onClick={() => handleExportView('all')}
                        className="px-3 py-2 bg-gray-50 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-100 transition-all flex items-center gap-1.5 shadow-xs"
                        title="Exportar todos los movimientos (ingresos y egresos) del estado de cuenta actual"
                      >
                        <Layers className="w-3.5 h-3.5 text-gray-500" />
                        Exportar Todo
                      </button>
                    </div>
                  )}

                  {/* Sincronizar Recibos e Ingresos */}
                  {subTab === 'income' && records.some(r => r.type === 'income' && !r.reconciled) && (
                    <button
                      onClick={handleSyncWithExistingPayments}
                      disabled={syncingWithPayments}
                      className="px-3.5 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                      title="Escanear cobros e ingresos existentes para asociar su número de recibo y conciliar sin duplicar"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingWithPayments ? 'animate-spin' : ''}`} />
                      {syncingWithPayments ? 'Conciliando...' : 'Sincronizar Recibos e Ingresos'}
                    </button>
                  )}

                  {/* Bulk actions when records are selected */}
                  {selectedRecords.length > 0 && (
                    <>
                      <button
                        onClick={() => {
                          if (selectedRecords.length === 1) {
                            const rec = records.find(r => r.id === selectedRecords[0]);
                            setBulkCategoryData({
                              categoryId: rec?.categoryId || '',
                              subcategoryId: rec?.subcategoryId || ''
                            });
                          } else {
                            setBulkCategoryData({ categoryId: '', subcategoryId: '' });
                          }
                          setShowBulkCategoryModal(true);
                        }}
                        className="px-3.5 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-sm transition-all flex items-center gap-1.5"
                        title="Cambiar categoría y subcategoría masivamente a los registros seleccionados aunque ya estén conciliados"
                      >
                        <Tag className="w-3.5 h-3.5" />
                        Categoría Masiva ({selectedRecords.length})
                      </button>

                      <button
                        onClick={() => setConfirmModal({ isOpen: true, type: 'delete_records' })}
                        className="px-3.5 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-all flex items-center gap-1.5 border border-red-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Eliminar ({selectedRecords.length})
                      </button>

                      {selectedRecords.some(id => !records.find(r => r.id === id)?.reconciled) && (
                        <button
                          onClick={() => setConfirmModal({ isOpen: true, type: 'reconcile_records' })}
                          className="px-3.5 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 shadow-md shadow-green-200 transition-all flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Conciliar ({selectedRecords.filter(id => !records.find(r => r.id === id)?.reconciled).length})
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Selection banner for multiple or single selected records */}
              {selectedRecords.length > 0 && (
                <div className="bg-blue-50/90 border-b border-blue-100 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-blue-900 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold bg-blue-600 text-white px-2.5 py-0.5 rounded-full text-[11px] shadow-xs">
                      {selectedRecords.length} {selectedRecords.length === 1 ? 'registro seleccionado' : 'registros seleccionados'}
                    </span>
                    <span className="text-gray-700 font-medium">
                      Puedes hacer cambios masivos en categoría y subcategoría aunque los registros ya estén conciliados.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (selectedRecords.length === 1) {
                          const rec = records.find(r => r.id === selectedRecords[0]);
                          setBulkCategoryData({
                            categoryId: rec?.categoryId || '',
                            subcategoryId: rec?.subcategoryId || ''
                          });
                        } else {
                          setBulkCategoryData({ categoryId: '', subcategoryId: '' });
                        }
                        setShowBulkCategoryModal(true);
                      }}
                      className="px-3 py-1.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-xs"
                      title="Asignar categoría y subcategoría masiva a los registros seleccionados"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      Cambiar Categoría ({selectedRecords.length})
                    </button>
                    <button
                      onClick={() => handleExportView('selected')}
                      className="px-3 py-1.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-xs"
                      title="Exportar únicamente los registros seleccionados a CSV/Excel"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Exportar Selección
                    </button>
                    <button
                      onClick={() => setSelectedRecords([])}
                      className="px-2.5 py-1 text-gray-500 hover:text-gray-800 text-xs font-semibold hover:bg-black/5 rounded transition-colors"
                    >
                      Deseleccionar todos
                    </button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4 w-10">
                        <button onClick={handleSelectAll} className="p-1 hover:bg-gray-200 rounded transition-colors" title="Seleccionar todos los registros de la vista">
                          {selectedRecords.length === filteredRecords.length && selectedRecords.length > 0 ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-4 font-medium">Fecha</th>
                      <th className="px-6 py-4 font-medium">Descripción</th>
                      <th className="px-6 py-4 font-medium">No. Recibo</th>
                      <th className="px-6 py-4 font-medium">Categoría</th>
                      <th className="px-6 py-4 font-medium">Monto</th>
                      <th className="px-6 py-4 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRecords.map((record) => {
                      const category = categories.find(c => c.id === record.categoryId);
                      const subcategory = subcategories.find(s => s.id === record.subcategoryId);
                      const isSelected = selectedRecords.includes(record.id!);
                      
                      return (
                        <tr 
                          key={record.id} 
                          className={`transition-colors ${
                            isSelected 
                              ? 'bg-blue-50/70 border-l-4 border-l-blue-600 font-medium' 
                              : (record.reconciled ? 'bg-gray-50/40 hover:bg-gray-100/60' : 'hover:bg-gray-50')
                          }`}
                        >
                          <td className="px-6 py-4">
                            <button 
                              onClick={() => handleToggleSelect(record.id!)} 
                              className="p-1 hover:bg-gray-200 rounded transition-colors"
                              title={isSelected ? "Deseleccionar fila" : "Seleccionar fila"}
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-blue-600" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-400" />
                              )}
                            </button>
                          </td>
                          <td className="px-6 py-4 text-xs font-medium text-gray-600">{record.date}</td>
                          <td className="px-6 py-4">
                            <span className="text-sm font-bold text-gray-900 block truncate max-w-[200px]">{record.description}</span>
                            {record.reconciledType === 'auto_matched' && (
                              <span className="inline-block mt-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                                Auto-conciliado
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {record.receiptNumber ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md w-fit shadow-xs">
                                  <Receipt className="w-3.5 h-3.5 text-indigo-500" />
                                  {record.receiptNumber}
                                </span>
                                {record.matchedPaymentId && (
                                  <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-0.5">
                                    <CheckCircle2 className="w-2.5 h-2.5" /> Vinculado a Ingreso
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 italic">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {category ? (
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-blue-600">{category.name}</span>
                                {subcategory && <span className="text-[9px] text-gray-400">{subcategory.name}</span>}
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-400 italic">Sin categoría</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className={`text-sm font-bold ${record.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                                ${record.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {record.currency || uploads.find(u => u.id === activeUploadId)?.currency || 'USD'}
                              </span>
                              {(record.currency || uploads.find(u => u.id === activeUploadId)?.currency) === 'USD' && (
                                <span className="text-[10px] text-gray-400 font-bold">
                                  ${(record.amount * (record.exchangeRate || exchangeRate)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP
                                  <span className="ml-1 opacity-70 font-normal">(T.C. {record.exchangeRate || exchangeRate})</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end items-center gap-1.5">
                              <button
                                onClick={() => {
                                  setSelectedRecords([record.id!]);
                                  setBulkCategoryData({
                                    categoryId: record.categoryId || '',
                                    subcategoryId: record.subcategoryId || ''
                                  });
                                  setShowBulkCategoryModal(true);
                                }}
                                className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Cambiar categoría y subcategoría de este movimiento"
                              >
                                <Tag className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingRecord(record)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Editar detalles, categoría o recibo"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              {!record.reconciled ? (
                                <button
                                  onClick={() => reconcileRecord(record)}
                                  className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                  title="Conciliar"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              ) : (
                                <span className="text-green-600 flex items-center gap-1 text-[10px] font-bold bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Conciliado
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRecords.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                          No se detectaron {subTab === 'income' ? 'ingresos' : 'egresos'} en este estado de cuenta.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileText className="w-10 h-10 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Selecciona un Estado de Cuenta</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              Carga un nuevo archivo o selecciona uno del historial para comenzar el proceso de conciliación bancaria.
            </p>
          </div>
        )}
      </div>

      {/* Currency Selection Modal */}
      {showCurrencyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                <DollarSign className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Moneda del Estado de Cuenta</h3>
              <p className="text-xs text-gray-500 mt-1">
                Selecciona la divisa para que el motor de IA optimice la extracción de columnas, importes y fechas:
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => processFile('USD')}
                className="flex flex-col items-center gap-2 p-5 border-2 border-emerald-200 bg-emerald-50/50 rounded-2xl hover:border-emerald-500 hover:bg-emerald-100/60 transition-all text-center group shadow-sm"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-black text-sm shadow">
                  USD
                </div>
                <span className="text-sm font-bold text-gray-900">Dólares (USD)</span>
                <span className="text-[10px] text-gray-500 leading-tight">Bancos de EE.UU. o cuentas en dólares (Chase, BofA, Wells Fargo, etc.)</span>
              </button>

              <button
                type="button"
                onClick={() => processFile('MXP')}
                className="flex flex-col items-center gap-2 p-5 border-2 border-blue-200 bg-blue-50/50 rounded-2xl hover:border-blue-500 hover:bg-blue-100/60 transition-all text-center group shadow-sm"
              >
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-sm shadow">
                  MXP
                </div>
                <span className="text-sm font-bold text-gray-900">Pesos (MXP)</span>
                <span className="text-[10px] text-gray-500 leading-tight">Bancos nacionales (BBVA, Banorte, Santander, Banamex, etc.)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => { setShowCurrencyModal(false); setPendingFile(null); }}
              className="w-full mt-6 py-2.5 text-gray-400 text-xs font-bold hover:text-gray-600 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Editar Registro</h3>
              <button onClick={() => setEditingRecord(null)}>
                <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleUpdateRecord} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Descripción</label>
                <input
                  type="text"
                  value={editingRecord.description}
                  onChange={e => setEditingRecord({ ...editingRecord, description: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">No. de Recibo</label>
                <div className="relative">
                  <Receipt className="w-4 h-4 text-gray-400 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    placeholder="Ej. REC-1042 o WOO-#45"
                    value={editingRecord.receiptNumber || ''}
                    onChange={e => setEditingRecord({ ...editingRecord, receiptNumber: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono font-bold"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Monto ({editingRecord.currency || uploads.find(u => u.id === editingRecord.uploadId)?.currency || 'USD'})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingRecord.amount}
                    onChange={e => setEditingRecord({ ...editingRecord, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Moneda</label>
                  <select
                    value={editingRecord.currency || uploads.find(u => u.id === editingRecord.uploadId)?.currency || 'USD'}
                    onChange={e => setEditingRecord({ ...editingRecord, currency: e.target.value as 'USD' | 'MXP' })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  >
                    <option value="USD">USD</option>
                    <option value="MXP">MXP</option>
                  </select>
                </div>
              </div>

              {(editingRecord.currency || uploads.find(u => u.id === editingRecord.uploadId)?.currency) === 'USD' && (
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo de Cambio</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingRecord.exchangeRate || exchangeRate}
                      onChange={e => setEditingRecord({ ...editingRecord, exchangeRate: parseFloat(e.target.value) || 0 })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex justify-between items-center">
                    <span className="text-blue-700 font-bold text-xs">Equivalente MXP:</span>
                    <span className="text-lg font-black text-blue-800">
                      ${(editingRecord.amount * (editingRecord.exchangeRate || exchangeRate)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Categoría</label>
                  <select
                    value={editingRecord.categoryId || ''}
                    onChange={e => setEditingRecord({ ...editingRecord, categoryId: e.target.value, subcategoryId: '' })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  >
                    <option value="">Seleccionar</option>
                    {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Subcategoría</label>
                  <select
                    value={editingRecord.subcategoryId || ''}
                    onChange={e => setEditingRecord({ ...editingRecord, subcategoryId: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    disabled={!editingRecord.categoryId}
                  >
                    <option value="">Seleccionar</option>
                    {subcategories.filter(s => s.categoryId === editingRecord.categoryId).map(sub => (
                      <option key={sub.id} value={sub.id}>{sub.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="p-4 bg-gray-50 rounded-xl space-y-3">
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${editingRecord.type === 'income' ? (editingRecord.isClientIncome ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300') : 'opacity-50 pointer-events-none'}`}>
                      {editingRecord.isClientIncome && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                    <input 
                      type="checkbox" 
                      className="hidden" 
                      checked={editingRecord.isClientIncome || false}
                      onChange={e => setEditingRecord({ ...editingRecord, isClientIncome: e.target.checked, isProviderExpense: false })}
                      disabled={editingRecord.type !== 'income'}
                    />
                    <span className="text-sm font-bold text-gray-700">¿Es Ingreso de Cliente?</span>
                  </label>

                  {editingRecord.isClientIncome && (
                    <div className="pl-8 animate-in slide-in-from-top-2 duration-200">
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase">Seleccionar Cliente</label>
                        <button 
                          type="button"
                          onClick={() => setShowQuickAddClient(true)}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Nuevo
                        </button>
                      </div>
                      <select
                        value={editingRecord.clientId || ''}
                        onChange={e => setEditingRecord({ ...editingRecord, clientId: e.target.value })}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Seleccionar Cliente</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.type === 'Individual' ? `${c.firstName} ${c.lastName}` : (c.commercialName || c.legalName)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${editingRecord.type === 'expense' ? (editingRecord.isProviderExpense ? 'bg-red-600 border-red-600' : 'bg-white border-gray-300') : 'opacity-50 pointer-events-none'}`}>
                      {editingRecord.isProviderExpense && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                    <input 
                      type="checkbox" 
                      className="hidden" 
                      checked={editingRecord.isProviderExpense || false}
                      onChange={e => setEditingRecord({ ...editingRecord, isProviderExpense: e.target.checked, isClientIncome: false })}
                      disabled={editingRecord.type !== 'expense'}
                    />
                    <span className="text-sm font-bold text-gray-700">¿Es Pago a Proveedor?</span>
                  </label>

                  {editingRecord.isProviderExpense && (
                    <div className="pl-8 animate-in slide-in-from-top-2 duration-200">
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase">Seleccionar Proveedor</label>
                        <button 
                          type="button"
                          onClick={() => setShowQuickAddProvider(true)}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Nuevo
                        </button>
                      </div>
                      <select
                        value={editingRecord.providerId || ''}
                        onChange={e => setEditingRecord({ ...editingRecord, providerId: e.target.value })}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-red-500"
                      >
                        <option value="">Seleccionar Proveedor</option>
                        {providers.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.commercialName || p.legalName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Duplicate Warning Modal */}
      {duplicateWarning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 text-amber-600 mb-6">
              <AlertCircle className="w-8 h-8" />
              <h3 className="text-xl font-bold">Posible Duplicado Detectado</h3>
            </div>
            
            <p className="text-gray-600 mb-6">
              Se han encontrado registros con el mismo monto y tipo en fechas cercanas. ¿Deseas continuar con la conciliación?
            </p>

            <div className="space-y-4 mb-8">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                <span className="text-[10px] font-bold text-blue-600 uppercase block mb-1">Registro Nuevo</span>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-gray-900">{duplicateWarning.record.description}</span>
                  <span className="text-sm font-bold text-blue-600">${duplicateWarning.record.amount.toLocaleString()}</span>
                </div>
                <span className="text-xs text-gray-500">{duplicateWarning.record.date}</span>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase block">Ingresos/Pagos Existentes Coincidentes</span>
                {duplicateWarning.existing.map(p => (
                  <div key={p.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex justify-between items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-gray-800 truncate">{p.notes || 'Ingreso registrado'}</span>
                        {p.receiptNumber && (
                          <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-200">
                            #{p.receiptNumber}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 block mt-0.5">
                        {formatDisplayDate(p.date)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-bold text-gray-900">${p.amount.toLocaleString()}</span>
                      <button
                        type="button"
                        onClick={() => handleUseExistingPayment(duplicateWarning.record, p)}
                        className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 shadow-sm transition-all flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Vincular
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDuplicateWarning(null)}
                className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => { reconcileRecord(duplicateWarning.record, true); setDuplicateWarning(null); }}
                className="flex-1 px-4 py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 shadow-lg shadow-amber-200 transition-all text-sm"
                title="Crea un nuevo pago adicional en el sistema"
              >
                Crear Nuevo Pago
              </button>
              <button
                onClick={() => { 
                  if (duplicateWarning.existing.length > 0) {
                    handleUseExistingPayment(duplicateWarning.record, duplicateWarning.existing[0]);
                  } else {
                    setDuplicateWarning(null);
                  }
                }}
                className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all text-sm flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                Vincular (No Duplicar)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Client Modal */}
      {showQuickAddClient && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Rápido: Nuevo Cliente</h3>
              <button onClick={() => setShowQuickAddClient(false)}>
                <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleQuickAddClient} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo de Cliente</label>
                <div className="flex gap-2">
                  {(['Individual', 'Agent', 'Corporate'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setQuickClient({ ...quickClient, type })}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${quickClient.type === type ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                    >
                      {type === 'Individual' ? 'Individual' : type === 'Agent' ? 'Agente' : 'Corp'}
                    </button>
                  ))}
                </div>
              </div>

              {quickClient.type === 'Individual' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre</label>
                    <input
                      type="text"
                      required
                      value={quickClient.firstName}
                      onChange={e => setQuickClient({ ...quickClient, firstName: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Apellido</label>
                    <input
                      type="text"
                      required
                      value={quickClient.lastName}
                      onChange={e => setQuickClient({ ...quickClient, lastName: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre Comercial</label>
                    <input
                      type="text"
                      required
                      value={quickClient.commercialName}
                      onChange={e => setQuickClient({ ...quickClient, commercialName: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Razón Social</label>
                    <input
                      type="text"
                      required
                      value={quickClient.legalName}
                      onChange={e => setQuickClient({ ...quickClient, legalName: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">RFC</label>
                  <input
                    type="text"
                    required
                    value={quickClient.rfc}
                    onChange={e => setQuickClient({ ...quickClient, rfc: e.target.value.toUpperCase() })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={quickClient.email}
                    onChange={e => setQuickClient({ ...quickClient, email: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none text-sm"
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowQuickAddClient(false)}
                  className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Provider Modal */}
      {showQuickAddProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Rápido: Nuevo Proveedor</h3>
              <button onClick={() => setShowQuickAddProvider(false)}>
                <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleQuickAddProvider} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre Comercial</label>
                <input
                  type="text"
                  required
                  value={quickProvider.commercialName}
                  onChange={e => setQuickProvider({ ...quickProvider, commercialName: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  placeholder="Ej: Papelería ABC"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre Legal / Razón Social</label>
                <input
                  type="text"
                  required
                  value={quickProvider.legalName}
                  onChange={e => setQuickProvider({ ...quickProvider, legalName: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">RFC</label>
                  <input
                    type="text"
                    required
                    value={quickProvider.rfc}
                    onChange={e => setQuickProvider({ ...quickProvider, rfc: e.target.value.toUpperCase() })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={quickProvider.email}
                    onChange={e => setQuickProvider({ ...quickProvider, email: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Categoría</label>
                <select
                  required
                  value={quickProvider.categoryId}
                  onChange={e => setQuickProvider({ ...quickProvider, categoryId: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="">Seleccionar Categoría</option>
                  {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowQuickAddProvider(false)}
                  className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Cambio Masivo de Categoría y Subcategoría (Aplica a seleccionados incluso ya conciliados) */}
      {showBulkCategoryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                  <Tag className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">
                    Cambio Masivo de Categoría
                  </h3>
                  <p className="text-xs text-gray-500">
                    {selectedRecords.length === 1 
                      ? '1 movimiento seleccionado' 
                      : `${selectedRecords.length} movimientos seleccionados`}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowBulkCategoryModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-900 space-y-2">
              <div className="font-bold flex items-center gap-2 text-blue-800">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                Actualización masiva (conciliados y pendientes)
              </div>
              <p className="text-blue-700 leading-relaxed">
                Asigna una nueva categoría y subcategoría a los <strong>{selectedRecords.length}</strong> movimientos seleccionados. Los movimientos que ya estén conciliados actualizarán en automático su comprobante de pago en el sistema.
              </p>
              {(() => {
                const selRecs = records.filter(r => selectedRecords.includes(r.id!));
                const reconciledCount = selRecs.filter(r => r.reconciled).length;
                const pendingCount = selRecs.length - reconciledCount;
                return (
                  <div className="pt-2 border-t border-blue-200/60 flex items-center gap-4 text-[11px] font-bold text-blue-800">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Ya Conciliados: {reconciledCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      Pendientes: {pendingCount}
                    </span>
                  </div>
                );
              })()}
            </div>

            <form onSubmit={handleApplyBulkCategory} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Categoría <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={bulkCategoryData.categoryId}
                  onChange={e => setBulkCategoryData({ categoryId: e.target.value, subcategoryId: '' })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                >
                  <option value="">-- Seleccionar Categoría --</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Subcategoría (Opcional)
                </label>
                <select
                  value={bulkCategoryData.subcategoryId}
                  onChange={e => setBulkCategoryData({ ...bulkCategoryData, subcategoryId: e.target.value })}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium disabled:opacity-50"
                  disabled={!bulkCategoryData.categoryId}
                >
                  <option value="">-- Sin Subcategoría / Conservar vacía --</option>
                  {subcategories
                    .filter(s => s.categoryId === bulkCategoryData.categoryId)
                    .map(sub => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                </select>
                {!bulkCategoryData.categoryId && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Selecciona primero una categoría para habilitar sus subcategorías disponibles.
                  </p>
                )}
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowBulkCategoryModal(false)}
                  className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!bulkCategoryData.categoryId || processing}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Aplicando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Guardar Cambios ({selectedRecords.length})
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, type: 'delete_upload' })}
        onConfirm={() => {
          if (confirmModal.type === 'delete_upload') handleDeleteUpload(confirmModal.id!);
          if (confirmModal.type === 'delete_records') handleBulkDelete();
          if (confirmModal.type === 'reconcile_records') handleBulkReconcile();
        }}
        title={
          confirmModal.type === 'delete_upload' ? 'Eliminar Historial' :
          confirmModal.type === 'delete_records' ? 'Eliminar Registros' : 'Conciliar Registros'
        }
        message={
          confirmModal.type === 'delete_upload' ? '¿Estás seguro de eliminar este estado de cuenta y todos sus registros asociados?' :
          confirmModal.type === 'delete_records' ? `¿Estás seguro de eliminar los ${selectedRecords.length} registros seleccionados?` :
          `¿Estás seguro de conciliar los ${selectedRecords.length} registros seleccionados? Se crearán los pagos correspondientes.`
        }
      />
    </div>
  );
}
