import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, where, getDocs, writeBatch, Timestamp, increment } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { StatementUpload, StatementRecord, Category, Subcategory, UserProfile, Payment, Client, Provider } from '../types';
import { Plus, Trash2, Edit2, Save, X, FileText, Upload, CheckCircle2, AlertCircle, ChevronRight, ChevronDown, Filter, Search, MoreVertical, CheckSquare, Square, ArrowRightLeft, History, DollarSign, Building2, User } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import ConfirmModal from './ConfirmModal';
import { format } from 'date-fns';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function StatementOCRManager({ profile, onReconcile, exchangeRate = 17.5 }: { profile: UserProfile | null; onReconcile?: (type: 'income' | 'expense') => void; exchangeRate?: number }) {
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
  const [showQuickAddProvider, setShowQuickAddProvider] = useState(false);
  const [showQuickAddClient, setShowQuickAddClient] = useState(false);
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
    const unsubUploads = onSnapshot(query(collection(db, 'statementUploads'), orderBy('uploadDate', 'desc')), (snap) => {
      setUploads(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StatementUpload)));
      setLoading(false);
    });

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

    const unsubRecords = onSnapshot(
      query(collection(db, 'statementRecords'), where('uploadId', '==', activeUploadId), orderBy('date', 'asc')),
      (snap) => {
        setRecords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StatementRecord)));
      }
    );

    return unsubRecords;
  }, [activeUploadId]);

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
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(file);
      });
      const base64Data = await base64Promise;

      // 2. Call Gemini for OCR
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            parts: [
              {
                text: "Extract all transactions from this bank statement. Classify each transaction as either an 'income' or 'expense' with absolute precision.\n" +
                      "Instructions for Classification:\n" +
                      "1. Identify 'income' (ingresos / abonos / depósitos / créditos / transferencias recibidas / intereses ganados / dividendos / devoluciones) when money enters the account. Look for transactions under headers like 'Abonos', 'Depósitos', 'Crédito', 'Deposits', 'Credits', 'Inflow', 'Debe', or values with a positive sign (+) or values under inflow columns.\n" +
                      "2. Identify 'expense' (egresos / cargos / retiros / débitos / pago / comisión / transferencias enviadas / compras / consumos) when money leaves the account. Look for transactions under headers like 'Cargos', 'Retiros', 'Débito', 'Withdrawals', 'Debits', 'Outflow', 'Haber', or values with a negative sign (-) or values under outflow columns.\n" +
                      "3. If a column contains both types, look for negative/positive signs or key phrases ('pago', 'retiro', 'depósito') to categorize them.\n" +
                      "4. The 'amount' field must ALWAYS be a positive number, regardless of how it is written in the document.\n" +
                      "5. Extract the date as YYYY-MM-DD. If only day and month are present, infer the year from the bank statement's statement period or header.\n" +
                      "Return a JSON array of objects with the specified schema."
              },
              { inlineData: { mimeType: file.type, data: base64Data } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                description: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                type: { type: Type.STRING, enum: ["income", "expense"] }
              },
              required: ["date", "description", "amount", "type"]
            }
          }
        }
      });

      const parsedRecords = JSON.parse(response.text);
      
      // 3. Calculate totals
      const totalIncomes = parsedRecords.reduce((acc: number, r: any) => r.type === 'income' ? acc + r.amount : acc, 0);
      const totalExpenses = parsedRecords.reduce((acc: number, r: any) => r.type === 'expense' ? acc + r.amount : acc, 0);

      // 4. Create Upload record
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
        createdAt: serverTimestamp()
      });

      // 5. Create individual records
      const batch = writeBatch(db);
      parsedRecords.forEach((r: any) => {
        const recordRef = doc(collection(db, 'statementRecords'));
        batch.set(recordRef, {
          uploadId: uploadRef.id,
          date: r.date,
          description: r.description,
          amount: r.amount,
          type: r.type,
          currency,
          reconciled: false,
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();

      setActiveUploadId(uploadRef.id);
    } catch (error) {
      console.error("OCR Error:", error);
      alert("Error al procesar el estado de cuenta. Por favor intenta de nuevo.");
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
    const unreconciled = filteredRecords.filter(r => !r.reconciled).map(r => r.id!);
    if (selectedRecords.length === unreconciled.length && unreconciled.length > 0) {
      setSelectedRecords([]);
    } else {
      setSelectedRecords(unreconciled);
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

  const checkDuplicates = async (record: StatementRecord) => {
    const q = query(
      collection(db, 'payments'),
      where('amount', '==', record.amount),
      where('type', '==', record.type === 'income' ? 'client_payment' : 'provider_payment')
    );
    const snap = await getDocs(q);
    const existing = snap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
    
    // Simple date proximity check (within 3 days)
    const recordDate = new Date(record.date);
    const duplicates = existing.filter(p => {
      const pDate = p.date instanceof Timestamp ? p.date.toDate() : new Date(p.date);
      const diff = Math.abs(pDate.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 3;
    });

    return duplicates;
  };

  const reconcileRecord = async (record: StatementRecord, skipDuplicateCheck = false, batch?: any) => {
    if (!profile) return;
    
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
      
      // 1. Create Payment
      const paymentRef = doc(collection(db, 'payments'));
      const upload = uploads.find(u => u.id === record.uploadId);
      const currency = record.currency || upload?.currency || 'USD';
      
      const paymentData: any = {
        currency: currency,
        type: record.isClientIncome ? 'client_payment' : (record.isProviderExpense ? 'provider_payment' : (record.type === 'income' ? 'client_payment' : 'provider_payment')),
        status: 'completed',
        date: Timestamp.fromDate(new Date(record.date)),
        notes: `Conciliado de: ${record.description}`,
        insuranceId: 'conciliacion_bancaria',
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

      // 2. Mark record as reconciled
      activeBatch.update(doc(db, 'statementRecords', record.id!), {
        reconciled: true,
        reconciledAt: serverTimestamp()
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
      
      for (const id of selectedRecords) {
        const record = records.find(r => r.id === id);
        if (record) {
          // Skip duplicate check for bulk to avoid multiple modals
          await reconcileRecord(record, true, batch);
          types.push(record.type);
        }
      }
      
      await batch.commit();
      
      const uniqueTypes = Array.from(new Set(types));
      
      setSelectedRecords([]);
      setConfirmModal({ isOpen: false, type: 'reconcile_records' });

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
      await updateDoc(doc(db, 'statementRecords', id!), data);
      setEditingRecord(null);
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
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            Historial
          </h3>
          
          <label className="block w-full">
            <div className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${processing ? 'bg-gray-50 border-gray-200' : 'border-blue-200 hover:border-blue-400 hover:bg-blue-50'}`}>
              {processing ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-bold text-gray-500">Procesando OCR...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-6 h-6 text-blue-600" />
                  <span className="text-xs font-bold text-gray-600">Cargar Estado de Cuenta</span>
                  <span className="text-[10px] text-gray-400">PDF o Imagen</span>
                </div>
              )}
              <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={processing} />
            </div>
          </label>

          <div className="mt-6 space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                onClick={() => setActiveUploadId(upload.id!)}
                className={`p-3 rounded-xl border cursor-pointer transition-all group ${activeUploadId === upload.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-200' : 'bg-white border-gray-100 hover:border-blue-200'}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-bold text-gray-900 truncate max-w-[120px]">{upload.fileName}</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setConfirmModal({ isOpen: true, type: 'delete_upload', id: upload.id }); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex justify-between items-center text-[10px] text-gray-400">
                  <span>{format(upload.uploadDate instanceof Timestamp ? upload.uploadDate.toDate() : new Date(upload.uploadDate), 'dd/MM/yyyy HH:mm')}</span>
                  <span className="font-bold text-blue-600">{upload.currency || 'USD'}</span>
                  <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase ${upload.status === 'reconciled' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {upload.status === 'reconciled' ? 'Conciliado' : 'Pendiente'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="text-[10px]">
                    <span className="block text-gray-400">Ingresos</span>
                    <div className="flex flex-col">
                      <span className="font-bold text-green-600">${upload.totalIncomes.toLocaleString()}</span>
                      {upload.reconciledIncomes !== undefined && (
                        <span className="text-[8px] text-green-700">Conciliado: ${upload.reconciledIncomes.toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px]">
                    <span className="block text-gray-400">Egresos</span>
                    <div className="flex flex-col">
                      <span className="font-bold text-red-600">${upload.totalExpenses.toLocaleString()}</span>
                      {upload.reconciledExpenses !== undefined && (
                        <span className="text-[8px] text-red-700">Conciliado: ${upload.reconciledExpenses.toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
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
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    {subTab === 'income' ? 'Ingresos' : 'Egresos'} del Estado de Cuenta
                  </h3>
                  <p className="text-xs text-gray-500">Selecciona los registros para conciliar o eliminar masivamente</p>
                </div>
                <div className="flex gap-2">
                  {selectedRecords.length > 0 && (
                    <>
                      <button
                        onClick={() => setConfirmModal({ isOpen: true, type: 'delete_records' })}
                        className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-all flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar ({selectedRecords.length})
                      </button>
                      <button
                        onClick={() => setConfirmModal({ isOpen: true, type: 'reconcile_records' })}
                        className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 shadow-lg shadow-green-200 transition-all flex items-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Conciliar ({selectedRecords.length})
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4 w-10">
                        <button onClick={handleSelectAll} className="p-1 hover:bg-gray-200 rounded transition-colors">
                          {selectedRecords.length === filteredRecords.filter(r => !r.reconciled).length && selectedRecords.length > 0 ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-4 font-medium">Fecha</th>
                      <th className="px-6 py-4 font-medium">Descripción</th>
                      <th className="px-6 py-4 font-medium">Categoría</th>
                      <th className="px-6 py-4 font-medium">Monto</th>
                      <th className="px-6 py-4 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRecords.map((record) => {
                      const category = categories.find(c => c.id === record.categoryId);
                      const subcategory = subcategories.find(s => s.id === record.subcategoryId);
                      
                      return (
                        <tr key={record.id} className={`hover:bg-gray-50 transition-colors ${record.reconciled ? 'opacity-50 grayscale' : ''}`}>
                          <td className="px-6 py-4">
                            {!record.reconciled && (
                              <button onClick={() => handleToggleSelect(record.id!)} className="p-1 hover:bg-gray-200 rounded transition-colors">
                                {selectedRecords.includes(record.id!) ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs font-medium text-gray-600">{record.date}</td>
                          <td className="px-6 py-4">
                            <span className="text-sm font-bold text-gray-900 block truncate max-w-[200px]">{record.description}</span>
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
                            <div className="flex justify-end gap-2">
                              {!record.reconciled && (
                                <>
                                  <button
                                    onClick={() => setEditingRecord(record)}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Editar"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => reconcileRecord(record)}
                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                    title="Conciliar"
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                              {record.reconciled && (
                                <span className="text-green-600 flex items-center gap-1 text-[10px] font-bold">
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
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
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
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 animate-in fade-in zoom-in duration-200">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <DollarSign className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Seleccionar Moneda</h3>
              <p className="text-sm text-gray-500 mt-2">
                ¿En qué moneda están expresadas las transacciones de este estado de cuenta?
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => processFile('MXP')}
                className="flex flex-col items-center gap-2 p-4 border-2 border-gray-100 rounded-2xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
              >
                <span className="text-2xl font-black text-gray-300 group-hover:text-blue-600">MXP</span>
                <span className="text-xs font-bold text-gray-500">Pesos Mexicanos</span>
              </button>
              <button
                onClick={() => processFile('USD')}
                className="flex flex-col items-center gap-2 p-4 border-2 border-gray-100 rounded-2xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
              >
                <span className="text-2xl font-black text-gray-300 group-hover:text-blue-600">USD</span>
                <span className="text-xs font-bold text-gray-500">Dólares</span>
              </button>
            </div>

            <button
              onClick={() => { setShowCurrencyModal(false); setPendingFile(null); }}
              className="w-full mt-6 py-3 text-gray-400 text-sm font-bold hover:text-gray-600 transition-colors"
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
                <span className="text-[10px] font-bold text-gray-400 uppercase block">Registros Existentes</span>
                {duplicateWarning.existing.map(p => (
                  <div key={p.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-gray-700 block">{p.notes || 'Sin notas'}</span>
                      <span className="text-[10px] text-gray-400">
                        {format(p.date instanceof Timestamp ? p.date.toDate() : new Date(p.date), 'dd/MM/yyyy')}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-gray-900">${p.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDuplicateWarning(null)}
                className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={() => { reconcileRecord(duplicateWarning.record, true); setDuplicateWarning(null); }}
                className="flex-1 px-4 py-3 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 shadow-lg shadow-amber-200 transition-all"
              >
                Mantener Ambos
              </button>
              <button
                onClick={() => { 
                  // Logic to "keep only one" would mean marking as reconciled without creating a new payment
                  updateDoc(doc(db, 'statementRecords', duplicateWarning.record.id!), { reconciled: true, reconciledAt: serverTimestamp() });
                  setDuplicateWarning(null);
                }}
                className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
              >
                Usar Existente
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
